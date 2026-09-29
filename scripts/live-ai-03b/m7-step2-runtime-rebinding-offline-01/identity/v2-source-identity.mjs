// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP 2 — SOURCE-IDENTITY contract (three DISTINCT pins, TWO phase-specific proofs). OFFLINE.
// Node built-ins only. No network / DB / provider / secret. Performs NO git write.
//
//   PIN A — Step-1 DERIVATION BASE (9270c282… / c46da041…)
//           The accepted M6 HEAD the V2 catalog/policy/bundle were derived from. It is bound INTO the
//           signed approval bundle (base_commit/base_tree) and the DB function checks base_commit. It is
//           NEVER rewritten here (a Step-2 or gateway commit is NOT a derivation base).
//   PIN B — GATEWAY DEPLOY SOURCE (4f390b74… / 72080256…)
//           The commit whose `server/voice-gateway` build closure the probe's gateway must run. It
//           carries the M7 `service_tier: "default"` pin. The superseded V1 deploy source 2b69ce… /
//           87aad22… is REJECTED (its gateway omits the tier pin ⇒ project default could re-price).
//   PIN C — Step-2 RUNTIME PRESERVATION commit — NOT FABRICATED. The historical preservation f5ec5807 (runtime
//           manifest 9a460078…) is HISTORICAL EVIDENCE ONLY: it binds the pre-correction bytes and can never
//           authorize this corrected runtime. Until the Owner preserves THIS corrected runtime in a new reviewed
//           commit, the pin is the fail-closed placeholder REQUIRED_AFTER_STEP2_PRESERVATION and every consumer
//           refuses. The new binding (Step2RuntimePreservationBindingV2) is produced by
//           tools/verify-step2-preservation.mjs over a three-segment lineage (see that tool).
//
// LIFECYCLE CORRECTION (M7-STEP2-LIFECYCLE-CORRECTION-OFFLINE-01). The accepted combined V2 source pin
// (checkSourcePinV2 / LiveAi03bSourcePinV2) required an OBSERVED DEPLOYED PIN-B gateway for EVERY consumer —
// including Phase A / SQL 03 activation. The PIN-B gateway (live-ai-staging-main.ts) refuses to start
// (no_active_catalog_version) BEFORE app.listen() until a catalog is active, so a healthy deployed gateway can
// never exist before activation: a dependency CYCLE. The combined check is RETIRED (it now fails closed) and
// replaced by two phase-specific proofs:
//   • ActivationSourceProofV2 (Phase A / SQL 03): exact PIN A + the REVIEWED STATIC PIN-B git identity (the
//     literal below; never caller-chosen; it claims NOTHING about deployment/health) + a valid PRESERVED PIN C.
//   • PreProbeSourceProofV2 (Phase B / pre-probe, reader host): exact PIN A + an INDEPENDENT, trusted-provenance
//     observation of a HEALTHY DEPLOYED gateway running exactly PIN B + a valid PRESERVED PIN C. A static proof
//     can NEVER satisfy it.
// ─────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXED_V2, canonicalize, sha256hex } from "./v2-identity.mjs";
import * as G from "../../m7-step1-hb1-consolidated-remediation-01/catalog/v2-digest-gen.mjs";

const HEX40 = /^[0-9a-f]{40}$/;
const fail = (reason) => ({ ok: false, reason });

// ═════════════════════════════ PIN A — derivation base ═════════════════════════════
export const DERIVATION_BASE = Object.freeze({
  role: "m7-step1-derivation-base",
  commit: G.BASE_COMMIT, // 9270c282d5fd65e9fe49261391badfe92c777b8f
  tree: G.BASE_TREE,     // c46da04123dc44cd9954fe350de0b1bc20ff0948
});
export function checkDerivationBase(o) {
  if (!o || typeof o !== "object") return fail("derivation_base_absent");
  if (o.commit !== DERIVATION_BASE.commit || o.tree !== DERIVATION_BASE.tree) return fail("derivation_base_rewritten");
  if (FIXED_V2.base_commit !== DERIVATION_BASE.commit || FIXED_V2.base_tree !== DERIVATION_BASE.tree) return fail("derivation_base_drift_in_contract");
  return { ok: true };
}

