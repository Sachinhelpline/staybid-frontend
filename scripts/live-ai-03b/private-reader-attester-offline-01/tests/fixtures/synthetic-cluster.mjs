// SYNTHETIC POSTGRESQL CLUSTER FIXTURE — TEST ONLY. Models ONE shared cluster state observed by TWO
// independent physical connections: the reader's session (LIFECYCLE_SQL, as accepted in
// private-reader-production-integration-offline-01/reader-session.mjs) and the attester's observer
// session (the fixed evidence registry in evidence-queries.mjs). This is what lets the same reader
// session opened through the accepted reader-host entrypoint be independently observed by the real
// attester code under test. No network, no real database — NOT evidence about hosted PostgreSQL.
import { LIFECYCLE_SQL, parsePgDurationMs, newApplicationName, connectionTokenFor } from "../../../private-reader-production-integration-offline-01/reader-session.mjs";
import { Q, READER_ROLE, PERMITTED_SELECT_OBJECTS, FORBIDDEN_OBJECT, PROHIBITED_ROLES, TRUSTED_SCHEMA } from "../../evidence-queries.mjs";
import { AI_STAGING } from "../../attester-config.mjs";
import { clusterFingerprint, ANCHOR_CONTRACT, ANCHOR_DOMAIN } from "../../target-binding.mjs";
import { FIXED } from "../../../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import { DORMANT_POLICY_CONTROL_QUERY, ARMED_POLICY_CONTROL_QUERY, CEILINGS_QUERY, ZERO_EXPOSURE_COUNTS_QUERY } from "../../../trusted-runtime-live-binding-offline-01/production-read-queries.mjs";
import { CATALOG_ACTIVE_COUNT_QUERY, CATALOG_ACTIVE_DIGEST_QUERY, CATALOG_INACTIVE_VERSION_QUERY, CATALOG_INACTIVE_ENTRY_COUNT_QUERY } from "../../../trusted-executor-runtime-01/trusted-read-adapter.mjs";

// Fixed synthetic rows for the ACCEPTED reviewed observation registry (what the reader host reads).
const observationRow = (q) => (
  q === CATALOG_ACTIVE_COUNT_QUERY ? { n: 1 } :
  q === CATALOG_INACTIVE_VERSION_QUERY ? { n: 1, digest: "inactive-digest" } :
  q === CATALOG_INACTIVE_ENTRY_COUNT_QUERY ? { n: 2 } :
  q === CATALOG_ACTIVE_DIGEST_QUERY ? { catalog_digest: "active-digest" } :
  q === DORMANT_POLICY_CONTROL_QUERY ? { active_policy_count: 0, dormant_policy_present: true, global_control_epoch: 1, project_control_epoch: 1, global_control_enabled: false, project_control_enabled: false, global_control_killed: false, project_control_killed: false } :
  q === ARMED_POLICY_CONTROL_QUERY ? { one_call_policy_digest: FIXED.one_call_policy_digest, control_global_digest: "g", control_project_digest: "p", global_control_epoch: 2, project_control_epoch: 2, global_control_enabled: true, project_control_enabled: true, global_control_killed: false, project_control_killed: false } :
  q === CEILINGS_QUERY ? { session_money_ceiling_micros: 89536, session_provider_calls: 1, session_execution_admissions: 1, subject_day_money_ceiling_micros: 89536, project_day_money_ceiling_micros: 89536, project_month_money_ceiling_micros: 89536, global_day_money_ceiling_micros: 89536 } :
  q === ZERO_EXPOSURE_COUNTS_QUERY ? { envelopes: 0, provider_reservations: 0, provider_settlements: 0, execution_consumptions: 0, decisions: 0, reconciliations: 0, scope_counters: 0, sessions: 0 } : null);

/**
 * @param scenario base | wrong_role | extra_membership | write_privilege | forbidden_object_accessible |
 *   missing_object | public_grant_unexpected | routine_execute | schema_create | observer_no_stats |
 *   observer_is_superuser | observer_is_reader | wrong_target
 */
