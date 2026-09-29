// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 V2 PRODUCTION AUTHORITY PROVISIONING — restricted EXECUTOR physical session. OFFLINE candidate.
//
// The executor-side analogue of the accepted reader session (private-reader-production-integration-offline-01/
// reader-session.mjs), which is reader-specific (reader role, read-only) and is therefore NOT reused for the
// executor. One controlled physical connection (one pg Client, no pool). On establishment, BEFORE the connection
// can be offered to the frozen runtime:
//   1. SET + READ BACK the session statement_timeout (bounded, 1000..15000 ms; the declared value is never proof);
//   2. READ the session's own identity (current_user / session_user must be live_ai_03b_executor; backend pid,
//      backend_start, application_name) and derive the executor CONNECTION TOKEN the independent attester binds;
//   3. READ the DB clock on the SAME connection (binds the trusted clock).
// default_transaction_read_only is deliberately NOT set: activate_catalog_v2 writes inside its SECURITY DEFINER
// body. Lifecycle SQL is a fixed frozen set executed only by this module; it is never reachable by the runtime.
// ─────────────────────────────────────────────────────────────────────────
import { createHash, randomBytes } from "node:crypto";
import { parsePgDurationMs } from "../../private-reader-production-integration-offline-01/reader-session.mjs";

export const EXECUTOR_ROLE = "live_ai_03b_executor";
export const EXECUTOR_CONNECTION_TOKEN_DOMAIN = "lai03b-executor-connection-v1";
export const EXECUTOR_APPLICATION_NAME_PREFIX = "lai03b-executor:";
export const EXECUTOR_STATEMENT_TIMEOUT_MIN_MS = 1000;
export const EXECUTOR_STATEMENT_TIMEOUT_MAX_MS = 15000;

export const EXECUTOR_LIFECYCLE_SQL = Object.freeze({
  setStatementTimeout: "SELECT set_config('statement_timeout', $1, false) AS v",
  readStatementTimeout: "SELECT current_setting('statement_timeout') AS v",
  readIdentity:
    "SELECT current_user AS current_user, session_user AS session_user, pg_backend_pid() AS pid, " +
    "(SELECT to_char(a.backend_start AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') FROM pg_stat_activity a WHERE a.pid = pg_backend_pid()) AS backend_start, " +
    "current_setting('application_name') AS application_name",
  readDbClockMs: "SELECT (floor(extract(epoch FROM clock_timestamp()) * 1000))::bigint AS ms",
});
const LIFECYCLE_TEXT = new Set(Object.values(EXECUTOR_LIFECYCLE_SQL));
const fail = (reason) => ({ ok: false, reason });

export function executorConnectionTokenFor({ pid, backendStart, applicationName }) {
  return createHash("sha256").update([EXECUTOR_CONNECTION_TOKEN_DOMAIN, String(pid), String(backendStart), String(applicationName)].join("\n")).digest("hex");
}
export function newExecutorApplicationName() { return EXECUTOR_APPLICATION_NAME_PREFIX + randomBytes(12).toString("hex"); }

async function one(physical, sql, params) {
  if (!LIFECYCLE_TEXT.has(sql)) throw new Error("executor_lifecycle_sql_not_allowed");
  const r = await physical.query(sql, params || []);
  return r && Array.isArray(r.rows) && r.rows.length === 1 ? r.rows[0] : undefined;
}

/** Establish + verify the executor session. Returns { ok:true, session } or { ok:false, reason }. */
export async function establishExecutorSession(physical, { statementTimeoutMs } = {}) {
  if (!Number.isInteger(statementTimeoutMs) || statementTimeoutMs < EXECUTOR_STATEMENT_TIMEOUT_MIN_MS || statementTimeoutMs > EXECUTOR_STATEMENT_TIMEOUT_MAX_MS) return fail("executor_statement_timeout_config_invalid");
  if (!physical || typeof physical.query !== "function" || typeof physical.isDead !== "function") return fail("executor_physical_session_invalid");
  try {
    await one(physical, EXECUTOR_LIFECYCLE_SQL.setStatementTimeout, [String(statementTimeoutMs) + "ms"]);
    const st = await one(physical, EXECUTOR_LIFECYCLE_SQL.readStatementTimeout);
    const eff = st ? parsePgDurationMs(st.v) : NaN;
    if (!Number.isInteger(eff)) return fail("executor_statement_timeout_unverifiable");
    if (eff !== statementTimeoutMs) return fail("executor_statement_timeout_not_applied");
    const id = await one(physical, EXECUTOR_LIFECYCLE_SQL.readIdentity);
    if (!id) return fail("executor_identity_unavailable");
    if (id.current_user !== EXECUTOR_ROLE || id.session_user !== EXECUTOR_ROLE) return fail("executor_session_role_not_executor");
    if (!Number.isInteger(Number(id.pid)) || typeof id.backend_start !== "string" || id.backend_start.length < 10) return fail("executor_identity_unavailable");
    if (typeof physical.applicationName !== "string" || !physical.applicationName.startsWith(EXECUTOR_APPLICATION_NAME_PREFIX) || id.application_name !== physical.applicationName) return fail("executor_application_name_mismatch");
    const clk = await one(physical, EXECUTOR_LIFECYCLE_SQL.readDbClockMs);
    const dbNowMs = clk ? Number(clk.ms) : NaN;
    if (!Number.isSafeInteger(dbNowMs)) return fail("executor_db_clock_unreadable");
    const identity = Object.freeze({ pid: Number(id.pid), backendStart: id.backend_start, applicationName: id.application_name, role: EXECUTOR_ROLE });
    return { ok: true, session: Object.freeze({ physical, identity, token: executorConnectionTokenFor(identity), effectiveStatementTimeoutMs: eff, dbNowMs }) };
  } catch { return fail("executor_session_setup_failed"); }
}

/**
 * PRODUCTION executor physical-connection factory over the real `pg` driver (repo dependency; lazily imported in
 * open()). Reads the connection string from the given env NAME at open() time — the value is never returned,
 * logged or placed in an error. One Client = one physical connection (no pool, no reconnect).
 */
export function makeExecutorPgPhysicalFactory({ env, connectionStringEnvName, connectTimeoutMs = 5000 }) {
  return Object.freeze({
    kind: "pg-executor",
    async open() {
      const cs = env ? env[connectionStringEnvName] : undefined;
      if (typeof cs !== "string" || cs.length === 0) throw new Error("executor_db_url_absent");
      const mod = await import("pg");
      const Client = (mod.default && mod.default.Client) || mod.Client;
      const applicationName = newExecutorApplicationName();
      const client = new Client({ connectionString: cs, application_name: applicationName, connectionTimeoutMillis: connectTimeoutMs, keepAlive: true });
      let dead = false;
      const markDead = () => { dead = true; };
      client.on("error", markDead); client.on("end", markDead);
      try { await client.connect(); } catch { markDead(); try { await client.end(); } catch {} throw new Error("executor_db_connect_failed"); }
      return Object.freeze({
        applicationName,
        async query(sql, params) { const r = await client.query(sql, params); return { rows: r.rows }; },
        isDead() { return dead; },
        async close() { markDead(); try { await client.end(); } catch {} },
      });
    },
  });
}
