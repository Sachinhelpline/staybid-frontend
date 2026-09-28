// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP 2 — SOURCE-IDENTITY contract (three DISTINCT pins). OFFLINE.
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
//   PIN C — FUTURE STEP-2 RUNTIME PRESERVATION commit — NOT FABRICATED. Until the Owner preserves this
//           runtime layer in a reviewed commit, the pin is the fail-closed placeholder
//           REQUIRED_AFTER_STEP2_PRESERVATION and every consumer refuses. The later receipt is verified by
//           (i) the preservation commit descending from PIN B, (ii) ONLY additive paths under the Step-2
//           directory relative to PIN B, and (iii) the runtime's OWN measured content manifest
//           (measureRuntimeManifest) equalling the manifest recorded in that receipt.
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

/** Observed deployed-gateway source (supplied by the independent Railway/runtime observation). */
export function checkGatewaySourcePinV2(o) {
  if (!o || typeof o !== "object") return fail("gateway_source_observation_absent");
  const S = SUPERSEDED_GATEWAY_SOURCE_V1;
  if (o.deployed_commit === S.commit || o.deployed_tree === S.tree || o.gateway_deployment_revision === S.commit || o.voice_gateway_tree === S.voice_gateway_tree) {
    return fail("superseded_gateway_source_2b69ce_rejected");
  }
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

// ═════════════════════════════ PIN C — Step-2 runtime preservation ═════════════════════════════
export const STEP2_PIN_STATUS_REQUIRED = "REQUIRED_AFTER_STEP2_PRESERVATION";
export const STEP2_PIN_STATUS_PRESERVED = "PRESERVED";
export const STEP2_DIR = "scripts/live-ai-03b/m7-step2-runtime-rebinding-offline-01";
export const STEP2_BINDING_CONTRACT = "Step2RuntimePreservationBindingV1";
export const STEP2_TRUSTED_PROVENANCE = "trusted-approved-step2-preservation-receipt";
export const STEP2_TEST_PROVENANCE = "TEST-ONLY-step2-preservation-receipt";

// THE placeholder. There is deliberately NO commit/tree here: a Step-2 commit does not exist and is
// not fabricated. Every consumer must fail closed on this value.
export const STEP2_RUNTIME_PIN_PLACEHOLDER = Object.freeze({
  contract: STEP2_BINDING_CONTRACT, status: STEP2_PIN_STATUS_REQUIRED,
  commit: null, tree: null, step2_dir_tree: null, runtime_manifest_digest: null,
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
 * Verify a Step-2 runtime preservation binding. The PLACEHOLDER always fails closed. A binding is
 * accepted only if: exact shape + contract; status PRESERVED; provenance = trusted (or TEST-ONLY under
 * an explicit test boundary); commit/tree/dir-tree are 40-hex and are NONE of the known non-Step-2
 * commits (derivation base / gateway deploy source / superseded V1 source); and its manifest digest
 * equals the runtime's OWN measured content manifest (so a receipt for other bytes cannot authorize
 * this runtime). The git-level facts (descends from PIN B; only additive Step-2 paths) are established
 * by tools/verify-step2-preservation.mjs BEFORE the Owner-controlled authority supplies the binding.
 */
export function verifyStep2RuntimePin(pin, opts) {
  const testBoundary = !!(opts && opts.testBoundary === true);
  const measured = (opts && opts.measured) || measureRuntimeManifest();
  if (!pin || typeof pin !== "object" || Array.isArray(pin)) return fail("step2_runtime_pin_absent");
  if (pin.status === STEP2_PIN_STATUS_REQUIRED) return fail("step2_runtime_pin_required_after_preservation");
  const want = ["commit", "contract", "provenance", "runtime_manifest_digest", "status", "step2_dir_tree", "tree"];
  if (Object.keys(pin).sort().join(",") !== want.join(",")) return fail("step2_runtime_pin_shape_not_exact");
  if (pin.contract !== STEP2_BINDING_CONTRACT) return fail("step2_runtime_pin_contract_mismatch");
  if (pin.status !== STEP2_PIN_STATUS_PRESERVED) return fail("step2_runtime_pin_not_preserved");
  if (pin.provenance !== (testBoundary ? STEP2_TEST_PROVENANCE : STEP2_TRUSTED_PROVENANCE)) return fail("step2_runtime_pin_provenance_untrusted");
  for (const k of ["commit", "tree", "step2_dir_tree"]) if (!HEX40.test(String(pin[k]))) return fail("step2_runtime_pin_" + k + "_malformed");
  const forbidden = new Set([DERIVATION_BASE.commit, DERIVATION_BASE.tree, GATEWAY_DEPLOY_SOURCE_V2.commit, GATEWAY_DEPLOY_SOURCE_V2.tree,
    SUPERSEDED_GATEWAY_SOURCE_V1.commit, SUPERSEDED_GATEWAY_SOURCE_V1.tree]);
  if (forbidden.has(pin.commit) || forbidden.has(pin.tree)) return fail("step2_runtime_pin_reuses_non_step2_commit");
  if (pin.runtime_manifest_digest !== measured.digest) return fail("step2_runtime_manifest_mismatch");
  return { ok: true, identity: { commit: pin.commit, tree: pin.tree, step2_dir_tree: pin.step2_dir_tree, runtime_manifest_digest: pin.runtime_manifest_digest } };
}

// ═════════════════════════════ combined source pin (what a V2 authority supplies) ═════════════════════════════
export const SOURCE_PIN_CONTRACT_V2 = "LiveAi03bSourcePinV2";
/**
 * A V2 source pin = { contract, derivationBase, gatewaySource (observed), step2Runtime (binding) }.
 * Every part is checked independently; none can stand in for another.
 */
export function checkSourcePinV2(sp, opts) {
  if (!sp || typeof sp !== "object" || Array.isArray(sp)) return fail("source_pin_absent");
  if (sp.contract !== SOURCE_PIN_CONTRACT_V2) return fail("source_pin_contract_not_v2");
  const a = checkDerivationBase(sp.derivationBase); if (!a.ok) return a;
  const b = checkGatewaySourcePinV2(sp.gatewaySource); if (!b.ok) return b;
  const c = verifyStep2RuntimePin(sp.step2Runtime, opts); if (!c.ok) return c;
  return { ok: true, step2: c.identity, gateway: gatewaySourceIdentity(), derivationBase: { commit: DERIVATION_BASE.commit, tree: DERIVATION_BASE.tree } };
}
