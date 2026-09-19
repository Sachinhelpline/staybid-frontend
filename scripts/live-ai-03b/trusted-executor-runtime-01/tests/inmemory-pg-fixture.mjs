// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — P1-02 TRUSTED EXECUTOR RUNTIME — DISPOSABLE IN-MEMORY PG FIXTURE.
// TEST-ONLY. Not shipped as a runtime module. Contains NO live Railway connection,
// NO production secret, NO CORE-PROD reachability, and only synthetic test data.
// It mimics — for offline deterministic tests ONLY — the accepted trusted function
// single-use + jsonb receipt behavior and answers the adapter's fixed read queries.
// It is NEVER evidence of live PostgreSQL privileges or a real committed transaction.
// ─────────────────────────────────────────────────────────────────────────

import { FIXED } from "../../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import { EXPECT } from "../../first-text-probe-activation-01/first-probe-preflight-postflight.mjs";
import {
  LEDGER_COMMITTED_QUERY, CATALOG_ACTIVE_COUNT_QUERY, CATALOG_ACTIVE_DIGEST_QUERY,
  CATALOG_INACTIVE_VERSION_QUERY, CATALOG_INACTIVE_ENTRY_COUNT_QUERY,
} from "../trusted-read-adapter.mjs";
import { ACTIVATE_SQL } from "../restricted-activation-adapter.mjs";

// reviewed-query marker strings the TEST passes as reviewedStateQueries; the fixture recognizes
// them and answers from synthetic state. (In production these are real, schema-confirmed SQL.)
export const REVIEWED_QUERIES = Object.freeze({
  dormantPolicyControl: "TEST_REVIEWED::dormantPolicyControl",
  armedPolicyControl: "TEST_REVIEWED::armedPolicyControl",
  ceilings: "TEST_REVIEWED::ceilings",
  zeroExposureCounts: "TEST_REVIEWED::zeroExposureCounts",
});

/**
 * @param {object} o - { consumedAtIso } canonical whole-second UTC used as the ledger consumed_at.
 * Returns { executorClient, readerClient, state }. Both clients share one synthetic DB state.
 */
export function makeInMemoryPg(o) {
  const consumedAtIso = (o && o.consumedAtIso) || "2026-09-21T00:00:00Z";
  const state = {
    catalogActive: false,                 // starts dormant (inactive predecessor)
    ledger: [],                           // approval_consumption rows
    activeDigest: null,
    duplicateInjected: null,              // for the duplicate-ledger negative test
  };

  function activate(claimsJson, executionId) {
    let claims;
    try { claims = JSON.parse(claimsJson); } catch { const e = new Error("invalid_json"); e.code = "22P02"; throw e; }
    // faithful subset of the frozen function guards
    if (claims.contract !== "VerifiedApprovalClaimsV1") { throw new Error("contract_mismatch"); }
    if (claims.active_catalog_digest !== FIXED.active_catalog_digest) throw new Error("active_digest_mismatch");
    if (claims.inactive_catalog_digest !== FIXED.inactive_catalog_digest) throw new Error("inactive_digest_mismatch");
    // single-use: unique(approval_id)
    if (state.ledger.some((r) => r.approval_id === claims.approval_id)) { const e = new Error("approval already consumed (replay rejected)"); e.code = "23505"; throw e; }
    // predecessor: must be inactive (not already active)
    if (state.catalogActive) throw new Error("catalog_already_active");
    const row = {
      approval_id: claims.approval_id, execution_id: executionId, content_digest: claims.content_digest,
      active_catalog_digest: claims.active_catalog_digest, action: "activate", consumed_at: consumedAtIso,
    };
    state.ledger.push(row);
    state.catalogActive = true;
    state.activeDigest = FIXED.active_catalog_digest;
    return {
      contract: "CatalogActivationReceiptV1", approval_id: row.approval_id, execution_id: row.execution_id,
      content_digest: row.content_digest, active_catalog_digest: row.active_catalog_digest, action: "activate", consumed_at: row.consumed_at,
    };
  }

  function ledgerRows(approvalId, executionId) {
    const rows = state.ledger.filter((r) => r.approval_id === approvalId && r.execution_id === executionId && r.action === "activate")
      .map((r) => ({ ...r }));
    if (state.duplicateInjected && state.duplicateInjected.approval_id === approvalId) rows.push({ ...state.duplicateInjected });
    return rows;
  }

  async function query(sql, params) {
    params = params || [];
    if (sql === ACTIVATE_SQL) return { rows: [{ receipt: activate(params[0], params[1]) }] };
    if (sql === LEDGER_COMMITTED_QUERY) return { rows: ledgerRows(params[0], params[1]) };
    if (sql === CATALOG_ACTIVE_COUNT_QUERY) return { rows: [{ n: state.catalogActive ? 1 : 0 }] };
    if (sql === CATALOG_ACTIVE_DIGEST_QUERY) return { rows: state.catalogActive ? [{ catalog_digest: state.activeDigest }] : [] };
    if (sql === CATALOG_INACTIVE_VERSION_QUERY) return { rows: [{ n: state.catalogActive ? 0 : 1, digest: state.catalogActive ? null : FIXED.inactive_catalog_digest }] };
    if (sql === CATALOG_INACTIVE_ENTRY_COUNT_QUERY) return { rows: [{ n: state.catalogActive ? 0 : 2 }] };
    if (sql === REVIEWED_QUERIES.dormantPolicyControl) return { rows: [{ active_policy_count: 0, dormant_policy_present: true, global_control_epoch: 1, project_control_epoch: 1, global_control_enabled: false, project_control_enabled: false, global_control_killed: false, project_control_killed: false }] };
    if (sql === REVIEWED_QUERIES.armedPolicyControl) return { rows: [{ one_call_policy_digest: EXPECT.one_call_policy_digest, control_global_digest: EXPECT.control_global_activation_digest, control_project_digest: EXPECT.control_project_activation_digest, global_control_epoch: 2, project_control_epoch: 2, global_control_enabled: true, project_control_enabled: true, global_control_killed: false, project_control_killed: false }] };
    if (sql === REVIEWED_QUERIES.ceilings) return { rows: [{ session_money_ceiling_micros: 89536, session_provider_calls: 1, session_execution_admissions: 1, subject_day_money_ceiling_micros: 89536, project_day_money_ceiling_micros: 89536, project_month_money_ceiling_micros: 89536, global_day_money_ceiling_micros: 89536 }] };
    if (sql === REVIEWED_QUERIES.zeroExposureCounts) return { rows: [{ envelopes: 0, provider_reservations: 0, provider_settlements: 0, execution_consumptions: 0, decisions: 0, reconciliations: 0, scope_counters: 0, sessions: 0 }] };
    const e = new Error("unrecognized_sql"); e.code = "42601"; throw e; // no arbitrary SQL
  }

  const executorClient = { __testFixture: true, query };
  const readerClient = { __testFixture: true, query };
  return { executorClient, readerClient, state };
}
