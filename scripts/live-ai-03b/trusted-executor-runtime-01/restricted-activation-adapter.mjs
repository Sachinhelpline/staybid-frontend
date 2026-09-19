// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — P1-02 TRUSTED EXECUTOR RUNTIME (Implementation B) — restricted,
// typed activation adapter for the FROZEN accepted trusted function. OFFLINE
// wiring only — performs no live Railway connection. It exposes exactly the
// capability the frozen executor expects (restrictedDbActivate({claims,executionId}))
// and invokes ONLY the exact reviewed SECURITY DEFINER function under the future
// restricted executor DB identity. No arbitrary SQL, no table DML, no admin fallback.
//
// Exact frozen function signature (recovered from the accepted SQL artifact):
//   live_ai_03b_trusted.activate_catalog(claims_json jsonb, p_execution_id text) RETURNS jsonb
// (see scripts/live-ai-03b/trusted-activation-boundary-01/db/2026-09-19-p1-02-
//  trusted-activation-boundary.sql). Single-use, atomic and freshness are enforced
// INSIDE that function; this adapter must not and does not add authority.
// ─────────────────────────────────────────────────────────────────────────

import { VERIFIED_CLAIMS_CONTRACT, RECEIPT_CONTRACT } from "../trusted-activation-boundary-01/pricing-approval-contract.mjs";

// The ONE fixed, parameterized activation statement. There is no other statement and
// no caller-supplied SQL / function-name / table selection path.
export const ACTIVATE_SQL = "SELECT live_ai_03b_trusted.activate_catalog($1::jsonb, $2) AS receipt";

function fail(reason, extra) { return { ok: false, reason, ...(extra || {}) }; }

/**
 * Build the restricted activation capability.
 * @param {object} opts
 *  - dbClient: a restricted executor DB client exposing query(text, params) -> {rows}.
 *      In production it MUST be a real client bound to the restricted executor role and a
 *      verified AI-STAGING connection; a test fixture (client.__testFixture===true) is
 *      REJECTED unless mode==='test'.
 *  - targetBinding: the verified binding from verifyConnectionTargetBinding() (ok===true).
 *  - mode: 'production' | 'test'.
 * Returns { restrictedDbActivate } or throws on a misconfigured adapter.
 */
export function makeRestrictedActivationAdapter(opts) {
  const { dbClient, targetBinding, mode } = opts || {};
  if (mode !== "production" && mode !== "test") throw new Error("activation_adapter_mode_invalid");
  if (!targetBinding || targetBinding.ok !== true) throw new Error("activation_adapter_target_unverified");
  if (!dbClient || typeof dbClient.query !== "function") throw new Error("activation_adapter_db_client_absent");
  if (mode === "production" && dbClient.__testFixture === true) throw new Error("activation_adapter_refuses_test_fixture_in_production");

  async function restrictedDbActivate({ claims, executionId }) {
    // only the verifier-emitted VerifiedApprovalClaimsV1 is accepted (never a raw envelope).
    if (!claims || typeof claims !== "object" || claims.contract !== VERIFIED_CLAIMS_CONTRACT) return fail("activation_claims_not_verified");
    if (typeof executionId !== "string" || executionId.trim() === "" || claims.execution_id !== executionId) return fail("activation_execution_unbound");

    let res;
    try {
      res = await dbClient.query(ACTIVATE_SQL, [JSON.stringify(claims), executionId]);
    } catch (e) {
      // ambiguous mutation outcome — surface UNKNOWN, NEVER auto-retry.
      const reason = (e && typeof e.code === "string") ? `activation_db_error:${e.code}` : "activation_db_error";
      return fail(reason, { uncertain: true });
    }
    const receipt = res && res.rows && res.rows[0] ? res.rows[0].receipt : undefined;
    if (!receipt || typeof receipt !== "object") return fail("activation_no_receipt", { uncertain: true });
    if (receipt.contract !== RECEIPT_CONTRACT || receipt.action !== "activate") return fail("activation_receipt_shape_invalid");
    // pass the DB's receipt straight through; the executor attaches the deterministic commitment.
    return { ok: true, receipt, consumedRef: `consumed:${receipt.approval_id}` };
  }

  return { restrictedDbActivate };
}