export function makeSyntheticCluster({ scenario = "base" } = {}) {
  let pidSeq = 51000;
  const sessions = []; // { pid, backendStart, applicationName, usename, datname, backendType, dead, st, ro, cbs }
  const state = {
    datname: "railway", databaseOid: "16401", readerRoleOid: "20001", encoding: "6",
    role: { rolsuper: false, rolcanlogin: true, rolinherit: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false },
    permitted: new Map(PERMITTED_SELECT_OBJECTS.map((o) => [o, true])),   // object -> exists
    tableSelect: new Map(PERMITTED_SELECT_OBJECTS.map((o) => [o, true])),
    tableWrite: new Map(PERMITTED_SELECT_OBJECTS.map((o) => [o, false])),
    forbiddenExists: true, forbiddenSelect: false, forbiddenWrite: false,
    memberships: [],           // extra role names the reader is (recursively) a member of
    reachableExtra: [],        // [{obj, sel, wr}] objects outside the 12 + ledger + forbidden
    routines: [],              // routine names with EXECUTE
    schemaCreate: false,       // reader holds CREATE on public
    publicGrants: [],          // [{obj, privilege_type}]
    sequences: [],             // [{seq, usage, upd, sel}]
    databaseCreate: false,     // reader holds CREATE on the database
    maintain: [],              // PostgreSQL 17+ tables on which the reader holds MAINTAIN
    observerHasStats: true, observerIsSuperuser: false, observerRole: "attester_observer",
    obsQueries: 0, opensReader: 0, opensObserver: 0, evidenceCallLog: [], failObserverOpens: 0,
  };
  if (scenario === "wrong_role") state.role.rolcanlogin = true; // handled via a differently-named session below
  if (scenario === "extra_membership") state.memberships = ["grp_extra"];
  if (scenario === "write_privilege") state.tableWrite.set(PERMITTED_SELECT_OBJECTS[0], true);
  if (scenario === "forbidden_object_accessible") state.forbiddenSelect = true;
  if (scenario === "missing_object") state.permitted.set(PERMITTED_SELECT_OBJECTS[0], false);
  if (scenario === "public_grant_unexpected") { state.reachableExtra.push({ obj: "public.unexpected_new_table", sel: true, wr: false }); state.publicGrants.push({ obj: "public.unexpected_new_table", privilege_type: "SELECT" }); }
  if (scenario === "routine_execute") state.routines.push("public.some_function");
  if (scenario === "schema_create") state.schemaCreate = true;
  if (scenario === "observer_no_stats") state.observerHasStats = false;
  if (scenario === "sequence_usage") state.sequences = [{ seq: "public.budget_decisions_seq", usage: true, upd: false, sel: false }];
  if (scenario === "database_create") state.databaseCreate = true;
  if (scenario === "maintain_pg17") state.maintain = [PERMITTED_SELECT_OBJECTS[0]];
  if (scenario === "observer_is_superuser") state.observerIsSuperuser = true;
  if (scenario === "observer_is_reader") state.observerRole = READER_ROLE;

  function openReaderSession(opts = {}) {
    state.opensReader++;
    const s = { pid: ++pidSeq, backendStart: new Date(Date.UTC(2026, 8, 24, 12, 0, state.opensReader)).toISOString().replace(/\.\d{3}Z$/, ".000000Z"),
      applicationName: typeof opts.applicationName === "string" ? opts.applicationName : newApplicationName(),
      usename: scenario === "wrong_role" ? "postgres" : READER_ROLE, datname: state.datname, backendType: "client backend",
      dead: false, st: 0, ro: "off", cbs: [] };
    s.kill = () => { if (s.dead) return; s.dead = true; for (const cb of s.cbs) { try { cb(); } catch {} } };
    sessions.push(s);
    return Object.freeze({
      applicationName: s.applicationName, isDead: () => s.dead, onDead: (cb) => { if (s.dead) cb(); else s.cbs.push(cb); },
      async close() { s.kill(); },
      async query(sql, params) {
        if (s.dead) throw new Error("connection terminated");
        if (sql === LIFECYCLE_SQL.setStatementTimeout) { s.st = parsePgDurationMs(params[0]); return { rows: [{ v: params[0] }] }; }
        if (sql === LIFECYCLE_SQL.readStatementTimeout) return { rows: [{ v: s.st === 0 ? "0" : s.st + "ms" }] };
        if (sql === LIFECYCLE_SQL.setReadOnly) { s.ro = "on"; return { rows: [{ v: "on" }] }; }
        if (sql === LIFECYCLE_SQL.readReadOnly) return { rows: [{ v: s.ro }] };
        if (sql === LIFECYCLE_SQL.readIdentity) return { rows: [{ current_user: s.usename, session_user: s.usename, pid: s.pid, backend_start: s.backendStart, application_name: s.applicationName }] };
        const row = observationRow(sql);
        if (!row) throw new Error("relation does not exist");
        state.readerObservationQueries = (state.readerObservationQueries || 0) + 1;
        return { rows: [row] };
      },
    });
  }

  function openObserverSession() {
    if (state.failObserverOpens > 0) { state.failObserverOpens--; throw new Error("observer connect refused"); }
    state.opensObserver++;
    const s = { dead: false, st: 0, ro: "off" };
    return Object.freeze({
      isDead: () => s.dead,
      async close() { s.dead = true; },
      async query(sql, params) {
        state.evidenceCallLog.push(sql);
        if (sql === "SELECT set_config('statement_timeout', $1, false) AS v") { s.st = parsePgDurationMs(params[0]); return { rows: [{ v: params[0] }] }; }
        if (sql === "SELECT current_setting('statement_timeout') AS v") return { rows: [{ v: s.st === 0 ? "0" : s.st + "ms" }] };
        if (sql === "SELECT set_config('default_transaction_read_only', 'on', false) AS v") { s.ro = "on"; return { rows: [{ v: "on" }] }; }
        if (sql === "SELECT current_setting('default_transaction_read_only') AS v") return { rows: [{ v: s.ro }] };
        state.obsQueries++;
        if (sql === Q.observerIdentity) return { rows: [{ current_user: state.observerRole, datname: state.datname, has_read_all_stats: state.observerHasStats, database_oid: state.databaseOid, is_superuser: state.observerIsSuperuser }] };
        if (sql === Q.clusterFingerprint) return { rows: [{ database_oid: state.databaseOid, datname: state.datname, reader_role_oid: state.readerRoleOid, encoding: state.encoding }] };
        if (sql === Q.readerSessions) {
          const rows = sessions.filter((x) => !x.dead && x.usename === params[0]).map((x) => ({ pid: x.pid, usename: x.usename, application_name: x.applicationName, datname: x.datname, backend_type: x.backendType, backend_start: state.observerHasStats ? x.backendStart : null, state: "active", client_addr: null }));
          return { rows };
        }
        if (sql === Q.readerRole) return { rows: [{ rolname: params[0], ...state.role }] };
        if (sql === Q.readerMemberships) return { rows: state.memberships.map((r) => ({ rolname: r })) };
        if (sql === Q.objectExists) {
          const obj = params[0];
          const exists = obj === FORBIDDEN_OBJECT ? state.forbiddenExists : (state.permitted.has(obj) ? state.permitted.get(obj) : true);
          return { rows: [{ reg: exists ? obj : null }] };
        }
        if (sql === Q.tablePrivilege) {
          const [, obj] = params;
          if (obj === FORBIDDEN_OBJECT) return { rows: [{ sel: state.forbiddenSelect, ins: state.forbiddenWrite, upd: false, del: false, trunc: false, refs: false, trig: false }] };
          const sel = state.tableSelect.get(obj) !== false; const wr = state.tableWrite.get(obj) === true;
          return { rows: [{ sel, ins: wr, upd: false, del: false, trunc: false, refs: false, trig: false }] };
        }
        if (sql === Q.readerReachableTables) {
          const rows = [];
          for (const [obj, sel] of state.tableSelect) if (sel) rows.push({ obj, sel: true, wr: state.tableWrite.get(obj) === true });
          for (const e of state.reachableExtra) rows.push(e);
          return { rows };
        }
        if (sql === Q.readerRoutines) return { rows: state.routines.map((r) => ({ routine: r })) };
        if (sql === Q.readerSchemas) return { rows: [{ nspname: "public", usage: true, create: state.schemaCreate }, { nspname: TRUSTED_SCHEMA, usage: false, create: false }] };
        if (sql === Q.prohibitedRoleReachability) return { rows: PROHIBITED_ROLES.map((r) => ({ rolname: r, reachable: false })) };
        if (sql === Q.publicGrants) return { rows: state.publicGrants };
        if (sql === Q.readerSequences) return { rows: state.sequences };
        if (sql === Q.readerDatabase) return { rows: [{ create: state.databaseCreate, temp: true, owner: false }] };
        if (sql === Q.readerMaintain) return { rows: state.maintain.map((o) => ({ obj: o })) };
        throw new Error("evidence sql not modeled: " + sql);
      },
    });
  }

  const readerFactory = { async open(opts) { return openReaderSession(opts); } };
  const observerFactory = { async open() { return openObserverSession(); } };

  function goodAnchor() {
    const fp = clusterFingerprint({ datname: state.datname, databaseOid: state.databaseOid, readerRoleOid: state.readerRoleOid, encoding: state.encoding });
    return { contract: ANCHOR_CONTRACT, domain: ANCHOR_DOMAIN, clusterFingerprint: fp, projectId: AI_STAGING.projectId, environmentId: AI_STAGING.environmentId, pgServiceId: AI_STAGING.pgServiceId, issuedAtMs: Date.now(), verifiedBy: "owner-manual-review-2026-09-24" };
  }
  return { state, readerFactory, observerFactory, killAllReaderSessions: () => { for (const s of sessions) s.kill(); }, liveReaderIdentities: () => sessions.filter((x) => !x.dead).map((x) => ({ pid: x.pid, backendStart: x.backendStart, applicationName: x.applicationName })), liveReaderSessions: () => sessions.filter((s) => !s.dead).length, goodAnchorJson: () => JSON.stringify(goodAnchor()), tokenFor: (s) => connectionTokenFor(s) };
}
