// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — ATTESTER: least-privilege OBSERVER connection + BOUNDED, LIFECYCLE-AWARE WORK COORDINATOR
// (OFFLINE). Node built-ins at load; the real `pg` driver is imported lazily only when a connection opens.
//
// One controlled physical connection for the attester's own observations. Only the fixed reviewed evidence
// registry can be issued; every statement is bounded by a DB-side statement_timeout it sets and reads back AND
// by an independent client-side wall-clock deadline; the session is read-only. The observer credential is read
// from its env NAME at connect time and is never returned, logged or embedded in any evidence.
//
// REQUEST-LIFECYCLE CONTAINMENT (v3 correction). Request AUTHORITY and computation LIFETIME are the SAME
// bounded lifecycle, carried by one absolute request context threaded through the whole path:
//   • an expired or caller-abandoned request never enters the queue, acquires the slot, opens a connection,
//     runs evidence, reaches signing, or increments a signed counter;
//   • queue entries carry the context — already-expired requests are rejected at enqueue and skipped at
//     hand-over, never acquiring the observer;
//   • authority expiring while evidence is ACTIVE cancels it immediately, invalidates the physical operation,
//     and holds capacity until teardown is contained — no late result becomes authoritative;
//   • observer OPEN is itself bounded and contained: at most ONE outstanding open at a time (a second is
//     refused, not started), and a connection returned late after abandonment is destroyed, never admitted;
//   • statement/observation deadlines are additionally capped by the request's remaining lifetime.
// Promise.race() returning is NOT cancellation of the losing operation — so a stalled statement/open marks
// the resource dead and invalidates/destroys it; capacity is not released while orphaned work still exists.
// PostgreSQL statement_timeout remains defence-in-depth only; it does not bound client-side queueing, a
// socket/driver stall, or an operation not yet executing server-side.
// ─────────────────────────────────────────────────────────────────────────
import { isPermittedEvidenceSql } from "./evidence-queries.mjs";
import { observeReaderEvidence } from "./evidence-evaluator.mjs";

export const OBSERVER_STATEMENT_TIMEOUT_MS = 1500;      // DB-side per-statement bound (set + read back)
export const OBSERVER_CONNECT_TIMEOUT_MS = 5000;        // pg connect (driver-level)
export const OBSERVER_QUERY_DEADLINE_MS = 1500;         // client-side wall clock per statement, capped by request remaining
export const OBSERVER_OBSERVATION_DEADLINE_MS = 2000;   // whole per-request evidence collection, capped by request remaining
export const OBSERVER_OPEN_DEADLINE_MS = 1500;          // bound acquiring/opening + validating an observer, capped by request remaining
export const OBSERVER_CLEANUP_DEADLINE_MS = 1000;       // bounded physical invalidation/teardown
export const OBSERVER_MAX_ACTIVE = 1;                   // ONE active evidence collection on the physical observer
export const OBSERVER_MAX_QUEUED = 3;                   // bounded queue behind the active one (1+3 == channel MAX 4)
export const DEFAULT_REQUEST_BUDGET_MS = 1900;          // coordinator fallback budget (the server always passes a caller-safe context; see attestation-server.mjs)

const SETUP = Object.freeze({
  setTimeout: "SELECT set_config('statement_timeout', $1, false) AS v",
  readTimeout: "SELECT current_setting('statement_timeout') AS v",
  setReadOnly: "SELECT set_config('default_transaction_read_only', 'on', false) AS v",
  readReadOnly: "SELECT current_setting('default_transaction_read_only') AS v",
});