// ═════════════════════════════ PIN B — gateway deploy source ═════════════════════════════
export const GATEWAY_DEPLOY_SOURCE_V2 = Object.freeze({
  role: "gateway-deploy-source",
  repository: "Sachinhelpline/staybid-frontend",
  commit: "4f390b74132b087b757faa655bdcb73be6c14a8f",
  tree: "72080256d4cc2a97a2a15058931e838ebef5ec48",
  // the gateway build closure = `tsc -p server/voice-gateway/tsconfig.json` (include "*.ts", rootDir ".")
  voice_gateway_tree: "2092d9de6b96763ab76477f9c37159082c00aa26",
  closure_blobs: Object.freeze({
    "server/voice-gateway/openai-responses.ts": "1a9e2ae8f13365577c4a0dc40f6771c1c5073a37", // carries service_tier:"default"
    "server/voice-gateway/live-ai-staging-main.ts": "e211b25f68f4414f4c6a938d9c25935cdf26b67a",
    "server/voice-gateway/config.ts": "32a5d5f48b4d3328b87ea0ee44ff0c8c72bbc4cf",
    "server/voice-gateway/live-ai-03b-controller.ts": "c1633aa786c86627682e803440df5472cf1a06ef",
    "server/voice-gateway/live-ai-budget-authority.ts": "73cead6dc20a29eb5035765df38ca0414f5744d0",
    "server/voice-gateway/live-ai-budget-store.ts": "b8979bd7673c21e914dd826fdf43e2b5577c56bc",
    "server/voice-gateway/live-ai-budget-pricing.ts": "9684cfbc98643231b0b06479333f01d9b10d709a",
    "server/voice-gateway/tsconfig.json": "dee0a7f10d72295e4cc1e7aafbb5b690ad6ee6c0",
    "package.json": "a5a06e499c1e252506ac1621a2f89ec8be0b742e",
    "package-lock.json": "569cdb2159fcf12b8bb30f88bd564fe62fb5941c",
  }),
  // the staging broker (Vercel-side, same repo) — unchanged since the superseded source.
  broker_blobs: Object.freeze({
    "app/api/live-ai/staging/session/route.ts": "8335574457fff30ea6fffb34d3b4c3c2aa42d979",
    "lib/live-ai/staging-authority.ts": "95cc6a6e5c1a799cf664c36b0d8f62df4be706eb",
  }),
  build_command: "npm run build:gateway",
  start_command: "npm run start:live-ai-staging",
});
export const SUPERSEDED_GATEWAY_SOURCE_V1 = Object.freeze({
  commit: "2b69ce28230fc9d56a035846e95d8de206d5db3b",
  tree: "87aad22d90f84f2c3b307201c3e0d3b8658b1619",
  voice_gateway_tree: "8dd654353ae3fba106f17b9e77b290499f8c1411",
  openai_responses_blob: "9607cf8c6f9da89191c80d62bbf6a1570f7214d3",
});

function isSupersededGatewayValue(o) {
  const S = SUPERSEDED_GATEWAY_SOURCE_V1;
  return o.deployed_commit === S.commit || o.deployed_tree === S.tree || o.gateway_deployment_revision === S.commit || o.voice_gateway_tree === S.voice_gateway_tree
    || o.commit === S.commit || o.tree === S.tree;
}

