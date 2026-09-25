// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — ATTESTER: INDEPENDENT EVIDENCE OBSERVATION + EVALUATION (OFFLINE). Node built-ins only.
//
// Turns the fixed evidence registry into the exact fields the ACCEPTED reader-host verifier checks. Every
// value is measured here; nothing is taken from the requester. Any measurement that cannot be completed
// fails closed — the attester never signs a stronger claim than it observed.
//
// Physical-session identity: the reader's connection token is re-derived from the attester's OWN
// pg_stat_activity observation using the ACCEPTED contract (connectionTokenFor in the frozen-adjacent
// reader-session module). The requester's claimed token is only ever used to SELECT which observed
// session to attest — never as evidence that the session exists or is the reader's.
// ─────────────────────────────────────────────────────────────────────────
import { connectionTokenFor } from "../private-reader-production-integration-offline-01/reader-session.mjs";
import { Q, READER_ROLE, FORBIDDEN_OBJECT, PERMITTED_SELECT_OBJECTS, WRITE_PRIVILEGES, PROHIBITED_ROLES, TRUSTED_SCHEMA } from "./evidence-queries.mjs";

export const EXPECTED_SELECT_GRANT_COUNT = PERMITTED_SELECT_OBJECTS.length; // 12 — the count the reader host pins
// Schema authority the reader legitimately holds (USAGE only; CREATE never).
const EXPECTED_SCHEMA_USAGE = Object.freeze(["public"]);
// The reader may hold SELECT on the deferred trusted ledger once that grant is applied; it is NOT counted
// in the 12 budget objects, and it must never carry write authority.
const OPTIONAL_LEDGER_OBJECT = TRUSTED_SCHEMA + ".approval_consumption";

function fail(reason, detail) { return { ok: false, reason, ...(detail ? { detail } : {}) }; }
const b = (v) => v === true;

/**
 * Observe and evaluate everything the accepted attestation payload asserts.
 * @param observer from establishObserverSession()
 * @param claimedConnectionToken the token the requester asked about (selection key ONLY)
 * Returns { ok:true, evidence:{ connection, privileges, observedAtMs, cluster, observer } } or { ok:false, reason }.
 */
