// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 V2 EXECUTOR ATTESTATION ISSUER — independent EVIDENCE OBSERVATION + EVALUATION. OFFLINE.
//
// Turns the fixed registry into EXACTLY the privilege fields the PRESERVED verifier (verifyExecutorAttestation in
// m7-v2-production-authority-provisioning-offline-01/src/executor-attestation.mjs) checks. Every value is MEASURED
// here; nothing comes from the requester. A measurement that cannot be completed, or any state wider than the
// accepted executor set, is REFUSED — never signed as an adverse claim for downstream interpretation.
//
// Physical-session identity: the executor connection token is RE-DERIVED from this issuer's own pg_stat_activity
// observation with the ACCEPTED contract (executorConnectionTokenFor, the same function the authority uses on its
// side). The requester's token only SELECTS which observed session to attest; exactly one must match.
//
// currentUser: another backend's current_user is not observable. It is signed as the executor role ONLY when it is
// PROVEN equal to the observed session user: the session user is the executor, the executor holds NO role
// membership (SET ROLE impossible) and is not a superuser (SET SESSION AUTHORIZATION impossible). Otherwise refuse.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
import { executorConnectionTokenFor, EXECUTOR_APPLICATION_NAME_PREFIX } from "../../m7-v2-production-authority-provisioning-offline-01/src/executor-session.mjs";
import { EXPECTED_EXECUTOR_PRIVILEGES } from "../../m7-v2-production-authority-provisioning-offline-01/src/executor-attestation.mjs";
import { XQ, EXECUTOR_ROLE, READER_ROLE, PROHIBITED_ROLES, TRUSTED_SCHEMA_PATTERN, REQUIRED_OBJECTS, OBSERVER_REQUIRED_MEMBERSHIP,
  ACL_BEARING_CATALOGS, SUPPORTED_SERVER_MAJORS } from "./executor-evidence-queries.mjs";

export const MAX_ATTESTER_DB_CLOCK_SKEW_MS = 5000;   // = the preserved verifier's forward tolerance
const isTrustedSchema = (n) => typeof n === "string" && n.startsWith("live_ai_03b");
const EXPECTED_ROUTINES = new Set(EXPECTED_EXECUTOR_PRIVILEGES.executableRoutines);
const EXPECTED_TRUSTED_USAGE = [...EXPECTED_EXECUTOR_PRIVILEGES.trustedSchemaUsage].sort();
// Schemas whose USAGE the executor may hold without widening: the two trusted schemas + `public` (PostgreSQL's
// PUBLIC default USAGE; the accepted Step-1 matrix denies only CREATE there). Anything else ⇒ refuse.
const PERMITTED_USAGE = new Set([...EXPECTED_TRUSTED_USAGE, "public"]);

const fail = (reason) => ({ ok: false, reason });
const b = (v) => v === true;
const strictBool = (v) => v === true || v === false;
const sorted = (a) => [...a].sort();

/**
 * Observe and evaluate everything the accepted executor payload asserts.
 * @param observer from establishExecutorObserverSession()
 * @param claimedConnectionToken the token the requester asked about (SELECTION KEY ONLY)
 * @param nowProvider the attester's trusted host clock (never caller time)
 */
