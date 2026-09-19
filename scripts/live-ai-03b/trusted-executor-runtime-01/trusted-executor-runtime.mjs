// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — P1-02 TRUSTED EXECUTOR RUNTIME (REMEDIATION) — production-shaped,
// one-shot trusted executor harness. OFFLINE — no live connection/provider/deploy/git.
//
// WORK finding corrected (production dependency/observation boundary): the previous
// production entrypoint accepted its security-authoritative dependencies (DB clients,
// trust root, connection proof, privilege proof, reviewed SQL, source pin) DIRECTLY
// FROM THE ACTIVATION CALLER, so a caller could fabricate them all and drive a false
// ok/activated result. Now the UNTRUSTED activation REQUEST is strictly separated from
// the INDEPENDENTLY-CONTROLLED PRODUCTION AUTHORITY:
//   • runTrustedExecutorProduction(request) accepts ONLY { approvalEnvelope,
//     suppliedEvidence, executionId } — any other key is rejected. All trusted
//     dependencies are acquired from acquireProductionAuthority() (independent of the
//     caller) + the digest-bound production query registry. Offline both are
//     unprovisioned/incomplete, so production FAILS CLOSED. No caller object, string,
//     boolean or unmarked client can become production authority.
//   • runTrustedExecutorTest(ctx) keeps dependency injection for the OFFLINE suite ONLY,
//     under an explicit test boundary (synthetic keys + disposable fixtures).
// There is NO production flag/env var that disables any verification, and NO
// production→test fallback and NO test→production authority promotion.
//
// It reuses the FROZEN one-shot executor (runActivation) + FROZEN Phase-B verifier
// (verifyConsumedApproval) + FROZEN armed/ceiling checks; it never emits PROBE_READY.
// ─────────────────────────────────────────────────────────────────────────

import { runActivation } from "../trusted-activation-boundary-01/trusted-activation-executor.mjs";
import { verifyConsumedApproval } from "../trusted-activation-boundary-01/approval-verify.mjs";
import { publicKeyFingerprintFromDerB64 } from "../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import { checks } from "../first-text-probe-activation-01/first-probe-preflight-postflight.mjs";
import { loadRuntimeConfig } from "./runtime-config.mjs";
import { verifyConnectionTargetBinding } from "./db-target-binding.mjs";
import { makeTrustedReadAdapter } from "./trusted-read-adapter.mjs";
import { makeRestrictedActivationAdapter } from "./restricted-activation-adapter.mjs";
import { acquireProductionAuthority } from "./production-authority.mjs";
import { getProductionQueryRegistry } from "./production-query-registry.mjs";

const STORE_BINDING_REF = "live-ai-03b-staging::railway-postgres::b7362594-a01b-4623-a982-394707a6cec2";
// The activation REQUEST caller may supply ONLY these keys — never any authority/dependency.
const ALLOWED_REQUEST_KEYS = new Set(["approvalEnvelope", "suppliedEvidence", "executionId"]);
function hold(stage, reason, extra) { return { ok: false, activated: false, stage, reason, probeReady: false, ...(extra || {}) }; }

/**
 * Shared core over a FULLY RESOLVED dependency bundle `d`. The bundle is assembled by the
 * production authority (production) or the test ctx (test) — never read piecemeal from an
 * activation caller here. Fail-closed at every missing capability; never auto-retries an
 * ambiguous activation; never emits PROBE_READY.
 */
