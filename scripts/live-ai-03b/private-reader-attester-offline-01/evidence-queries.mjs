// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — ATTESTER: fixed reviewed EVIDENCE QUERY REGISTRY (OFFLINE). Node built-ins only.
//
// The COMPLETE set of SQL the attester may ever execute. Every statement is a fixed SELECT with bound
// parameters — the attestation request selects NO SQL, table, role or predicate. Nothing here writes,
// and nothing reads application row data: only catalog/privilege metadata and the reader's own session
// row. A statement not in this registry cannot be issued (the observer connection enforces membership).
//
// PostgreSQL semantics these queries rely on were verified on a throwaway local PostgreSQL 16 cluster
// (never a live database):
//   • has_table_privilege() counts a DIRECT grant and a PUBLIC grant, but NOT a privilege reachable only
//     through a NOINHERIT role membership — so membership enumeration is mandatory, not optional.
//   • pg_has_role(role, grp, 'MEMBER') is true even for a NOINHERIT member, i.e. SET ROLE reachability.
//   • information_schema.role_table_grants does NOT list PUBLIC grants → never the sole privilege source.
//   • has_table_privilege() RAISES on a missing relation → every object is resolved with to_regclass first.
//   • backend_start is NULL in pg_stat_activity for an observer without pg_read_all_stats.
// ─────────────────────────────────────────────────────────────────────────

export const EVIDENCE_REGISTRY_VERSION = "attester-evidence-registry-v1";
export const READER_ROLE = "live_ai_03b_reader";
export const FORBIDDEN_OBJECT = "public.budget_envelope_allocations";