/** Observed deployed-gateway source fields (the four live facts). Used ONLY inside the pre-probe proof. */
export function checkGatewaySourcePinV2(o) {
  if (!o || typeof o !== "object") return fail("gateway_source_observation_absent");
  if (isSupersededGatewayValue(o)) return fail("superseded_gateway_source_2b69ce_rejected");
  const P = GATEWAY_DEPLOY_SOURCE_V2;
  if (o.deployed_commit !== P.commit) return fail("deployed_commit_mismatch");
  if (o.deployed_tree !== P.tree) return fail("deployed_tree_mismatch");
  if (o.gateway_deployment_revision !== P.commit) return fail("gateway_revision_not_pinned_commit");
  if (o.voice_gateway_tree !== P.voice_gateway_tree) return fail("voice_gateway_closure_tree_mismatch");
  return { ok: true };
}
export function gatewaySourceIdentity() {
  const P = GATEWAY_DEPLOY_SOURCE_V2;
  return { commit: P.commit, tree: P.tree, voice_gateway_tree: P.voice_gateway_tree };
}

// ── STATIC reviewed PIN-B identity (Phase A only) ──
export const GATEWAY_STATIC_SOURCE_KIND = "reviewed-static-git-source";
/** Digest over the reviewed PIN-B build closure + broker blobs — a pure function of the literal above. */
export function gatewayClosureDigestV2() {
  const P = GATEWAY_DEPLOY_SOURCE_V2;
  return sha256hex(canonicalize({ domain: "staybid.live-ai.m7-step2.gateway-static-closure.v1", commit: P.commit, tree: P.tree,
    voice_gateway_tree: P.voice_gateway_tree, closure_blobs: { ...P.closure_blobs }, broker_blobs: { ...P.broker_blobs } }));
}
/** The ONLY acceptable static PIN-B object: derived from the reviewed literal, never from a caller. */
export function staticGatewaySourceIdentityV2() {
  const P = GATEWAY_DEPLOY_SOURCE_V2;
  return { kind: GATEWAY_STATIC_SOURCE_KIND, repository: P.repository, commit: P.commit, tree: P.tree,
    voice_gateway_tree: P.voice_gateway_tree, closure_digest: gatewayClosureDigestV2() };
}
const STATIC_KEYS = ["closure_digest", "commit", "kind", "repository", "tree", "voice_gateway_tree"];
// any key describing a LIVE deployment is forbidden in a static (pre-deployment) proof.
const DEPLOYMENT_CLAIM_KEYS = ["deployed_commit", "deployed_tree", "gateway_deployment_revision", "healthy", "observation_provenance", "observed_at", "deployment_id"];
/** Phase-A PIN-B check: byte-exact equality with the reviewed literal; NO deployment/health claim accepted. */
export function checkStaticGatewaySourceV2(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return fail("static_gateway_source_absent");
  if (DEPLOYMENT_CLAIM_KEYS.some((k) => Object.prototype.hasOwnProperty.call(o, k))) return fail("activation_proof_must_not_claim_gateway_deployment");
  if (isSupersededGatewayValue(o)) return fail("superseded_gateway_source_2b69ce_rejected");
  if (Object.keys(o).sort().join(",") !== STATIC_KEYS.join(",")) return fail("static_gateway_source_shape_not_exact");
  const want = staticGatewaySourceIdentityV2();
  if (o.kind !== want.kind) return fail("static_gateway_source_kind_mismatch");
  if (o.repository !== want.repository) return fail("static_gateway_repository_mismatch");
  if (o.commit !== want.commit) return fail("static_gateway_commit_mismatch");
  if (o.tree !== want.tree) return fail("static_gateway_tree_mismatch");
  if (o.voice_gateway_tree !== want.voice_gateway_tree) return fail("static_gateway_voice_gateway_tree_mismatch");
  if (o.closure_digest !== want.closure_digest) return fail("static_gateway_closure_digest_mismatch");
  return { ok: true };
}

