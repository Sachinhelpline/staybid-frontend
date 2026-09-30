// TEST-ONLY synthetic PostgreSQL stand-in for the executor attestation issuer (offline; no network; no real DB).
// Answers ONLY the observer setup statements and the fixed executor evidence registry, from a scripted state whose
// default is the CLEAN accepted post-Step-1 executor shape (as measured on a real throwaway cluster by
// tests/localpg). Any SQL outside the registry throws — so a test proves the issuer never issues unregistered SQL.
import { XQ } from "../../src/executor-evidence-queries.mjs";
import { executorConnectionTokenFor, newExecutorApplicationName } from "../../../m7-v2-production-authority-provisioning-offline-01/src/executor-session.mjs";
import { BUDGET_OBJECTS, LEDGER_OBJECT, ACL_BEARING_CATALOGS } from "../../src/executor-evidence-queries.mjs";

export const EX = "live_ai_03b_executor";
export function cleanState(over = {}) {
  const appName = newExecutorApplicationName();
  const base = {
    now: () => Date.now(),
    observer: { current_user: "live_ai_03b_executor_attester_observer", session_user: "live_ai_03b_executor_attester_observer", has_read_all_stats: true,
      is_superuser: false, createrole: false, createdb: false, replication: false, bypassrls: false, member_of_executor: false, member_of_reader: false },
    observerMemberships: ["pg_read_all_stats"],
    dbSkewMs: 0,
    cluster: { datname: "railway", database_oid: "16384", executor_role_oid: "16500", encoding: "6" },
    sessions: [{ pid: 4242, usename: EX, application_name: appName, datname: "railway", backend_type: "client backend", backend_start: "2026-09-29T10:00:00.123456Z" }],
    role: { rolname: EX, rolsuper: false, rolcanlogin: true, rolinherit: true, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false },
    memberships: [], prohibitedReachable: [],
    schemas: [{ nspname: "live_ai_03b_trusted", usage: true, create: false, owner: false }, { nspname: "live_ai_03b_trusted_v2", usage: true, create: false, owner: false },
      { nspname: "public", usage: true, create: false, owner: false }],
    routines: ["live_ai_03b_trusted.activate_catalog(jsonb,text)", "live_ai_03b_trusted.restore_catalog_inactive(jsonb,text)",
      "live_ai_03b_trusted_v2.activate_catalog_v2(jsonb,text)", "live_ai_03b_trusted_v2.restore_catalog_v2_inactive(jsonb,text)"],
    relations: [], sequences: [], maintain: [],
    database: { create: false, temp: true, owner: false }, owned: 0,
    objects: new Set([...BUDGET_OBJECTS, LEDGER_OBJECT]),
    publicRelationGrants: [], publicSchemaGrants: [], publicTrustedRoutines: [], defaultAcl: [],
    // R1 catch-all evidence — defaults = the CLEAN accepted state as measured on real PostgreSQL 16.13 / 18.4
    serverVersionNum: 180004, aclCatalogs: [...ACL_BEARING_CATALOGS],
    shdepend: [
      ...["live_ai_03b_trusted", "live_ai_03b_trusted_v2"].map((name, i) => ({ dbid: "16384", cls: "pg_namespace", objid: String(16653 + i), objsubid: 0, deptype: "a", this_db: true, name })),
      ...["live_ai_03b_trusted.activate_catalog(jsonb,text)", "live_ai_03b_trusted.restore_catalog_inactive(jsonb,text)", "live_ai_03b_trusted_v2.activate_catalog_v2(jsonb,text)",
        "live_ai_03b_trusted_v2.restore_catalog_v2_inactive(jsonb,text)"].map((name, i) => ({ dbid: "16384", cls: "pg_proc", objid: String(16665 + i), objsubid: 0, deptype: "a", this_db: true, name })),
    ],
    databaseGrants: [], extendedEffective: [], publicExtended: [], ownershipAll: [],
    setup: { timeoutMs: null, readOnly: "off" },
    failOn: null,          // an XQ key whose query throws
    stallOn: null,         // an XQ key whose query never resolves
  };
  return { ...base, ...over, observer: { ...base.observer, ...(over.observer || {}) }, role: { ...base.role, ...(over.role || {}) }, database: { ...base.database, ...(over.database || {}) } };
}
export const tokenOf = (s) => executorConnectionTokenFor({ pid: s.pid, backendStart: s.backend_start, applicationName: s.application_name });

