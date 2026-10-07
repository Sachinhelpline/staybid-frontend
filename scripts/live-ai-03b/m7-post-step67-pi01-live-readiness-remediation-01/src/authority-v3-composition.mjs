// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — PI01 LIVE READINESS REMEDIATION 01 — DEPLOYABLE Authority V3 composition (exact additive bridge).
// OFFLINE candidate. Construction performs NO network and NO database I/O.
//
// Binds the ACCEPTED PI01 composition (composeProductionActivationBoundaryV3 — byte-identical, materialized from
// the authoritative preservation cbcb2689 into scripts/live-ai-03b/m7-post-step67-production-integration-01-runtime-01)
// to real production dependencies, built ONLY from validated V3 configuration:
//   • executorPhysicalFactory / readerPhysicalFactory — the frozen pg factories (executor-session / reader-session);
//   • executorAttestationSource — the V2 channel client (executor-attestation-channel-v2; no V1 client exists here);
//   • readerAttestationProvider — the frozen Step6/7 acquireReaderV2Attestation over the SAME reader session the
//     accepted PI01 core established (mirrors the accepted V2-era provider exactly, without importing the V2-era
//     entrypoint, whose graph also loads the V1 executor channel);
//   • executorTrustRoot (issuer == R3 V2 issuer, enforced by the config) / readerTrustRoot — pinned public roots;
//   • env — handed to the accepted PI01 core, which re-runs the frozen R3 loadRuntimeConfigV3 itself.
// It returns the accepted one-shot boundary UNCHANGED. It never calls run(); nothing here activates anything.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
import { composeProductionActivationBoundaryV3 } from "../../m7-post-step67-production-integration-01-runtime-01/src/production-composition.mjs";
import { PINNED_SUCCESSOR_RUNTIME_PIN_REF } from "../../m7-post-step67-production-integration-01-runtime-01/src/runtime-preservation-binding.mjs";
import { makeExecutorPgPhysicalFactory } from "../../m7-v2-production-authority-provisioning-offline-01/src/executor-session.mjs";
import { makePgPhysicalFactory } from "../../private-reader-production-integration-offline-01/reader-session.mjs";
import { acquireReaderV2Attestation, READER_PROTOCOL } from "../../m7-step67-authority-dedicated-reader-attester-offline-01/src/reader-v2-attestation-source.mjs";
import { loadAuthorityV3Config, AUTHORITY_V3_CONFIG_VERSION, EXECUTOR_ATTESTER_ENV, READER_ATTESTER_ENV } from "./authority-v3-config.mjs";
import { createExecutorAttestationSourceChannelV2 } from "./executor-attestation-channel-v2.mjs";

export const AUTHORITY_V3_COMPOSITION_VERSION = "pi01-authority-v3-composition-lrr01";
export const READER_V2_PROTOCOL = "reader-attestation-channel-v2";
if (READER_PROTOCOL !== READER_V2_PROTOCOL) throw new Error("reader_v2_protocol_constant_mismatch");
const BOUNDED_REASON = /^[a-z0-9_:]{1,96}$/;
const NONCE = /^[0-9a-f]{32}$/;
const unavailable = (reason) => Object.freeze({ available: false, reason: BOUNDED_REASON.test(String(reason)) ? String(reason) : "authority_v3_unavailable" });

/** V2 executor attestation source from validated V3 config. No I/O. */
export function acquireExecutorAttestationSourceV3({ env, config }) {
  if (!env || !config || config.ok !== true || config.version !== AUTHORITY_V3_CONFIG_VERSION) return unavailable("executor_attestation_source_config_invalid");
  const ch = config.executorAttester.channel, rch = config.readerAttester.channel;
  if (ch.channelSecretEnvName !== EXECUTOR_ATTESTER_ENV.channelSecret || rch.channelSecretEnvName !== READER_ATTESTER_ENV.channelSecret) return unavailable("executor_attestation_source_config_invalid");
  if (ch.host !== env[EXECUTOR_ATTESTER_ENV.host] || String(ch.port) !== env[EXECUTOR_ATTESTER_ENV.port]) return unavailable("executor_attestation_source_destination_mismatch");
  let r;
  try { r = createExecutorAttestationSourceChannelV2({ host: ch.host, port: ch.port, channelSecret: env[ch.channelSecretEnvName], readerChannelSecret: env[rch.channelSecretEnvName] }, { offlineTestBoundary: false }); }
  catch { return unavailable("executor_attestation_source_construction_failed"); }
  if (!r || r.ok !== true || !r.source || typeof r.source.obtain !== "function") return unavailable((r && r.reason) || "executor_attestation_source_rejected");
  return Object.freeze({ available: true, source: r.source });
}

