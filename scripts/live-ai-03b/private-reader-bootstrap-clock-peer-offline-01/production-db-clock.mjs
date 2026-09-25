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
export function makeProductionClockSampler(deps) {
  const { env, connectionStringEnvName, expectedFingerprint, readerRole = READER_ROLE,
    statementTimeoutMs = 2000, connectTimeoutMs = 5000, deadlineMs = DEFAULT_PROBE_DEADLINE_MS } = deps || {};
  if (!env || typeof env !== "object") throw new Error("clock_sampler_env_required");
  if (typeof connectionStringEnvName !== "string" || !connectionStringEnvName) throw new Error("clock_sampler_conn_name_required");
  if (typeof expectedFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(expectedFingerprint)) throw new Error("clock_sampler_fingerprint_required");
  if (!Number.isInteger(statementTimeoutMs) || statementTimeoutMs < 1) throw new Error("clock_sampler_statement_timeout_invalid");

  const factory = makePgPhysicalFactory({ env, connectionStringEnvName, connectTimeoutMs });
  let physical = null;
  let opening = null;

  async function ensure() {
    if (physical && !physical.isDead()) return physical;
    if (opening) return opening;
    physical = null;
    opening = (async () => {
      const p = await factory.open();                       // throws reader_db_url_absent / reader_db_connect_failed
      try {
        await p.query(LIFECYCLE_SQL.setStatementTimeout, [String(statementTimeoutMs) + "ms"]);
        await p.query(LIFECYCLE_SQL.setReadOnly, []);
        const ro = await p.query(LIFECYCLE_SQL.readReadOnly, []);
        if (!ro || !ro.rows || !ro.rows[0] || ro.rows[0].v !== "on") throw new Error("read_only_not_applied");
      } catch (e) { try { await p.close(); } catch {} throw new Error("clock_session_harden_failed"); }
      p.onDead(() => { if (physical === p) physical = null; });
      physical = p; return p;
    })();
    try { return await opening; } finally { opening = null; }
  }

  // The ONLY SQL this adapter will run is the fixed clock probe. Anything else fails closed.
  const query = async (sql, params) => {
    if (sql !== DB_CLOCK_QUERY) throw new Error("clock_query_not_permitted");
    const p = await ensure();
    return p.query(sql, params);
  };
  const probe = makeDbClockProbe({ query, readerRole, expectedFingerprint, deadlineMs });
  const monoNowUs = defaultMonoNowUs(performance);
  const wallNowMs = () => Date.now();
  const takeSampleFn = () => takeSample({ wallNowMs, monoNowUs, probe });

  return Object.freeze({
    version: PRODUCTION_CLOCK_VERSION,
    takeSampleFn,
    monoNowUs,
    async close() { const p = physical; physical = null; if (p) { try { await p.close(); } catch {} } },
  });
}

/**
 * Build a clock sampler over an ALREADY-ESTABLISHED read-only physical session (e.g. the reader's own observed
 * session, so its clock probes and its connection-token identity come from ONE session). Runs ONLY the fixed
 * clock probe on that session. The caller owns the session lifecycle.
 */
export function makeClockSamplerOverPhysical(physical, { expectedFingerprint, readerRole = READER_ROLE, deadlineMs = DEFAULT_PROBE_DEADLINE_MS } = {}) {
  if (!physical || typeof physical.query !== "function") throw new Error("clock_sampler_physical_required");
  if (typeof expectedFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(expectedFingerprint)) throw new Error("clock_sampler_fingerprint_required");
  const query = async (sql, params) => { if (sql !== DB_CLOCK_QUERY) throw new Error("clock_query_not_permitted"); return physical.query(sql, params); };
  const probe = makeDbClockProbe({ query, readerRole, expectedFingerprint, deadlineMs });
  const monoNowUs = defaultMonoNowUs(performance);
  return Object.freeze({ version: PRODUCTION_CLOCK_VERSION, takeSampleFn: () => takeSample({ wallNowMs: () => Date.now(), monoNowUs, probe }), monoNowUs });
}
