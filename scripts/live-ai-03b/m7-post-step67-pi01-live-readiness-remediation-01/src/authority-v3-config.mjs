// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — PI01 LIVE READINESS REMEDIATION 01 — Authority V3 STATIC configuration (no I/O). OFFLINE.
//
// The V2-era loader (m7-v2-production-authority-provisioning-offline-01/src/provisioning-config.mjs) is bound to
// loadRuntimeConfigV2 (contract "V2") and accepts any executor-attester issuer string, so it can never configure the
// accepted V3 runtime. This loader composes ONLY accepted pieces, unchanged:
//   • the frozen R3 loadRuntimeConfigV3 (contract "V3", AI-STAGING targets, reviewer root, and
//     LIVE_AI_03B_CONNECTION_IDENTITY_PROOF_REF == staybid.live-ai-03b.executor-attester.v2);
//   • the frozen forbidden-secret screen; the frozen deployment-anchor parser; the frozen attester trust-root and
//     private-destination validators; the frozen Railway-internal name rule;
// and adds the V3 binding rules: the executor-attester trust root issuer MUST be exactly the R3 V2 issuer (no V1
// trust root can be configured), both attester destinations MUST be `*.railway.internal`, the executor and reader DB
// credentials must be distinct, the two channel secrets must differ. Secret VALUES are compared by digest only and
// are never returned or logged; only env NAMES and public material leave this module.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { loadRuntimeConfigV3, REQUIRED_ENV as V3_REQUIRED_ENV }
  from "../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/v3-runtime-config.mjs";
import { EXECUTOR_ATTESTATION_ISSUER_V2 } from "../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/executor-attestation-v2.mjs";
import { screenForbiddenSecrets, EXECUTOR_ATTESTER_ENV, READER_ATTESTER_ENV, DEPLOYMENT_ANCHOR_ENV }
  from "../../m7-v2-production-authority-provisioning-offline-01/src/provisioning-config.mjs";
import { REQUIRED_ENV_NAMES_V2 } from "../../m7-step2-runtime-rebinding-offline-01/runtime/v2-runtime-config.mjs";
import { makeAttesterTrustRoot } from "../../private-reader-production-integration-offline-01/reader-attestation.mjs";
import { validateAttesterChannelConfig } from "../../private-reader-production-integration-offline-01/attestation-source-channel.mjs";
import { RAILWAY_INTERNAL_RE } from "../../private-reader-bootstrap-clock-peer-offline-01/private-peer-resolver.mjs";
import { parseDeploymentAnchor } from "../../private-reader-attester-offline-01/target-binding.mjs";

export const AUTHORITY_V3_CONFIG_VERSION = "pi01-authority-v3-config-lrr01";
export const DB_ENV = Object.freeze({ executorDbUrl: REQUIRED_ENV_NAMES_V2.executorDbUrl, readerDbUrl: REQUIRED_ENV_NAMES_V2.readerDbUrl });
export { EXECUTOR_ATTESTER_ENV, READER_ATTESTER_ENV, DEPLOYMENT_ANCHOR_ENV, V3_REQUIRED_ENV };
/** Every env NAME the deployable V3 Authority requires (values never read by the standby status path). */
export const REQUIRED_AUTHORITY_V3_NAMES = Object.freeze([...new Set([
  ...Object.values(V3_REQUIRED_ENV), DB_ENV.executorDbUrl, DB_ENV.readerDbUrl, DEPLOYMENT_ANCHOR_ENV,
  ...Object.values(EXECUTOR_ATTESTER_ENV), ...Object.values(READER_ATTESTER_ENV),
])].sort());
export const SECRET_AUTHORITY_V3_NAMES = Object.freeze([DB_ENV.executorDbUrl, DB_ENV.readerDbUrl, EXECUTOR_ATTESTER_ENV.channelSecret, READER_ATTESTER_ENV.channelSecret].sort());

const present = (env, n) => typeof env[n] === "string" && env[n].trim() !== "";
const fail = (reason, extra) => ({ ok: false, reason, ...(extra || {}) });
const digestOf = (v) => createHash("sha256").update(String(v), "utf8").digest("hex");
const parsePort = (v) => (typeof v === "string" && /^[0-9]{1,5}$/.test(v) ? Number(v) : NaN);

