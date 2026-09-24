// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — reader PHYSICAL SESSION establishment + PostgreSQL statement_timeout enforcement
// (OFFLINE). Node built-ins only at module load; the real `pg` driver is imported lazily ONLY when a
// production session is actually opened (never in this offline candidate's tests).
//
// One controlled physical connection. On every (re)connection, BEFORE any observation may run:
//   1. SET the session statement_timeout (parameterized set_config — fixed SQL, no string building);
//   2. READ BACK the effective value from the SAME connection and require 0 < effective ≤ 2000 ms and
//      effective === requested (a configured/declared value is never treated as proof);
//   3. SET + read back default_transaction_read_only = on (defence-in-depth; the role is SELECT-only);
//   4. READ the session's own identity (current_user/session_user, backend pid, backend_start,
//      application_name) and derive the CONNECTION TOKEN the independent attester must bind to.
// Lifecycle SQL is a fixed frozen set, executed only by this module — never exposed to the observation
// API. Nothing here grants write/owner/executor authority: these are ordinary session-level settings.
// ─────────────────────────────────────────────────────────────────────────
import { createHash, randomBytes } from "node:crypto";
import { READER_ROLE, READER_STATEMENT_TIMEOUT_MAX_MS } from "../private-reader-host-runtime-offline-01/reader-only-authority.mjs";

export const CONNECTION_TOKEN_DOMAIN = "lai03b-reader-connection-v1";
export const APPLICATION_NAME_PREFIX = "lai03b-reader:";

// The ONLY SQL this module ever executes (fixed text; parameters bound by the driver).
export const LIFECYCLE_SQL = Object.freeze({
  setStatementTimeout: "SELECT set_config('statement_timeout', $1, false) AS v",
  readStatementTimeout: "SELECT current_setting('statement_timeout') AS v",
  setReadOnly: "SELECT set_config('default_transaction_read_only', 'on', false) AS v",
  readReadOnly: "SELECT current_setting('default_transaction_read_only') AS v",
  readIdentity:
    "SELECT current_user AS current_user, session_user AS session_user, pg_backend_pid() AS pid, " +
    "(SELECT to_char(a.backend_start AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') FROM pg_stat_activity a WHERE a.pid = pg_backend_pid()) AS backend_start, " +
    "current_setting('application_name') AS application_name",
});
const LIFECYCLE_TEXT = new Set(Object.values(LIFECYCLE_SQL));

function fail(reason) { return { ok: false, reason }; }

/** Parse a PostgreSQL duration GUC string ("2s", "1500ms", "1min", "0", "2000") to integer ms, or NaN. */
export function parsePgDurationMs(v) {
  if (typeof v !== "string") return NaN;
  const m = /^\s*(\d+)\s*(ms|s|min|h|d)?\s*$/.exec(v);
  if (!m) return NaN;
  const n = Number(m[1]); const mult = { ms: 1, s: 1000, min: 60000, h: 3600000, d: 86400000 }[m[2] || "ms"];
  const r = n * mult;
  return Number.isSafeInteger(r) ? r : NaN;
}

/** Deterministic connection token: the attester derives the same value from its OWN independent
 *  observation of the session (pg_stat_activity: pid, backend_start, application_name). */
export function connectionTokenFor({ pid, backendStart, applicationName }) {
  return createHash("sha256").update([CONNECTION_TOKEN_DOMAIN, String(pid), String(backendStart), String(applicationName)].join("\n")).digest("hex");
}

export function newApplicationName() { return APPLICATION_NAME_PREFIX + randomBytes(12).toString("hex"); }

async function one(physical, sql, params) {
  if (!LIFECYCLE_TEXT.has(sql)) throw new Error("lifecycle_sql_not_allowed");
  const r = await physical.query(sql, params || []);
  return r && Array.isArray(r.rows) && r.rows.length === 1 ? r.rows[0] : undefined;
}

/**
 * Establish + verify a reader session over a freshly opened physical connection.
 * @param physical { query(sql, params) → {rows}, close(), onDead(cb), applicationName }
 * @param statementTimeoutMs integer 1..READER_STATEMENT_TIMEOUT_MAX_MS
 * Returns { ok:true, session } or { ok:false, reason } (and the caller closes the physical connection).
 */