export async function observeExecutorEvidence(observer, claimedConnectionToken, { nowProvider = Date.now } = {}) {
  const observedAtMs = nowProvider();
  let self, obsMem, clock, fp, sessions, role, memberships, prohibited, schemas, routines, relations, sequences, maintain, database, owned,
    pubRel, pubSchema, pubRoutine, defAcl, ver, aclCats, shdep, dbGrants, extEff, pubExt, ownAll;
  try {
    self = await observer.evidence(XQ.observerIdentity, [EXECUTOR_ROLE, READER_ROLE]);
    obsMem = await observer.evidence(XQ.observerMemberships, []);
    clock = await observer.evidence(XQ.dbClock, []);
    fp = await observer.evidence(XQ.clusterFingerprint, [EXECUTOR_ROLE]);
    sessions = await observer.evidence(XQ.executorSessions, [EXECUTOR_ROLE]);
    role = await observer.evidence(XQ.executorRole, [EXECUTOR_ROLE]);
    memberships = await observer.evidence(XQ.executorMemberships, [EXECUTOR_ROLE]);
    prohibited = await observer.evidence(XQ.prohibitedRoleReachability, [EXECUTOR_ROLE, PROHIBITED_ROLES.slice()]);
    schemas = await observer.evidence(XQ.executorSchemas, [EXECUTOR_ROLE]);
    routines = await observer.evidence(XQ.executorRoutines, [EXECUTOR_ROLE]);
    relations = await observer.evidence(XQ.executorRelations, [EXECUTOR_ROLE]);
    sequences = await observer.evidence(XQ.executorSequences, [EXECUTOR_ROLE]);
    maintain = await observer.evidence(XQ.executorMaintain, [EXECUTOR_ROLE]);
    database = await observer.evidence(XQ.executorDatabase, [EXECUTOR_ROLE]);
    owned = await observer.evidence(XQ.executorOwnership, [EXECUTOR_ROLE]);
    pubRel = await observer.evidence(XQ.publicRelationGrants, []);
    pubSchema = await observer.evidence(XQ.publicSchemaGrants, [TRUSTED_SCHEMA_PATTERN]);
    pubRoutine = await observer.evidence(XQ.publicTrustedRoutines, [TRUSTED_SCHEMA_PATTERN]);
    defAcl = await observer.evidence(XQ.defaultAclWidening, [EXECUTOR_ROLE]);
    // R1 — complete authority coverage (catch-all)
    ver = await observer.evidence(XQ.serverVersion, []);
    aclCats = await observer.evidence(XQ.aclCatalogs, []);
    shdep = await observer.evidence(XQ.executorShdepend, [EXECUTOR_ROLE]);
    dbGrants = await observer.evidence(XQ.executorDatabaseGrants, [EXECUTOR_ROLE]);
    extEff = await observer.evidence(XQ.executorExtendedEffective, [EXECUTOR_ROLE]);
    pubExt = await observer.evidence(XQ.publicExtended, []);
    ownAll = await observer.evidence(XQ.executorOwnershipAll, [EXECUTOR_ROLE]);
  } catch { return fail("evidence_unavailable"); }

  // ── observer: least privilege + independence ──
  const s0 = self[0];
  if (!s0 || typeof s0.current_user !== "string") return fail("observer_identity_unavailable");
  if (s0.current_user !== s0.session_user) return fail("observer_identity_ambiguous");
  if (s0.current_user === EXECUTOR_ROLE) return fail("observer_is_executor");
  if (s0.current_user === READER_ROLE) return fail("observer_is_reader");
  if (b(s0.is_superuser)) return fail("observer_is_superuser");
  if (b(s0.createrole) || b(s0.createdb) || b(s0.replication) || b(s0.bypassrls)) return fail("observer_overprivileged");
  if (b(s0.member_of_executor)) return fail("observer_holds_executor_authority");
  if (b(s0.member_of_reader)) return fail("observer_holds_reader_authority");
  if (!b(s0.has_read_all_stats)) return fail("observer_lacks_session_visibility");
  const observerMemberOf = obsMem.map((m) => (m && m.rolname ? String(m.rolname) : "")).filter(Boolean);
  if (observerMemberOf.length !== 1 || observerMemberOf[0] !== OBSERVER_REQUIRED_MEMBERSHIP) return fail("observer_membership_not_least_privilege");

  // ── clock: the attester's host clock must agree with the DB clock (it signs issuedAtMs from the host clock) ──
  const dbNowMs = clock[0] ? Number(clock[0].ms) : NaN;
  if (!Number.isSafeInteger(dbNowMs)) return fail("db_clock_unavailable");
  if (Math.abs(observedAtMs - dbNowMs) > MAX_ATTESTER_DB_CLOCK_SKEW_MS) return fail("attester_clock_skew");

  // ── cluster fingerprint ──
  const f0 = fp[0];
  if (!f0 || !f0.database_oid || !f0.datname || !f0.executor_role_oid) return fail("cluster_fingerprint_unavailable");
  if (String(f0.datname) !== String(s0.datname) || String(f0.database_oid) !== String(s0.database_oid)) return fail("cluster_identity_inconsistent");
  const cluster = Object.freeze({ datname: String(f0.datname), databaseOid: String(f0.database_oid), executorRoleOid: String(f0.executor_role_oid),
    encoding: f0.encoding === null || f0.encoding === undefined ? null : String(f0.encoding) });

  // ── executor role attributes (strict booleans; anything unmeasurable refuses) ──
  const r0 = role[0];
  if (!r0) return fail("executor_role_absent");
  for (const k of ["rolsuper", "rolcanlogin", "rolbypassrls", "rolcreatedb", "rolcreaterole", "rolreplication"]) if (!strictBool(r0[k])) return fail("privilege_measurement_incomplete");
  if (!b(r0.rolcanlogin)) return fail("executor_role_cannot_login");

  // ── physical session: this issuer's OWN observation decides which session exists ──
  const observed = [];
  for (const row of sessions) {
    if (!row || row.usename !== EXECUTOR_ROLE || row.backend_type !== "client backend") continue;
    if (typeof row.backend_start !== "string" || row.backend_start.length < 10) return fail("session_start_not_visible");
    if (!Number.isInteger(Number(row.pid)) || typeof row.application_name !== "string" || row.application_name === "") continue;
    observed.push({ pid: Number(row.pid), backendStart: row.backend_start, applicationName: row.application_name, usename: row.usename,
      datname: row.datname === null || row.datname === undefined ? null : String(row.datname) });
  }
  if (observed.length === 0) return fail("no_executor_session_observed");
  const matches = observed.filter((x) => executorConnectionTokenFor(x) === claimedConnectionToken);   // re-derived, never trusted
  if (matches.length === 0) return fail("no_such_session");
  if (matches.length > 1) return fail("ambiguous_session");
  const sess = matches[0];
  if (!sess.applicationName.startsWith(EXECUTOR_APPLICATION_NAME_PREFIX)) return fail("session_application_name_not_executor");
  if (sess.datname === null || sess.datname !== cluster.datname) return fail("session_database_mismatch");

  // ── reviewed objects must exist (schema drift ⇒ refuse) ──
  for (const obj of REQUIRED_OBJECTS) {
    const dot = obj.indexOf(".");
    let ex; try { ex = await observer.evidence(XQ.objectExists, [obj.slice(0, dot), obj.slice(dot + 1)]); } catch { return fail("evidence_unavailable"); }
    if (!ex[0] || Number(ex[0].n) !== 1) return fail("reviewed_object_absent");
  }

  // ── memberships + prohibited reachability ──
  const roleMemberships = sorted(memberships.map((m) => (m && m.rolname ? String(m.rolname) : "")).filter(Boolean));
  const prohibitedReachable = prohibited.filter((r) => b(r.reachable)).map((r) => String(r.rolname));

  // ── schema authority ──
  const trustedSchemaUsage = [], schemaCreate = [], unexpectedUsage = []; let schemaOwner = false;
  for (const row of schemas) {
    const n = row && row.nspname ? String(row.nspname) : null; if (!n) continue;
    if (!strictBool(row.usage) || !strictBool(row.create)) return fail("privilege_measurement_incomplete");
    if (b(row.create)) schemaCreate.push(n);
    if (b(row.owner)) schemaOwner = true;
    if (b(row.usage)) { if (isTrustedSchema(n)) trustedSchemaUsage.push(n); if (!PERMITTED_USAGE.has(n)) unexpectedUsage.push(n); }
  }

  // ── routine EXECUTE authority on every user-schema routine ──
  const executableRoutines = sorted(routines.map((r) => (r && r.routine ? String(r.routine) : "")).filter(Boolean));
  const unapprovedRoutineExecute = executableRoutines.some((r) => !EXPECTED_ROUTINES.has(r));

  // ── relation / sequence / MAINTAIN authority, split into trusted-schema (ledger) vs everything else (budget/state) ──
  let budgetTablePrivilegeCount = 0, ledgerPrivilegeCount = 0;
  const add = (nsp, n) => { if (isTrustedSchema(nsp)) ledgerPrivilegeCount += n; else budgetTablePrivilegeCount += n; };
  for (const row of relations) {
    if (!row || !row.nsp) continue;
    add(String(row.nsp), ["sel", "ins", "upd", "del", "trunc", "refs", "trig", "csel", "cins", "cupd", "crefs"].filter((k) => b(row[k])).length || 1);
  }
  for (const row of sequences) if (row && row.nsp) add(String(row.nsp), ["usage", "upd", "sel"].filter((k) => b(row[k])).length);
  for (const row of maintain) if (row && row.nsp) add(String(row.nsp), 1);

  // ── database / ownership ──
  const d0 = database[0];
  if (!d0 || !strictBool(d0.create) || !strictBool(d0.owner)) return fail("privilege_measurement_incomplete");
  const o0 = owned[0]; let ownedCount = o0 ? Number(o0.owned) : NaN;
  if (!Number.isSafeInteger(ownedCount)) return fail("privilege_measurement_incomplete");

  // ── PUBLIC / default-privilege widening ──
  // ── R1: supported server + reviewed ACL-bearing object classes (unknown ⇒ refuse, never skip) ──
  const v0 = ver[0] ? Number(ver[0].v) : NaN;
  if (!Number.isInteger(v0) || !SUPPORTED_SERVER_MAJORS.includes(Math.floor(v0 / 10000))) return fail("server_version_unsupported");
  const cats = sorted(aclCats.map((r) => (r && r.col ? String(r.col) : "")).filter(Boolean));
  if (JSON.stringify(cats) !== JSON.stringify(sorted(ACL_BEARING_CATALOGS))) return fail("privilege_class_coverage_incomplete");

  // ── R1: extended authority findings — anything outside the exact reviewed set. Each maps into the frozen signed
  //    field publicOrDefaultPrivilegeWidening (so the issuer refuses AND a force-signed copy fails the preserved verifier) ──
  const extended = [];
  const reviewedShdep = new Set([...EXPECTED_TRUSTED_USAGE.map((n) => "pg_namespace:" + n), ...EXPECTED_EXECUTOR_PRIVILEGES.executableRoutines.map((r) => "pg_proc:" + r)]);
  const grantsByDb = new Map();
  for (const g of dbGrants) { if (!g || !g.datname) continue; const k = String(g.datname); grantsByDb.set(k, [...(grantsByDb.get(k) || []), String(g.privilege_type)]); }
  for (const d of shdep) {
    if (!d || typeof d.cls !== "string" || typeof d.deptype !== "string") { extended.push("shdepend:unreadable"); continue; }
    const ok = d.deptype === "a" && (
      (d.this_db === true && (d.cls === "pg_namespace" || d.cls === "pg_proc") && Number(d.objsubid) === 0 && reviewedShdep.has(d.cls + ":" + d.name))
      || (d.cls === "pg_database" && String(d.dbid) === "0" && d.name === cluster.datname
          && (grantsByDb.get(cluster.datname) || []).every((pv) => pv === "CONNECT" || pv === "TEMPORARY")));
    if (!ok) extended.push(`shdepend:${d.deptype}:${d.cls}${d.this_db === true ? "" : ":other-db-or-shared"}${d.name ? ":" + d.name : ""}`);
  }
  for (const [db, privs] of grantsByDb) if (db !== cluster.datname || privs.some((pv) => pv !== "CONNECT" && pv !== "TEMPORARY")) extended.push("database-grant:" + db + ":" + sorted(privs).join("+"));
  for (const r of extEff) if (r && r.f) extended.push("effective:" + String(r.f));
  for (const r of pubExt) if (r && r.f) extended.push("public:" + String(r.f));
  for (const r of ownAll) if (r && r.cat) { extended.push("owner:" + String(r.cat)); ownedCount += Number(r.n) || 1; }

  const publicOrDefaultPrivilegeWidening = pubRel.length > 0 || pubSchema.length > 0 || pubRoutine.length > 0 || defAcl.length > 0
    || extended.length > 0 || d0.create === true || d0.owner === true || schemaOwner || ownedCount !== 0;

  // currentUser is signed only when PROVEN equal to the observed session user (see header)
  const currentUserProven = sess.usename === EXECUTOR_ROLE && roleMemberships.length === 0 && r0.rolsuper === false;

  return {
    ok: true,
    evidence: Object.freeze({
      observedAtMs, dbNowMs, cluster,
      observer: Object.freeze({ role: String(s0.current_user) }),
      connection: Object.freeze({ token: executorConnectionTokenFor(sess), role: EXECUTOR_ROLE, pid: sess.pid, backendStart: sess.backendStart, applicationName: sess.applicationName }),
      // EXACTLY the preserved verifier's privilege fields (EXECUTOR_PRIVILEGE_KEYS)
      privileges: Object.freeze({
        budgetTablePrivilegeCount,
        currentUser: currentUserProven ? EXECUTOR_ROLE : "unproven",
        executableRoutines: Object.freeze(executableRoutines),
        ledgerPrivilegeCount,
        publicOrDefaultPrivilegeWidening,
        rolbypassrls: r0.rolbypassrls,
        rolcreatedb: r0.rolcreatedb,
        rolcreaterole: r0.rolcreaterole,
        rolreplication: r0.rolreplication,
        rolsuper: r0.rolsuper,
        roleMemberships: Object.freeze(roleMemberships),
        schemaCreate: Object.freeze(sorted(schemaCreate)),
        sessionUser: sess.usename,
        trustedSchemaUsage: Object.freeze(sorted(trustedSchemaUsage)),
        unapprovedRoutineExecute,
      }),
      // measured context used for the refusal decision (never signed, never returned to the caller)
      context: Object.freeze({ prohibitedReachable: Object.freeze(prohibitedReachable), unexpectedUsage: Object.freeze(sorted(unexpectedUsage)),
        extendedFindings: Object.freeze(sorted([...new Set(extended)])), serverVersionNum: v0,
        schemaOwner, databaseCreate: d0.create, databaseOwner: d0.owner, databaseTemporary: b(d0.temp), ownedCount }),
    }),
  };
}