async function runInternal(mode, d) {
  if (mode !== "production" && mode !== "test") return hold("mode", "invalid_mode");
  const cfg = d.cfg;
  if (!cfg || cfg.ok !== true) return hold("config", (cfg && cfg.reason) || "config_absent", { missing: cfg && cfg.missing });

  const trustRoot = d.trustRoot;
  if (!trustRoot || typeof trustRoot.pinnedPublicKeyDerB64 !== "string") return hold("trust_root", "trust_root_absent");
  // trust root must be pinned to the config fingerprint (independent of the operator envelope).
  let fp; try { fp = publicKeyFingerprintFromDerB64(trustRoot.pinnedPublicKeyDerB64); } catch { return hold("trust_root", "trust_root_key_invalid"); }
  if (fp !== trustRoot.pinnedFingerprint || fp !== cfg.reviewer.pinnedFingerprint) return hold("trust_root", "trust_root_not_config_pinned");

  // connection → AI-STAGING service target binding (independent issuer + client-token bound).
  const targetBinding = verifyConnectionTargetBinding({
    expectedServiceId: cfg.targets.pgServiceId, expectedIssuer: d.expectedIssuer, connectionToken: d.connectionToken,
    connectionIdentityProof: d.connectionIdentityProof, testBoundary: mode === "test",
  });
  if (!targetBinding.ok) return hold("target_binding", targetBinding.reason);

  let reader, activator;
  try {
    reader = makeTrustedReadAdapter({ dbClient: d.readerDbClient, targetBinding, reviewedStateQueries: d.reviewedStateQueries, mode });
    activator = makeRestrictedActivationAdapter({ dbClient: d.executorDbClient, targetBinding, mode });
  } catch (e) { return hold("adapter", String(e && e.message || "adapter_init_failed")); }

  const sourcePin = d.sourcePin, privilegeProof = d.privilegeProof;
  if (!sourcePin || typeof sourcePin !== "object") return hold("source_pin", "source_pin_absent");
  if (!privilegeProof || privilegeProof.restricted_role_proof_present !== true) return hold("privilege_proof", "privilege_proof_absent");
  if (typeof d.nowProvider !== "function") return hold("clock", "now_provider_absent");
  const nowIso = d.nowProvider();

  const dormant = await reader.observeDormant();
  if (!dormant.ok) return hold("dormant_observation", dormant.reason);

  // pre-fetch the unused/consumed state for the frozen verifier's SYNCHRONOUS isConsumed.
  const claimedApprovalId = d.approvalEnvelope && d.approvalEnvelope.payload && d.approvalEnvelope.payload.approval_id;
  const prefetchedConsumed = new Set();
  let consumedBefore = false;
  if (typeof claimedApprovalId === "string" && typeof d.executionId === "string") {
    try { consumedBefore = (await reader.isApprovalConsumed(claimedApprovalId, d.executionId)) === true; }
    catch { return hold("ledger_precheck", "ledger_precheck_error"); }
    if (consumedBefore) prefetchedConsumed.add(`${claimedApprovalId}::${d.executionId}`);
  }
  const isConsumed = (approvalId, executionId) => prefetchedConsumed.has(`${approvalId}::${executionId}`);

  const railway = {
    railway_project_id: cfg.targets.projectId, railway_environment_id: cfg.targets.environmentId,
    gateway_service_id: cfg.targets.gatewayServiceId, postgres_service_id: cfg.targets.pgServiceId,
  };
  const db = { resolved_postgres_service_id: targetBinding.verifiedServiceId, store_binding_ref: STORE_BINDING_REF, resolved_project_id: targetBinding.verifiedProjectId };
  const readState = {
    provenance: reader.readStateProvenance,
    observe: () => ({ railway, source: sourcePin, db, dormantState: dormant.dormantState, counts: dormant.counts, approvalConsumed: consumedBefore, privilegeProof }),
  };

  const act = await runActivation({
    trustRoot, approvalEnvelope: d.approvalEnvelope, suppliedEvidence: d.suppliedEvidence,
    nowIso, executionId: d.executionId, isConsumed, readState, testBoundary: mode === "test",
    restrictedDbActivate: activator.restrictedDbActivate,
    targetBinding: { resolvedPostgresServiceId: targetBinding.verifiedServiceId, resolvedProjectId: targetBinding.verifiedProjectId },
  });
  if (!act.ok) return hold("activation", act.reason, { uncertain: act.reason && String(act.reason).includes("ambiguous") });
  if (!act.activationReceipt) return hold("activation_receipt", "activation_receipt_absent");

  const ledger = await reader.observeCommittedLedger({ approvalId: act.approvalId, executionId: act.executionId });
  if (!ledger.ok) return hold("committed_ledger", ledger.reason);

  const pb = verifyConsumedApproval({
    envelope: d.approvalEnvelope, trustRoot, suppliedEvidence: d.suppliedEvidence,
    nowIso: d.nowProvider(), executionId: d.executionId,
    ledgerObservation: ledger.observation, activationReceipt: act.activationReceipt, testBoundary: mode === "test",
  });
  if (!pb.ok) return hold("phase_b_consumed_approval", pb.reason);
  const armed = await reader.observeArmed();
  if (!armed.ok) return hold("armed_observation", armed.reason);
  const armedCheck = checks.predecessorArmedState(armed.armedState);
  if (!armedCheck.ok) return hold("phase_b_armed_state", armedCheck.reason);
  const ceil = await reader.observeCeilings();
  if (!ceil.ok) return hold("ceilings_observation", ceil.reason);
  const ceilCheck = checks.oneCallCeilingsExact(ceil.oneCallPolicy);
  if (!ceilCheck.ok) return hold("phase_b_ceilings", ceilCheck.reason);

  return {
    ok: true, activated: true, stage: "CATALOG_ACTIVATION_AND_PHASE_B_COMPLETE", probeReady: false,
    approvalId: act.approvalId, executionId: act.executionId, consumedAt: pb.consumedAt, dbIdentity: reader.dbIdentity,
    note: "AI-STAGING catalog activated via the restricted trusted function and correlated to the committed ledger + activation receipt; NOT probe-ready — gateway arm + full preflight + the single probe are separate authorized steps.",
  };
}

