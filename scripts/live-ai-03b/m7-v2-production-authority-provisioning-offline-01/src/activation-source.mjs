// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 V2 PRODUCTION AUTHORITY PROVISIONING — Phase-A ActivationSourceProofV2. OFFLINE candidate.
//
// Builds the EXACT preserved LiveAi03bActivationSourceProofV2 from the preserved literals ONLY:
//   PIN A  — DERIVATION_BASE (9270c282 / c46da041) — imported, not re-typed;
//   PIN B  — staticGatewaySourceIdentityV2() (4f390b74 / 72080256 / 2092d9de + closure digest over the reviewed
//            blobs incl. openai-responses 1a9e2ae8 and live-ai-staging-main e211b25f) — imported, not re-typed;
//   PIN C  — the corrected PRESERVED Step2RuntimePreservationBindingV2 of commit 0afe4b6b, emitted by the
//            preserved verifier (tools/verify-step2-preservation.mjs) at preservation time and recorded here.
// The recorded PIN C is NEVER trusted on its own: productionActivationSourceProofV2 RE-DERIVES it from git with the
// preserved verifier (read-only) and requires byte-equality, then validates the whole proof with the preserved
// checkActivationSourceProofV2 (which also re-measures the running Step-2 bytes = 64c70317…). No deployed-gateway
// observation exists or is accepted here (Phase A). The Phase-B PreProbeSourceProofV2 is deliberately NOT imported.
// ─────────────────────────────────────────────────────────────────────────
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DERIVATION_BASE, staticGatewaySourceIdentityV2, checkActivationSourceProofV2, ACTIVATION_SOURCE_PROOF_CONTRACT_V2,
  STEP2_BINDING_CONTRACT, STEP2_PIN_STATUS_PRESERVED, STEP2_TRUSTED_PROVENANCE } from "../../m7-step2-runtime-rebinding-offline-01/identity/v2-source-identity.mjs";
import { verifyStep2Preservation, makeGit } from "../../m7-step2-runtime-rebinding-offline-01/tools/verify-step2-preservation.mjs";

/** The genuine corrected PIN-C V2 binding (as emitted by the preserved verifier for commit 0afe4b6b). */
export const PRESERVED_PIN_C_V2 = Object.freeze({
  contract: STEP2_BINDING_CONTRACT, status: STEP2_PIN_STATUS_PRESERVED, provenance: STEP2_TRUSTED_PROVENANCE,
  commit: "0afe4b6bedeb12f756cc9027367d323acb264464",
  tree: "e7bb3733cb3206e5ad1a1b0e9121b7010741734f",
  step2_dir_tree: "bacac441271856966c9b7983c4fa1625f7a6a2d2",
  runtime_manifest_digest: "64c7031746bff227321e2e2506b4737938eafc3493ae472ab0f51e5e46987d9f",
  correction_base: "3fda6af1eb9bf2681a39e4b90bddec270ac86395",
  historical_pin_c: "f5ec5807014442884c1d156c51a4edd1563b25bd",
});
const PIN_C_KEYS = Object.keys(PRESERVED_PIN_C_V2).sort().join(",");
const DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const fail = (reason) => ({ ok: false, reason });

export function assembleActivationSourceProofV2(step2Runtime) {
  return Object.freeze({
    contract: ACTIVATION_SOURCE_PROOF_CONTRACT_V2,
    derivationBase: Object.freeze({ commit: DERIVATION_BASE.commit, tree: DERIVATION_BASE.tree }),
    gatewayStaticSource: Object.freeze(staticGatewaySourceIdentityV2()),
    step2Runtime: Object.freeze({ ...step2Runtime }),
  });
}

/** Re-derive PIN C from git with the PRESERVED verifier (read-only) and require equality with the recorded binding. */
export function rederivePinCFromGit(git) {
  const r = verifyStep2Preservation(git, PRESERVED_PIN_C_V2.commit);
  if (!r || r.ok !== true) return fail("pin_c_rederivation_failed:" + String((r && r.reason) || "unknown").slice(0, 96));
  const b = r.binding;
  if (Object.keys(b).sort().join(",") !== PIN_C_KEYS || Object.keys(PRESERVED_PIN_C_V2).some((k) => b[k] !== PRESERVED_PIN_C_V2[k])) return fail("pin_c_rederived_binding_differs");
  return { ok: true, binding: Object.freeze({ ...b }) };
}

/**
 * PRODUCTION Phase-A source proof: re-derive PIN C from the repository the entrypoint runs from, assemble the proof
 * from the preserved literals, validate it with the preserved checkActivationSourceProofV2 (production mode).
 */
export function productionActivationSourceProofV2({ repoRoot = DEFAULT_REPO_ROOT, git } = {}) {
  let g = git;
  try { g = g || makeGit(repoRoot); } catch { return fail("pin_c_git_unavailable"); }
  let d; try { d = rederivePinCFromGit(g); } catch { return fail("pin_c_git_unavailable"); }
  if (!d.ok) return d;
  const proof = assembleActivationSourceProofV2(d.binding);
  const c = checkActivationSourceProofV2(proof, { testBoundary: false });
  if (!c.ok) return fail("activation_source_proof_" + c.reason);
  if (c.gatewayDeployed !== false || c.phase !== "activation") return fail("activation_source_proof_phase_mismatch");
  return { ok: true, proof };
}

/** TEST Phase-A source proof over a TEST-provenance PIN C (explicit test boundary only). */
export function testActivationSourceProofV2(testPinC, opts) {
  if (!opts || opts.testBoundary !== true) return fail("test_source_proof_requires_testBoundary_true");
  const proof = assembleActivationSourceProofV2(testPinC);
  const c = checkActivationSourceProofV2(proof, { testBoundary: true });
  return c.ok ? { ok: true, proof } : fail("activation_source_proof_" + c.reason);
}