function fail(reason) { return { ok: false, reason }; }
export function parsePgDurationMs(v) {
  if (typeof v !== "string") return NaN;
  const m = /^\s*(\d+)\s*(ms|s|min|h|d)?\s*$/.exec(v);
  if (!m) return NaN;
  const r = Number(m[1]) * { ms: 1, s: 1000, min: 60000, h: 3600000, d: 86400000 }[m[2] || "ms"];
  return Number.isSafeInteger(r) ? r : NaN;
}
// Race a promise against a wall-clock deadline. The loser is ABANDONED (the driver-stall reality the caller
// must contain by invalidating the physical resource), never silently treated as complete.
function withDeadline(p, ms, reason = "evidence_query_deadline") {
  let t; const d = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(reason)), Math.max(1, ms)); });
  return Promise.race([Promise.resolve().then(() => p), d]).finally(() => clearTimeout(t));
}
const clampRemaining = (ctx, cap) => Math.max(1, ctx ? Math.min(cap, ctx.remainingMs()) : cap);

// ── ONE ABSOLUTE REQUEST-LIFECYCLE CONTEXT ────────────────────────────────
// Immutable absolute deadline + cancellation state + identity, on a real (or injected) monotonic-ish clock —
// NOT the freshness clock. `live()` is the single source of truth for "is this request still authorised".
let __rid = 0;
export function makeRequestContext(budgetMs = DEFAULT_REQUEST_BUDGET_MS, clock = Date.now) {
  const acceptedAt = clock();
  let deadlineAt = acceptedAt + budgetMs;                  // may be TIGHTENED earlier, never extended
  let cancelled = false, reason = null; const listeners = [];
  return Object.freeze({
    id: "req-" + (++__rid),
    acceptedAt, budgetMs,
    deadlineAt: () => deadlineAt,
    remainingMs: () => deadlineAt - clock(),
    expired: () => clock() >= deadlineAt,
    isCancelled: () => cancelled,
    reason: () => reason,
    live: () => !cancelled && clock() < deadlineAt,        // authority AND time both required
    // TIGHTEN-ONLY: move the deadline EARLIER, never later. An authenticated caller-timeline signal (e.g. the
    // caller's own elapsed time) can only SHORTEN the authority window, so it can never be used to extend it.
    tighten: (at) => { if (typeof at === "number" && at < deadlineAt) deadlineAt = at; },
    tightenRemaining: (ms) => { const at = clock() + ms; if (at < deadlineAt) deadlineAt = at; },
    cancel: (r) => { if (!cancelled) { cancelled = true; reason = r || "cancelled"; const ls = listeners.splice(0); for (const l of ls) { try { l(reason); } catch {} } } },
    onCancel: (l) => { if (cancelled) { try { l(reason); } catch {} } else listeners.push(l); },
  });
}

/**
 * Open + verify an observer session over a freshly opened physical connection.
 * @param physical { query(sql, params) → {rows}, close(), destroy?(), isDead?() }
 * Returns { ok:true, observer } or { ok:false, reason }. Every setup statement is wall-clock bounded, so a
 * stalled session setup cannot hang startup or recovery.
 */
