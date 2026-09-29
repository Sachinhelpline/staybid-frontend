// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — BOOTSTRAP: PRODUCTION DIRECT-PostgreSQL clock sampler (OFFLINE candidate). Node built-ins only
// at module load; the real `pg` driver is imported lazily by the ACCEPTED factory, only when a connection opens.
//
// The bootstrap clock source is a DIRECT, bounded, read-only PostgreSQL session against the exact anchored
// AI-STAGING Railway PostgreSQL service — NOT Supabase, NOT PostgREST, NOT SB_URL, NOT any HTTP clock. It reuses
// the accepted `makePgPhysicalFactory` (byte-unchanged, imported) to open ONE physical connection from an env
// NAME (value never returned/logged), hardens it read-only + statement_timeout using the accepted fixed lifecycle
// statements, then exposes ONLY the fixed clock probe (the sole SQL it will ever run) — no arbitrary SQL surface
// reaches the bootstrap caller. On a dead connection it transparently reopens on the next sample. The reader uses
// its reader credential; the attester uses its observer credential; the executor credential is never used here.
// ─────────────────────────────────────────────────────────────────────────
import { performance } from "node:perf_hooks";
import { makePgPhysicalFactory, LIFECYCLE_SQL } from "../private-reader-production-integration-offline-01/reader-session.mjs";
import { makeDbClockProbe, DB_CLOCK_QUERY, DEFAULT_PROBE_DEADLINE_MS, READER_ROLE } from "./db-clock-probe.mjs";
import { takeSample, defaultMonoNowUs } from "./clock-interval.mjs";

export const PRODUCTION_CLOCK_VERSION = "reader-bootstrap-production-clock-v1";

/**
 * Build a production clock sampler backed by a direct PostgreSQL session.
 * @param deps.env process environment (read-only; secret VALUE consumed only inside the accepted factory)
 * @param deps.connectionStringEnvName env NAME holding the read-only DB URL (reader OR observer credential)
 * @param deps.expectedFingerprint 64-hex anchored cluster fingerprint enforced on every probe (required in production)
 * @param deps.readerRole role name whose OID feeds the fingerprint (default the accepted live_ai_03b_reader)
 * @param deps.statementTimeoutMs session statement_timeout (ms, within the frozen bound)
 * @param deps.connectTimeoutMs / deps.deadlineMs bounds
 * Returns { takeSampleFn, monoNowUs, close }.
 */
// ── M5 clock-recovery remediation — connection-level SINGLE-FLIGHT helpers ─────────────────────────────────────
// Invariant: AT MOST ONE clock DB query is ever outstanding on a given physical connection. A probe that is still
// unresolved when its bounded deadline fires (or that failed at the driver) RETIRES its physical: it is marked
// dead + detached immediately and closed within a bound; the next probe opens a fresh, re-hardened read-only
// session. No query is ever issued on a physical that still has unresolved work, and nothing queues behind it.
export const CLOCK_CLOSE_DEADLINE_MS = 2000;     // bound on awaiting a retired session's close
function boundedClose(p, ms, onTimeout) {
  let t; const d = new Promise((res) => { t = setTimeout(() => { try { onTimeout(); } catch {} res(false); }, Math.max(1, ms)); });
  const c = Promise.resolve().then(() => p.close()).then(() => true, () => true);
  return Promise.race([c, d]).finally(() => clearTimeout(t));
}
function withHardenDeadline(promise, ms) {
  let t; const d = new Promise((_, rej) => { t = setTimeout(() => rej(new Error("clock_session_harden_deadline")), Math.max(1, ms)); });
  return Promise.race([promise, d]).finally(() => clearTimeout(t));
}
/** Promise-chain serializer: calls run strictly one after another (no overlap, bounded by the caller's cadence). */
function makeSerializer() {
  let tail = Promise.resolve();
  return (fn) => { const run = tail.then(fn, fn); tail = run.then(() => {}, () => {}); return run; };
}

