// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — PI01 LIVE READINESS REMEDIATION 01 — Executor V2 independent EVIDENCE MEASUREMENT. OFFLINE.
//
// WHY THIS EXISTS (additive, not a redesign): the frozen V1 issuer evaluator
// (m7-v2-executor-attester-issuer-offline-01/src/executor-evidence-evaluator.mjs) hard-codes the V1 expected
// executor authority (2 trusted schemas, 4 routines) into its MEASUREMENT (permitted-usage set, unapproved-routine
// flag, reviewed shdepend set). In the accepted V3 state (R3 SQL m7-v3-02 adds schema live_ai_03b_trusted_v3 and two
// routines) the V1 evaluator therefore reports trusted_v3 as unexpected usage, the V3 routines as unapproved and the
// V3 shdepend rows as extended findings — it can never measure the accepted V3 state as clean. A V2 measurement is
// required. This module is the frozen V1 measurement logic line-for-line, with ONLY the expectation constants
// swapped to the frozen R3 EXPECTED_EXECUTOR_PRIVILEGES_V2 (3 schemas, 6 routines). It reuses, unchanged:
//   • the frozen fixed evidence registry XQ (role/pattern-parameterised; no V1 constant inside any query);
//   • the frozen executorConnectionTokenFor (the SAME token derivation the Authority executor session uses);
//   • the frozen reviewed object list, prohibited roles, ACL-bearing catalog set and supported server majors.
// It emits EXACTLY the R3 V2 evidence shape consumed by the frozen evaluateObservedExecutorEvidenceV2 policy
// ({connection,context,dbNowMs,observedAtMs,privileges,target}); the target comes ONLY from the Owner-issued anchor
// via the frozen resolveExecutorTarget. Every value is MEASURED; nothing comes from the requester except the token
// used as a SELECTION KEY (exactly one observed session must re-derive to it). Any unmeasurable value ⇒ refuse.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
import { executorConnectionTokenFor, EXECUTOR_APPLICATION_NAME_PREFIX } from "../../m7-v2-production-authority-provisioning-offline-01/src/executor-session.mjs";
import { XQ, EXECUTOR_ROLE, READER_ROLE, PROHIBITED_ROLES, TRUSTED_SCHEMA_PATTERN, REQUIRED_OBJECTS, OBSERVER_REQUIRED_MEMBERSHIP,
  ACL_BEARING_CATALOGS, SUPPORTED_SERVER_MAJORS } from "../../m7-v2-executor-attester-issuer-offline-01/src/executor-evidence-queries.mjs";
import { resolveExecutorTarget } from "../../m7-v2-executor-attester-issuer-offline-01/src/executor-target-binding.mjs";
import { EXPECTED_EXECUTOR_PRIVILEGES_V2, EXECUTOR_ROLE as EXECUTOR_ROLE_V2 }
  from "../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/executor-attestation-v2.mjs";

export const EXECUTOR_EVIDENCE_V2_VERSION = "executor-evidence-v2-measurement-v1";
export const MAX_ATTESTER_DB_CLOCK_SKEW_MS = 5000;
if (EXECUTOR_ROLE !== EXECUTOR_ROLE_V2) throw new Error("executor_role_registry_mismatch");
const isTrustedSchema = (n) => typeof n === "string" && n.startsWith("live_ai_03b");
const EXPECTED_ROUTINES_V2 = new Set(EXPECTED_EXECUTOR_PRIVILEGES_V2.executableRoutines);
const EXPECTED_TRUSTED_USAGE_V2 = [...EXPECTED_EXECUTOR_PRIVILEGES_V2.trustedSchemaUsage].sort();
const PERMITTED_USAGE_V2 = new Set([...EXPECTED_TRUSTED_USAGE_V2, "public"]);
export const V2_EXPECTATION = Object.freeze({ trustedSchemaUsage: Object.freeze([...EXPECTED_TRUSTED_USAGE_V2]),
  executableRoutines: Object.freeze([...EXPECTED_EXECUTOR_PRIVILEGES_V2.executableRoutines].sort()) });

const fail = (reason) => ({ ok: false, reason });
const b = (v) => v === true;
const strictBool = (v) => v === true || v === false;
const sorted = (a) => [...a].sort();

/**
 * Measure the executor authority for the session selected by `claimedConnectionToken`.
 * @returns { ok:true, measured:{observedAtMs,dbNowMs,cluster,connection,privileges,context} } | { ok:false, reason }
 */