// ── LIVE deployed PIN-B observation (Phase B only) ──
export const GATEWAY_DEPLOYMENT_OBSERVATION_KIND = "live-deployed-gateway-observation";
export const GATEWAY_OBSERVATION_TRUSTED_PROVENANCE = "independent-railway-deployment-observation-v2";
export const GATEWAY_OBSERVATION_TEST_PROVENANCE = "TEST-ONLY-gateway-deployment-observation";
const OBSERVATION_KEYS = ["deployed_commit", "deployed_tree", "gateway_deployment_revision", "healthy", "kind", "observation_provenance", "voice_gateway_tree"];
/** Phase-B PIN-B check: an independent, trusted, HEALTHY deployed-gateway observation running exactly PIN B. */
export function checkDeployedGatewayObservationV2(o, opts) {
  const testBoundary = !!(opts && opts.testBoundary === true);
  if (!o || typeof o !== "object" || Array.isArray(o)) return fail("gateway_source_observation_absent");
  if (o.kind === GATEWAY_STATIC_SOURCE_KIND || Object.prototype.hasOwnProperty.call(o, "closure_digest")) return fail("static_gateway_proof_cannot_satisfy_pre_probe");
  if (isSupersededGatewayValue(o)) return fail("superseded_gateway_source_2b69ce_rejected");
  if (o.kind !== GATEWAY_DEPLOYMENT_OBSERVATION_KIND) return fail("deployed_gateway_observation_kind_absent");
  if (Object.keys(o).sort().join(",") !== OBSERVATION_KEYS.join(",")) return fail("deployed_gateway_observation_shape_not_exact");
  if (o.observation_provenance !== (testBoundary ? GATEWAY_OBSERVATION_TEST_PROVENANCE : GATEWAY_OBSERVATION_TRUSTED_PROVENANCE)) return fail("deployed_gateway_observation_not_independent");
  if (o.healthy !== true) return fail("deployed_gateway_not_healthy");
  return checkGatewaySourcePinV2(o);
}

// ═════════════════════════════ PIN C — Step-2 runtime preservation ═════════════════════════════
export const STEP2_PIN_STATUS_REQUIRED = "REQUIRED_AFTER_STEP2_PRESERVATION";
export const STEP2_PIN_STATUS_PRESERVED = "PRESERVED";
export const STEP2_DIR = "scripts/live-ai-03b/m7-step2-runtime-rebinding-offline-01";
export const STEP2_BINDING_CONTRACT = "Step2RuntimePreservationBindingV2";
export const STEP2_BINDING_CONTRACT_V1_HISTORICAL = "Step2RuntimePreservationBindingV1";
export const STEP2_TRUSTED_PROVENANCE = "trusted-approved-step2-preservation-receipt-v2";
export const STEP2_TEST_PROVENANCE = "TEST-ONLY-step2-preservation-receipt-v2";

/** HISTORICAL PIN C (accepted pre-correction preservation). Evidence only — it can NEVER authorize this runtime. */
export const HISTORICAL_STEP2_PRESERVATION = Object.freeze({
  status: "HISTORICAL_EVIDENCE_ONLY",
  commit: "f5ec5807014442884c1d156c51a4edd1563b25bd",
  tree: "742c837dae2ba83d88a1c66790f19d29c6af59f5",
  step2_dir_tree: "c0a2910d8b374ed63b7927cd3a0b348c0ed018d9",
  runtime_manifest_digest: "9a460078846eec885b726e7b54bdbd8a301c690b1f78a68439e151f462341998",
});
/** The accepted M5 closure on top of the historical PIN C (unrelated to Step 2; retained, never Step-2 drift). */
export const ACCEPTED_M5_CLOSURE = Object.freeze({
  commit: "3fda6af1eb9bf2681a39e4b90bddec270ac86395",
  tree: "aef84e58f9febc366b04c5e14ecacbea76e86776",
  parent: "f5ec5807014442884c1d156c51a4edd1563b25bd",
  step2_dir_tree: "c0a2910d8b374ed63b7927cd3a0b348c0ed018d9", // unchanged from the historical PIN C
  path_prefixes: Object.freeze([
    "scripts/live-ai-03b/m5-attester-clock-recovery-remediation-offline-01/",
    "scripts/live-ai-03b/private-reader-bootstrap-clock-peer-offline-01/",
  ]),
});