export function makeProductionClockSampler(deps) {
  const { env, connectionStringEnvName, expectedFingerprint, readerRole = READER_ROLE,
    statementTimeoutMs = 2000, connectTimeoutMs = 5000, deadlineMs = DEFAULT_PROBE_DEADLINE_MS,
    closeDeadlineMs = CLOCK_CLOSE_DEADLINE_MS, physicalFactory } = deps || {};
  if (!env || typeof env !== "object") throw new Error("clock_sampler_env_required");
  if (typeof connectionStringEnvName !== "string" || !connectionStringEnvName) throw new Error("clock_sampler_conn_name_required");
  if (typeof expectedFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(expectedFingerprint)) throw new Error("clock_sampler_fingerprint_required");
  if (!Number.isInteger(statementTimeoutMs) || statementTimeoutMs < 1) throw new Error("clock_sampler_statement_timeout_invalid");

  // `physicalFactory` is a TEST-ONLY seam (a fake pg-like physical); production always uses the accepted factory.
  const factory = physicalFactory && typeof physicalFactory.open === "function"
    ? physicalFactory : makePgPhysicalFactory({ env, connectionStringEnvName, connectTimeoutMs });
  let physical = null;
  let opening = null;
  // Shutdown containment: MONOTONIC lifecycle OPEN → CLOSED, committed SYNCHRONOUSLY when close() begins. Once
  // CLOSED no factory.open() is initiated, no SQL starts (run() is the single choke point), no sample starts,
  // queued callers fail closed, and a late-completing open is retired instead of installed. Never reopens.
  let closed = false;
  const retired = new WeakSet();          // physicals that must never carry another query
  const active = new WeakMap();           // physical → outstanding query count (asserted ≤ 1)
  const st = { opened: 0, openFailures: 0, retiredUnresolved: 0, retiredFailed: 0, closeTimeouts: 0,
    cancelledBeforeQuery: 0, samples: 0, maxConcurrentQueriesPerPhysical: 0, concurrencyViolations: 0,
    opensStarted: 0, sqlStarted: 0, lateOpensRetired: 0, refusedAfterClose: 0 };

  async function run(p, sql, params) {    // the ONLY place a query reaches a physical
    if (closed || retired.has(p)) { st.refusedAfterClose += closed ? 1 : 0; throw new Error(closed ? "clock_sampler_closed" : "clock_session_retired"); }
    const n = (active.get(p) || 0) + 1;
    if (n > 1) { st.concurrencyViolations++; throw new Error("clock_physical_busy"); }   // defence in depth: never overlap
    active.set(p, n); if (n > st.maxConcurrentQueriesPerPhysical) st.maxConcurrentQueriesPerPhysical = n;
    st.sqlStarted++;
    try { return await p.query(sql, params); } finally { active.set(p, (active.get(p) || 1) - 1); }
  }
  function usable(p) { return !!p && !retired.has(p) && !(typeof p.isDead === "function" && p.isDead()); }
  function retire(p, why) {
    if (!p || retired.has(p)) return;
    retired.add(p);
    if (why === "unresolved") st.retiredUnresolved++; else st.retiredFailed++;
    if (physical === p) physical = null;                                  // detach now; next probe reopens
    void boundedClose(p, closeDeadlineMs, () => { st.closeTimeouts++; }); // close() marks dead synchronously first
  }

  function retireLate(p) {                // a physical that finished opening after close(): never usable
    if (!p || retired.has(p)) return;
    retired.add(p); st.lateOpensRetired++;
    if (physical === p) physical = null;
    void boundedClose(p, closeDeadlineMs, () => { st.closeTimeouts++; });
  }
  async function ensure() {
    if (closed) { st.refusedAfterClose++; throw new Error("clock_sampler_closed"); }
    if (usable(physical)) return physical;
    if (opening) return opening;
    physical = null;
    opening = (async () => {
      let p;
      st.opensStarted++;
      try { p = await factory.open(); } catch (e) { st.openFailures++; throw e; }   // reader_db_url_absent / reader_db_connect_failed
      if (closed) { retireLate(p); throw new Error("clock_sampler_closed"); }       // late open: retire, never harden/install
      try {
        // each step re-checks retirement, so a harden sequence abandoned at its deadline issues nothing further
        const step = (sql, params) => { if (retired.has(p)) throw new Error("clock_session_retired"); return run(p, sql, params); };
        await withHardenDeadline((async () => {
          await step(LIFECYCLE_SQL.setStatementTimeout, [String(statementTimeoutMs) + "ms"]);
          await step(LIFECYCLE_SQL.setReadOnly, []);
          const ro = await step(LIFECYCLE_SQL.readReadOnly, []);
          if (!ro || !ro.rows || !ro.rows[0] || ro.rows[0].v !== "on") throw new Error("read_only_not_applied");
        })(), deadlineMs);
      } catch (e) {
        if (closed) { retireLate(p); throw new Error("clock_sampler_closed"); }
        st.openFailures++; retired.add(p); void boundedClose(p, closeDeadlineMs, () => { st.closeTimeouts++; }); throw new Error("clock_session_harden_failed");
      }
      if (closed) { retireLate(p); throw new Error("clock_sampler_closed"); }         // closed during harden: never install
      if (typeof p.onDead === "function") p.onDead(() => { if (physical === p) physical = null; });
      st.opened++;
      physical = p; return p;
    })();
    try { return await opening; } finally { opening = null; }
  }

  // The ONLY SQL this adapter will run is the fixed clock probe. Anything else fails closed. `attempt` is the
  // single current sample (samples are serialized); a probe whose deadline already fired is CANCELLED so a late
  // ensure() can never issue a query after its sample has been abandoned.
  let attempt = null;
  let closePromise = null;
  const query = async (sql, params) => {
    if (sql !== DB_CLOCK_QUERY) throw new Error("clock_query_not_permitted");
    const a = attempt;
    const p = await ensure();
    if (closed) { st.refusedAfterClose++; throw new Error("clock_sampler_closed"); }
    if (!a || a.cancelled) { st.cancelledBeforeQuery++; throw new Error("clock_probe_cancelled"); }
    const rec = { p, settled: false, failed: false };
    a.rec = rec;
    try { return await run(p, sql, params); } catch (e) { rec.failed = true; throw e; } finally { rec.settled = true; }
  };
  const probe = makeDbClockProbe({ query, readerRole, expectedFingerprint, deadlineMs });
  const monoNowUs = defaultMonoNowUs(performance);
  const wallNowMs = () => Date.now();
  const serial = makeSerializer();
  // Serialized: RTT is measured INSIDE takeSample, i.e. only after this sample holds the single-flight slot.
  const takeSampleFn = () => serial(async () => {
    if (closed) { st.refusedAfterClose++; return { ok: false, reason: "sampler_closed" }; }   // queued callers fail closed; no sample starts
    const a = { cancelled: false, rec: null };
    attempt = a; st.samples++;
    try { return await takeSample({ wallNowMs, monoNowUs, probe }); }
    finally {
      a.cancelled = true; if (attempt === a) attempt = null;
      const rec = a.rec;
      if (rec && !rec.settled) retire(rec.p, "unresolved");      // abandoned at the deadline: never reuse
      else if (rec && rec.failed) retire(rec.p, "failed");       // driver/statement error: reopen fresh
    }
  });

  return Object.freeze({
    version: PRODUCTION_CLOCK_VERSION,
    takeSampleFn,
    monoNowUs,
    stats() { return { ...st, closed, hasPhysical: usable(physical), opening: !!opening }; },
    get closed() { return closed; },
    /**
     * Close: the CLOSED latch is committed SYNCHRONOUSLY (before the first await), so no open/SQL/sample can start
     * after this call begins. The current sample is cancelled, the installed physical is retired and closed within
     * `closeDeadlineMs`; a still-pending open is NOT awaited — its late result retires itself (never installed).
     * Idempotent and monotonic (never reopens). Resolves within the bounded close deadline.
     */
    close() {
      if (closePromise) return closePromise;
      closed = true;
      if (attempt) attempt.cancelled = true;
      const p = physical; physical = null;
      if (p) retired.add(p);
      closePromise = p ? boundedClose(p, closeDeadlineMs, () => { st.closeTimeouts++; }).then(() => undefined) : Promise.resolve();
      return closePromise;
    },
  });
}

