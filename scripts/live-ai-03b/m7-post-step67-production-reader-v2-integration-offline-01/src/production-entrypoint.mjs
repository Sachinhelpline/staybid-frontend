// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 V2 PRODUCTION AUTHORITY PROVISIONING — production composition entrypoint. OFFLINE candidate.
//
// Post-Step67 reader-v2 integration:
//   • executor attestation path is unchanged;
//   • production reader v1 source is removed with NO fallback;
//   • the reader provider reuses the reviewer-trust-root frozen acquireReaderV2Attestation() and receives the
//     exact reader session owned by the provisioner, so DB-clock sampling and attestation bind the same physical
//     connection later sealed as the guarded reader client.
// ─────────────────────────────────────────────────────────────────────────
import process from "node:process";
import { fileURLToPath } from "node:url";
import { composeTrustedExecutorProductionV2, composeTrustedExecutorTestV2 } from "../../m7-step2-runtime-rebinding-offline-01/runtime/v2-trusted-executor-runtime.mjs";
import { makePgPhysicalFactory } from "../../private-reader-production-integration-offline-01/reader-session.mjs";
import { createExecutorAttestationSourceChannel } from "../../m7-v2-executor-attester-issuer-offline-01/src/executor-attestation-channel.mjs";
import { acquireReaderV2Attestation } from "../../m7-step67-authority-dedicated-reader-attester-offline-01/src/reader-v2-attestation-source.mjs";
import { loadProvisioningConfig, PROVISIONING_CONFIG_VERSION, EXECUTOR_ATTESTER_ENV, READER_ATTESTER_ENV } from "./provisioning-config.mjs";
import { loadReviewerTrustRootV2 } from "./reviewer-trust-root.mjs";
import { productionActivationSourceProofV2 } from "./activation-source.mjs";
import { makeExecutorPgPhysicalFactory } from "./executor-session.mjs";
import { makeProductionClock } from "./trusted-clock.mjs";
import { createAuthorityProvisionerV2 } from "./provisioner.mjs";

export const ENTRYPOINT_VERSION = "v2-production-authority-entrypoint-v2-reader-clock";
export const READER_V2_PROTOCOL = "reader-attestation-channel-v2";
const unavailable = (reason) => Object.freeze({ available: false, reason, run: async () => Object.freeze({ ok: false, activated: false, probeReady: false, stage: "production_authority", reason }) });
const exSourceFail = (reason) => Object.freeze({ available: false, reason });
const readerProviderFail = (reason) => Object.freeze({ available: false, reason });
const BOUNDED_REASON = /^[a-z0-9_]{1,96}$/;
const NONCE = /^[0-9a-f]{32}$/;

export async function acquireExecutorAttestationSourceV2(trusted) {
  if (!trusted || typeof trusted !== "object" || Array.isArray(trusted) || Object.keys(trusted).sort().join(",") !== "env,provisioningConfig")
    return exSourceFail("executor_attestation_source_inputs_invalid");
  const { provisioningConfig: pc, env } = trusted;
  if (!env || typeof env !== "object" || !pc || pc.ok !== true || pc.version !== PROVISIONING_CONFIG_VERSION || !pc.executorAttester || !pc.readerAttester)
    return exSourceFail("executor_attestation_source_config_invalid");
  const ch = pc.executorAttester.channel, rch = pc.readerAttester.channel;
  if (!ch || !rch || ch.channelSecretEnvName !== EXECUTOR_ATTESTER_ENV.channelSecret || rch.channelSecretEnvName !== READER_ATTESTER_ENV.channelSecret)
    return exSourceFail("executor_attestation_source_config_invalid");
  if (typeof ch.host !== "string" || ch.host !== env[EXECUTOR_ATTESTER_ENV.host] || !Number.isInteger(ch.port) || String(ch.port) !== env[EXECUTOR_ATTESTER_ENV.port])
    return exSourceFail("executor_attestation_source_destination_mismatch");
  const channelSecret = env[ch.channelSecretEnvName];
  if (typeof channelSecret !== "string" || channelSecret === "") return exSourceFail("executor_attestation_source_channel_secret_absent");
  const readerChannelSecret = env[rch.channelSecretEnvName];
  if (typeof readerChannelSecret !== "string" || readerChannelSecret === "") return exSourceFail("executor_attestation_source_reader_channel_secret_absent");
  let r;
  try { r = createExecutorAttestationSourceChannel({ host: ch.host, port: ch.port, channelSecret, readerChannelSecret }, { offlineTestBoundary: false }); }
  catch { return exSourceFail("executor_attestation_source_construction_failed"); }
  if (!r || r.ok !== true) return exSourceFail(r && typeof r.reason === "string" && BOUNDED_REASON.test(r.reason) ? r.reason : "executor_attestation_source_rejected");
  if (!r.source || typeof r.source.obtain !== "function") return exSourceFail("executor_attestation_source_rejected");
  return Object.freeze({ available: true, source: r.source });
}

