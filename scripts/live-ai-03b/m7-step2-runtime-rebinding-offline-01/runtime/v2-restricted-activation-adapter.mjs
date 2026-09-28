// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP 2 — restricted, typed V2 activation / restoration adapter. OFFLINE wiring.
//
// Successor of trusted-executor-runtime-01/restricted-activation-adapter.mjs (V1, frozen: it calls
// live_ai_03b_trusted.activate_catalog — the M6 V1 function that now REFUSES by expiry). This adapter
// exposes exactly two fixed parameterised statements against the accepted Step-1 successor schema:
//   live_ai_03b_trusted_v2.activate_catalog_v2(claims_json jsonb, p_execution_id text) RETURNS jsonb
//   live_ai_03b_trusted_v2.restore_catalog_v2_inactive(claims_json jsonb, p_execution_id text) RETURNS jsonb
// No other SQL, no function-name / table selection path, no raw catalog DML, no admin fallback, no
// retry. Single-use, atomicity and DB-clock freshness are enforced INSIDE those SECURITY DEFINER
// functions; this adapter adds NO authority — it only refuses to forward anything that is not the
// exact VerifiedApprovalClaimsV2 shape bound to the execution id.
// ─────────────────────────────────────────────────────────────────────────

import { VERIFIED_CLAIMS_CONTRACT_V2, RECEIPT_CONTRACT_V2 } from "../../m7-step1-hb1-consolidated-remediation-01/approval/pricing-approval-contract-v2.mjs";
import { CATALOG_V2 } from "../identity/v2-identity.mjs";

export const ACTIVATE_SQL_V2 = "SELECT live_ai_03b_trusted_v2.activate_catalog_v2($1::jsonb, $2) AS receipt";
export const RESTORE_SQL_V2 = "SELECT live_ai_03b_trusted_v2.restore_catalog_v2_inactive($1::jsonb, $2) AS receipt";
export const RESTORATION_RECEIPT_CONTRACT_V2 = "CatalogRestorationReceiptV2";
// the exact 36-key VerifiedApprovalClaimsV2 set (mirrors the DB function's COLLATE "C" key check).
export const CLAIMS_V2_KEYS = Object.freeze(["account_mode", "activation_bundle_digest", "active_catalog_digest", "ai_staging_postgres", "ai_staging_project",
  "approval_expiry", "approval_id", "approval_not_before", "base_commit", "cache_write_rate_micros", "catalog_verification_expiry", "catalog_version_id",
  "content_digest", "context_tier", "contract", "core_excluded_postgres", "core_excluded_project", "currency", "evidence_expiry", "evidence_verified_at",
  "execution_id", "inactive_catalog_digest", "input_rate_micros", "model", "one_call_money_ceiling_micros", "one_call_policy_digest", "one_call_policy_id",
  "output_rate_micros", "processing_mode", "provider", "receipt_id", "regional_uplift", "reviewer_fingerprint", "service_tier", "source_digest", "unit_size"]);

function fail(reason, extra) { return { ok: false, reason, ...(extra || {}) }; }
const byteOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function claimsShapeOk(claims, executionId) {
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) return "activation_claims_not_verified";
  if (claims.contract !== VERIFIED_CLAIMS_CONTRACT_V2) return "activation_claims_not_verified_v2";
  if (Object.keys(claims).sort(byteOrder).join(",") !== CLAIMS_V2_KEYS.join(",")) return "activation_claims_key_set_not_exact";
  if (claims.catalog_version_id !== CATALOG_V2.id) return "activation_claims_not_v2_catalog";
  if (typeof executionId !== "string" || executionId.trim() === "" || claims.execution_id !== executionId) return "activation_execution_unbound";
  return null;
}

/**
 * @param opts.dbClient restricted executor client (query(text, params) -> {rows}); production refuses a __testFixture.
 * @param opts.targetBinding verified AI-STAGING binding (ok===true).
 * @param opts.mode 'production' | 'test'.
 * @returns { restrictedDbActivate, restrictedDbRestore }
 */
export function makeRestrictedActivationAdapterV2(opts) {
  const { dbClient, targetBinding, mode } = opts || {};
  if (mode !== "production" && mode !== "test") throw new Error("activation_adapter_v2_mode_invalid");
  if (!targetBinding || targetBinding.ok !== true) throw new Error("activation_adapter_v2_target_unverified");
  if (!dbClient || typeof dbClient.query !== "function") throw new Error("activation_adapter_v2_db_client_absent");
  if (mode === "production" && dbClient.__testFixture === true) throw new Error("activation_adapter_v2_refuses_test_fixture_in_production");

  async function call(sql, claims, executionId) {
    let res;
    try { res = await dbClient.query(sql, [JSON.stringify(claims), executionId]); }
    catch (e) {
      // ambiguous mutation outcome — surface UNKNOWN, NEVER auto-retry. Only a SQLSTATE code leaves.
      const code = e && typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code) ? e.code : null;
      return fail(code ? `db_error:${code}` : "db_error", { uncertain: true });
    }
    const receipt = res && Array.isArray(res.rows) && res.rows[0] ? res.rows[0].receipt : undefined;
    if (!receipt || typeof receipt !== "object") return fail("no_receipt", { uncertain: true });
    return { ok: true, receipt };
  }

  async function restrictedDbActivate({ claims, executionId } = {}) {
    const bad = claimsShapeOk(claims, executionId); if (bad) return fail(bad);
    const r = await call(ACTIVATE_SQL_V2, claims, executionId);
    if (!r.ok) return fail("activation_" + r.reason, r.uncertain ? { uncertain: true } : undefined);
    const rc = r.receipt;
    if (rc.contract !== RECEIPT_CONTRACT_V2 || rc.action !== "activate" || rc.catalog_version_id !== CATALOG_V2.id) return fail("activation_receipt_shape_invalid");
    return { ok: true, receipt: rc, consumedRef: `consumed:${rc.approval_id}` };
  }

  async function restrictedDbRestore({ claims, executionId } = {}) {
    const bad = claimsShapeOk(claims, executionId); if (bad) return fail(bad);
    const r = await call(RESTORE_SQL_V2, claims, executionId);
    if (!r.ok) return fail("restoration_" + r.reason, r.uncertain ? { uncertain: true } : undefined);
    const rc = r.receipt;
    if (rc.contract !== RESTORATION_RECEIPT_CONTRACT_V2 || rc.catalog_version_id !== CATALOG_V2.id || (rc.status !== "restored" && rc.status !== "already_restored")) return fail("restoration_receipt_shape_invalid");
    return { ok: true, receipt: rc };
  }

  return Object.freeze({ restrictedDbActivate, restrictedDbRestore });
}
