// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP 2 — one-shot trusted V2 CATALOG ACTIVATION executor. OFFLINE.
// Node built-ins only. UNEXECUTED against real infrastructure.
//
// Successor of trusted-activation-boundary-01/trusted-activation-executor.mjs (V1, frozen: V1
// verifyApproval + V1 runPreActivation + the M6 V1 activate_catalog). Same two-half boundary:
//   (1) AUTHENTICATION — verifyApprovalV2 against the independently pinned reviewer trust root; only the
//       resulting VerifiedApprovalClaimsV2 (never the envelope) is handed onward;
//   (2) EXECUTION/PRIVILEGE — ONLY the injected restricted V2 capability (activate_catalog_v2).
// It holds NO provider key, NO gateway signing key, NO CORE credential; targets AI-STAGING only; runs the
// concrete PHASE-A verifier (runPreActivationV2) over V2 observations from an approved V2 read capability
// (a V1 read capability is refused by provenance); NEVER retries after an ambiguous mutation; emits a
// bounded CATALOG_ACTIVATION_COMPLETE receipt and NEVER PROBE_READY.
// Lifecycle correction: Phase A consumes the ActivationSourceProofV2 (PIN A + REVIEWED STATIC PIN B + PRESERVED
// PIN C). It does NOT require a deployed gateway — the PIN-B gateway cannot start before this activation.
// ─────────────────────────────────────────────────────────────────────────

import { verifyApprovalV2 } from "../../m7-step1-hb1-consolidated-remediation-01/approval/approval-verify-v2.mjs";
import { RECEIPT_CONTRACT_V2, activationReceiptCommitmentV2 } from "../../m7-step1-hb1-consolidated-remediation-01/approval/pricing-approval-contract-v2.mjs";
import { TARGETS_V2, CATALOG_V2 } from "../identity/v2-identity.mjs";
import { runPreActivationV2 } from "./v2-preflight.mjs";
import { TRUSTED_READSTATE_PROVENANCE_V2, TEST_READSTATE_PROVENANCE_V2 } from "./v2-trusted-read-adapter.mjs";

function deny(stage, reason, extra) { return { ok: false, activated: false, probeReady: false, stage, reason, ...(extra || {}) }; }

let ALREADY_RAN = false; // process-lifetime one-shot (a second activation attempt is refused before any I/O)

/**
 * deps (INJECTED by the credential-isolated V2 runtime; TEST-only under an explicit test boundary):
 *   trustRoot, approvalEnvelope, suppliedEvidence, nowIso, executionId, isConsumed(approvalId, executionId),
 *   readState { provenance (V2), observe() -> { railway, activationSourceProof, db, preActivationState, counts, approvalConsumed, privilegeProof } },
 *   restrictedDbActivate({ claims, executionId }), targetBinding { resolvedPostgresServiceId, resolvedProjectId }, testBoundary?
 */