// THE placeholder. There is deliberately NO commit/tree here: the corrected Step-2 preservation commit does
// not exist and is not fabricated. Every consumer must fail closed on this value.
export const STEP2_RUNTIME_PIN_PLACEHOLDER = Object.freeze({
  contract: STEP2_BINDING_CONTRACT, status: STEP2_PIN_STATUS_REQUIRED,
  commit: null, tree: null, step2_dir_tree: null, runtime_manifest_digest: null,
  correction_base: ACCEPTED_M5_CLOSURE.commit, historical_pin_c: HISTORICAL_STEP2_PRESERVATION.commit,
});

// the runtime files whose CONTENT the preservation receipt must bind (paths relative to STEP2_DIR).
export const RUNTIME_MANIFEST_FILES = Object.freeze([
  "identity/v2-identity.mjs",
  "identity/v2-source-identity.mjs",
  "probe/v2-first-text-probe.mjs",
  "reader/v2-gateway-observation-caller.mjs",
  "reader/v2-observation-contract.mjs",
  "reader/v2-production-entrypoint.mjs",
  "reader/v2-production-reader-authority.mjs",
  "reader/v2-reader-only-authority.mjs",
  "reader/v2-serving-runtime.mjs",
  "runtime/v2-preflight.mjs",
  "runtime/v2-production-authority.mjs",
  "runtime/v2-query-registry.mjs",
  "runtime/v2-restricted-activation-adapter.mjs",
  "runtime/v2-runtime-config.mjs",
  "runtime/v2-trusted-activation-executor.mjs",
  "runtime/v2-trusted-executor-runtime.mjs",
  "runtime/v2-trusted-read-adapter.mjs",
]);
const HERE = dirname(fileURLToPath(import.meta.url));
const STEP2_ROOT = join(HERE, "..");

/** Canonical content manifest over (path, sha256(bytes)) — pure function of the bytes supplied. */
export function manifestDigestOf(entries) {
  const files = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map((e) => ({ path: e.path, sha256: e.sha256 }));
  return sha256hex(canonicalize({ domain: "staybid.live-ai.m7-step2.runtime-manifest.v1", files }));
}
/** Self-measurement of THIS runtime's own module bytes (local read-only file access; never network). */
export function measureRuntimeManifest(root = STEP2_ROOT) {
  const files = RUNTIME_MANIFEST_FILES.map((p) => ({ path: p, sha256: createHash("sha256").update(readFileSync(join(root, p))).digest("hex") }));
  return { files, digest: manifestDigestOf(files) };
}

/**
 * Verify a Step-2 runtime preservation binding (V2). The PLACEHOLDER always fails closed. A binding is accepted
 * only if: exact shape + V2 contract (a V1 historical binding is refused); status PRESERVED; provenance = trusted
 * (or TEST-ONLY under an explicit test boundary); commit/tree/dir-tree are 40-hex and are NONE of the known
 * non-correction commits (PIN A / PIN B / superseded V1 / historical PIN C / M5 closure, nor their trees); the
 * lineage fields name exactly the historical PIN C and the accepted M5 closure it was corrected on top of; the
 * Step-2 dir tree differs from the historical one; the manifest digest is NOT the historical 9a460078… and equals
 * the runtime's OWN measured content manifest (so a receipt for other bytes cannot authorize this runtime).
 * The git-level facts (three-segment lineage; only Step-2 paths changed by the correction) are established by
 * tools/verify-step2-preservation.mjs BEFORE the Owner-controlled authority supplies the binding.
 */
