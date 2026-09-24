// SYNTHETIC PostgreSQL SESSION FIXTURE — TEST ONLY. Models the parts of a real PostgreSQL session the
// integration relies on: set_config/current_setting for statement_timeout + default_transaction_read_only,
// the session's own identity (pg_stat_activity), statement_timeout ENDING a long statement, connection
// loss, and fixed rows for the reviewed observation registry. NO network, NO real database.
// It is NOT evidence about hosted PostgreSQL behaviour.
import { FIXED } from "../../../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import { DORMANT_POLICY_CONTROL_QUERY, ARMED_POLICY_CONTROL_QUERY, CEILINGS_QUERY, ZERO_EXPOSURE_COUNTS_QUERY } from "../../../trusted-runtime-live-binding-offline-01/production-read-queries.mjs";
import { CATALOG_ACTIVE_COUNT_QUERY, CATALOG_ACTIVE_DIGEST_QUERY, CATALOG_INACTIVE_VERSION_QUERY, CATALOG_INACTIVE_ENTRY_COUNT_QUERY } from "../../../trusted-executor-runtime-01/trusted-read-adapter.mjs";
import { LIFECYCLE_SQL, parsePgDurationMs, newApplicationName } from "../../reader-session.mjs";
import { AI_STAGING_TARGET } from "./reference-attester.mjs";

const rowFor = (q) => (
  q === CATALOG_ACTIVE_COUNT_QUERY ? { n: 1 } :
  q === CATALOG_INACTIVE_VERSION_QUERY ? { n: 1, digest: "inactive-digest" } :
  q === CATALOG_INACTIVE_ENTRY_COUNT_QUERY ? { n: 2 } :
  q === CATALOG_ACTIVE_DIGEST_QUERY ? { catalog_digest: "active-digest" } :
  q === DORMANT_POLICY_CONTROL_QUERY ? { active_policy_count: 0, dormant_policy_present: true, global_control_epoch: 1, project_control_epoch: 1, global_control_enabled: false, project_control_enabled: false, global_control_killed: false, project_control_killed: false } :
  q === ARMED_POLICY_CONTROL_QUERY ? { one_call_policy_digest: FIXED.one_call_policy_digest, control_global_digest: "g", control_project_digest: "p", global_control_epoch: 2, project_control_epoch: 2, global_control_enabled: true, project_control_enabled: true, global_control_killed: false, project_control_killed: false } :
  q === CEILINGS_QUERY ? { session_money_ceiling_micros: 89536, session_provider_calls: 1, session_execution_admissions: 1, subject_day_money_ceiling_micros: 89536, project_day_money_ceiling_micros: 89536, project_month_money_ceiling_micros: 89536, global_day_money_ceiling_micros: 89536 } :
  q === ZERO_EXPOSURE_COUNTS_QUERY ? { envelopes: 0, provider_reservations: 0, provider_settlements: 0, execution_consumptions: 0, decisions: 0, reconciliations: 0, scope_counters: 0, sessions: 0 } : null);
const fmtDur = (ms) => (ms === 0 ? "0" : ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`);

/**
 * @param timeoutBehaviour 'honor' | 'ignore' (SET silently has no effect) | 'unsupported' (SET errors) |
 *   'cap5s' (server forces 5s) | 'fixed1000' (server applies a different value) | 'garbled' (unparseable readback)
 */
export function makeSyntheticPg({ timeoutBehaviour = "honor", role = "live_ai_03b_reader" } = {}) {
  let pidSeq = 41000;
  const sessions = [];
  const db = {
    target: { ...AI_STAGING_TARGET },
    currentUser: role,
    privileges: { effectiveSelectOnly: true, writePrivilegeCount: 0, selectGrantCount: 12, forbiddenObjectAccessible: false, unapprovedRoleMembership: false, unapprovedRoutineAuthority: false, ownerOrExecutorAuthority: false },
    timeoutBehaviour, stall: null, delayMs: 0, obsQueries: 0, lifecycleQueries: 0, opens: 0, failOpen: false,
    observeSessions() { return sessions.filter((s) => !s.dead).map((s) => ({ pid: s.pid, backendStart: s.backendStart, applicationName: s.applicationName, usename: db.currentUser })); },
    observePrivileges() { return { currentUser: db.currentUser, ...db.privileges }; },
    killAll() { for (const s of sessions) s.kill(); },
    liveSessions() { return sessions.filter((s) => !s.dead).length; },
    factory: {
      async open(opts = {}) {
        if (db.failOpen) throw new Error("connect refused");
        db.opens++;
        const s = { pid: ++pidSeq, backendStart: new Date(Date.UTC(2026, 8, 24, 10, 0, db.opens)).toISOString().replace(/\.\d{3}Z$/, ".000000Z"), applicationName: typeof opts.applicationName === "string" ? opts.applicationName : newApplicationName(), dead: false, st: 0, ro: "off", cbs: [] };
        s.kill = () => { if (s.dead) return; s.dead = true; for (const cb of s.cbs) { try { cb(); } catch {} } };
        sessions.push(s);
        return {
          applicationName: s.applicationName,
          isDead: () => s.dead,
          onDead: (cb) => { if (s.dead) cb(); else s.cbs.push(cb); },
          async close() { s.kill(); },
          async query(sql, params) {
            if (s.dead) throw new Error("connection terminated");
            if (sql === LIFECYCLE_SQL.setStatementTimeout) {
              db.lifecycleQueries++;
              if (db.timeoutBehaviour === "unsupported") throw new Error("unrecognized configuration parameter");
              if (db.timeoutBehaviour === "honor") s.st = parsePgDurationMs(params[0]);
              if (db.timeoutBehaviour === "cap5s") s.st = 5000;
              if (db.timeoutBehaviour === "fixed1000") s.st = 1000;
              return { rows: [{ v: fmtDur(s.st) }] };
            }
            if (sql === LIFECYCLE_SQL.readStatementTimeout) { db.lifecycleQueries++; return { rows: [{ v: db.timeoutBehaviour === "garbled" ? "two seconds" : fmtDur(s.st) }] }; }
            if (sql === LIFECYCLE_SQL.setReadOnly) { db.lifecycleQueries++; s.ro = "on"; return { rows: [{ v: "on" }] }; }
            if (sql === LIFECYCLE_SQL.readReadOnly) { db.lifecycleQueries++; return { rows: [{ v: s.ro }] }; }
            if (sql === LIFECYCLE_SQL.readIdentity) {
              db.lifecycleQueries++;
              return { rows: [{ current_user: db.currentUser, session_user: db.currentUser, pid: s.pid, backend_start: s.backendStart, application_name: s.applicationName }] };
            }
            const row = rowFor(sql);
            if (!row) throw new Error("relation does not exist");
            db.obsQueries++;
            if (db.stall === "statement_timeout") {
              // the DB-side statement_timeout ENDS the statement after the effective session value
              await new Promise((r) => setTimeout(r, s.st));
              throw new Error("canceling statement due to statement timeout");
            }
            if (db.stall === "hang") await new Promise(() => {});
            if (db.delayMs > 0) await new Promise((r) => setTimeout(r, db.delayMs));
            if (s.dead) throw new Error("connection terminated");
            return { rows: [row] };
          },
        };
      },
    },
  };
  return db;
}