export async function observeReaderEvidence(observer, claimedConnectionToken, { nowProvider = Date.now } = {}) {
  const observedAtMs = nowProvider();
  let self, fp, sessions, role, memberships, reachable, routines, schemas, prohibited, publicGrants, sequences, database, maintain;
  try {
    self = await observer.evidence(Q.observerIdentity, []);
    fp = await observer.evidence(Q.clusterFingerprint, [READER_ROLE]);
    sessions = await observer.evidence(Q.readerSessions, [READER_ROLE]);
    role = await observer.evidence(Q.readerRole, [READER_ROLE]);
    memberships = await observer.evidence(Q.readerMemberships, [READER_ROLE]);
    reachable = await observer.evidence(Q.readerReachableTables, [READER_ROLE, TRUSTED_SCHEMA]);
    routines = await observer.evidence(Q.readerRoutines, [READER_ROLE, TRUSTED_SCHEMA]);
    schemas = await observer.evidence(Q.readerSchemas, [READER_ROLE, TRUSTED_SCHEMA]);
    prohibited = await observer.evidence(Q.prohibitedRoleReachability, [READER_ROLE, PROHIBITED_ROLES.slice()]);
    publicGrants = await observer.evidence(Q.publicGrants, [TRUSTED_SCHEMA]);
    sequences = await observer.evidence(Q.readerSequences, [READER_ROLE, TRUSTED_SCHEMA]);
    database = await observer.evidence(Q.readerDatabase, [READER_ROLE]);
    maintain = await observer.evidence(Q.readerMaintain, [READER_ROLE, TRUSTED_SCHEMA]);
  } catch { return fail("evidence_unavailable"); }

  // ── observer capability: without pg_read_all_stats, backend_start is NULL and no token can be derived ──
  const s0 = self[0];
  if (!s0 || typeof s0.current_user !== "string") return fail("observer_identity_unavailable");
  if (b(s0.is_superuser)) return fail("observer_is_superuser");           // least privilege is a hard requirement
  if (!b(s0.has_read_all_stats)) return fail("observer_lacks_session_visibility");
  if (s0.current_user === READER_ROLE) return fail("observer_is_reader");  // must be an independent identity

  // ── cluster fingerprint (stable per cluster+database; detects a swapped endpoint) ──
  const f0 = fp[0];
  if (!f0 || !f0.database_oid || !f0.datname || !f0.reader_role_oid) return fail("cluster_fingerprint_unavailable");
  const cluster = Object.freeze({ datname: String(f0.datname), databaseOid: String(f0.database_oid), readerRoleOid: String(f0.reader_role_oid), encoding: f0.encoding === null || f0.encoding === undefined ? null : String(f0.encoding) });

  // ── reader role attributes ──
  const r0 = role[0];
  if (!r0) return fail("reader_role_absent");
  if (b(r0.rolsuper) || b(r0.rolbypassrls) || b(r0.rolcreatedb) || b(r0.rolcreaterole) || b(r0.rolreplication)) return fail("reader_role_overprivileged");
  if (!b(r0.rolcanlogin)) return fail("reader_role_cannot_login");

  // ── physical session: the attester's OWN observation decides which session exists ──
  const observed = [];
  for (const row of sessions) {
    if (!row || row.usename !== READER_ROLE || row.backend_type !== "client backend") continue;
    if (typeof row.backend_start !== "string" || row.backend_start.length < 10) return fail("session_start_not_visible");
    if (!Number.isInteger(Number(row.pid)) || typeof row.application_name !== "string" || row.application_name === "") continue;
    observed.push({ pid: Number(row.pid), backendStart: row.backend_start, applicationName: row.application_name, datname: row.datname === null || row.datname === undefined ? null : String(row.datname) });
  }
  if (observed.length === 0) return fail("no_reader_session_observed");
  const matches = observed.filter((x) => connectionTokenFor(x) === claimedConnectionToken); // re-derived, never trusted
  if (matches.length === 0) return fail("no_such_session");
  if (matches.length > 1) return fail("ambiguous_session");                 // cannot bind unambiguously
  const sess = matches[0];
  if (sess.datname !== null && sess.datname !== cluster.datname) return fail("session_database_mismatch");

  // ── effective privileges (measured, not inferred) ──
  const permitted = new Set(PERMITTED_SELECT_OBJECTS);
  let selectGrantCount = 0; let writePrivilegeCount = 0; let forbiddenObjectAccessible = false;
  let unexpectedObjectAuthority = false;
  const missing = [];
  for (const obj of PERMITTED_SELECT_OBJECTS) {
    let ex, pr;
    try {
      ex = await observer.evidence(Q.objectExists, [obj]);
      if (!ex[0] || ex[0].reg === null || ex[0].reg === undefined) { missing.push(obj); continue; }
      pr = await observer.evidence(Q.tablePrivilege, [READER_ROLE, obj]);
    } catch { return fail("evidence_unavailable"); }
    const p = pr[0];
    if (!p) return fail("privilege_measurement_incomplete");
    if (b(p.sel)) selectGrantCount++;
    for (const k of ["ins", "upd", "del", "trunc", "refs", "trig"]) if (b(p[k])) writePrivilegeCount++;
  }
  if (missing.length > 0) return fail("permitted_object_absent");            // schema drift ⇒ no signature
  // forbidden object
  try {
    const ex = await observer.evidence(Q.objectExists, [FORBIDDEN_OBJECT]);
    if (ex[0] && ex[0].reg) {
      const pr = await observer.evidence(Q.tablePrivilege, [READER_ROLE, FORBIDDEN_OBJECT]);
      const p = pr[0];
      if (!p) return fail("privilege_measurement_incomplete");
      if (b(p.sel) || WRITE_PRIVILEGES.some((_, i) => b([p.ins, p.upd, p.del, p.trunc, p.refs, p.trig][i]))) forbiddenObjectAccessible = true;
    }
  } catch { return fail("evidence_unavailable"); }
  // anything reachable beyond the reviewed set (catches PUBLIC grants and new objects alike)
  for (const row of reachable) {
    const obj = row && row.obj ? String(row.obj) : null;
    if (!obj) continue;
    if (b(row.wr)) writePrivilegeCount++;
    if (permitted.has(obj) || obj === OPTIONAL_LEDGER_OBJECT) continue;
    if (obj === FORBIDDEN_OBJECT) { forbiddenObjectAccessible = true; continue; }
    unexpectedObjectAuthority = true;                                        // e.g. a PUBLIC grant on a new table
  }
  // memberships: ANY membership is unapproved authority (a NOINHERIT member can still SET ROLE)
  const memberOf = memberships.map((m) => (m && m.rolname ? String(m.rolname) : "")).filter(Boolean);
  const unapprovedRoleMembership = memberOf.length > 0;
  const prohibitedReachable = prohibited.filter((r) => b(r.reachable)).map((r) => String(r.rolname));
  // routine EXECUTE authority in the reviewed schemas
  const unapprovedRoutineAuthority = routines.length > 0;
  // schema authority
  let schemaAuthorityUnexpected = false;
  for (const row of schemas) {
    const n = row && row.nspname ? String(row.nspname) : null; if (!n) continue;
    if (b(row.create)) schemaAuthorityUnexpected = true;
    if (b(row.usage) && !EXPECTED_SCHEMA_USAGE.includes(n) && n !== TRUSTED_SCHEMA) schemaAuthorityUnexpected = true;
  }
  const publicGrantObjects = publicGrants.map((g) => (g && g.obj ? String(g.obj) : "")).filter(Boolean);
  // sequences: USAGE/UPDATE are write authority (nextval/setval); SELECT on a sequence is unreviewed authority
  let sequenceAuthorityUnexpected = false;
  for (const row of sequences) {
    if (!row) continue;
    if (b(row.usage)) writePrivilegeCount++;
    if (b(row.upd)) writePrivilegeCount++;
    if (b(row.sel)) sequenceAuthorityUnexpected = true;
  }
  // database-level authority: CREATE (new schemas) or ownership is disqualifying. TEMPORARY is a PostgreSQL
  // PUBLIC default the accepted Sections I–III do not revoke; it is recorded, not signed as a claim, and the
  // reader's sessions run with default_transaction_read_only=on, which rejects CREATE TEMP TABLE.
  const d0 = database[0];
  if (!d0) return fail("privilege_measurement_incomplete");
  const databaseAuthorityUnexpected = b(d0.create) || b(d0.owner);
  const maintainAuthority = maintain.length > 0;                            // PostgreSQL 17+ MAINTAIN on any table
  if (b(d0.create)) writePrivilegeCount++;

  const ownerOrExecutorAuthority = unapprovedRoleMembership || prohibitedReachable.length > 0 || schemaAuthorityUnexpected
    || unexpectedObjectAuthority || sequenceAuthorityUnexpected || databaseAuthorityUnexpected || maintainAuthority || b(r0.rolsuper);
  const effectiveSelectOnly = writePrivilegeCount === 0 && !forbiddenObjectAccessible && !unexpectedObjectAuthority;

  return {
    ok: true,
    evidence: Object.freeze({
      observedAtMs,
      cluster,
      observer: Object.freeze({ role: String(s0.current_user), hasReadAllStats: true }),
      connection: Object.freeze({ token: connectionTokenFor(sess), role: READER_ROLE, pid: sess.pid, backendStart: sess.backendStart, applicationName: sess.applicationName }),
      // exactly the accepted payload privilege fields
      privileges: Object.freeze({
        currentUser: READER_ROLE,
        effectiveSelectOnly,
        writePrivilegeCount,
        selectGrantCount,
        forbiddenObjectAccessible,
        unapprovedRoleMembership,
        unapprovedRoutineAuthority,
        ownerOrExecutorAuthority,
      }),
      // measured context kept for the attester's own decision + logs (never signed, never returned)
      context: Object.freeze({ memberOf, prohibitedReachable, publicGrantObjects, schemaAuthorityUnexpected, unexpectedObjectAuthority,
        sequenceAuthorityUnexpected, databaseAuthorityUnexpected, maintainAuthority, databaseTemporary: b(d0.temp) }),
    }),
  };
}

/**
 * The attester signs ONLY a clean observation: the accepted contract's expected state. Anything else is
 * refused outright rather than signed as an adverse claim, so a bad state can never be replayed as proof.
 */
export function evidenceIsAttestable(ev) {
  const p = ev.privileges;
  if (p.currentUser !== READER_ROLE) return fail("drift_current_user");
  if (p.selectGrantCount !== EXPECTED_SELECT_GRANT_COUNT) return fail("drift_select_grant_count");
  if (p.writePrivilegeCount !== 0) return fail("drift_write_privilege");
  if (p.forbiddenObjectAccessible) return fail("drift_forbidden_object_accessible");
  if (p.unapprovedRoleMembership) return fail("drift_role_membership");
  if (p.unapprovedRoutineAuthority) return fail("drift_routine_authority");
  if (p.ownerOrExecutorAuthority) return fail("drift_owner_or_executor_authority");
  if (!p.effectiveSelectOnly) return fail("drift_not_select_only");
  return { ok: true };
}