const sameList = (a, e) => Array.isArray(a) && JSON.stringify(sorted(a)) === JSON.stringify(sorted(e)) && new Set(a).size === a.length;

/**
 * The issuer signs ONLY the exact accepted clean state. Anything else is refused outright, so an adverse or
 * uncertain state can never be signed and replayed as proof. (Mirrors — and is stricter than — the preserved
 * verifier; the server additionally re-verifies every issued envelope with the preserved verifier itself.)
 */
export function executorEvidenceIsAttestable(ev) {
  const p = ev.privileges, c = ev.context;
  if (p.sessionUser !== EXECUTOR_ROLE) return fail("drift_session_user");
  if (p.rolsuper !== false) return fail("drift_superuser");
  if (p.rolcreaterole !== false) return fail("drift_createrole");
  if (p.rolcreatedb !== false) return fail("drift_createdb");
  if (p.rolreplication !== false) return fail("drift_replication");
  if (p.rolbypassrls !== false) return fail("drift_bypassrls");
  if (p.roleMemberships.length !== 0 || c.prohibitedReachable.length !== 0) return fail("drift_role_membership");
  if (p.currentUser !== EXECUTOR_ROLE) return fail("drift_current_user_unproven");
  if (p.schemaCreate.length !== 0) return fail("drift_schema_create");
  if (p.budgetTablePrivilegeCount !== 0) return fail("drift_budget_table_privilege");
  if (p.ledgerPrivilegeCount !== 0) return fail("drift_ledger_privilege");
  if (!sameList(p.trustedSchemaUsage, EXPECTED_TRUSTED_USAGE)) return fail("drift_trusted_schema_usage");
  if (c.unexpectedUsage.length !== 0) return fail("drift_unexpected_schema_usage");
  if (!sameList(p.executableRoutines, EXPECTED_EXECUTOR_PRIVILEGES.executableRoutines)) return fail("drift_routine_execute");
  if (p.unapprovedRoutineExecute !== false) return fail("drift_unapproved_routine_execute");
  if (c.schemaOwner || c.databaseCreate || c.databaseOwner || c.ownedCount !== 0) return fail("drift_owner_or_database_authority");
  // R1: every extended finding (catch-all) is ALSO folded into the signed widening field, so this refuses too
  if (p.publicOrDefaultPrivilegeWidening !== false || c.extendedFindings.length !== 0) return fail("drift_public_or_default_widening");
  return { ok: true };
}