export function verifyStep2RuntimePin(pin, opts) {
  const testBoundary = !!(opts && opts.testBoundary === true);
  const measured = (opts && opts.measured) || measureRuntimeManifest();
  if (!pin || typeof pin !== "object" || Array.isArray(pin)) return fail("step2_runtime_pin_absent");
  if (pin.status === STEP2_PIN_STATUS_REQUIRED) return fail("step2_runtime_pin_required_after_preservation");
  if (pin.contract === STEP2_BINDING_CONTRACT_V1_HISTORICAL) return fail("historical_step2_binding_v1_cannot_authorize_corrected_runtime");
  const want = ["commit", "contract", "correction_base", "historical_pin_c", "provenance", "runtime_manifest_digest", "status", "step2_dir_tree", "tree"];
  if (Object.keys(pin).sort().join(",") !== want.join(",")) return fail("step2_runtime_pin_shape_not_exact");
  if (pin.contract !== STEP2_BINDING_CONTRACT) return fail("step2_runtime_pin_contract_mismatch");
  if (pin.status !== STEP2_PIN_STATUS_PRESERVED) return fail("step2_runtime_pin_not_preserved");
  if (pin.provenance !== (testBoundary ? STEP2_TEST_PROVENANCE : STEP2_TRUSTED_PROVENANCE)) return fail("step2_runtime_pin_provenance_untrusted");
  for (const k of ["commit", "tree", "step2_dir_tree"]) if (!HEX40.test(String(pin[k]))) return fail("step2_runtime_pin_" + k + "_malformed");
  const H = HISTORICAL_STEP2_PRESERVATION;
  if (pin.commit === H.commit || pin.tree === H.tree) return fail("historical_pin_c_cannot_authorize_corrected_runtime");
  const forbidden = new Set([DERIVATION_BASE.commit, DERIVATION_BASE.tree, GATEWAY_DEPLOY_SOURCE_V2.commit, GATEWAY_DEPLOY_SOURCE_V2.tree,
    SUPERSEDED_GATEWAY_SOURCE_V1.commit, SUPERSEDED_GATEWAY_SOURCE_V1.tree, ACCEPTED_M5_CLOSURE.commit, ACCEPTED_M5_CLOSURE.tree]);
  if (forbidden.has(pin.commit) || forbidden.has(pin.tree)) return fail("step2_runtime_pin_reuses_non_step2_commit");
  if (pin.correction_base !== ACCEPTED_M5_CLOSURE.commit || pin.historical_pin_c !== H.commit) return fail("step2_runtime_pin_lineage_mismatch");
  if (pin.step2_dir_tree === H.step2_dir_tree) return fail("historical_step2_dir_tree_cannot_authorize_corrected_runtime");
  if (pin.runtime_manifest_digest === H.runtime_manifest_digest) return fail("historical_runtime_manifest_cannot_authorize_corrected_runtime");
  if (pin.runtime_manifest_digest !== measured.digest) return fail("step2_runtime_manifest_mismatch");
  return { ok: true, identity: { commit: pin.commit, tree: pin.tree, step2_dir_tree: pin.step2_dir_tree, runtime_manifest_digest: pin.runtime_manifest_digest } };
}

// ═════════════════════════════ historical combined source pin — RETIRED ═════════════════════════════
export const SOURCE_PIN_CONTRACT_V2 = "LiveAi03bSourcePinV2";
/**
 * RETIRED. The accepted combined pin required an observed deployed PIN-B gateway for every phase, which is
 * impossible before SQL 03 activation (lifecycle cycle). It now fails closed for EVERY input so no stale caller
 * can use it; use checkActivationSourceProofV2 (Phase A) or checkPreProbeSourceProofV2 (Phase B).
 */
export function checkSourcePinV2() { return fail("combined_source_pin_v2_retired_phase_specific_proof_required"); }

// ═════════════════════════════ phase-specific source proofs ═════════════════════════════
export const ACTIVATION_SOURCE_PROOF_CONTRACT_V2 = "LiveAi03bActivationSourceProofV2";
export const PRE_PROBE_SOURCE_PROOF_CONTRACT_V2 = "LiveAi03bPreProbeSourceProofV2";
const ACT_KEYS = ["contract", "derivationBase", "gatewayStaticSource", "step2Runtime"];
const PRE_KEYS = ["contract", "derivationBase", "gatewayDeployment", "step2Runtime"];
const baseIdentity = () => ({ commit: DERIVATION_BASE.commit, tree: DERIVATION_BASE.tree });

