// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 V2 EXECUTOR ATTESTATION ISSUER — fixed reviewed EVIDENCE QUERY REGISTRY. OFFLINE candidate.
//
// The COMPLETE set of SQL this issuer may ever execute. Every statement is a fixed SELECT over system catalogs /
// privilege functions / pg_stat_activity with BOUND parameters. The attestation request selects NO SQL, table,
// role, schema or predicate: the only parameters are the fixed role names and object names below. Nothing writes;
// nothing reads application row data. The observer session enforces registry membership (isPermittedExecutorSql).
//
// Semantics (verified on a throwaway local PostgreSQL 16 cluster built from the accepted post-Step-1 migrations —
// never a live database; see tests/localpg):
//   • has_table_privilege / has_function_privilege / has_schema_privilege count DIRECT, INHERITED and PUBLIC grants;
//     memberships are enumerated separately because a NOINHERIT member can still SET ROLE (any membership refuses);
//   • column-level grants are invisible to has_table_privilege → has_any_column_privilege is measured too;
//   • a routine with a NULL proacl is PUBLIC-executable (the built-in default) → counted as widening;
//   • pg_stat_activity.backend_start is NULL for an observer without pg_read_all_stats → no token, refuse;
//   • the connection token cannot be derived from anything but (pid, backend_start, application_name) observed here.
// "User schemas" = every namespace except pg_catalog, information_schema, pg_toast*, pg_temp_* (system-owned).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
import { EXECUTOR_ROLE } from "../../m7-v2-production-authority-provisioning-offline-01/src/executor-session.mjs";
import { READER_ROLE } from "../../private-reader-host-runtime-offline-01/reader-only-authority.mjs";
import { PERMITTED_SELECT_OBJECTS, FORBIDDEN_OBJECT, PROHIBITED_ROLES } from "../../private-reader-attester-offline-01/evidence-queries.mjs";

export const EXECUTOR_EVIDENCE_REGISTRY_VERSION = "executor-attester-evidence-registry-v1";
export { EXECUTOR_ROLE, READER_ROLE, PROHIBITED_ROLES };
export const TRUSTED_SCHEMA_PATTERN = "live\\_ai\\_03b%";           // LIKE pattern for the trusted boundary schemas
export const LEDGER_OBJECT = "live_ai_03b_trusted.approval_consumption";
// The 13 accepted budget/state objects the executor must hold NO privilege on (reader's 12 + the forbidden one).
export const BUDGET_OBJECTS = Object.freeze([...PERMITTED_SELECT_OBJECTS, FORBIDDEN_OBJECT]);
export const REQUIRED_OBJECTS = Object.freeze([...BUDGET_OBJECTS, LEDGER_OBJECT]);   // schema drift ⇒ refuse
export const OBSERVER_REQUIRED_MEMBERSHIP = "pg_read_all_stats";
const USER_NS = "n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp\\_%'";

