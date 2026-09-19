// TEST-ONLY disposable in-memory fixture for the LIVE-AI-03B verified-schema read queries.
// Answers the ACTUAL four reviewed SQL strings + the frozen catalog/ledger/activate SQL with
// synthetic rows shaped exactly as the real AI-STAGING schema would return. NO live DB, NO
// Railway, NO secret, NO CORE reachability. Never evidence of live PostgreSQL behavior.
import { FIXED } from "../../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import { EXPECT } from "../../first-text-probe-activation-01/first-probe-preflight-postflight.mjs";
import {
  LEDGER_COMMITTED_QUERY, CATALOG_ACTIVE_COUNT_QUERY, CATALOG_ACTIVE_DIGEST_QUERY,
  CATALOG_INACTIVE_VERSION_QUERY, CATALOG_INACTIVE_ENTRY_COUNT_QUERY,
} from "../../trusted-executor-runtime-01/trusted-read-adapter.mjs";
import { ACTIVATE_SQL } from "../../trusted-executor-runtime-01/restricted-activation-adapter.mjs";
import {
  DORMANT_POLICY_CONTROL_QUERY, ARMED_POLICY_CONTROL_QUERY, CEILINGS_QUERY, ZERO_EXPOSURE_COUNTS_QUERY,
} from "../production-read-queries.mjs";

export const DORMANT_ROW = () => ({ active_policy_count: 0, dormant_policy_present: true, global_control_epoch: 1, project_control_epoch: 1, global_control_enabled: false, project_control_enabled: false, global_control_killed: false, project_control_killed: false });
// armedPolicyControl no longer emits active_policy_count (the frozen adapter discards it; global
// cardinality is enforced INSIDE one_call_policy_digest, which goes NULL when >1 policy is active).
export const ARMED_ROW = () => ({ one_call_policy_digest: EXPECT.one_call_policy_digest, control_global_digest: EXPECT.control_global_activation_digest, control_project_digest: EXPECT.control_project_activation_digest, global_control_epoch: 2, project_control_epoch: 2, global_control_enabled: true, project_control_enabled: true, global_control_killed: false, project_control_killed: false });
export const CEILINGS_ROW = () => ({ session_money_ceiling_micros: 89536, session_provider_calls: 1, session_execution_admissions: 1, subject_day_money_ceiling_micros: 89536, project_day_money_ceiling_micros: 89536, project_month_money_ceiling_micros: 89536, global_day_money_ceiling_micros: 89536 });
export const ZERO_ROW = () => ({ envelopes: 0, provider_reservations: 0, provider_settlements: 0, execution_consumptions: 0, decisions: 0, reconciliations: 0, scope_counters: 0, sessions: 0 });

/** @param o {consumedAtIso, overrides:{dormant?,armed?,ceilings?,zero?}, throwOn:Set<string>} */
export function makeFixture(o = {}) {
  const consumedAtIso = o.consumedAtIso || "2026-09-21T00:00:00Z";
  const ov = o.overrides || {};
  const throwOn = o.throwOn || new Set();
  const state = { catalogActive: false, ledger: [] };
  function activate(claimsJson, executionId) {
    const claims = JSON.parse(claimsJson);
    if (claims.contract !== "VerifiedApprovalClaimsV1") throw new Error("contract_mismatch");
    if (state.ledger.some((r) => r.approval_id === claims.approval_id)) { const e = new Error("replay"); e.code = "23505"; throw e; }
    if (state.catalogActive) throw new Error("catalog_already_active");
    const row = { approval_id: claims.approval_id, execution_id: executionId, content_digest: claims.content_digest, active_catalog_digest: claims.active_catalog_digest, action: "activate", consumed_at: consumedAtIso };
    state.ledger.push(row); state.catalogActive = true;
    return { contract: "CatalogActivationReceiptV1", approval_id: row.approval_id, execution_id: row.execution_id, content_digest: row.content_digest, active_catalog_digest: row.active_catalog_digest, action: "activate", consumed_at: row.consumed_at };
  }
  async function query(sql, params) {
    params = params || [];
    if (throwOn.has(sql)) { const e = new Error("more than one row returned by a subquery used as an expression"); e.code = "21000"; throw e; }
    if (sql === ACTIVATE_SQL) return { rows: [{ receipt: activate(params[0], params[1]) }] };
    if (sql === LEDGER_COMMITTED_QUERY) return { rows: state.ledger.filter((r) => r.approval_id === params[0] && r.execution_id === params[1] && r.action === "activate").map((r) => ({ ...r })) };
    if (sql === CATALOG_ACTIVE_COUNT_QUERY) return { rows: [{ n: state.catalogActive ? 1 : 0 }] };
    if (sql === CATALOG_ACTIVE_DIGEST_QUERY) return { rows: state.catalogActive ? [{ catalog_digest: FIXED.active_catalog_digest }] : [] };
    if (sql === CATALOG_INACTIVE_VERSION_QUERY) return { rows: [{ n: state.catalogActive ? 0 : 1, digest: state.catalogActive ? null : FIXED.inactive_catalog_digest }] };
    if (sql === CATALOG_INACTIVE_ENTRY_COUNT_QUERY) return { rows: [{ n: state.catalogActive ? 0 : 2 }] };
    // override builders may return null to simulate ZERO rows (e.g. a wrong-identity policy that the
    // corrected id/digest-bound query matches nothing for) — the frozen adapter then fails closed.
    if (sql === DORMANT_POLICY_CONTROL_QUERY) { const row = ov.dormant ? ov.dormant() : DORMANT_ROW(); return { rows: row == null ? [] : [row] }; }
    if (sql === ARMED_POLICY_CONTROL_QUERY) { const row = ov.armed ? ov.armed() : ARMED_ROW(); return { rows: row == null ? [] : [row] }; }
    if (sql === CEILINGS_QUERY) { const row = ov.ceilings ? ov.ceilings() : CEILINGS_ROW(); return { rows: row == null ? [] : [row] }; }
    if (sql === ZERO_EXPOSURE_COUNTS_QUERY) { const row = ov.zero ? ov.zero() : ZERO_ROW(); return { rows: row == null ? [] : [row] }; }
    const e = new Error("unrecognized_sql"); e.code = "42601"; throw e;
  }
  const client = { __testFixture: true, query };
  return { client, state };
}