/**
 * Phase A / trusted SQL 03 activation. = { contract, derivationBase (PIN A), gatewayStaticSource (the reviewed
 * static PIN-B literal), step2Runtime (PRESERVED V2 binding) }. It proves source identity only; it NEVER claims
 * that a gateway is deployed or healthy (gatewayDeployed:false in the result).
 */
export function checkActivationSourceProofV2(sp, opts) {
  if (!sp || typeof sp !== "object" || Array.isArray(sp)) return fail("activation_source_proof_absent");
  if (sp.contract === SOURCE_PIN_CONTRACT_V2) return fail("combined_source_pin_v2_retired_phase_specific_proof_required");
  if (sp.contract === PRE_PROBE_SOURCE_PROOF_CONTRACT_V2) return fail("pre_probe_proof_is_not_an_activation_proof");
  if (sp.contract !== ACTIVATION_SOURCE_PROOF_CONTRACT_V2) return fail("activation_source_proof_contract_mismatch");
  if (Object.prototype.hasOwnProperty.call(sp, "gatewayDeployment") || Object.prototype.hasOwnProperty.call(sp, "gatewaySource")) return fail("activation_proof_must_not_claim_gateway_deployment");
  if (Object.keys(sp).sort().join(",") !== ACT_KEYS.join(",")) return fail("activation_source_proof_shape_not_exact");
  const a = checkDerivationBase(sp.derivationBase); if (!a.ok) return a;
  const b = checkStaticGatewaySourceV2(sp.gatewayStaticSource); if (!b.ok) return b;
  const c = verifyStep2RuntimePin(sp.step2Runtime, opts); if (!c.ok) return c;
  return { ok: true, phase: "activation", gatewayDeployed: false, step2: c.identity, gateway: gatewaySourceIdentity(), derivationBase: baseIdentity() };
}

/**
 * Phase B / pre-probe (and the V2 reader host). = { contract, derivationBase (PIN A), gatewayDeployment (an
 * independent trusted observation of a HEALTHY gateway deployed from exactly PIN B), step2Runtime }. A static
 * proof, an absent observation, or any wrong / superseded deployment fact fails closed.
 */
export function checkPreProbeSourceProofV2(sp, opts) {
  if (!sp || typeof sp !== "object" || Array.isArray(sp)) return fail("pre_probe_source_proof_absent");
  if (sp.contract === SOURCE_PIN_CONTRACT_V2) return fail("combined_source_pin_v2_retired_phase_specific_proof_required");
  if (sp.contract === ACTIVATION_SOURCE_PROOF_CONTRACT_V2) return fail("static_gateway_proof_cannot_satisfy_pre_probe");
  if (sp.contract !== PRE_PROBE_SOURCE_PROOF_CONTRACT_V2) return fail("pre_probe_source_proof_contract_mismatch");
  if (Object.prototype.hasOwnProperty.call(sp, "gatewayStaticSource")) return fail("static_gateway_proof_cannot_satisfy_pre_probe");
  if (Object.keys(sp).sort().join(",") !== PRE_KEYS.join(",")) return fail("pre_probe_source_proof_shape_not_exact");
  const a = checkDerivationBase(sp.derivationBase); if (!a.ok) return a;
  const b = checkDeployedGatewayObservationV2(sp.gatewayDeployment, opts); if (!b.ok) return b;
  const c = verifyStep2RuntimePin(sp.step2Runtime, opts); if (!c.ok) return c;
  return { ok: true, phase: "pre-probe", gatewayDeployed: true, step2: c.identity, gateway: gatewaySourceIdentity(), derivationBase: baseIdentity() };
}