export async function establishObserverSession(physical, { statementTimeoutMs = OBSERVER_STATEMENT_TIMEOUT_MS, queryDeadlineMs = OBSERVER_QUERY_DEADLINE_MS } = {}) {
  if (!physical || typeof physical.query !== "function") return fail("observer_session_invalid");
  if (!Number.isInteger(statementTimeoutMs) || statementTimeoutMs < 1 || statementTimeoutMs > 5000) return fail("observer_timeout_config_invalid");
  const setupQuery = (sql, params) => withDeadline(physical.query(sql, params), queryDeadlineMs, "observer_setup_deadline");
  try {
    await setupQuery(SETUP.setTimeout, [String(statementTimeoutMs) + "ms"]);
    const st = await setupQuery(SETUP.readTimeout, []);
    const eff = st && st.rows && st.rows[0] ? parsePgDurationMs(st.rows[0].v) : NaN;
    if (!Number.isInteger(eff) || eff <= 0 || eff > statementTimeoutMs) return fail("observer_statement_timeout_unverified");
    await setupQuery(SETUP.setReadOnly, []);
    const ro = await setupQuery(SETUP.readReadOnly, []);
    if (!ro || !ro.rows || !ro.rows[0] || ro.rows[0].v !== "on") return fail("observer_read_only_unverified");
  } catch { return fail("observer_session_setup_failed"); }

  let closed = false;
  const invalidatePhysical = async () => {
    try { await withDeadline(typeof physical.destroy === "function" ? physical.destroy() : physical.close(), OBSERVER_CLEANUP_DEADLINE_MS, "observer_cleanup_deadline"); } catch {}
  };
  const observer = Object.freeze({
    effectiveStatementTimeoutMs: statementTimeoutMs,
    isDead() { return closed || (typeof physical.isDead === "function" && physical.isDead()); },
    async evidence(sql, params = []) {
      if (closed) throw new Error("observer_closed");
      if (!isPermittedEvidenceSql(sql)) throw new Error("evidence_sql_not_permitted");  // never caller-chosen
      if (!Array.isArray(params) || params.length > 3) throw new Error("evidence_params_invalid");
      for (const p of params) {
        const okp = (typeof p === "string" && p.length <= 128) || (Array.isArray(p) && p.length <= 32 && p.every((x) => typeof x === "string" && x.length <= 64));
        if (!okp) throw new Error("evidence_params_invalid");
      }
      let r;
      try { r = await withDeadline(physical.query(sql, params), queryDeadlineMs); }
      catch (e) { closed = true; void invalidatePhysical(); throw e; }   // stalled/errored statement ⇒ dead + destroyed, never reused
      return r && Array.isArray(r.rows) ? r.rows : [];
    },
    async close() { closed = true; await invalidatePhysical(); },
  });
  return { ok: true, observer };
}

/**
 * BOUNDED, LIFECYCLE-AWARE OBSERVER WORK COORDINATOR. Serializes evidence collection onto one physical
 * observer with a bounded queue, threads the request context through every stage, invalidates a stalled
 * physical resource, discards stale/expired results, bounds outstanding opens to one, and re-validates a fresh
 * connection before evidence resumes.
 *
 * @param opts.provider async () → { ok:true, observer } | { ok:false, reason } — opens + fully validates an
 *   observer session; called under the single lease, at most one outstanding at a time.
 */
