// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP 2 — production-shaped, one-shot TRUSTED EXECUTOR V2 harness. OFFLINE.
//
// Successor of trusted-executor-runtime-01/trusted-executor-runtime.mjs (V1, frozen). Sequence:
//   config (V2) → trust root pinned to config → connection→AI-STAGING target binding → V2 read adapter
//   (reader client, content-verified V2 registry) + V2 activation adapter (executor client) →
//   ActivationSourceProofV2 (A derivation base / B REVIEWED STATIC gateway 4f390 / C PRESERVED Step-2 binding —
//   NO deployed gateway: the PIN-B gateway cannot start before this activation; the deployed-gateway proof
//   belongs to the separate PHASE-B preflight) →
//   PHASE A (pre-activation V2 state + authentic UNUSED approval, inside runActivationV2) →
//   restricted activate_catalog_v2 (one-shot, no retry) → COMMITTED ledger (read AFTER the transaction) →
//   PHASE-B CORRELATION (verifyConsumedApprovalV2: the SAME approval ↔ EXACTLY ONE committed ledger row ↔
//   the deterministic receipt commitment) → ACTIVATED-state check (V2 sole active; policy NOT active;
//   controls dormant).
// It deliberately does NOT arm policy/controls, does NOT run the pre-probe preflight and NEVER emits
// PROBE_READY. The V1 runtime checked ARMED state right after activation; in the V2 lifecycle the armed
// state belongs to the separate PHASE-B preflight (runPreflightV2), after the Owner-run 04/05 steps.
//
// runTrustedExecutorProductionV2(request): request may carry ONLY { approvalEnvelope, suppliedEvidence,
//   executionId }; NO provisioner ⇒ acquireProductionAuthorityV2() is UNPROVISIONED ⇒ fail closed (default).
// composeTrustedExecutorProductionV2(provisioner): the bounded PRODUCTION COMPOSITION SEAM — a future,
//   separately authorized entrypoint supplies a frozen provisioner at composition time; the returned one-shot
//   run(request) accepts the same untrusted request only; the authority must pass the full production bar.
// runTrustedExecutorTestV2(ctx) / composeTrustedExecutorTestV2(provisioner, {testBoundary:true}): the OFFLINE
//   suite only.
// ─────────────────────────────────────────────────────────────────────────

import { verifyConsumedApprovalV2 } from "../../m7-step1-hb1-consolidated-remediation-01/approval/approval-verify-v2.mjs";
import { publicKeyFingerprintFromDerB64 } from "../../m7-step1-hb1-consolidated-remediation-01/approval/pricing-approval-contract-v2.mjs";
import { verifyConnectionTargetBinding } from "../../trusted-executor-runtime-01/db-target-binding.mjs";
import { TARGETS_V2, STORE_BINDING_REF, assertIdentityIntegrity } from "../identity/v2-identity.mjs";
import { checkActivationSourceProofV2 } from "../identity/v2-source-identity.mjs";
import { loadRuntimeConfigV2 } from "./v2-runtime-config.mjs";
import { makeTrustedReadAdapterV2 } from "./v2-trusted-read-adapter.mjs";
import { makeRestrictedActivationAdapterV2 } from "./v2-restricted-activation-adapter.mjs";
import { runActivationV2 } from "./v2-trusted-activation-executor.mjs";
import { checkActivatedStateV2 } from "./v2-preflight.mjs";
import { acquireProductionAuthorityV2, acquireAuthorityForTestV2, validateProvisionedAuthorityV2, rejectCallerSuppliedAuthorityV2, checkProvisionerV2 } from "./v2-production-authority.mjs";

function hold(stage, reason, extra) { return { ok: false, activated: false, probeReady: false, stage, reason, ...(extra || {}) }; }