export async function measureExecutorEvidenceV2(observer, claimedConnectionToken, { nowProvider = Date.now } = {}) {
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
    ver = await observer.evidence(XQ.serverVersion, []);
    aclCats = await observer.evidence(XQ.aclCatalogs, []);
    shdep = await observer.evidence(XQ.executorShdepend, [EXECUTOR_ROLE]);
    dbGrants = await observer.evidence(XQ.executorDatabaseGrants, [EXECUTOR_ROLE]);
    extEff = await observer.evidence(XQ.executorExtendedEffective, [EXECUTOR_ROLE]);
    pubExt = await observer.evidence(XQ.publicExtended, []);
    ownAll = await observer.evidence(XQ.executorOwnershipAll, [EXECUTOR_ROLE]);
  } catch { return fail("evidence_unavailable"); }

  // ── observer: least privilege + independence (frozen V1 rules, unchanged) ──
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

  // ── clock ──
  const dbNowMs = clock[0] ? Number(clock[0].ms) : NaN;
  if (!Number.isSafeInteger(dbNowMs)) return fail("db_clock_unavailable");
  if (Math.abs(observedAtMs - dbNowMs) > MAX_ATTESTER_DB_CLOCK_SKEW_MS) return fail("attester_clock_skew");

  // ── cluster fingerprint ──
  const f0 = fp[0];
  if (!f0 || !f0.database_oid || !f0.datname || !f0.executor_role_oid) return fail("cluster_fingerprint_unavailable");
  if (String(f0.datname) !== String(s0.datname) || String(f0.database_oid) !== String(s0.database_oid)) return fail("cluster_identity_inconsistent");
  const cluster = Object.freeze({ datname: String(f0.datname), databaseOid: String(f0.database_oid), executorRoleOid: String(f0.executor_role_oid),
    encoding: f0.encoding === null || f0.encoding === undefined ? null : String(f0.encoding) });

  // ── executor role attributes ──
  const r0 = role[0];
  if (!r0) return fail("executor_role_absent");
  for (const k of ["rolsuper", "rolcanlogin", "rolbypassrls", "rolcreatedb", "rolcreaterole", "rolreplication"]) if (!strictBool(r0[k])) return fail("privilege_measurement_incomplete");
  if (!b(r0.rolcanlogin)) return fail("executor_role_cannot_login");

  // ── physical session: OWN observation decides which session exists; token re-derived, never trusted ──
  const observed = [];
  for (const row of sessions) {
    if (!row || row.usename !== EXECUTOR_ROLE || row.backend_type !== "client backend") continue;
    if (typeof row.backend_start !== "string" || row.backend_start.length < 10) return fail("session_start_not_visible");
    if (!Number.isInteger(Number(row.pid)) || typeof row.application_name !== "string" || row.application_name === "") continue;
    observed.push({ pid: Number(row.pid), backendStart: row.backend_start, applicationName: row.application_name, usename: row.usename,
      datname: row.datname === null || row.datname === undefined ? null : String(row.datname) });
  }
  if (observed.length === 0) return fail("no_executor_session_observed");
  const matches = observed.filter((x) => executorConnectionTokenFor(x) === claimedConnectionToken);
  if (matches.length === 0) return fail("no_such_session");
  if (matches.length > 1) return fail("ambiguous_session");
  const sess = matches[0];
  if (!sess.applicationName.startsWith(EXECUTOR_APPLICATION_NAME_PREFIX)) return fail("session_application_name_not_executor");
  if (sess.datname === null || sess.datname !== cluster.datname) return fail("session_database_mismatch");

  // ── reviewed objects must exist ──
  for (const obj of REQUIRED_OBJECTS) {
    const dot = obj.indexOf(".");
    let ex; try { ex = await observer.evidence(XQ.objectExists, [obj.slice(0, dot), obj.slice(dot + 1)]); } catch { return fail("evidence_unavailable"); }
    if (!ex[0] || Number(ex[0].n) !== 1) return fail("reviewed_object_absent");
  }

  const roleMemberships = sorted(memberships.map((m) => (m && m.rolname ? String(m.rolname) : "")).filter(Boolean));
  const prohibitedReachable = prohibited.filter((r) => b(r.reachable)).map((r) => String(r.rolname));

  // ── schema authority (V2 expectation) ──
  const trustedSchemaUsage = [], schemaCreate = [], unexpectedUsage = []; let schemaOwner = false;
  for (const row of schemas) {
    const n = row && row.nspname ? String(row.nspname) : null; if (!n) continue;
    if (!strictBool(row.usage) || !strictBool(row.create)) return fail("privilege_measurement_incomplete");
    if (b(row.create)) schemaCreate.push(n);
    if (b(row.owner)) schemaOwner = true;
    if (b(row.usage)) { if (isTrustedSchema(n)) trustedSchemaUsage.push(n); if (!PERMITTED_USAGE_V2.has(n)) unexpectedUsage.push(n); }
  }

  // ── routine EXECUTE authority (V2 expectation) ──
  const executableRoutines = sorted(routines.map((r) => (r && r.routine ? String(r.routine) : "")).filter(Boolean));
  const unapprovedRoutineExecute = executableRoutines.some((r) => !EXPECTED_ROUTINES_V2.has(r));

  // ── relation / sequence / MAINTAIN authority ──
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

  // ── supported server + complete ACL-bearing coverage ──
  const v0 = ver[0] ? Number(ver[0].v) : NaN;
  if (!Number.isInteger(v0) || !SUPPORTED_SERVER_MAJORS.includes(Math.floor(v0 / 10000))) return fail("server_version_unsupported");
  const cats = sorted(aclCats.map((r) => (r && r.col ? String(r.col) : "")).filter(Boolean));
  if (JSON.stringify(cats) !== JSON.stringify(sorted(ACL_BEARING_CATALOGS))) return fail("privilege_class_coverage_incomplete");

  // ── extended authority findings (V2 reviewed shdepend set) ──
  const extended = [];
  const reviewedShdep = new Set([...EXPECTED_TRUSTED_USAGE_V2.map((n) => "pg_namespace:" + n), ...EXPECTED_EXECUTOR_PRIVILEGES_V2.executableRoutines.map((r) => "pg_proc:" + r)]);
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
  const currentUserProven = sess.usename === EXECUTOR_ROLE && roleMemberships.length === 0 && r0.rolsuper === false;

  return {
    ok: true,
    measured: Object.freeze({
      observedAtMs, dbNowMs, cluster,
      connection: Object.freeze({ role: EXECUTOR_ROLE, token: executorConnectionTokenFor(sess) }),
      privileges: Object.freeze({
        budgetTablePrivilegeCount,
        currentUser: currentUserProven ? EXECUTOR_ROLE : "unproven",
        executableRoutines: Object.freeze(executableRoutines),
        ledgerPrivilegeCount,
        publicOrDefaultPrivilegeWidening,
        rolbypassrls: r0.rolbypassrls, rolcreatedb: r0.rolcreatedb, rolcreaterole: r0.rolcreaterole, rolreplication: r0.rolreplication, rolsuper: r0.rolsuper,
        roleMemberships: Object.freeze(roleMemberships),
        schemaCreate: Object.freeze(sorted(schemaCreate)),
        sessionUser: sess.usename,
        trustedSchemaUsage: Object.freeze(sorted(trustedSchemaUsage)),
        unapprovedRoutineExecute,
      }),
      // R3 V2 evidence-policy context (exact key set); observerIndependent is true ONLY because every observer
      // least-privilege/independence check above passed (any failure returned before this point).
      context: Object.freeze({
        databaseCreate: d0.create, databaseOwner: d0.owner,
        extendedFindings: Object.freeze(sorted([...new Set(extended)])),
        observerIndependent: true, ownedCount,
        prohibitedReachable: Object.freeze(prohibitedReachable), schemaOwner,
        serverVersionMajor: Math.floor(v0 / 10000),
        unexpectedUsage: Object.freeze(sorted(unexpectedUsage)),
      }),
    }),
  };
}