export function createObserverCoordinator(opts = {}) {
  const {
    provider,
    nowProvider = Date.now,
    clock = Date.now,
    defaultBudgetMs = DEFAULT_REQUEST_BUDGET_MS,
    observationDeadlineMs = OBSERVER_OBSERVATION_DEADLINE_MS,
    openDeadlineMs = OBSERVER_OPEN_DEADLINE_MS,
    cleanupDeadlineMs = OBSERVER_CLEANUP_DEADLINE_MS,
    maxActive = OBSERVER_MAX_ACTIVE,
    maxQueued = OBSERVER_MAX_QUEUED,
  } = opts;
  if (typeof provider !== "function") throw new Error("observer_coordinator_provider_required");

  let current = null;             // the live validated observer, or null
  let active = 0;                 // evidence collections currently holding the single physical observer
  const waiters = [];            // queued { ctx, res } — bounded by maxQueued; each is handed the one active slot
  let terminating = 0;           // physical resources being torn down — orphaned underlying work still alive
  let generation = 0;            // increments per observation; guards a stale, post-deadline result
  let pendingOpen = null;        // the single outstanding open that was abandoned by deadline but hasn't settled
  let openInFlight = 0;          // opens currently being attempted (0 or 1)
  let reopenFailures = 0;
  let providerCalls = 0;
  let shutting = false;

  function stats() {
    return Object.freeze({ activeEvidence: active, queuedEvidence: waiters.length, terminating, generation, reopenFailures, providerCalls, openInFlight, pendingOpen: pendingOpen !== null, maxActive, maxQueued });
  }
  function acquire(ctx) {
    if (active < maxActive) { active++; return Promise.resolve(true); }
    if (waiters.length >= maxQueued) return Promise.resolve(false);   // fail-busy: bounded queue
    return new Promise((res) => waiters.push({ ctx, res }));          // the one active slot is transferred, not doubled
  }
  function release() {
    while (waiters.length) {
      const w = waiters.shift();
      if (w.ctx && !w.ctx.live()) { try { w.res(false); } catch {} continue; }  // expired while queued — never acquires
      try { w.res(true); } catch {}                                             // slot handed to the next LIVE waiter
      return;
    }
    active = Math.max(0, active - 1);
  }
  async function invalidate(observer) {
    if (!observer) return;
    terminating++;                                                    // slot stays held during teardown
    try { await withDeadline(observer.close(), cleanupDeadlineMs, "observer_cleanup_deadline"); } catch {}
    finally { terminating = Math.max(0, terminating - 1); }
  }
  function disposeLate(r) {                                           // a connection returned AFTER abandonment is destroyed, never admitted
    const obs = r && r.ok === true && r.observer ? r.observer : null;
    if (obs) void invalidate(obs);
  }
  // At most ONE outstanding open. A second is refused (not started) while one is abandoned-but-unsettled.
  // The open is governed by BOTH the (remaining-capped) open deadline AND request cancellation, so a cancel
  // (or caller-safe expiry) during an unresolved open abandons this generation — a late observer is never
  // admitted as current, is disposed, and the next request must open a fresh, re-validated connection.
  async function acquireObserver(ctx) {
    if (current && !current.isDead()) return { ok: true, observer: current };
    if (pendingOpen) return { ok: false, reason: "observer_open_in_flight" };
    providerCalls++; openInFlight++;
    const op = Promise.resolve().then(() => provider());
    pendingOpen = op;
    let abandoned = false;
    op.then((r) => { if (pendingOpen === op) pendingOpen = null; if (abandoned) disposeLate(r); },
            () => { if (pendingOpen === op) pendingOpen = null; })
      .finally(() => { openInFlight = Math.max(0, openInFlight - 1); });
    let onCancel;
    const cancelSignal = new Promise((_, rej) => { onCancel = () => rej(new Error("open_cancelled")); ctx.onCancel(onCancel); });
    let r;
    try { r = await Promise.race([withDeadline(op, clampRemaining(ctx, openDeadlineMs), "observer_open_deadline"), cancelSignal]); }
    catch { abandoned = true; reopenFailures++; return { ok: false, reason: ctx.isCancelled() ? "request_cancelled" : "observer_open_deadline" }; }
    // PRE-CURRENT authority check: admit the opened observer as `current` ONLY if the request is still live.
    // Otherwise dispose the returned connection now (a resolution that is still in flight is disposed by op.then
    // via `abandoned`), so a connection opened under lost authority never becomes current or gets reused.
    if (!ctx.live()) { abandoned = true; disposeLate(r); return { ok: false, reason: ctx.isCancelled() ? "request_cancelled" : "request_expired" }; }
    if (r && r.ok === true && r.observer && typeof r.observer.isDead === "function" && !r.observer.isDead()) { current = r.observer; return { ok: true, observer: current }; }
    reopenFailures++;
    return { ok: false, reason: (r && r.reason) || "observer_unavailable" };
  }

  async function observe(connectionToken, { nowProvider: nP = nowProvider, context, budgetMs = defaultBudgetMs } = {}) {
    const ctx = context || makeRequestContext(budgetMs, clock);
    if (!ctx.live()) return { ok: false, reason: "request_expired" };            // rejected before enqueue
    if (shutting) return { ok: false, reason: "observer_unavailable" };
    const got = await acquire(ctx);
    if (!got) return { ok: false, reason: ctx.live() ? "observer_busy" : "request_expired" };
    try {
      if (!ctx.live()) return { ok: false, reason: "request_expired" };          // expired while queued
      const acq = await acquireObserver(ctx);
      if (!acq.ok) return { ok: false, reason: acq.reason };
      if (!ctx.live()) return { ok: false, reason: "request_expired" };          // expired during open
      const observer = acq.observer;
      const gen = ++generation;
      let timedOut = false, timer, onCancel;
      const deadline = new Promise((_, rej) => { timer = setTimeout(() => { timedOut = true; rej(new Error("observation_deadline")); }, clampRemaining(ctx, observationDeadlineMs)); });
      const cancelled = new Promise((_, rej) => { onCancel = () => rej(new Error("request_cancelled")); ctx.onCancel(onCancel); });
      let ev;
      try {
        ev = await Promise.race([observeReaderEvidence(observer, connectionToken, { nowProvider: nP }), deadline, cancelled]);
      } catch {
        await invalidate(observer);                                              // contain underlying work before releasing
        return { ok: false, reason: timedOut ? "observation_deadline" : (ctx.isCancelled() ? "request_cancelled" : (!ctx.live() ? "request_expired" : "observer_unavailable")) };
      } finally { clearTimeout(timer); }
      // Stale / expired / invalidated-during-run guard: a late or unauthorised result is never authoritative.
      if (!ctx.live()) { await invalidate(observer); return { ok: false, reason: ctx.isCancelled() ? "request_cancelled" : "request_expired" }; }
      if (observer.isDead() || gen !== generation) { await invalidate(observer); return { ok: false, reason: "observer_unavailable" }; }
      if (!ev || ev.ok !== true) {
        if (observer.isDead()) await invalidate(observer);
        return { ok: false, reason: (ev && ev.reason) || "evidence_unavailable" };
      }
      return { ok: true, evidence: ev.evidence, context: ctx };
    } finally { release(); }
  }

  async function shutdown({ deadlineMs = cleanupDeadlineMs } = {}) {
    shutting = true;
    while (waiters.length) { const w = waiters.shift(); if (w.ctx) { try { w.ctx.cancel("shutdown"); } catch {} } try { w.res(false); } catch {} }
    const t0 = clock();
    while ((active > 0 || terminating > 0 || openInFlight > 0) && (clock() - t0) < deadlineMs) { await new Promise((r) => setTimeout(r, 20)); }
    return true;   // note: a never-settling open Promise cannot be force-cancelled — it is bounded to ONE and never re-started (see DEPLOYMENT-CONTRACT §8)
  }

  return Object.freeze({ observe, stats, shutdown, isShutting: () => shutting });
}