/** Reader V2 provider over the frozen Step6/7 acquisition path (mirror of the accepted V2-era provider). No I/O. */
export function acquireReaderAttestationProviderV3({ env, config }, { acquire = acquireReaderV2Attestation } = {}) {
  if (!env || !config || config.ok !== true || config.version !== AUTHORITY_V3_CONFIG_VERSION) return unavailable("reader_v2_provider_config_invalid");
  const ch = config.readerAttester.channel;
  if (ch.channelSecretEnvName !== READER_ATTESTER_ENV.channelSecret || !config.readerAttester.trustRoot) return unavailable("reader_v2_provider_config_invalid");
  if (ch.host !== env[READER_ATTESTER_ENV.host] || String(ch.port) !== env[READER_ATTESTER_ENV.port]) return unavailable("reader_v2_provider_destination_mismatch");
  const channelSecret = env[ch.channelSecretEnvName];
  if (typeof channelSecret !== "string" || channelSecret === "") return unavailable("reader_v2_provider_channel_secret_absent");
  if (typeof config.anchorClusterFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(config.anchorClusterFingerprint)) return unavailable("reader_v2_provider_anchor_invalid");
  const provider = Object.freeze({
    async obtain(...args) {
      if (args.length !== 1 || !args[0] || typeof args[0] !== "object" || Array.isArray(args[0]) || Object.keys(args[0]).join(",") !== "session")
        return Object.freeze({ ok: false, reason: "reader_v2_provider_session_invalid" });
      const session = args[0].session;
      if (!session || !session.physical || typeof session.token !== "string") return Object.freeze({ ok: false, reason: "reader_v2_provider_session_invalid" });
      let r;
      try {
        r = await acquire({ session, attester: { host: ch.host, port: ch.port }, channelSecret, trustRoot: config.readerAttester.trustRoot,
          anchorClusterFingerprint: config.anchorClusterFingerprint, testBoundary: false });
      } catch { return Object.freeze({ ok: false, reason: "reader_v2_acquisition_failed" }); }
      if (!r || r.ok !== true) return Object.freeze({ ok: false, reason: r && typeof r.reason === "string" && BOUNDED_REASON.test(r.reason) ? r.reason : "reader_v2_acquisition_failed" });
      if (r.protocol !== READER_V2_PROTOCOL) return Object.freeze({ ok: false, reason: "reader_v2_protocol_mismatch" });
      if (!r.envelope || typeof r.envelope !== "object" || !NONCE.test(r.requestNonce || "")) return Object.freeze({ ok: false, reason: "reader_v2_result_invalid" });
      return Object.freeze({ ok: true, envelope: r.envelope, requestNonce: r.requestNonce, protocol: r.protocol });
    },
  });
  return Object.freeze({ available: true, provider });
}

/**
 * Compose the deployable Authority V3 activation boundary. Production accepts ONLY { env }.
 * Returns { available:false, reason } or { available:true, boundary, successorRuntimePinRef } — the boundary is the
 * accepted PI01 one-shot object, returned unchanged and NOT invoked.
 */
export function composeAuthorityV3(opts = {}) {
  if (!opts || typeof opts !== "object" || Array.isArray(opts) || Object.keys(opts).some((k) => k !== "env")) return unavailable("authority_v3_rejects_injection");
  const env = opts.env;
  if (!env || typeof env !== "object") return unavailable("env_absent");
  const config = loadAuthorityV3Config(env, { testBoundary: false });
  if (!config.ok) return unavailable(config.reason);
  const exSrc = acquireExecutorAttestationSourceV3({ env, config });
  if (exSrc.available !== true) return unavailable(exSrc.reason);
  const rd = acquireReaderAttestationProviderV3({ env, config });
  if (rd.available !== true) return unavailable(rd.reason);
  let boundary;
  try {
    boundary = composeProductionActivationBoundaryV3({
      env,
      executorAttestationSource: exSrc.source,
      executorPhysicalFactory: makeExecutorPgPhysicalFactory({ env, connectionStringEnvName: config.executorDbUrlEnvName }),
      executorTrustRoot: config.executorAttester.trustRoot,
      readerAttestationProvider: rd.provider,
      readerPhysicalFactory: makePgPhysicalFactory({ env, connectionStringEnvName: config.readerDbUrlEnvName }),
      readerTrustRoot: config.readerAttester.trustRoot,
    });
  } catch { return unavailable("pi01_composition_threw"); }
  if (!boundary || boundary.available !== true) return unavailable((boundary && boundary.reason) || "pi01_composition_unavailable");
  if (boundary.successorRuntimePinRef !== PINNED_SUCCESSOR_RUNTIME_PIN_REF) return unavailable("successor_runtime_pin_ref_mismatch");
  return Object.freeze({ available: true, boundary, successorRuntimePinRef: boundary.successorRuntimePinRef, mode: boundary.mode });
}
