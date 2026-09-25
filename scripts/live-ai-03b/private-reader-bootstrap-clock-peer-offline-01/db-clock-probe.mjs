// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — BOOTSTRAP: fixed read-only DB CLOCK + FINGERPRINT probe contract (OFFLINE). Node built-ins.
//
// The clock probe is the ONLY DB statement the bootstrap layer runs. It is fixed (no arbitrary SQL), read-only,
// bounded by a wall-clock deadline, exposes no application row data and no secret, and on EVERY call re-reads
// the anchored cluster fingerprint fields so a swapped/rebound database is detected before any clock evidence
// is trusted. The fingerprint algorithm is the ACCEPTED one (target-binding.mjs) — reused, never re-invented.
// ─────────────────────────────────────────────────────────────────────────
import { clusterFingerprint } from "../private-reader-attester-offline-01/target-binding.mjs";
import { READER_ROLE } from "../private-reader-attester-offline-01/evidence-queries.mjs";

export { READER_ROLE };

// db_micros returned as text to preserve integer precision across the wire; parsed + range-checked here.
export const DB_CLOCK_QUERY =
  "SELECT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000000)::bigint::text AS db_micros, " +
  "current_database() AS datname, " +
  "(SELECT oid FROM pg_database WHERE datname = current_database())::text AS database_oid, " +
  "(SELECT oid FROM pg_roles WHERE rolname = $1)::text AS reader_role_oid, " +
  "(SELECT encoding::text FROM pg_database WHERE datname = current_database()) AS encoding";

export const DEFAULT_PROBE_DEADLINE_MS = 2000;   // wall-clock cap per probe (above the DB statement_timeout)

function withDeadline(p, ms, reason) {
  let t; const d = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(reason)), Math.max(1, ms)); });
  return Promise.race([Promise.resolve().then(() => p), d]).finally(() => clearTimeout(t));
}
const isSafeInt = (n) => Number.isInteger(n) && Number.isSafeInteger(n);

/** Only the fixed clock query is ever permitted (defence in depth: production path can never run other SQL). */
export function isPermittedClockSql(sql) { return sql === DB_CLOCK_QUERY; }

function parseRow(row) {
  if (!row) return { ok: false, reason: "db_probe_empty" };
  const dbUs = Number(row.db_micros);
  if (!isSafeInt(dbUs) || dbUs <= 0) return { ok: false, reason: "db_micros_invalid" };
  if (typeof row.datname !== "string" || !row.database_oid || !row.reader_role_oid) return { ok: false, reason: "db_fingerprint_fields_missing" };
  const cluster = {
    datname: String(row.datname),
    databaseOid: String(row.database_oid),
    readerRoleOid: String(row.reader_role_oid),
    encoding: row.encoding === null || row.encoding === undefined ? null : String(row.encoding),
  };
  return { ok: true, dbUs, cluster, fingerprint: clusterFingerprint(cluster) };
}

/**
 * Build a probe: async () → { dbUs, cluster, fingerprint }. Throws on deadline, invalid row, or (when
 * expectedFingerprint is given) a fingerprint mismatch — so the caller's sample fails closed.
 * @param deps.query async (sql, params) → { rows } — a read-only, statement_timeout-bounded DB session.
 * @param deps.readerRole role name whose OID feeds the fingerprint (default the accepted live_ai_03b_reader).
 * @param deps.expectedFingerprint 64-hex anchored fingerprint to enforce on every probe (optional at bootstrap
 *   discovery time; REQUIRED once an anchor is bound).
 * @param deps.deadlineMs wall-clock cap.
 */
export function makeDbClockProbe(deps) {
  const query = deps && deps.query;
  const readerRole = (deps && deps.readerRole) || READER_ROLE;
  const expectedFingerprint = deps && deps.expectedFingerprint;
  const deadlineMs = deps && Number.isInteger(deps.deadlineMs) ? deps.deadlineMs : DEFAULT_PROBE_DEADLINE_MS;
  if (typeof query !== "function") throw new Error("db_clock_probe_query_required");
  if (expectedFingerprint !== undefined && expectedFingerprint !== null && !/^[0-9a-f]{64}$/.test(expectedFingerprint)) {
    throw new Error("db_clock_probe_expected_fingerprint_invalid");
  }
  return async function probe() {
    const r = await withDeadline(query(DB_CLOCK_QUERY, [readerRole]), deadlineMs, "db_probe_deadline");
    const rows = r && Array.isArray(r.rows) ? r.rows : [];
    const parsed = parseRow(rows[0]);
    if (!parsed.ok) throw new Error(parsed.reason);
    if (expectedFingerprint && parsed.fingerprint !== expectedFingerprint) throw new Error("db_fingerprint_mismatch");
    return parsed;
  };
}