/**
 * PRODUCTION entrypoint. Accepts ONLY the untrusted activation request
 * ({ approvalEnvelope, suppliedEvidence, executionId }); every other key is rejected. All
 * trusted dependencies come from acquireProductionAuthority() + the digest-bound query registry,
 * NEVER from the caller. Offline both are unprovisioned/incomplete ⇒ fail closed.
 */
export async function runTrustedExecutorProduction(request) {
  const req = request && typeof request === "object" ? request : {};
  for (const k of Object.keys(req)) {
    if (!ALLOWED_REQUEST_KEYS.has(k)) return hold("production_boundary", "production_rejects_caller_supplied_authority:" + k);
  }
  const auth = await acquireProductionAuthority();
  if (!auth || auth.available !== true) return hold("production_authority", (auth && auth.reason) || "production_authority_unavailable");
  const registry = getProductionQueryRegistry();
  if (!registry || registry.complete !== true) return hold("query_registry", (registry && registry.reason) || "query_registry_incomplete");
  // assemble resolved deps from the AUTHORITY only (unreachable offline — auth is unprovisioned).
  const a = auth.authority || {};
  const d = {
    cfg: a.cfg, trustRoot: a.trustRoot, connectionIdentityProof: a.connectionIdentityProof,
    expectedIssuer: a.expectedIssuer, connectionToken: a.connectionToken,
    executorDbClient: a.executorDbClient, readerDbClient: a.readerDbClient,
    reviewedStateQueries: { __registryDigest: registry.digest, ...(a.reviewedStateQueries || {}) },
    sourcePin: a.sourcePin, privilegeProof: a.privilegeProof,
    approvalEnvelope: req.approvalEnvelope, suppliedEvidence: req.suppliedEvidence, executionId: req.executionId,
    nowProvider: a.nowProvider,
  };
  return runInternal("production", d);
}

/** TEST entrypoint — offline suite ONLY (synthetic keys + disposable in-memory fixture). */
export async function runTrustedExecutorTest(ctx) {
  const c = ctx && typeof ctx === "object" ? ctx : {};
  if (c.testBoundary !== true) return hold("test_boundary", "test_entrypoint_requires_testBoundary_true");
  const cfg = loadRuntimeConfig(c.env);
  const d = {
    cfg, trustRoot: c.trustRoot, connectionIdentityProof: c.connectionIdentityProof,
    expectedIssuer: c.expectedIssuer, connectionToken: c.connectionToken,
    executorDbClient: c.executorDbClient, readerDbClient: c.readerDbClient,
    reviewedStateQueries: c.reviewedStateQueries, sourcePin: c.sourcePin, privilegeProof: c.privilegeProof,
    approvalEnvelope: c.approvalEnvelope, suppliedEvidence: c.suppliedEvidence, executionId: c.executionId,
    nowProvider: c.nowProvider,
  };
  return runInternal("test", d);
}