export async function runActivationV2(deps) {
  if (!deps || typeof deps !== "object") return deny("input", "deps_absent");
  if (ALREADY_RAN) return deny("guard", "executor_is_one_shot_already_ran");
  if (deps.providerApiKey !== undefined || deps.gatewaySigningPrivateKey !== undefined || deps.coreCredential !== undefined || deps.reviewerPrivateKey !== undefined) {
    return deny("secret_hygiene", "executor_must_not_receive_provider_gateway_core_or_reviewer_secrets");
  }
  const tb = deps.targetBinding;
  if (!tb || tb.resolvedPostgresServiceId !== TARGETS_V2.postgres) return deny("target", "db_binding_not_ai_staging");
  if (tb.resolvedPostgresServiceId === TARGETS_V2.core_excluded_postgres || tb.resolvedProjectId === TARGETS_V2.core_excluded_project) return deny("target", "core_prod_target_refused");

  const v = verifyApprovalV2({ envelope: deps.approvalEnvelope, trustRoot: deps.trustRoot, suppliedEvidence: deps.suppliedEvidence,
    nowIso: deps.nowIso, executionId: deps.executionId, isConsumed: deps.isConsumed });
  if (!v.ok || !v.claims) return deny("approval", v.reason || "approval_no_claims");

  const rs = deps.readState;
  if (!rs || typeof rs.observe !== "function" || typeof rs.provenance !== "string") return deny("readstate", "approved_readonly_capability_absent");
  const provOk = deps.testBoundary === true ? rs.provenance === TEST_READSTATE_PROVENANCE_V2 : rs.provenance === TRUSTED_READSTATE_PROVENANCE_V2;
  if (!provOk) return deny("readstate", "readonly_capability_provenance_untrusted_or_not_v2");

  let o;
  try { o = await rs.observe(); } catch { return deny("readstate", "pre_activation_observe_failed"); }
  let phaseA;
  try {
    phaseA = runPreActivationV2({
      railway: o.railway, activationSourceProof: o.activationSourceProof, db: o.db, nowIso: deps.nowIso, testBoundary: deps.testBoundary === true,
      approvalEnvelope: deps.approvalEnvelope, trustRoot: deps.trustRoot, suppliedEvidence: deps.suppliedEvidence,
      executionId: deps.executionId, isApprovalConsumed: deps.isConsumed,
      preActivationState: o.preActivationState, counts: o.counts, approvalConsumed: o.approvalConsumed, privilegeProof: o.privilegeProof,
    });
  } catch { return deny("pre_activation", "pre_activation_observations_incomplete"); }
  if (!phaseA || phaseA.pass !== true) return deny("pre_activation", "pre_activation_failed:" + (phaseA.failures || []).map((f) => f.reason).join(",").slice(0, 200));

  if (typeof deps.restrictedDbActivate !== "function") return deny("privilege", "restricted_executor_db_capability_absent");
  let res;
  ALREADY_RAN = true; // claim the one-shot BEFORE the mutation attempt: a throw can never lead to a retry.
  try { res = await deps.restrictedDbActivate({ claims: v.claims, executionId: v.claims.execution_id }); }
  catch { return deny("db", "restricted_activation_ambiguous_no_retry", { uncertain: true }); }
  if (!res || res.ok !== true) return deny("db", (res && res.reason) || "restricted_activation_refused", res && res.uncertain ? { uncertain: true } : undefined);

  const rr = res.receipt;
  let activationReceipt = null;
  if (rr && typeof rr === "object" && rr.contract === RECEIPT_CONTRACT_V2 && rr.action === "activate" && rr.catalog_version_id === CATALOG_V2.id
    && typeof rr.approval_id === "string" && typeof rr.execution_id === "string" && typeof rr.content_digest === "string"
    && typeof rr.active_catalog_digest === "string" && typeof rr.consumed_at === "string") {
    const fields = { approval_id: rr.approval_id, execution_id: rr.execution_id, content_digest: rr.content_digest,
      active_catalog_digest: rr.active_catalog_digest, consumed_at: rr.consumed_at };
    activationReceipt = Object.freeze({ contract: RECEIPT_CONTRACT_V2, action: "activate", catalog_version_id: CATALOG_V2.id, ...fields,
      commitment: activationReceiptCommitmentV2(fields) });
  }
  return {
    ok: true, activated: true, stage: "CATALOG_ACTIVATION_COMPLETE", probeReady: false,
    approvalId: v.claims.approval_id, executionId: v.claims.execution_id,
    consumedRef: typeof res.consumedRef === "string" ? res.consumedRef.slice(0, 96) : null,
    activationReceipt,
    note: "AI-STAGING V2 catalog activated via the restricted trusted_v2 function from VERIFIED claims; NOT probe-ready — ledger correlation, policy/control arm, PHASE B and the single probe are separate steps",
  };
}

function main() {
  process.stderr.write("[live-ai-03b V2 trusted-activation-executor] FAIL-CLOSED: performs NO db/network/provider access on its own; requires an INJECTED credential-isolated V2 runtime. Exit 2.\n");
  process.exit(2);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