export async function establishReaderSession(physical, { statementTimeoutMs } = {}) {
  if (!Number.isInteger(statementTimeoutMs) || statementTimeoutMs < 1 || statementTimeoutMs > READER_STATEMENT_TIMEOUT_MAX_MS) return fail("statement_timeout_config_invalid");
  if (!physical || typeof physical.query !== "function") return fail("physical_session_invalid");
  try {
    await one(physical, LIFECYCLE_SQL.setStatementTimeout, [String(statementTimeoutMs) + "ms"]);
    const st = await one(physical, LIFECYCLE_SQL.readStatementTimeout);
    const eff = st ? parsePgDurationMs(st.v) : NaN;
    if (!Number.isInteger(eff)) return fail("statement_timeout_unverifiable");
    if (eff <= 0) return fail("statement_timeout_disabled");
    if (eff > READER_STATEMENT_TIMEOUT_MAX_MS) return fail("statement_timeout_above_limit");
    if (eff !== statementTimeoutMs) return fail("statement_timeout_not_applied");

    await one(physical, LIFECYCLE_SQL.setReadOnly);
    const ro = await one(physical, LIFECYCLE_SQL.readReadOnly);
    if (!ro || ro.v !== "on") return fail("read_only_not_applied");

    const id = await one(physical, LIFECYCLE_SQL.readIdentity);
    if (!id) return fail("identity_unavailable");
    if (id.current_user !== READER_ROLE || id.session_user !== READER_ROLE) return fail("session_role_not_reader");
    if (!Number.isInteger(Number(id.pid)) || typeof id.backend_start !== "string" || id.backend_start.length < 10) return fail("identity_unavailable");
    if (typeof physical.applicationName !== "string" || id.application_name !== physical.applicationName) return fail("application_name_mismatch");
    const identity = Object.freeze({ pid: Number(id.pid), backendStart: id.backend_start, applicationName: id.application_name });
    return { ok: true, session: Object.freeze({ physical, identity, token: connectionTokenFor(identity), effectiveStatementTimeoutMs: eff }) };
  } catch { return fail("session_setup_failed"); }
}

/** Re-verify an established session in place (renewal self-check): same identity/token, timeout and
 *  read-only still in effect. Detects a silently replaced backend or a reset setting. */
export async function recheckReaderSession(session) {
  try {
    const st = await one(session.physical, LIFECYCLE_SQL.readStatementTimeout);
    if (!st || parsePgDurationMs(st.v) !== session.effectiveStatementTimeoutMs) return fail("drift_statement_timeout");
    const ro = await one(session.physical, LIFECYCLE_SQL.readReadOnly);
    if (!ro || ro.v !== "on") return fail("drift_read_only");
    const id = await one(session.physical, LIFECYCLE_SQL.readIdentity);
    if (!id || id.current_user !== READER_ROLE || id.session_user !== READER_ROLE) return fail("drift_session_role");
    const token = connectionTokenFor({ pid: Number(id.pid), backendStart: id.backend_start, applicationName: id.application_name });
    if (token !== session.token) return fail("drift_connection_identity");
    return { ok: true };
  } catch { return fail("session_recheck_failed"); }
}

/**
 * PRODUCTION physical-connection factory over the real `pg` driver (repo dependency). Reads the reader
 * connection string from the env NAME given (value never returned/logged). Imports `pg` lazily inside
 * open(); constructing the factory performs no I/O. One Client = one physical connection (no pool).
 */
export function makePgPhysicalFactory({ env, connectionStringEnvName, connectTimeoutMs = 5000 }) {
  return Object.freeze({
    kind: "pg",
    async open() {
      const cs = env ? env[connectionStringEnvName] : undefined;
      if (typeof cs !== "string" || cs.length === 0) throw new Error("reader_db_url_absent");
      const mod = await import("pg");
      const Client = (mod.default && mod.default.Client) || mod.Client;
      const applicationName = newApplicationName();
      const client = new Client({ connectionString: cs, application_name: applicationName, connectionTimeoutMillis: connectTimeoutMs, keepAlive: true });
      const deadCbs = [];
      let dead = false;
      const markDead = () => { if (dead) return; dead = true; for (const cb of deadCbs) { try { cb(); } catch {} } };
      client.on("error", markDead);
      client.on("end", markDead);
      try { await client.connect(); } catch { markDead(); try { await client.end(); } catch {} throw new Error("reader_db_connect_failed"); }
      return Object.freeze({
        applicationName,
        async query(sql, params) { const r = await client.query(sql, params); return { rows: r.rows }; },
        onDead(cb) { if (dead) { try { cb(); } catch {} } else deadCbs.push(cb); },
        isDead() { return dead; },
        async close() { markDead(); try { await client.end(); } catch {} },
      });
    },
  });
}