/**
 * Build a clock sampler over an ALREADY-ESTABLISHED read-only physical session (e.g. the reader's own observed
 * session, so its clock probes and its connection-token identity come from ONE session). Runs ONLY the fixed
 * clock probe on that session. The caller owns the session lifecycle.
 *
 * M5 remediation: samples are SERIALIZED, and while a previous clock probe on this physical is still UNRESOLVED
 * (abandoned at its deadline) — or the physical is dead — a sample fails closed with the unchanged reason
 * `db_probe_failed` WITHOUT issuing a query (no second query ever queues behind unresolved work). Once the prior
 * probe settles, sampling resumes on the same session. The reader's lifecycle/recovery semantics are unchanged.
 */
export function makeClockSamplerOverPhysical(physical, { expectedFingerprint, readerRole = READER_ROLE, deadlineMs = DEFAULT_PROBE_DEADLINE_MS } = {}) {
  if (!physical || typeof physical.query !== "function") throw new Error("clock_sampler_physical_required");
  if (typeof expectedFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(expectedFingerprint)) throw new Error("clock_sampler_fingerprint_required");
  let unresolved = 0;                      // clock probes issued on this physical that have not yet settled
  const st = { samples: 0, skippedBusy: 0, skippedDead: 0, maxConcurrentQueries: 0 };
  const query = async (sql, params) => {
    if (sql !== DB_CLOCK_QUERY) throw new Error("clock_query_not_permitted");
    if (unresolved > 0) { st.skippedBusy++; throw new Error("clock_physical_busy"); }
    if (typeof physical.isDead === "function" && physical.isDead()) { st.skippedDead++; throw new Error("clock_physical_dead"); }
    unresolved++; if (unresolved > st.maxConcurrentQueries) st.maxConcurrentQueries = unresolved;
    try { return await physical.query(sql, params); } finally { unresolved--; }
  };
  const probe = makeDbClockProbe({ query, readerRole, expectedFingerprint, deadlineMs });
  const monoNowUs = defaultMonoNowUs(performance);
  const serial = makeSerializer();
  return Object.freeze({
    version: PRODUCTION_CLOCK_VERSION,
    takeSampleFn: () => serial(() => { st.samples++; return takeSample({ wallNowMs: () => Date.now(), monoNowUs, probe }); }),
    monoNowUs,
    stats() { return { ...st, unresolved }; },
  });
}
