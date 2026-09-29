// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 V2 PRODUCTION AUTHORITY PROVISIONING — non-secret configuration loader. OFFLINE candidate.
// Node built-ins only. It returns env NAMES, non-secret public identifiers and pinned PUBLIC keys only.
//
// Composes (never edits) the preserved Step-2 V2 config contract (loadRuntimeConfigV2, PIN-C 0afe4b6b) and the
// accepted attester trust-root primitive (makeAttesterTrustRoot). Adds:
//   • an explicit forbidden-secret-class screen for the executor authority process (provider / gateway /
//     gateway-store / CORE / reviewer-private / superuser credentials) — presence ⇒ fail closed;
//   • two DISTINCT restricted DB credential references (executor ≠ reader), compared only by digest inside the
//     trusted process (values are never returned, logged or placed in an error);
//   • the two independent attester trust roots (reader: the accepted AiStagingReaderAttestationV1 issuer;
//     executor: the AiStagingExecutorAttestationV1 issuer) and their deployment-owned channel destinations.
// ─────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { loadRuntimeConfigV2, REQUIRED_ENV_NAMES_V2, FORBIDDEN_ENV_NAMES_V2 } from "../../m7-step2-runtime-rebinding-offline-01/runtime/v2-runtime-config.mjs";
import { makeAttesterTrustRoot } from "../../private-reader-production-integration-offline-01/reader-attestation.mjs";
import { validateAttesterChannelConfig } from "../../private-reader-production-integration-offline-01/attestation-source-channel.mjs";
import { ENV as READER_INTEGRATION_ENV } from "../../private-reader-production-integration-offline-01/integration-config.mjs";

export const PROVISIONING_CONFIG_VERSION = "v2-production-authority-provisioning-config-v1";

/** Executor-attestation issuer (independent, Owner-controlled; NOT the executor process). Names only. */
export const EXECUTOR_ATTESTER_ENV = Object.freeze({
  issuer: "LIVE_AI_03B_EXECUTOR_ATTESTER_ISSUER",
  publicKeyDerB64: "LIVE_AI_03B_EXECUTOR_ATTESTER_PUBKEY_DER_B64",
  fingerprint: "LIVE_AI_03B_EXECUTOR_ATTESTER_FINGERPRINT",
  host: "LIVE_AI_03B_EXECUTOR_ATTESTER_HOST",
  port: "LIVE_AI_03B_EXECUTOR_ATTESTER_PORT",
  channelSecret: "LIVE_AI_03B_EXECUTOR_ATTESTER_CHANNEL_SECRET", // SECRET (channel HMAC key) — value never returned
});
/** Reader-attestation issuer — the ACCEPTED env names of the private-reader integration (reused, not redefined). */
export const READER_ATTESTER_ENV = Object.freeze({
  issuer: READER_INTEGRATION_ENV.attesterIssuer,
  publicKeyDerB64: READER_INTEGRATION_ENV.attesterPublicKeyDerB64,
  fingerprint: READER_INTEGRATION_ENV.attesterFingerprint,
  host: READER_INTEGRATION_ENV.attesterHost,
  port: READER_INTEGRATION_ENV.attesterPort,
  channelSecret: READER_INTEGRATION_ENV.attesterChannelSecret,
});
export const EXECUTOR_STATEMENT_TIMEOUT_ENV = "LIVE_AI_03B_EXECUTOR_STATEMENT_TIMEOUT_MS";

/**
 * Secret classes that must NEVER be present in the executor authority environment. Exact names (frozen V2 list
 * + gateway / gateway-store / broker / reader-host / superuser credentials) and name patterns.
 */
export const FORBIDDEN_ENV_NAMES = Object.freeze([
  ...FORBIDDEN_ENV_NAMES_V2,                       // OPENAI_API_KEY, LIVE_AI_SESSION_SIGNING_PRIVATE_KEY, LIVE_AI_03B_REVIEWER_PRIVATE_KEY, CORE_DATABASE_URL
  "LIVE_AI_03B_STAGING_DATABASE_URL",              // gateway-store credential
  "LIVE_AI_CONTROL_TOKEN_SECRET", "LIVE_AI_KILL_SWITCH_HMAC_SECRET", "LIVE_AI_IP_HASH_SALT", // gateway secrets
  "LIVE_AI_03B_STAGING_SUBJECT_HMAC_SECRET",       // broker secret
  "LIVE_AI_03B_READER_TRANSPORT_SECRET",           // reader-host caller-auth secret
  "DATABASE_URL", "DATABASE_PUBLIC_URL", "PGPASSWORD", "POSTGRES_PASSWORD", "PGUSER", // superuser / platform DB credentials
]);
export const FORBIDDEN_ENV_PATTERNS = Object.freeze([/PRIVATE_KEY/, /^OPENAI_.*(KEY|TOKEN|SECRET)/, /^CORE_/, /GATEWAY.*(SECRET|KEY)/]);