/** A synthetic physical connection over `state`. Records every statement in `log`. */
export function syntheticPhysical(state, log = []) {
  let dead = false;
  const key = (sql) => Object.keys(XQ).find((k) => XQ[k] === sql);
  return Object.freeze({
    async query(sql, params) {
      log.push(sql);
      if (dead) throw new Error("dead");
      if (sql === "SELECT set_config('statement_timeout', $1, false) AS v") { state.setup.timeoutMs = params[0]; return { rows: [{ v: params[0] }] }; }
      if (sql === "SELECT current_setting('statement_timeout') AS v") return { rows: [{ v: state.setup.timeoutMs }] };
      if (sql === "SELECT set_config('default_transaction_read_only', 'on', false) AS v") { state.setup.readOnly = "on"; return { rows: [{ v: "on" }] }; }
      if (sql === "SELECT current_setting('default_transaction_read_only') AS v") return { rows: [{ v: state.setup.readOnly }] };
      const k = key(sql);
      if (!k) throw new Error("synthetic: unregistered SQL");
      if (state.failOn === k) throw new Error("synthetic failure");
      if (state.stallOn === k) return new Promise(() => {});
      const s = state;
      switch (k) {
        case "observerIdentity": return { rows: [{ ...s.observer, datname: s.cluster.datname, database_oid: s.cluster.database_oid }] };
        case "observerMemberships": return { rows: s.observerMemberships.map((rolname) => ({ rolname })) };
        case "dbClock": return { rows: [{ ms: String(s.now() + s.dbSkewMs) }] };
        case "clusterFingerprint": return { rows: [{ ...s.cluster }] };
        case "executorSessions": return { rows: s.sessions.filter((x) => x.usename === params[0]) };
        case "executorRole": return { rows: s.role ? [{ ...s.role }] : [] };
        case "executorMemberships": return { rows: s.memberships.map((rolname) => ({ rolname })) };
        case "prohibitedRoleReachability": return { rows: params[1].map((r) => ({ rolname: r, reachable: s.prohibitedReachable.includes(r) })) };
        case "executorSchemas": return { rows: s.schemas.map((x) => ({ ...x })) };
        case "executorRoutines": return { rows: s.routines.map((routine) => ({ routine })) };
        case "executorRelations": return { rows: s.relations.map((x) => ({ ...x })) };
        case "executorSequences": return { rows: s.sequences.map((x) => ({ ...x })) };
        case "executorMaintain": return { rows: s.maintain.map((x) => ({ ...x })) };
        case "executorDatabase": return { rows: [{ ...s.database }] };
        case "executorOwnership": return { rows: [{ owned: String(s.owned) }] };
        case "objectExists": return { rows: [{ n: s.objects.has(params[0] + "." + params[1]) ? 1 : 0 }] };
        case "publicRelationGrants": return { rows: s.publicRelationGrants };
        case "publicSchemaGrants": return { rows: s.publicSchemaGrants };
        case "publicTrustedRoutines": return { rows: s.publicTrustedRoutines };
        case "defaultAclWidening": return { rows: s.defaultAcl };
        case "serverVersion": return { rows: [{ v: s.serverVersionNum }] };
        case "aclCatalogs": return { rows: s.aclCatalogs.map((col) => ({ col })) };
        case "executorShdepend": return { rows: s.shdepend.map((x) => ({ ...x })) };
        case "executorDatabaseGrants": return { rows: s.databaseGrants.map((x) => ({ ...x })) };
        case "executorExtendedEffective": return { rows: s.extendedEffective.map((f) => ({ f })) };
        case "publicExtended": return { rows: s.publicExtended.map((f) => ({ f })) };
        case "executorOwnershipAll": return { rows: s.ownershipAll.map((x) => ({ ...x })) };
        default: throw new Error("synthetic: unhandled");
      }
    },
    isDead() { return dead; },
    async close() { dead = true; },
    async destroy() { dead = true; },
  });
}
export const syntheticFactory = (state, log) => Object.freeze({ kind: "synthetic", async open() { return syntheticPhysical(state, log); } });
