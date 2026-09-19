// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — P1-02 TRUSTED ACTIVATION BOUNDARY — one-shot trusted executor.
// OFFLINE, Node built-ins only. UNEXECUTED against real infrastructure.
//
// The private, bounded, one-shot activation executor. It is the ONLY principal permitted
// to cause catalog activation, and it does so ONLY after an independently-signed approval
// verifies. It holds NO provider API key, NO gateway signing private key, NO CORE-PROD
// credential; it targets AI-STAGING exclusively; it never infers privilege from a service
// name or its own env. It fails closed if any trust root, credential, target proof, or
// preflight is unavailable, emits only redacted bounded receipts, and NEVER retries after
// an ambiguous mutation attempt.
//
// It composes two independent halves of the P1-02 boundary:
//   (1) AUTHENTICATION — verifyApproval() against an independently-pinned reviewer key;
//   (2) EXECUTION/PRIVILEGE — it invokes ONLY the restricted DB activation function via a
//       restricted executor DB credential; it can NOT and does NOT run raw catalog UPDATEs.
// Offline, both the production trust root and the restricted DB credential are ABSENT, so
// this executor fail-closes — activation remains BLOCKED (the intended state).
//
// This module performs NO network / DB / provider call on its own; the DB access is an
// INJECTED restricted capability (deps.restrictedDbActivate) supplied only by a properly
// deployed, credential-isolated runtime. The CLI refuses (exit 2) with no injected context.
// ─────────────────────────────────────────────────────────────────────────

import { verifyApproval } from "./approval-verify.mjs";
import { FIXED, RECEIPT_CONTRACT, activationReceiptCommitment } from "./pricing-approval-contract.mjs";
// Finding 2 — a CONCRETE pre-activation verifier (not a caller {pass:true} callback).
import { runPreActivation } from "../first-text-probe-activation-01/first-probe-preflight-postflight.mjs";

// required future deployment/credential/permission proofs (see deployment spec + README).
export const REQUIRED_FUTURE_PROOFS = Object.freeze([
  "independently-pinned production reviewer public key + fingerprint (trust root) provisioned outside repo/Railway/gateway/probe/executor",
  "genuine independently-reviewed Standard/non-regional signed pricing approval for THIS execution",
  "restricted executor DB LOGIN credential that can EXECUTE only the trusted activation function (no BUDGET table DML, no superuser, no pg_write_all_data)",
  "applied trusted schema + NOLOGIN owner + restricted executor role + approval-consumption ledger + activate/restore functions (db migration)",
  "proof the probe/runtime principal cannot read the executor credential or impersonate a privileged role (postgres/pg_write_all_data isolation)",
  "runtime DB reference resolves to AI-STAGING Postgres b7362594-... (identity, not schema shape); CORE excluded",
  "Owner-controlled executor deployment/config authority + pinned executor release + trust-root fingerprint",
  "complete execution-time seven-ceiling preflight PASS + fresh catalog (now < 2026-09-25T18:37:35Z) or reviewed successor",
]);

function deny(stage, reason) { return { ok: false, activated: false, stage, reason }; }

/**
 * One-shot CATALOG activation. Fail-closed. This executor performs its OWN bounded work only —
 * PHASE A pre-activation verification + the reviewed catalog activation — and emits a bounded
 * CATALOG_ACTIVATION_COMPLETE receipt. It DELIBERATELY does NOT run the policy/control transitions,
 * the PHASE B post-activation/pre-probe verification, or emit a PROBE_READY receipt (those are
 * separate downstream steps under their own authorized boundaries).
 *
 * deps (all INJECTED by a credential-isolated runtime; TEST-only under an explicit test boundary):
 *  - trustRoot: { pinnedPublicKeyDerB64, pinnedFingerprint }  (production trust root; absent offline)
 *  - approvalEnvelope, suppliedEvidence, nowIso, executionId
 *  - isConsumed(approvalId, executionId) -> boolean
 *  - readState: { provenance, observe(phase) -> typed observations }  — an APPROVED read-only
 *       capability. NO caller {pass:true} verdict is ever accepted; a concrete verifier
 *       (runPreActivation) decides over the observations. provenance must be trusted; offline the
 *       real provenance is absent, so the real executor fails closed unless testBoundary===true
 *       with a TEST-ONLY capability.
 *  - testBoundary?: boolean  — true ONLY for offline TEST fixtures (explicitly identified).
 *  - restrictedDbActivate({ claims, executionId }) -> { ok, consumedRef, reason }
 *       the ONLY DB path: a restricted capability that calls the SECURITY DEFINER trusted
 *       activate_catalog(claims_json, execution_id) under the restricted executor role, passing the
 *       VERIFIED claims (Finding 1). NOT a raw catalog UPDATE, NOT the raw envelope.
 *  - targetBinding: { resolvedPostgresServiceId, resolvedProjectId }  (must be AI-STAGING; not CORE)
 */