async function runInternal(mode, d) {
  if (mode !== "production" && mode !== "test") return hold("mode", "invalid_mode");
  const idc = assertIdentityIntegrity(); if (!idc.ok) return hold("identity", idc.reason);
  const cfg = d.cfg;
  if (!cfg || cfg.ok !== true) return hold("config", (cfg && cfg.reason) || "config_absent", { missing: cfg && cfg.missing });

  const trustRoot = d.trustRoot;
  if (!trustRoot || typeof trustRoot.pinnedPublicKeyDerB64 !== "string") return hold("trust_root", "trust_root_absent");
  let fp; try { fp = publicKeyFingerprintFromDerB64(trustRoot.pinnedPublicKeyDerB64); } catch { return hold("trust_root", "trust_root_key_invalid"); }
  if (fp !== trustRoot.pinnedFingerprint || fp !== cfg.reviewer.pinnedFingerprint) return hold("trust_root", "trust_root_not_config_pinned");

  const targetBinding = verifyConnectionTargetBinding({
    expectedServiceId: cfg.targets.pgServiceId, expectedIssuer: d.expectedIssuer, connectionToken: d.connectionToken,
    connectionIdentityProof: d.connectionIdentityProof, testBoundary: mode === "test",
  });
  if (!targetBinding.ok) return hold("target_binding", targetBinding.reason);
  if (targetBinding.verifiedServiceId !== TARGETS_V2.postgres) return hold("target_binding", "binding_not_ai_staging");

  let reader, activator;
  try {
    reader = makeTrustedReadAdapterV2({ dbClient: d.readerDbClient, targetBinding, registry: d.registry, mode });
    activator = makeRestrictedActivationAdapterV2({ dbClient: d.executorDbClient, targetBinding, mode });
  } catch (e) { return hold("adapter", String((e && e.message) || "adapter_init_failed").slice(0, 96)); }
  if (d.readerDbClient === d.executorDbClient) return hold("adapter", "reader_and_executor_must_be_separate_clients");

  const sp = checkActivationSourceProofV2(d.activationSourceProof, { testBoundary: mode === "test" });
  if (!sp.ok) return hold("source_proof", sp.reason);
  if (!d.privilegeProof || d.privilegeProof.restricted_role_proof_present !== true) return hold("privilege_proof", "privilege_proof_absent");
  if (typeof d.nowProvider !== "function") return hold("clock", "now_provider_absent");

  const pre = await reader.observePreActivation();
  if (!pre.ok) return hold("pre_activation_observation", pre.reason);

  // pre-fetch the ledger (async) for the frozen verifier's SYNCHRONOUS isConsumed.
  const claimed = d.approvalEnvelope && d.approvalEnvelope.payload && d.approvalEnvelope.payload.approval_id;
  let consumedBefore = false;
  if (typeof claimed === "string" && typeof d.executionId === "string") {
    try { consumedBefore = (await reader.isApprovalConsumed(claimed, d.executionId)) === true; } catch { return hold("ledger_precheck", "ledger_precheck_error"); }
  }
  const isConsumed = (a, e) => consumedBefore && a === claimed && e === d.executionId;

  const railway = { railway_project_id: cfg.targets.projectId, railway_environment_id: cfg.targets.environmentId,
    gateway_service_id: cfg.targets.gatewayServiceId, postgres_service_id: cfg.targets.pgServiceId };
  const db = { resolved_postgres_service_id: targetBinding.verifiedServiceId, store_binding_ref: STORE_BINDING_REF, resolved_project_id: targetBinding.verifiedProjectId };
  const readState = Object.freeze({
    provenance: reader.readStateProvenance,
    observe: () => ({ railway, activationSourceProof: d.activationSourceProof, db, preActivationState: pre.preActivationState, counts: pre.counts,
      approvalConsumed: consumedBefore, privilegeProof: d.privilegeProof }),
  });

  const act = await runActivationV2({
    trustRoot, approvalEnvelope: d.approvalEnvelope, suppliedEvidence: d.suppliedEvidence, nowIso: d.nowProvider(),
    executionId: d.executionId, isConsumed, readState, testBoundary: mode === "test",
    restrictedDbActivate: activator.restrictedDbActivate,
    targetBinding: { resolvedPostgresServiceId: targetBinding.verifiedServiceId, resolvedProjectId: targetBinding.verifiedProjectId },
  });
  if (!act.ok) return hold("activation", act.reason, act.uncertain ? { uncertain: true } : undefined);
  if (!act.activationReceipt) return hold("activation_receipt", "activation_receipt_absent");

  const ledger = await reader.observeCommittedLedger({ approvalId: act.approvalId, executionId: act.executionId });
  if (!ledger.ok) return hold("committed_ledger", ledger.reason);
  const pb = verifyConsumedApprovalV2({
    envelope: d.approvalEnvelope, trustRoot, suppliedEvidence: d.suppliedEvidence, nowIso: d.nowProvider(), executionId: d.executionId,
    ledgerObservation: ledger.observation, activationReceipt: act.activationReceipt, testBoundary: mode === "test",
  });
  if (!pb.ok) return hold("phase_b_correlation", pb.reason);

  const activated = await reader.observeActivated();
  if (!activated.ok) return hold("activated_observation", activated.reason);
  const ac = checkActivatedStateV2(activated.activatedState);
  if (!ac.ok) return hold("activated_state", ac.reason);

  return {
    ok: true, activated: true, stage: "V2_CATALOG_ACTIVATED_COMMITTED_AND_CORRELATED", probeReady: false,
    approvalId: act.approvalId, executionId: act.executionId, consumedAt: pb.consumedAt, dbIdentity: reader.dbIdentity,
    activationReceipt: act.activationReceipt,
    note: "V2 catalog activated via trusted_v2 and correlated to the committed M6 ledger + receipt; NOT probe-ready — Owner policy/control arm (04/05), PHASE-B preflight and the single probe are separate authorized steps.",
  };
}