const present = (env, n) => typeof env[n] === "string" && env[n].trim() !== "";
const fail = (reason, extra) => ({ ok: false, reason, ...(extra || {}) });
const digestOf = (v) => createHash("sha256").update(String(v), "utf8").digest("hex");

export function screenForbiddenSecrets(env) {
  for (const n of FORBIDDEN_ENV_NAMES) if (present(env, n)) return fail("forbidden_secret_class_present");
  for (const n of Object.keys(env)) if (present(env, n) && FORBIDDEN_ENV_PATTERNS.some((re) => re.test(n))) return fail("forbidden_secret_class_present");
  return { ok: true };
}

function attesterRole(env, names, { allowTestIssuer, offlineTestBoundary }) {
  const req = [names.issuer, names.publicKeyDerB64, names.fingerprint, names.host, names.port, names.channelSecret];
  const missing = req.filter((n) => !present(env, n));
  if (missing.length) return fail("attester_config_incomplete", { missing });
  const tr = makeAttesterTrustRoot({ issuer: env[names.issuer], publicKeyDerB64: env[names.publicKeyDerB64], fingerprint: env[names.fingerprint] }, { allowTestIssuer });
  if (!tr.ok) return fail(tr.reason);
  const port = /^[0-9]{1,5}$/.test(env[names.port]) ? Number(env[names.port]) : NaN;
  const ch = validateAttesterChannelConfig({ host: env[names.host], port, channelSecret: env[names.channelSecret] }, { offlineTestBoundary });
  if (!ch.ok) return fail(ch.reason);
  return { ok: true, trustRoot: tr.trustRoot, channel: Object.freeze({ host: env[names.host], port, channelSecretEnvName: names.channelSecret }) };
}

/**
 * Load + validate the provisioning configuration (NO I/O, no secret value returned).
 * opts.testBoundary:true only inside the explicit offline test boundary (TEST-ONLY issuers + loopback channels).
 */
export function loadProvisioningConfig(env, opts) {
  const testBoundary = !!(opts && opts.testBoundary === true);
  if (!env || typeof env !== "object") return fail("env_absent");
  const fs = screenForbiddenSecrets(env); if (!fs.ok) return fs;
  const cfg = loadRuntimeConfigV2(env);
  if (!cfg.ok) return fail("runtime_config_v2_" + cfg.reason, cfg.missing ? { missing: cfg.missing } : undefined);
  const exName = REQUIRED_ENV_NAMES_V2.executorDbUrl, rdName = REQUIRED_ENV_NAMES_V2.readerDbUrl;
  // distinct credential identities (compared only by digest; the values never leave this function)
  if (digestOf(env[exName]) === digestOf(env[rdName])) return fail("executor_and_reader_share_a_credential");
  const ex = attesterRole(env, EXECUTOR_ATTESTER_ENV, { allowTestIssuer: testBoundary, offlineTestBoundary: testBoundary });
  if (!ex.ok) return fail("executor_" + ex.reason, ex.missing ? { missing: ex.missing } : undefined);
  const rd = attesterRole(env, READER_ATTESTER_ENV, { allowTestIssuer: testBoundary, offlineTestBoundary: testBoundary });
  if (!rd.ok) return fail("reader_" + rd.reason, rd.missing ? { missing: rd.missing } : undefined);
  // the frozen V2 config's connection-identity proof reference must name the executor-attestation issuer
  if (cfg.secretRefs.connectionIdentityProofRef !== ex.trustRoot.issuer) return fail("connection_identity_proof_ref_not_executor_issuer");
  if (ex.channel.channelSecretEnvName === rd.channel.channelSecretEnvName) return fail("attester_channel_secret_name_shared");
  if (env[EXECUTOR_ATTESTER_ENV.channelSecret] === env[READER_ATTESTER_ENV.channelSecret]) return fail("attester_channel_secret_reused");
  let exTimeout = 10000;
  if (present(env, EXECUTOR_STATEMENT_TIMEOUT_ENV)) {
    exTimeout = /^[0-9]{1,5}$/.test(env[EXECUTOR_STATEMENT_TIMEOUT_ENV]) ? Number(env[EXECUTOR_STATEMENT_TIMEOUT_ENV]) : NaN;
    if (!Number.isInteger(exTimeout) || exTimeout < 1000 || exTimeout > 15000) return fail("executor_statement_timeout_invalid");
  }
  return Object.freeze({
    ok: true, version: PROVISIONING_CONFIG_VERSION, cfg,
    executorDbUrlEnvName: exName, readerDbUrlEnvName: rdName, executorStatementTimeoutMs: exTimeout, readerStatementTimeoutMs: 2000,
    executorAttester: Object.freeze({ trustRoot: ex.trustRoot, channel: ex.channel }),
    readerAttester: Object.freeze({ trustRoot: rd.trustRoot, channel: rd.channel }),
  });
}
