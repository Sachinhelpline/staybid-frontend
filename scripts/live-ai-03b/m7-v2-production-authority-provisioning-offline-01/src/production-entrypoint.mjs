// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 V2 PRODUCTION AUTHORITY PROVISIONING — production composition entrypoint. OFFLINE candidate.
//
// composeProductionActivationBoundaryV2({ env }) — called ONLY by a future, separately authorized trusted process.
// It receives trusted composition inputs only (the process environment); it NEVER receives an activation request.
// Order (every step before the first DB connection is static, no I/O):
//   1. provisioning config (names + public material; forbidden-secret screen; distinct credential references);
//   2. reviewer PUBLIC trust root (DER SPKI Ed25519, fingerprint recomputed = config);
//   3. Phase-A ActivationSourceProofV2 (PIN C RE-DERIVED from git by the preserved verifier; preserved checker);
//   4. the executor-attestation source — UNPROVISIONED in this repository state (no independent issuer of
//      AiStagingExecutorAttestationV1 exists) ⇒ fail closed HERE, before any connection;
//   5. the reader-attestation source — the ACCEPTED reader-attestation-channel-v1 adapter;
//   6. the two restricted physical-connection factories (distinct env NAMES; values read only at open());
//   7. the trusted clock (bound to the DB clock inside acquire());
//   8. the frozen provisioner → the preserved composeTrustedExecutorProductionV2(provisioner) → ONE-SHOT run(request).
// The returned run(request) accepts exactly { approvalEnvelope, suppliedEvidence, executionId } (enforced by the
// preserved runtime) and releases both connections afterwards. This module never creates, signs or fabricates an
// approval or evidence, never runs SQL 04/05, never touches a gateway or provider.
// ─────────────────────────────────────────────────────────────────────────
import process from "node:process";
import { fileURLToPath } from "node:url";
import { composeTrustedExecutorProductionV2, composeTrustedExecutorTestV2 } from "../../m7-step2-runtime-rebinding-offline-01/runtime/v2-trusted-executor-runtime.mjs";
import { makePgPhysicalFactory } from "../../private-reader-production-integration-offline-01/reader-session.mjs";
import { createAttestationSourceChannel } from "../../private-reader-production-integration-offline-01/attestation-source-channel.mjs";
import { loadProvisioningConfig } from "./provisioning-config.mjs";
import { loadReviewerTrustRootV2 } from "./reviewer-trust-root.mjs";
import { productionActivationSourceProofV2 } from "./activation-source.mjs";
import { makeExecutorPgPhysicalFactory } from "./executor-session.mjs";
import { makeProductionClock } from "./trusted-clock.mjs";
import { createAuthorityProvisionerV2 } from "./provisioner.mjs";

export const ENTRYPOINT_VERSION = "v2-production-authority-entrypoint-v1";
const unavailable = (reason) => Object.freeze({ available: false, reason, run: async () => Object.freeze({ ok: false, activated: false, probeReady: false, stage: "production_authority", reason }) });

const EXECUTOR_ATTESTATION_SOURCE_UNPROVISIONED = Object.freeze({ available: false, reason: "executor_attestation_source_unprovisioned" });
/**
 * The executor-attestation source. No independently reviewed issuer of AiStagingExecutorAttestationV1 exists (the
 * accepted M5 attester issues reader attestations only). There is no setter, env switch or injection path: a real
 * source requires a separately reviewed and preserved change to this package once such an issuer exists.
 */
export async function acquireExecutorAttestationSourceV2() { return EXECUTOR_ATTESTATION_SOURCE_UNPROVISIONED; }

export async function composeProductionActivationBoundaryV2(opts = {}) {
  const keys = Object.keys(opts);
  if (keys.some((k) => k !== "env" && k !== "repoRoot")) return unavailable("production_entrypoint_rejects_injection");
  const env = opts.env || process.env;
  const pc = loadProvisioningConfig(env, { testBoundary: false });
  if (!pc.ok) return unavailable(pc.reason);
  const rt = loadReviewerTrustRootV2(pc.cfg);
  if (!rt.ok) return unavailable(rt.reason);
  const sp = productionActivationSourceProofV2(opts.repoRoot ? { repoRoot: opts.repoRoot } : {});
  if (!sp.ok) return unavailable(sp.reason);
  const exSrc = await acquireExecutorAttestationSourceV2();
  if (!exSrc || exSrc.available !== true) return unavailable((exSrc && exSrc.reason) || "executor_attestation_source_unprovisioned");
  const ch = pc.readerAttester.channel;
  const rdSrc = createAttestationSourceChannel({ host: ch.host, port: ch.port, channelSecret: env[ch.channelSecretEnvName] }, { offlineTestBoundary: false });
  if (!rdSrc.ok) return unavailable("reader_" + rdSrc.reason);
  const prov = createAuthorityProvisionerV2({
    provisioningConfig: pc, reviewerTrustRoot: rt.trustRoot, activationSourceProof: sp.proof, clock: makeProductionClock(),
    executorPhysicalFactory: makeExecutorPgPhysicalFactory({ env, connectionStringEnvName: pc.executorDbUrlEnvName }),
    readerPhysicalFactory: makePgPhysicalFactory({ env, connectionStringEnvName: pc.readerDbUrlEnvName }),
    executorAttestationSource: exSrc.source, readerAttestationSource: rdSrc.source,
  }, { testBoundary: false });
  if (!prov.ok) return unavailable(prov.reason);
  return boundary(composeTrustedExecutorProductionV2(prov.provisioner), prov.close, "production");
}

function boundary(composed, close, mode) {
  if (!composed || composed.available !== true) return unavailable((composed && composed.reason) || "composition_unavailable");
  let used = false;
  return Object.freeze({
    available: true, mode,
    async run(request) {
      if (used) return Object.freeze({ ok: false, activated: false, probeReady: false, stage: "guard", reason: "activation_boundary_is_one_shot" });
      used = true;
      try { return await composed.run(request); } finally { await close(); }
    },
  });
}

/** TEST composition — explicit isolated test boundary only; the same provisioner under the preserved TEST seam. */
export function composeActivationBoundaryForTestV2(deps, opts) {
  if (!opts || opts.testBoundary !== true) return unavailable("test_composition_requires_testBoundary_true");
  const prov = createAuthorityProvisionerV2(deps, { testBoundary: true });
  if (!prov.ok) return unavailable(prov.reason);
  return boundary(composeTrustedExecutorTestV2(prov.provisioner, { testBoundary: true }), prov.close, "test");
}
function main() {
  process.stderr.write("[live-ai-03b V2 production-authority entrypoint] FAIL-CLOSED: library composition only; it accepts no activation request from argv/stdin and performs no DB/network access on its own. Exit 2.\n");
  process.exit(2);
}
const isMain = (() => { try { return !!process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]; } catch { return false; } })();
if (isMain) main();