async function runWithAuthority(mode, acquire, request) {
  const rj = rejectCallerSuppliedAuthorityV2(request);
  if (!rj.ok) return hold("production_boundary", rj.reason);
  const req = request || {};
  const auth = await acquire();
  if (!auth || auth.available !== true) return hold("production_authority", (auth && auth.reason) || "production_authority_unavailable");
  const v = validateProvisionedAuthorityV2(auth.authority, { testBoundary: mode === "test" });
  if (!v.ok) return hold("production_authority", v.reason);
  const a = auth.authority;
  return runInternal(mode, { ...a, approvalEnvelope: req.approvalEnvelope, suppliedEvidence: req.suppliedEvidence, executionId: req.executionId });
}

/** PRODUCTION entrypoint (default) — untrusted request only; NO provisioner ⇒ UNPROVISIONED ⇒ fail closed. */
export async function runTrustedExecutorProductionV2(request) {
  return runWithAuthority("production", () => acquireProductionAuthorityV2(), request);
}

function composed(mode, provisioner, acquire) {
  const pc = checkProvisionerV2(provisioner);
  if (!pc.ok) return Object.freeze({ available: false, reason: pc.reason, run: async () => hold("production_authority", pc.reason) });
  let used = false;
  return Object.freeze({
    available: true, mode,
    async run(request) {
      if (used) return hold("guard", "composed_executor_is_one_shot");
      used = true; // claimed before any acquisition / I/O
      return runWithAuthority(mode, () => acquire(provisioner), request);
    },
  });
}
/**
 * PRODUCTION COMPOSITION SEAM. The future separately authorized production entrypoint composes the executor with
 * its frozen provisioner; the result exposes ONLY a one-shot run(request). No global state is written; nothing in
 * this repository calls it with a real provisioner (none exists).
 */
export function composeTrustedExecutorProductionV2(provisioner) {
  return composed("production", provisioner, (p) => acquireProductionAuthorityV2(p));
}
/** TEST composition — explicit isolated test boundary only; the same seam with TEST-mode validation. */
export function composeTrustedExecutorTestV2(provisioner, opts) {
  if (!opts || opts.testBoundary !== true) return Object.freeze({ available: false, reason: "test_composition_requires_testBoundary_true", run: async () => hold("test_boundary", "test_composition_requires_testBoundary_true") });
  return composed("test", provisioner, (p) => acquireAuthorityForTestV2(p, { testBoundary: true }));
}

/** TEST entrypoint — offline suite ONLY (synthetic keys + disposable local PG / fixtures). */
export async function runTrustedExecutorTestV2(ctx) {
  const c = ctx && typeof ctx === "object" ? ctx : {};
  if (c.testBoundary !== true) return hold("test_boundary", "test_entrypoint_requires_testBoundary_true");
  return runInternal("test", {
    cfg: loadRuntimeConfigV2(c.env), trustRoot: c.trustRoot, connectionIdentityProof: c.connectionIdentityProof,
    expectedIssuer: c.expectedIssuer, connectionToken: c.connectionToken, executorDbClient: c.executorDbClient, readerDbClient: c.readerDbClient,
    registry: c.registry, activationSourceProof: c.activationSourceProof, privilegeProof: c.privilegeProof,
    approvalEnvelope: c.approvalEnvelope, suppliedEvidence: c.suppliedEvidence, executionId: c.executionId, nowProvider: c.nowProvider,
  });
}