/**
 * Build the EXACT R3 V2 evidence object (input of the frozen evaluateObservedExecutorEvidenceV2) from a measurement
 * and the Owner-issued executor anchor. The target is anchor-derived only; a cluster mismatch refuses.
 */
export function toPolicyEvidenceV2(measured, anchor) {
  if (!measured || !measured.cluster) return fail("measurement_absent");
  const tgt = resolveExecutorTarget(anchor, measured.cluster);
  if (!tgt.ok) return fail(tgt.reason);
  const p = measured.privileges;
  return { ok: true, evidence: {
    connection: { role: measured.connection.role, token: measured.connection.token },
    context: { ...measured.context, extendedFindings: [...measured.context.extendedFindings], prohibitedReachable: [...measured.context.prohibitedReachable],
      unexpectedUsage: [...measured.context.unexpectedUsage] },
    dbNowMs: measured.dbNowMs, observedAtMs: measured.observedAtMs,
    privileges: { ...p, executableRoutines: [...p.executableRoutines], roleMemberships: [...p.roleMemberships], schemaCreate: [...p.schemaCreate],
      trustedSchemaUsage: [...p.trustedSchemaUsage] },
    target: { environmentId: tgt.target.environmentId, pgServiceId: tgt.target.pgServiceId, projectId: tgt.target.projectId },
  } };
}