// The accepted reader SELECT set (scripts/live-ai-03b/trusted-runtime-live-binding-offline-01/
// trusted-reader-role.sql §III) — exactly 12 objects; the count the reader host pins.
export const PERMITTED_SELECT_OBJECTS = Object.freeze([
  "public.budget_policy_versions", "public.budget_control_epochs",
  "public.budget_price_catalog_versions", "public.budget_price_catalog_entries",
  "public.budget_envelopes", "public.budget_provider_reservations", "public.budget_provider_settlements",
  "public.budget_execution_consumptions", "public.budget_decisions", "public.budget_reconciliations",
  "public.budget_scope_counters", "public.budget_sessions",
]);
// Write privileges that must be absent on every in-scope object.
export const WRITE_PRIVILEGES = Object.freeze(["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]);
// Roles whose membership is categorically disqualifying (any membership at all is already rejected;
// these are listed so an explicit reachability check is recorded in the evidence).
export const PROHIBITED_ROLES = Object.freeze(["pg_write_all_data", "pg_read_all_data", "pg_execute_server_program",
  "pg_read_server_files", "pg_write_server_files", "pg_monitor", "pg_maintain", "pg_signal_backend", "pg_checkpoint"]);
export const TRUSTED_SCHEMA = "live_ai_03b_trusted";

export const Q = Object.freeze({
  // ── observer self-check: who am I, where am I, can I read stats ──
  observerIdentity:
    "SELECT current_user AS current_user, current_database() AS datname, " +
    "pg_has_role(current_user, 'pg_read_all_stats', 'USAGE') AS has_read_all_stats, " +
    "(SELECT oid FROM pg_database WHERE datname = current_database())::text AS database_oid, " +
    "(SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser",
  // ── cluster fingerprint (stable per cluster+database; detects a swapped endpoint) ──
  clusterFingerprint:
    "SELECT (SELECT oid FROM pg_database WHERE datname = current_database())::text AS database_oid, " +
    "current_database() AS datname, " +
    "(SELECT oid FROM pg_roles WHERE rolname = $1)::text AS reader_role_oid, " +
    "(SELECT encoding::text FROM pg_database WHERE datname = current_database()) AS encoding",
  // ── the reader's own PHYSICAL session (the token source; requires pg_read_all_stats) ──
  readerSessions:
    "SELECT a.pid, a.usename, a.application_name, a.datname, a.backend_type, " +
    "to_char(a.backend_start AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS backend_start, " +
    "a.state, a.client_addr::text AS client_addr " +
    "FROM pg_stat_activity a WHERE a.usename = $1 AND a.backend_type = 'client backend'",
  // ── reader role attributes ──
  readerRole:
    "SELECT rolname, rolsuper, rolcanlogin, rolinherit, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication " +
    "FROM pg_roles WHERE rolname = $1",
  // ── EVERY membership the reader holds (direct or transitive), regardless of INHERIT ──
  readerMemberships:
    "WITH RECURSIVE m(roleid) AS (" +
    "  SELECT roleid FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = $1) " +
    "  UNION SELECT am.roleid FROM pg_auth_members am JOIN m ON am.member = m.roleid" +
    ") SELECT r.rolname FROM m JOIN pg_roles r ON r.oid = m.roleid",
  // ── object existence (has_*_privilege raises on a missing relation) ──
  objectExists: "SELECT to_regclass($1)::text AS reg",
  // ── effective privilege on ONE object (direct + PUBLIC; parameterised, never interpolated) ──
  tablePrivilege:
    "SELECT has_table_privilege($1, $2, 'SELECT') AS sel, " +
    "has_table_privilege($1, $2, 'INSERT') AS ins, has_table_privilege($1, $2, 'UPDATE') AS upd, " +
    "has_table_privilege($1, $2, 'DELETE') AS del, has_table_privilege($1, $2, 'TRUNCATE') AS trunc, " +
    "has_table_privilege($1, $2, 'REFERENCES') AS refs, has_table_privilege($1, $2, 'TRIGGER') AS trig",
  // ── every table in the reviewed schemas on which the reader effectively holds ANY privilege ──
  readerReachableTables:
    "SELECT n.nspname || '.' || c.relname AS obj, " +
    "has_table_privilege($1, c.oid, 'SELECT') AS sel, " +
    "(has_table_privilege($1, c.oid, 'INSERT') OR has_table_privilege($1, c.oid, 'UPDATE') " +
    " OR has_table_privilege($1, c.oid, 'DELETE') OR has_table_privilege($1, c.oid, 'TRUNCATE') " +
    " OR has_table_privilege($1, c.oid, 'REFERENCES') OR has_table_privilege($1, c.oid, 'TRIGGER')) AS wr " +
    "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
    "WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname IN ('public', $2) " +
    "AND (has_table_privilege($1, c.oid, 'SELECT') OR has_table_privilege($1, c.oid, 'INSERT') " +
    " OR has_table_privilege($1, c.oid, 'UPDATE') OR has_table_privilege($1, c.oid, 'DELETE') " +
    " OR has_table_privilege($1, c.oid, 'TRUNCATE') OR has_table_privilege($1, c.oid, 'REFERENCES') " +
    " OR has_table_privilege($1, c.oid, 'TRIGGER'))",
  // ── routine EXECUTE authority in the reviewed schemas ──
  readerRoutines:
    "SELECT n.nspname || '.' || p.proname AS routine FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace " +
    "WHERE n.nspname IN ('public', $2) AND has_function_privilege($1, p.oid, 'EXECUTE')",
  // ── schema authority (USAGE is expected on public; CREATE never is) ──
  readerSchemas:
    "SELECT n.nspname, has_schema_privilege($1, n.oid, 'USAGE') AS usage, has_schema_privilege($1, n.oid, 'CREATE') AS create " +
    "FROM pg_namespace n WHERE n.nspname IN ('public', $2)",
  // ── SET ROLE reachability of categorically prohibited roles ──
  prohibitedRoleReachability:
    "SELECT r.rolname, pg_has_role($1, r.oid, 'MEMBER') AS reachable FROM pg_roles r WHERE r.rolname = ANY($2::text[])",
  // ── sequence authority in the reviewed schemas (USAGE allows nextval() — a write; SELECT reads state) ──
  readerSequences:
    "SELECT n.nspname || '.' || c.relname AS seq, has_sequence_privilege($1, c.oid, 'USAGE') AS usage, " +
    "has_sequence_privilege($1, c.oid, 'UPDATE') AS upd, has_sequence_privilege($1, c.oid, 'SELECT') AS sel " +
    "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'S' AND n.nspname IN ('public', $2)",
  // ── PostgreSQL 17+ table MAINTAIN privilege (VACUUM/ANALYZE/REINDEX/CLUSTER/REFRESH/LOCK). The privilege
  //    name does not exist before 17, so it is only evaluated when the server supports it (live AI-STAGING
  //    runs PostgreSQL 18). has_table_privilege is STABLE, so the untaken CASE branch is never executed. ──
  readerMaintain:
    "SELECT n.nspname || '.' || c.relname AS obj FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
    "WHERE c.relkind IN ('r','p','m') AND n.nspname IN ('public', $2) " +
    "AND CASE WHEN current_setting('server_version_num')::int >= 170000 THEN has_table_privilege($1, c.oid, 'MAINTAIN') ELSE false END",
  // ── database-level authority (CREATE = new schemas; TEMPORARY is a PostgreSQL PUBLIC default, recorded) ──
  readerDatabase:
    "SELECT has_database_privilege($1, current_database(), 'CREATE') AS create, " +
    "has_database_privilege($1, current_database(), 'TEMPORARY') AS temp, " +
    "(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) = $1 AS owner",
  // ── PUBLIC grants in the reviewed schemas (aclexplode grantee 0) ──
  publicGrants:
    "SELECT n.nspname || '.' || c.relname AS obj, a.privilege_type FROM pg_class c " +
    "JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) a " +
    "WHERE a.grantee = 0 AND n.nspname IN ('public', $1)",
});

export const ALLOWED_SQL = Object.freeze(Object.values(Q));
const ALLOWED = new Set(ALLOWED_SQL);
export function isPermittedEvidenceSql(sql) { return typeof sql === "string" && ALLOWED.has(sql); }