/** Production physical-connection factory over the real `pg` driver. Constructing it performs no I/O. */
export function makeObserverPgFactory({ env, connectionStringEnvName, applicationName = "lai03b-attester-observer" }) {
  return Object.freeze({
    kind: "pg",
    async open() {
      const cs = env ? env[connectionStringEnvName] : undefined;
      if (typeof cs !== "string" || cs.length === 0) throw new Error("observer_db_url_absent");
      const mod = await import("pg");
      const Client = (mod.default && mod.default.Client) || mod.Client;
      const client = new Client({ connectionString: cs, application_name: applicationName, connectionTimeoutMillis: OBSERVER_CONNECT_TIMEOUT_MS, keepAlive: true });
      let dead = false; const markDead = () => { dead = true; };
      client.on("error", markDead); client.on("end", markDead);
      try { await client.connect(); } catch { markDead(); try { await client.end(); } catch {} throw new Error("observer_db_connect_failed"); }
      // Hard invalidation: mark dead FIRST (never reused even if teardown stalls), then destroy the socket and
      // end the client so a query still alive on the wire cannot survive to produce a late row.
      const destroy = async () => {
        markDead();
        try { const s = client.connection && client.connection.stream; if (s && typeof s.destroy === "function") s.destroy(); } catch {}
        try { await client.end(); } catch {}
      };
      return Object.freeze({
        async query(sql, params) { const r = await client.query(sql, params); return { rows: r.rows }; },
        isDead() { return dead; },
        async close() { await destroy(); },
        async destroy() { await destroy(); },
      });
    },
  });
}