export const XQ = Object.freeze({
  // ── observer self-check: identity, least privilege, independence from the executor + reader ──
  observerIdentity:
    "SELECT current_user AS current_user, session_user AS session_user, current_database() AS datname, " +
    "(SELECT oid FROM pg_database WHERE datname = current_database())::text AS database_oid, " +
    "pg_has_role(current_user, 'pg_read_all_stats', 'USAGE') AS has_read_all_stats, " +
    "r.rolsuper AS is_superuser, r.rolcreaterole AS createrole, r.rolcreatedb AS createdb, " +
    "r.rolreplication AS replication, r.rolbypassrls AS bypassrls, " +
    "COALESCE((SELECT pg_has_role(current_user, x.oid, 'MEMBER') FROM pg_roles x WHERE x.rolname = $1), false) AS member_of_executor, " +
    "COALESCE((SELECT pg_has_role(current_user, x.oid, 'MEMBER') FROM pg_roles x WHERE x.rolname = $2), false) AS member_of_reader " +
    "FROM pg_roles r WHERE r.rolname = current_user",
  observerMemberships:
    "WITH RECURSIVE m(roleid) AS (" +
    "  SELECT roleid FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = current_user) " +
    "  UNION SELECT am.roleid FROM pg_auth_members am JOIN m ON am.member = m.roleid" +
    ") SELECT r.rolname FROM m JOIN pg_roles r ON r.oid = m.roleid",
  // ── DB clock (the attester's host clock must agree with it before signing) ──
  dbClock: "SELECT (floor(extract(epoch FROM clock_timestamp()) * 1000))::bigint AS ms",
  // ── cluster fingerprint (stable per cluster + database + executor role; detects a swapped endpoint) ──
  clusterFingerprint:
    "SELECT (SELECT oid FROM pg_database WHERE datname = current_database())::text AS database_oid, " +
    "current_database() AS datname, (SELECT oid FROM pg_roles WHERE rolname = $1)::text AS executor_role_oid, " +
    "(SELECT encoding::text FROM pg_database WHERE datname = current_database()) AS encoding",
  // ── the executor's own PHYSICAL sessions (the token source; requires pg_read_all_stats) ──
  executorSessions:
    "SELECT a.pid, a.usename, a.application_name, a.datname, a.backend_type, " +
    "to_char(a.backend_start AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS backend_start " +
    "FROM pg_stat_activity a WHERE a.usename = $1 AND a.backend_type = 'client backend'",
  // ── executor role attributes ──
  executorRole:
    "SELECT rolname, rolsuper, rolcanlogin, rolinherit, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication " +
    "FROM pg_roles WHERE rolname = $1",
  // ── EVERY membership the executor holds (direct or transitive), regardless of INHERIT ──
  executorMemberships:
    "WITH RECURSIVE m(roleid) AS (" +
    "  SELECT roleid FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = $1) " +
    "  UNION SELECT am.roleid FROM pg_auth_members am JOIN m ON am.member = m.roleid" +
    ") SELECT r.rolname FROM m JOIN pg_roles r ON r.oid = m.roleid",
  // ── SET ROLE reachability of categorically prohibited roles ──
  prohibitedRoleReachability:
    "SELECT r.rolname, pg_has_role($1, r.oid, 'MEMBER') AS reachable FROM pg_roles r WHERE r.rolname = ANY($2::text[])",
  // ── schema authority on EVERY user schema (USAGE / CREATE / ownership) ──
  executorSchemas:
    "SELECT n.nspname, has_schema_privilege($1, n.oid, 'USAGE') AS usage, has_schema_privilege($1, n.oid, 'CREATE') AS create, " +
    "pg_get_userbyid(n.nspowner) = $1 AS owner FROM pg_namespace n WHERE " + USER_NS,
  // ── EVERY user-schema routine the executor can EXECUTE, as name(argtypes) ──
  executorRoutines:
    "SELECT n.nspname || '.' || p.proname || '(' || replace(oidvectortypes(p.proargtypes), ', ', ',') || ')' AS routine " +
    "FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE " + USER_NS + " AND has_function_privilege($1, p.oid, 'EXECUTE')",
  // ── table / view / column authority on EVERY user-schema relation where the executor holds ANY privilege ──
  executorRelations:
    "SELECT n.nspname AS nsp, n.nspname || '.' || c.relname AS obj, " +
    "has_table_privilege($1, c.oid, 'SELECT') AS sel, has_table_privilege($1, c.oid, 'INSERT') AS ins, " +
    "has_table_privilege($1, c.oid, 'UPDATE') AS upd, has_table_privilege($1, c.oid, 'DELETE') AS del, " +
    "has_table_privilege($1, c.oid, 'TRUNCATE') AS trunc, has_table_privilege($1, c.oid, 'REFERENCES') AS refs, " +
    "has_table_privilege($1, c.oid, 'TRIGGER') AS trig, " +
    "has_any_column_privilege($1, c.oid, 'SELECT') AS csel, has_any_column_privilege($1, c.oid, 'INSERT') AS cins, " +
    "has_any_column_privilege($1, c.oid, 'UPDATE') AS cupd, has_any_column_privilege($1, c.oid, 'REFERENCES') AS crefs " +
    "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r','p','v','m','f') AND " + USER_NS + " " +
    "AND (has_table_privilege($1, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') " +
    "OR has_any_column_privilege($1, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))",
  // ── sequence authority (USAGE = nextval, UPDATE = setval, SELECT = currval/state) ──
  executorSequences:
    "SELECT n.nspname AS nsp, n.nspname || '.' || c.relname AS seq, has_sequence_privilege($1, c.oid, 'USAGE') AS usage, " +
    "has_sequence_privilege($1, c.oid, 'UPDATE') AS upd, has_sequence_privilege($1, c.oid, 'SELECT') AS sel " +
    "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'S' AND " + USER_NS,
  // ── PostgreSQL 17+ MAINTAIN (evaluated only when supported; the CASE branch is never taken before 17) ──
  executorMaintain:
    "SELECT n.nspname AS nsp, n.nspname || '.' || c.relname AS obj FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
    "WHERE c.relkind IN ('r','p','m') AND " + USER_NS + " " +
    "AND CASE WHEN current_setting('server_version_num')::int >= 170000 THEN has_table_privilege($1, c.oid, 'MAINTAIN') ELSE false END",
  // ── database-level authority (CREATE = new schemas; TEMPORARY is the PostgreSQL PUBLIC default, recorded) ──
  executorDatabase:
    "SELECT has_database_privilege($1, current_database(), 'CREATE') AS create, " +
    "has_database_privilege($1, current_database(), 'TEMPORARY') AS temp, " +
    "(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) = $1 AS owner",
  // ── objects OWNED by the executor anywhere in this database (an owner holds implicit, unmeasured authority) ──
  executorOwnership:
    "SELECT (SELECT count(*) FROM pg_class WHERE relowner = r.oid) + (SELECT count(*) FROM pg_proc WHERE proowner = r.oid) " +
    "+ (SELECT count(*) FROM pg_namespace WHERE nspowner = r.oid) + (SELECT count(*) FROM pg_type WHERE typowner = r.oid) AS owned " +
    "FROM pg_roles r WHERE r.rolname = $1",
  // ── the reviewed objects must exist (schema drift ⇒ refuse rather than count 0 on a renamed object). A pure catalog
  //    lookup: to_regclass() RAISES "permission denied for schema" for an observer without USAGE on the trusted schema
  //    (verified on real PostgreSQL), and the observer must NOT be granted that USAGE. ──
  objectExists:
    "SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2",
  // ── PUBLIC widening: relation grants to PUBLIC in any user schema ──
  publicRelationGrants:
    "SELECT n.nspname || '.' || c.relname AS obj, a.privilege_type FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, " +
    "aclexplode(c.relacl) a WHERE a.grantee = 0 AND " + USER_NS,
  // ── PUBLIC widening: schema grants to PUBLIC on the trusted schemas, and CREATE to PUBLIC on any user schema ──
  publicSchemaGrants:
    "SELECT n.nspname, a.privilege_type FROM pg_namespace n, aclexplode(n.nspacl) a WHERE a.grantee = 0 AND " + USER_NS + " " +
    "AND (n.nspname LIKE $1 OR a.privilege_type = 'CREATE')",
  // ── PUBLIC widening: trusted-schema routines executable by PUBLIC (NULL proacl = built-in PUBLIC EXECUTE) ──
  publicTrustedRoutines:
    "SELECT n.nspname || '.' || p.proname AS routine FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace " +
    "WHERE n.nspname LIKE $1 AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))",
  // ── DEFAULT-privilege widening: any pg_default_acl entry granting to PUBLIC or to the executor ──
  defaultAclWidening:
    "SELECT d.defaclobjtype::text AS objtype, COALESCE(n.nspname, '') AS nsp, a.privilege_type, (a.grantee = 0) AS to_public " +
    "FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace, aclexplode(d.defaclacl) a " +
    "WHERE a.grantee = 0 OR a.grantee = (SELECT oid FROM pg_roles WHERE rolname = $1)",

  // ════════ R1 — COMPLETE AUTHORITY COVERAGE (catch-all). Every finding maps into the frozen signed field
  //          publicOrDefaultPrivilegeWidening = true ⇒ the issuer refuses; unknown ⇒ refuse. ════════
  // ── supported server majors are exactly 16 and 18 (the tested versions); anything else fails closed ──
  serverVersion: "SELECT current_setting('server_version_num')::int AS v",
  // ── coverage self-check: EVERY aclitem[] column of every pg_catalog table. The set must equal the reviewed set
  //    (ACL_BEARING_CATALOGS); a new ACL-bearing object class in a future server ⇒ refuse, never silently skip ──
  aclCatalogs:
    "SELECT c.relname || '.' || a.attname AS col FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid " +
    "JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'pg_catalog' AND c.relkind = 'r' " +
    "AND a.atttypid = 'aclitem[]'::regtype AND a.attnum > 0 AND NOT a.attisdropped",
  // ── DIRECT catch-all: every shared dependency on the executor role in ANY database or on a shared object —
  //    ownership ('o'), ACL grant/grantor ('a'), policy ('r'), init privilege ('i'), any other type. Only the
  //    reviewed ACL entries (the 2 trusted schemas, the 4 routines, CONNECT/TEMP on this database) are allowed ──
  executorShdepend:
    "SELECT d.dbid::text AS dbid, d.classid::regclass::text AS cls, d.objid::text AS objid, d.objsubid, d.deptype::text AS deptype, " +
    "(d.dbid = (SELECT oid FROM pg_database WHERE datname = current_database())) AS this_db, " +
    "CASE WHEN d.classid = 'pg_namespace'::regclass THEN (SELECT nspname::text FROM pg_namespace WHERE oid = d.objid) " +
    "WHEN d.classid = 'pg_proc'::regclass THEN (SELECT n.nspname || '.' || p.proname || '(' || replace(oidvectortypes(p.proargtypes), ', ', ',') || ')' " +
    "FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.oid = d.objid) " +
    "WHEN d.classid = 'pg_database'::regclass THEN (SELECT datname::text FROM pg_database WHERE oid = d.objid) ELSE NULL END AS name " +
    "FROM pg_shdepend d WHERE d.refclassid = 'pg_authid'::regclass AND d.refobjid = (SELECT oid FROM pg_roles WHERE rolname = $1)",
  // ── the executor's explicit privileges on each database (only CONNECT / TEMPORARY on this database are reviewed) ──
  executorDatabaseGrants:
    "SELECT d.datname::text AS datname, a.privilege_type FROM pg_database d, aclexplode(d.datacl) a " +
    "WHERE a.grantee = (SELECT oid FROM pg_roles WHERE rolname = $1)",
  // ── EFFECTIVE executor authority on the shared / non-schema object classes (defence in depth over the catch-all).
  //    Languages are deliberately NOT measured by has_language_privilege: acldefault grants PUBLIC USAGE on every
  //    language (ambient, verified on PG16 + PG18), and an UNTRUSTED language (c, internal) can be used to create a
  //    function only by a superuser whatever its ACL (bounded by the signed rolsuper = false). Any explicit change to a
  //    language ACL is caught by publicExtended 'language-acl' (vs pg_init_privs) and by the pg_shdepend catch-all. ──
  executorExtendedEffective:
    "SELECT 'fdw-usage:' || fdwname AS f FROM pg_foreign_data_wrapper WHERE has_foreign_data_wrapper_privilege($1, oid, 'USAGE') " +
    "UNION ALL SELECT 'server-usage:' || srvname FROM pg_foreign_server WHERE has_server_privilege($1, oid, 'USAGE') " +
    "UNION ALL SELECT 'tablespace-create:' || spcname FROM pg_tablespace WHERE has_tablespace_privilege($1, oid, 'CREATE') " +
    "UNION ALL SELECT 'database-create:' || datname FROM pg_database WHERE has_database_privilege($1, oid, 'CREATE') " +
    "UNION ALL SELECT 'parameter:' || parname FROM pg_parameter_acl WHERE has_parameter_privilege($1, parname, 'SET') OR has_parameter_privilege($1, parname, 'ALTER SYSTEM') " +
    "UNION ALL SELECT 'largeobject:' || m.oid::text FROM pg_largeobject_metadata m WHERE m.lomowner = (SELECT oid FROM pg_roles WHERE rolname = $1) " +
    "OR EXISTS (SELECT 1 FROM aclexplode(m.lomacl) a WHERE a.grantee = 0 OR a.grantee = (SELECT oid FROM pg_roles WHERE rolname = $1)) " +
    "UNION ALL SELECT 'schema-create:' || nspname FROM pg_namespace WHERE has_schema_privilege($1, oid, 'CREATE') " +
    "UNION ALL SELECT 'user-mapping:' || srvname FROM pg_user_mappings WHERE umuser = 0 OR umuser = (SELECT oid FROM pg_roles WHERE rolname = $1) " +
    "UNION ALL SELECT 'role-setting:' || COALESCE(s.setdatabase::text, '0') FROM pg_db_role_setting s WHERE s.setrole = (SELECT oid FROM pg_roles WHERE rolname = $1)",
  // ── PUBLIC / system-ACL widening on every ACL-bearing class. NULL ACLs are normalised with acldefault() and system
  //    objects are compared with their pg_init_privs baseline, so ambient built-in defaults never count as drift ──
  publicExtended:
    "SELECT 'database-public-create:' || d.datname AS f FROM pg_database d, aclexplode(d.datacl) a WHERE a.grantee = 0 AND a.privilege_type = 'CREATE' " +
    "UNION ALL SELECT 'schema-public-create:' || n.nspname FROM pg_namespace n, aclexplode(n.nspacl) a WHERE a.grantee = 0 AND a.privilege_type = 'CREATE' " +
    "UNION ALL SELECT 'column-public:' || n.nspname || '.' || c.relname || '.' || att.attname FROM pg_attribute att JOIN pg_class c ON c.oid = att.attrelid " +
    "JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(att.attacl) a WHERE a.grantee = 0 AND " + USER_NS + " " +
    "UNION ALL SELECT 'catalog-relation-acl:' || c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
    "LEFT JOIN pg_init_privs ip ON ip.objoid = c.oid AND ip.classoid = 'pg_class'::regclass AND ip.objsubid = 0 WHERE n.nspname = 'pg_catalog' " +
    "AND ARRAY(SELECT x::text FROM unnest(COALESCE(c.relacl, acldefault('r', c.relowner))) x ORDER BY 1) IS DISTINCT FROM " +
    "ARRAY(SELECT x::text FROM unnest(COALESCE(ip.initprivs, acldefault('r', c.relowner))) x ORDER BY 1) " +
    "UNION ALL SELECT 'catalog-column-acl:' || c.relname || '.' || att.attname FROM pg_attribute att JOIN pg_class c ON c.oid = att.attrelid " +
    "JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_init_privs ip ON ip.objoid = c.oid AND ip.classoid = 'pg_class'::regclass AND ip.objsubid = att.attnum " +
    "WHERE n.nspname IN ('pg_catalog', 'information_schema') AND att.attnum > 0 " +
    "AND ARRAY(SELECT x::text FROM unnest(COALESCE(att.attacl, '{}'::aclitem[])) x ORDER BY 1) IS DISTINCT FROM ARRAY(SELECT x::text FROM unnest(COALESCE(ip.initprivs, '{}'::aclitem[])) x ORDER BY 1) " +
    "UNION ALL SELECT 'infoschema-public-nonselect:' || c.relname || ':' || a.privilege_type FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, " +
    "aclexplode(c.relacl) a WHERE n.nspname = 'information_schema' AND a.grantee = 0 AND a.privilege_type <> 'SELECT' " +
    "UNION ALL SELECT 'catalog-routine-acl:' || n.nspname || '.' || p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace " +
    "LEFT JOIN pg_init_privs ip ON ip.objoid = p.oid AND ip.classoid = 'pg_proc'::regclass WHERE n.nspname IN ('pg_catalog', 'information_schema') " +
    "AND ARRAY(SELECT x::text FROM unnest(COALESCE(p.proacl, acldefault('f', p.proowner))) x ORDER BY 1) IS DISTINCT FROM " +
    "ARRAY(SELECT x::text FROM unnest(COALESCE(ip.initprivs, acldefault('f', p.proowner))) x ORDER BY 1) " +
    "UNION ALL SELECT 'type-acl:' || n.nspname || '.' || t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace " +
    "LEFT JOIN pg_init_privs ip ON ip.objoid = t.oid AND ip.classoid = 'pg_type'::regclass " +
    "WHERE ARRAY(SELECT x::text FROM unnest(COALESCE(t.typacl, acldefault('T', t.typowner))) x ORDER BY 1) IS DISTINCT FROM " +
    "ARRAY(SELECT x::text FROM unnest(COALESCE(ip.initprivs, acldefault('T', t.typowner))) x ORDER BY 1) " +
    "UNION ALL SELECT 'language-acl:' || l.lanname FROM pg_language l LEFT JOIN pg_init_privs ip ON ip.objoid = l.oid AND ip.classoid = 'pg_language'::regclass " +
    "WHERE ARRAY(SELECT x::text FROM unnest(COALESCE(l.lanacl, acldefault('l', l.lanowner))) x ORDER BY 1) IS DISTINCT FROM " +
    "ARRAY(SELECT x::text FROM unnest(COALESCE(ip.initprivs, acldefault('l', l.lanowner))) x ORDER BY 1) " +
    "UNION ALL SELECT 'largeobject-public:' || m.oid::text FROM pg_largeobject_metadata m, aclexplode(m.lomacl) a WHERE a.grantee = 0 " +
    "UNION ALL SELECT 'fdw-public:' || w.fdwname FROM pg_foreign_data_wrapper w, aclexplode(w.fdwacl) a WHERE a.grantee = 0 " +
    "UNION ALL SELECT 'server-public:' || s.srvname FROM pg_foreign_server s, aclexplode(s.srvacl) a WHERE a.grantee = 0 " +
    "UNION ALL SELECT 'tablespace-public:' || t.spcname FROM pg_tablespace t, aclexplode(t.spcacl) a WHERE a.grantee = 0 " +
    "UNION ALL SELECT 'parameter-public:' || p.parname FROM pg_parameter_acl p, aclexplode(p.paracl) a WHERE a.grantee = 0 " +
    "UNION ALL SELECT 'lo-compat-privileges' WHERE current_setting('lo_compat_privileges') <> 'off' " +
    "UNION ALL SELECT 'database-setting-lo-compat' FROM pg_db_role_setting s, unnest(s.setconfig) x WHERE s.setrole = 0 AND x LIKE 'lo\\_compat\\_privileges%'",
  // ── ownership by the executor across EVERY owner-bearing catalog of this database + the shared catalogs ──
  executorOwnershipAll:
    "WITH r AS (SELECT oid FROM pg_roles WHERE rolname = $1) SELECT cat, n FROM (" +
    "SELECT 'pg_class' AS cat, count(*) AS n FROM pg_class, r WHERE relowner = r.oid UNION ALL SELECT 'pg_proc', count(*) FROM pg_proc, r WHERE proowner = r.oid " +
    "UNION ALL SELECT 'pg_namespace', count(*) FROM pg_namespace, r WHERE nspowner = r.oid UNION ALL SELECT 'pg_type', count(*) FROM pg_type, r WHERE typowner = r.oid " +
    "UNION ALL SELECT 'pg_database', count(*) FROM pg_database, r WHERE datdba = r.oid UNION ALL SELECT 'pg_tablespace', count(*) FROM pg_tablespace, r WHERE spcowner = r.oid " +
    "UNION ALL SELECT 'pg_language', count(*) FROM pg_language, r WHERE lanowner = r.oid UNION ALL SELECT 'pg_largeobject_metadata', count(*) FROM pg_largeobject_metadata, r WHERE lomowner = r.oid " +
    "UNION ALL SELECT 'pg_foreign_data_wrapper', count(*) FROM pg_foreign_data_wrapper, r WHERE fdwowner = r.oid UNION ALL SELECT 'pg_foreign_server', count(*) FROM pg_foreign_server, r WHERE srvowner = r.oid " +
    "UNION ALL SELECT 'pg_collation', count(*) FROM pg_collation, r WHERE collowner = r.oid UNION ALL SELECT 'pg_conversion', count(*) FROM pg_conversion, r WHERE conowner = r.oid " +
    "UNION ALL SELECT 'pg_operator', count(*) FROM pg_operator, r WHERE oprowner = r.oid UNION ALL SELECT 'pg_opclass', count(*) FROM pg_opclass, r WHERE opcowner = r.oid " +
    "UNION ALL SELECT 'pg_opfamily', count(*) FROM pg_opfamily, r WHERE opfowner = r.oid UNION ALL SELECT 'pg_ts_config', count(*) FROM pg_ts_config, r WHERE cfgowner = r.oid " +
    "UNION ALL SELECT 'pg_ts_dict', count(*) FROM pg_ts_dict, r WHERE dictowner = r.oid UNION ALL SELECT 'pg_extension', count(*) FROM pg_extension, r WHERE extowner = r.oid " +
    "UNION ALL SELECT 'pg_event_trigger', count(*) FROM pg_event_trigger, r WHERE evtowner = r.oid UNION ALL SELECT 'pg_publication', count(*) FROM pg_publication, r WHERE pubowner = r.oid " +
    "UNION ALL SELECT 'pg_subscription', count(*) FROM pg_subscription, r WHERE subowner = r.oid UNION ALL SELECT 'pg_statistic_ext', count(*) FROM pg_statistic_ext, r WHERE stxowner = r.oid " +
    "UNION ALL SELECT 'pg_default_acl', count(*) FROM pg_default_acl, r WHERE defaclrole = r.oid" +
    ") o WHERE n > 0",
});

// The reviewed set of ACL-bearing catalog columns on PostgreSQL 16 and 18 (verified on both; tests/localpg). Any other
// aclitem[] column in pg_catalog ⇒ an unreviewed object class ⇒ the issuer refuses (privilege_class_coverage_incomplete).
export const ACL_BEARING_CATALOGS = Object.freeze(["pg_attribute.attacl", "pg_class.relacl", "pg_database.datacl", "pg_default_acl.defaclacl",
  "pg_foreign_data_wrapper.fdwacl", "pg_foreign_server.srvacl", "pg_init_privs.initprivs", "pg_language.lanacl", "pg_largeobject_metadata.lomacl",
  "pg_namespace.nspacl", "pg_parameter_acl.paracl", "pg_proc.proacl", "pg_tablespace.spcacl", "pg_type.typacl"]);
export const SUPPORTED_SERVER_MAJORS = Object.freeze([16, 18]);

export const ALLOWED_EXECUTOR_SQL = Object.freeze(Object.values(XQ));
const ALLOWED = new Set(ALLOWED_EXECUTOR_SQL);
export function isPermittedExecutorSql(sql) { return typeof sql === "string" && ALLOWED.has(sql); }