/** Build the trusted production reader-v2 provider. Construction performs no network/DB I/O. */
export function acquireReaderAttestationProviderV2(trusted) {
  if (!trusted || typeof trusted !== "object" || Array.isArray(trusted) || Object.keys(trusted).sort().join(",") !== "env,provisioningConfig")
    return readerProviderFail("reader_v2_provider_inputs_invalid");
  const acquireReader = acquireReaderV2Attestation;
  const { provisioningConfig: pc, env } = trusted;
  if (!env || typeof env !== "object" || !pc || pc.ok !== true || pc.version !== PROVISIONING_CONFIG_VERSION || !pc.readerAttester)
    return readerProviderFail("reader_v2_provider_config_invalid");
  const ch = pc.readerAttester.channel;
  if (!ch || ch.channelSecretEnvName !== READER_ATTESTER_ENV.channelSecret || !pc.readerAttester.trustRoot)
    return readerProviderFail("reader_v2_provider_config_invalid");
  if (typeof ch.host !== "string" || ch.host !== env[READER_ATTESTER_ENV.host] || !Number.isInteger(ch.port) || String(ch.port) !== env[READER_ATTESTER_ENV.port])
    return readerProviderFail("reader_v2_provider_destination_mismatch");
  const channelSecret = env[ch.channelSecretEnvName];
  if (typeof channelSecret !== "string" || channelSecret === "") return readerProviderFail("reader_v2_provider_channel_secret_absent");
  if (typeof pc.anchorClusterFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(pc.anchorClusterFingerprint))
    return readerProviderFail("reader_v2_provider_anchor_invalid");

  const provider = Object.freeze({
    async obtain(...args) {
      if (args.length !== 1 || !args[0] || typeof args[0] !== "object" || Array.isArray(args[0]) || Object.keys(args[0]).join(",") !== "session")
        return Object.freeze({ ok: false, reason: "reader_v2_provider_session_invalid" });
      const session = args[0].session;
      if (!session || !session.physical || typeof session.token !== "string") return Object.freeze({ ok: false, reason: "reader_v2_provider_session_invalid" });
      let r;
      try {
        r = await acquireReader({
          session,
          attester: { host: ch.host, port: ch.port },
          channelSecret,
          trustRoot: pc.readerAttester.trustRoot,
          anchorClusterFingerprint: pc.anchorClusterFingerprint,
          testBoundary: false,
        });
      } catch {
        return Object.freeze({ ok: false, reason: "reader_v2_acquisition_failed" });
      }
      if (!r || r.ok !== true) {
        const reason = r && typeof r.reason === "string" && BOUNDED_REASON.test(r.reason) ? r.reason : "reader_v2_acquisition_failed";
        return Object.freeze({ ok: false, reason });
      }
      if (r.protocol !== READER_V2_PROTOCOL) return Object.freeze({ ok: false, reason: "reader_v2_protocol_mismatch" });
      if (!r.envelope || typeof r.envelope !== "object" || !NONCE.test(r.requestNonce || "")) return Object.freeze({ ok: false, reason: "reader_v2_result_invalid" });
      return Object.freeze({ ok: true, envelope: r.envelope, requestNonce: r.requestNonce, protocol: r.protocol });
    },
  });
  return Object.freeze({ available: true, provider });
}

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
  const exSrc = await acquireExecutorAttestationSourceV2({ provisioningConfig: pc, env });
  if (!exSrc || exSrc.available !== true) return unavailable((exSrc && exSrc.reason) || "executor_attestation_source_rejected");
  const rd = acquireReaderAttestationProviderV2({ provisioningConfig: pc, env });
  if (!rd || rd.available !== true) return unavailable((rd && rd.reason) || "reader_v2_provider_rejected");
  const prov = createAuthorityProvisionerV2({
    provisioningConfig: pc, reviewerTrustRoot: rt.trustRoot, activationSourceProof: sp.proof, clock: makeProductionClock(),
    executorPhysicalFactory: makeExecutorPgPhysicalFactory({ env, connectionStringEnvName: pc.executorDbUrlEnvName }),
    readerPhysicalFactory: makePgPhysicalFactory({ env, connectionStringEnvName: pc.readerDbUrlEnvName }),
    executorAttestationSource: exSrc.source, readerAttestationProvider: rd.provider,
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