let ALREADY_RAN = false;

const TRUSTED_READSTATE_PROVENANCE = "trusted-approved-readonly-capability"; // real (absent offline)
const TEST_READSTATE_PROVENANCE = "TEST-ONLY-readonly-capability";

export async function runActivation(deps) {
  if (!deps || typeof deps !== "object") return deny("input", "deps_absent");
  if (ALREADY_RAN) return deny("guard", "executor_is_one_shot_already_ran");

  // never hold or accept provider/gateway/CORE secrets.
  if (deps.providerApiKey !== undefined || deps.gatewaySigningPrivateKey !== undefined || deps.coreCredential !== undefined) {
    return deny("secret_hygiene", "executor_must_not_receive_provider_gateway_core_secrets");
  }

  // target must be AI-STAGING, never CORE.
  const tb = deps.targetBinding;
  if (!tb || tb.resolvedPostgresServiceId !== FIXED.ai_staging_postgres) return deny("target", "db_binding_not_ai_staging");
  if (tb.resolvedPostgresServiceId === FIXED.core_excluded_postgres || tb.resolvedProjectId === FIXED.core_excluded_project) return deny("target", "core_prod_target_refused");

  // (1) AUTHENTICATION — independently-signed approval against the pinned trust root. The verified
  //     claims (VerifiedApprovalClaimsV1) are the ONLY thing handed onward (Finding 1).
  const v = verifyApproval({
    envelope: deps.approvalEnvelope, trustRoot: deps.trustRoot, suppliedEvidence: deps.suppliedEvidence,
    nowIso: deps.nowIso, executionId: deps.executionId, isConsumed: deps.isConsumed,
  });
  if (!v.ok || !v.claims) return deny("approval", v.reason || "approval_no_claims");

  // (2) APPROVED READ-ONLY OBSERVATION CAPABILITY — no caller {pass:true} verdict accepted.
  const rs = deps.readState;
  if (!rs || typeof rs.observe !== "function" || typeof rs.provenance !== "string") {
    return deny("readstate", "approved_readonly_capability_absent");
  }
  const provenanceOk = deps.testBoundary === true
    ? rs.provenance === TEST_READSTATE_PROVENANCE
    : rs.provenance === TRUSTED_READSTATE_PROVENANCE;
  if (!provenanceOk) return deny("readstate", "readonly_capability_provenance_untrusted"); // real trust root absent offline ⇒ fail closed

  // (3) PHASE A PRE-ACTIVATION — concrete verifier over authoritative DORMANT observations.
  let preObs;
  try { preObs = rs.observe("pre-activation"); } catch { return deny("readstate", "pre_activation_observe_failed"); }
  let phaseA;
  try {
    phaseA = runPreActivation({
      railway: preObs.railway, source: preObs.source, db: preObs.db, nowIso: deps.nowIso,
      approvalEnvelope: deps.approvalEnvelope, trustRoot: deps.trustRoot, suppliedEvidence: deps.suppliedEvidence,
      executionId: deps.executionId, isApprovalConsumed: deps.isConsumed,
      dormantState: preObs.dormantState, counts: preObs.counts,
      approvalConsumed: preObs.approvalConsumed, privilegeProof: preObs.privilegeProof,
    });
  } catch { return deny("pre_activation", "pre_activation_observations_incomplete"); }
  if (!phaseA || phaseA.pass !== true) {
    return deny("pre_activation", "pre_activation_failed:" + ((phaseA && phaseA.failures || []).map((f) => f.reason).join(",").slice(0, 160)));
  }

  // (4) EXECUTION/PRIVILEGE — the ONLY DB path is the restricted trusted-function capability,
  //     invoked with the VERIFIED claims (never the raw envelope, never caller-selected fields).
  if (typeof deps.restrictedDbActivate !== "function") {
    return deny("privilege", "restricted_executor_db_capability_absent"); // no restricted credential ⇒ BLOCKED
  }
  let res;
  try {
    res = await deps.restrictedDbActivate({ claims: v.claims, executionId: v.claims.execution_id });
  } catch {
    ALREADY_RAN = true; // ambiguous mutation attempt — NO automatic retry.
    return deny("db", "restricted_activation_ambiguous_no_retry");
  }
  ALREADY_RAN = true;
  if (!res || res.ok !== true) return deny("db", (res && res.reason) ? res.reason : "restricted_activation_refused");

  // Build the deterministic CatalogActivationReceiptV1 from the trusted DB return (the fields of
  // the ledger row it just consumed + the reviewed transition) and attach the deterministic
  // commitment. This receipt is surfaced for the SEPARATE downstream PHASE-B correlation; it is
  // NOT a commit proof — Phase B independently reads the COMMITTED ledger and correlates this to
  // it. A malformed/absent DB receipt is surfaced as null (Phase B then fails closed).
  const rr = res.receipt;
  let activationReceipt = null;
  if (rr && typeof rr === "object" && rr.contract === RECEIPT_CONTRACT && rr.action === "activate"
    && typeof rr.approval_id === "string" && typeof rr.execution_id === "string"
    && typeof rr.content_digest === "string" && typeof rr.active_catalog_digest === "string"
    && typeof rr.consumed_at === "string") {
    activationReceipt = {
      contract: RECEIPT_CONTRACT, action: "activate",
      approval_id: rr.approval_id, execution_id: rr.execution_id,
      content_digest: rr.content_digest, active_catalog_digest: rr.active_catalog_digest, consumed_at: rr.consumed_at,
      commitment: activationReceiptCommitment({
        approval_id: rr.approval_id, execution_id: rr.execution_id, content_digest: rr.content_digest,
        active_catalog_digest: rr.active_catalog_digest, consumed_at: rr.consumed_at,
      }),
    };
  }

  // bounded CATALOG_ACTIVATION_COMPLETE receipt ONLY — never a PROBE_READY receipt. The one-call
  // policy activation, control enablement, PHASE B pre-probe verification, and the PROBE_READY
  // decision are SEPARATE downstream steps under their own authorized boundaries.
  return {
    ok: true, activated: true, stage: "CATALOG_ACTIVATION_COMPLETE", probeReady: false,
    approvalId: v.claims.approval_id, executionId: v.claims.execution_id,
    consumedRef: typeof res.consumedRef === "string" ? res.consumedRef.slice(0, 96) : null,
    activationReceipt,
    note: "AI-STAGING catalog activated via restricted trusted function from VERIFIED claims; NOT probe-ready — policy/control transitions + PHASE B pre-probe are separate downstream steps; redacted receipt",
  };
}

function main() {
  process.stderr.write(
    "[live-ai-03b trusted-activation-executor] FAIL-CLOSED: performs NO db/network/provider access on its own.\n" +
    "It requires an INJECTED credential-isolated runtime (production trust root + restricted DB activation capability +\n" +
    "verified single-use signed approval + preflight). Offline neither the production trust root nor the restricted DB\n" +
    "credential exists, so activation is BLOCKED. Required future proofs:\n - " + REQUIRED_FUTURE_PROOFS.join("\n - ") + "\n" +
    "Invoked directly it activates nothing and exits non-zero (2). No secret is ever printed.\n",
  );
  process.exit(2);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