function attester(env, names, { testBoundary }) {
  const tr = makeAttesterTrustRoot({ issuer: env[names.issuer], publicKeyDerB64: env[names.publicKeyDerB64], fingerprint: env[names.fingerprint] }, { allowTestIssuer: testBoundary });
  if (!tr.ok) return fail(tr.reason);
  const port = parsePort(env[names.port]);
  const ch = validateAttesterChannelConfig({ host: env[names.host], port, channelSecret: env[names.channelSecret] }, { offlineTestBoundary: testBoundary });
  if (!ch.ok) return fail(ch.reason);
  const host = env[names.host];
  if (!testBoundary && !RAILWAY_INTERNAL_RE.test(host)) return fail("attester_host_not_railway_internal");
  if (testBoundary && !(RAILWAY_INTERNAL_RE.test(host) || host === "127.0.0.1" || host === "::1")) return fail("attester_host_not_test_or_railway_internal");
  return { ok: true, trustRoot: tr.trustRoot, channel: Object.freeze({ host, port, channelSecretEnvName: names.channelSecret }) };
}

/**
 * Fail-closed STATIC load. `testBoundary` is the ONLY way to accept TEST-ONLY attester issuers and loopback
 * destinations (offline tests); production refuses both. The executor trust root must be the R3 V2 issuer in BOTH
 * modes (there is no test exception for the V2 contract binding).
 */
export function loadAuthorityV3Config(env, { testBoundary = false } = {}) {
  if (!env || typeof env !== "object" || Array.isArray(env)) return fail("env_absent");
  const fs = screenForbiddenSecrets(env); if (!fs.ok) return fail(fs.reason);
  const missing = REQUIRED_AUTHORITY_V3_NAMES.filter((n) => !present(env, n));
  if (missing.length) return fail("authority_v3_config_incomplete", { missing });
  const v3 = loadRuntimeConfigV3(env);
  if (!v3 || v3.ok !== true) return fail("runtime_config_v3_" + ((v3 && v3.reason) || "rejected"));
  const parsed = parseDeploymentAnchor(env[DEPLOYMENT_ANCHOR_ENV]);
  if (!parsed.ok) return fail("reader_v2_" + parsed.reason);
  const anchor = parsed.anchor;
  if (anchor.projectId !== v3.targets.project || anchor.environmentId !== v3.targets.environment || anchor.pgServiceId !== v3.targets.pg) return fail("reader_v2_anchor_target_mismatch");
  if (typeof anchor.clusterFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(anchor.clusterFingerprint)) return fail("reader_v2_anchor_fingerprint_invalid");
  if (digestOf(env[DB_ENV.executorDbUrl]) === digestOf(env[DB_ENV.readerDbUrl])) return fail("executor_and_reader_share_a_credential");

  const ex = attester(env, EXECUTOR_ATTESTER_ENV, { testBoundary });
  if (!ex.ok) return fail("executor_" + ex.reason);
  if (ex.trustRoot.issuer !== EXECUTOR_ATTESTATION_ISSUER_V2) return fail("executor_attester_issuer_not_v2");
  if (v3.connectionIdentityProofRef !== ex.trustRoot.issuer) return fail("connection_identity_proof_ref_not_executor_issuer");
  const rd = attester(env, READER_ATTESTER_ENV, { testBoundary });
  if (!rd.ok) return fail("reader_" + rd.reason);
  if (rd.trustRoot.issuer === ex.trustRoot.issuer) return fail("reader_and_executor_attester_issuer_shared");
  if (rd.trustRoot.fingerprint === ex.trustRoot.fingerprint) return fail("reader_and_executor_attester_key_shared");
  if (env[EXECUTOR_ATTESTER_ENV.channelSecret] === env[READER_ATTESTER_ENV.channelSecret]) return fail("attester_channel_secret_reused");

  return Object.freeze({
    ok: true, version: AUTHORITY_V3_CONFIG_VERSION, runtime: v3,
    executorDbUrlEnvName: DB_ENV.executorDbUrl, readerDbUrlEnvName: DB_ENV.readerDbUrl,
    executorAttester: Object.freeze({ trustRoot: ex.trustRoot, channel: ex.channel }),
    readerAttester: Object.freeze({ trustRoot: rd.trustRoot, channel: rd.channel }),
    anchorClusterFingerprint: anchor.clusterFingerprint,
  });
}
