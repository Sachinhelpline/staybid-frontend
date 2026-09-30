// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 V2 EXECUTOR ATTESTATION ISSUER — non-secret configuration contract. OFFLINE candidate.
//
// A SEPARATE authority plane from the accepted reader attester (private-reader-attester-offline-01, untouched): its
// own issuer identity, its own Ed25519 signing key, its own channel secret, its own observer credential name, its
// own deployment anchor and its own request protocol. Validation is STATIC (no I/O): it runs before any database
// connection or listener exists. Secret VALUES are never returned — only their env NAMES — and never logged.
//
// Compatibility with the PRESERVED authority package: the names the authority already expects
// (LIVE_AI_03B_EXECUTOR_ATTESTER_{ISSUER,PUBKEY_DER_B64,FINGERPRINT,PORT,CHANNEL_SECRET}) are imported from it and
// used unchanged, so the same values configure both ends. HOST on the authority side is the DESTINATION name; the
// service binds to its own BIND_HOST.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
import { validateAttesterListen } from "../../private-reader-attester-offline-01/attester-config.mjs";
import { ATTESTER_ID as READER_ATTESTER_ID, ENV as READER_ATTESTER_SERVICE_ENV } from "../../private-reader-attester-offline-01/attester-config.mjs";
import { MIN_CHANNEL_SECRET_LEN } from "../../private-reader-production-integration-offline-01/attestation-source-channel.mjs";
import { ATTESTATION_MAX_LIFETIME_MS, TEST_ISSUER_PREFIX } from "../../private-reader-production-integration-offline-01/reader-attestation.mjs";
import { ENV as READER_INTEGRATION_ENV } from "../../private-reader-production-integration-offline-01/integration-config.mjs";
import { EXECUTOR_ATTESTER_ENV as AUTHORITY_EXECUTOR_ATTESTER_ENV } from "../../m7-v2-production-authority-provisioning-offline-01/src/provisioning-config.mjs";
import { REQUIRED_ENV_NAMES_V2 } from "../../m7-step2-runtime-rebinding-offline-01/runtime/v2-runtime-config.mjs";
import { parseExecutorDeploymentAnchor } from "./executor-target-binding.mjs";

export const EXECUTOR_ATTESTER_ID = "live-ai-03b-executor-attester";
export const EXECUTOR_ATTESTER_CONFIG_VERSION = "executor-attester-config-v1";
export const DEFAULT_PROOF_LIFETIME_MS = 120000;

export const ENV = Object.freeze({
  // shared with the PRESERVED authority package (same names, same values on both ends)
  issuer: AUTHORITY_EXECUTOR_ATTESTER_ENV.issuer,                   // LIVE_AI_03B_EXECUTOR_ATTESTER_ISSUER (non-secret)
  publicKeyDerB64: AUTHORITY_EXECUTOR_ATTESTER_ENV.publicKeyDerB64, // LIVE_AI_03B_EXECUTOR_ATTESTER_PUBKEY_DER_B64 (non-secret; self-consistency)
  fingerprint: AUTHORITY_EXECUTOR_ATTESTER_ENV.fingerprint,         // LIVE_AI_03B_EXECUTOR_ATTESTER_FINGERPRINT (non-secret; self-consistency)
  port: AUTHORITY_EXECUTOR_ATTESTER_ENV.port,                       // LIVE_AI_03B_EXECUTOR_ATTESTER_PORT (listen port = authority destination port)
  channelSecret: AUTHORITY_EXECUTOR_ATTESTER_ENV.channelSecret,     // LIVE_AI_03B_EXECUTOR_ATTESTER_CHANNEL_SECRET (SECRET)
  // service-side only
  signingKeyPkcs8B64: "LIVE_AI_03B_EXECUTOR_ATTESTER_SIGNING_KEY_PKCS8_B64", // SECRET: this issuer's OWN Ed25519 private key
  observerDbUrl: "LIVE_AI_03B_EXECUTOR_ATTESTER_OBSERVER_DB_URL",           // SECRET: least-privilege observer credential
  bindHost: "LIVE_AI_03B_EXECUTOR_ATTESTER_BIND_HOST",
  allowedPeerCidrs: "LIVE_AI_03B_EXECUTOR_ATTESTER_ALLOWED_PEER_CIDRS",
  allowWildcardBind: "LIVE_AI_03B_EXECUTOR_ATTESTER_ALLOW_WILDCARD_BIND",
  proofLifetimeMs: "LIVE_AI_03B_EXECUTOR_ATTESTER_PROOF_LIFETIME_MS",
  deploymentAnchor: "LIVE_AI_03B_EXECUTOR_ATTESTER_DEPLOYMENT_ANCHOR",      // Owner-issued AiStagingExecutorDeploymentAnchorV1 (JSON, non-secret)
  // non-secret identity of the ACCEPTED reader attester — this issuer must be provably DISTINCT from it
  readerAttesterIssuer: "LIVE_AI_03B_EXECUTOR_ATTESTER_DISTINCT_READER_ISSUER",
  readerAttesterFingerprint: "LIVE_AI_03B_EXECUTOR_ATTESTER_DISTINCT_READER_FINGERPRINT",
});
export const SECRET_ENV_NAMES = Object.freeze([ENV.channelSecret, ENV.signingKeyPkcs8B64, ENV.observerDbUrl]);

/**
 * Credentials this service must NEVER hold (presence ⇒ fail closed before any I/O): the executor and reader DB
 * credentials, the gateway-store credential, the reader-host transport secret, EVERY reader-attester secret (its
 * signing key, its observer credential, its channel secret — the executor attester is a separate authority plane),
 * provider / reviewer / session signing keys, gateway and broker secrets, CORE and platform superuser credentials.
 */
export const FORBIDDEN_ENV_NAMES = Object.freeze([
  REQUIRED_ENV_NAMES_V2.executorDbUrl,                // LIVE_AI_03B_TRUSTED_EXECUTOR_DB_URL
  REQUIRED_ENV_NAMES_V2.readerDbUrl,                  // LIVE_AI_03B_TRUSTED_READER_DB_URL
  "LIVE_AI_03B_STAGING_DATABASE_URL",                 // gateway-store credential
  "LIVE_AI_03B_READER_TRANSPORT_SECRET",              // reader-host caller-auth secret
  READER_ATTESTER_SERVICE_ENV.signingKeyPkcs8B64,     // LIVE_AI_03B_ATTESTER_SIGNING_KEY_PKCS8_B64 (reader attester key)
  READER_ATTESTER_SERVICE_ENV.observerDbUrl,          // LIVE_AI_03B_ATTESTER_OBSERVER_DB_URL (reader attester observer)
  READER_ATTESTER_SERVICE_ENV.channelSecret,          // LIVE_AI_03B_READER_ATTESTER_CHANNEL_SECRET
  READER_INTEGRATION_ENV.attesterChannelSecret,       // (same name, listed explicitly)
  "OPENAI_API_KEY", "LIVE_AI_SESSION_SIGNING_PRIVATE_KEY", "LIVE_AI_03B_REVIEWER_PRIVATE_KEY", "CORE_DATABASE_URL",
  "LIVE_AI_CONTROL_TOKEN_SECRET", "LIVE_AI_KILL_SWITCH_HMAC_SECRET", "LIVE_AI_IP_HASH_SALT",
  "LIVE_AI_03B_STAGING_SUBJECT_HMAC_SECRET",
  "DATABASE_URL", "DATABASE_PUBLIC_URL", "PGPASSWORD", "POSTGRES_PASSWORD", "PGUSER",
]);
export const FORBIDDEN_ENV_PATTERNS = Object.freeze([/PRIVATE_KEY/, /^OPENAI_/, /^ANTHROPIC_.*(KEY|TOKEN|SECRET)/, /^CORE_/, /GATEWAY.*(SECRET|KEY)/]);

const present = (env, n) => typeof env[n] === "string" && env[n].trim() !== "";
const fail = (reason, extra) => ({ ok: false, reason, ...(extra || {}) });
const HEX64 = /^[0-9a-f]{64}$/;
const ISSUER_RE = /^[A-Za-z0-9._:-]{3,128}$/;

/** Returns the reason code of the first foreign credential present, or null. Never returns a value. */
export function screenForeignCredentials(env) {
  for (const n of FORBIDDEN_ENV_NAMES) if (present(env, n)) return "foreign_credential_present";
  for (const n of Object.keys(env)) if (present(env, n) && FORBIDDEN_ENV_PATTERNS.some((re) => re.test(n))) return "foreign_credential_present";
  return null;
}

/**
 * Fail-closed STATIC configuration load (no I/O). Returns non-secret values + secret env NAMES only.
 * `offlineTestBoundary` is the only way to accept a TEST-ONLY issuer, a TEST-ONLY anchor verifier, or a loopback
 * listener/peer; production refuses all three.
 */
export function loadExecutorAttesterConfig(env, { offlineTestBoundary = false } = {}) {
  if (!env || typeof env !== "object") return fail("env_absent");
  const foreign = screenForeignCredentials(env);
  if (foreign) return fail(foreign);
  const required = [ENV.issuer, ENV.publicKeyDerB64, ENV.fingerprint, ENV.port, ENV.channelSecret, ENV.signingKeyPkcs8B64, ENV.observerDbUrl,
    ENV.bindHost, ENV.allowedPeerCidrs, ENV.deploymentAnchor, ENV.readerAttesterIssuer, ENV.readerAttesterFingerprint];
  const missing = required.filter((n) => !present(env, n));
  if (missing.length) return fail("executor_attester_config_incomplete", { missing });

  const issuer = env[ENV.issuer];
  if (!ISSUER_RE.test(issuer)) return fail("issuer_invalid");
  if (!offlineTestBoundary && issuer.startsWith(TEST_ISSUER_PREFIX)) return fail("issuer_test_only_refused");
  const readerIssuer = env[ENV.readerAttesterIssuer];
  if (!ISSUER_RE.test(readerIssuer)) return fail("reader_attester_issuer_invalid");
  if (issuer === readerIssuer || issuer === READER_ATTESTER_ID) return fail("issuer_not_distinct_from_reader_attester");
  const fingerprint = env[ENV.fingerprint], readerFingerprint = env[ENV.readerAttesterFingerprint];
  if (!HEX64.test(fingerprint)) return fail("fingerprint_malformed");
  if (!HEX64.test(readerFingerprint)) return fail("reader_attester_fingerprint_malformed");
  if (fingerprint === readerFingerprint) return fail("signing_key_not_distinct_from_reader_attester");
  if (env[ENV.channelSecret].length < MIN_CHANNEL_SECRET_LEN) return fail("channel_secret_invalid");

  const port = /^[0-9]{1,5}$/.test(env[ENV.port]) ? Number(env[ENV.port]) : NaN;
  const listen = { bindHost: env[ENV.bindHost], port, allowWildcardBind: env[ENV.allowWildcardBind] === "true",
    allowedPeerCidrs: env[ENV.allowedPeerCidrs].split(",").map((x) => x.trim()).filter((x) => x.length > 0) };
  const lv = validateAttesterListen(listen, { offlineTestBoundary });
  if (!lv.ok) return fail(lv.reason);

  let proofLifetimeMs = DEFAULT_PROOF_LIFETIME_MS;
  if (present(env, ENV.proofLifetimeMs)) {
    proofLifetimeMs = /^[0-9]{1,7}$/.test(env[ENV.proofLifetimeMs]) ? Number(env[ENV.proofLifetimeMs]) : NaN;
    if (!Number.isInteger(proofLifetimeMs) || proofLifetimeMs < 1000 || proofLifetimeMs > ATTESTATION_MAX_LIFETIME_MS) return fail("proof_lifetime_invalid");
  }
  const anchor = parseExecutorDeploymentAnchor(env[ENV.deploymentAnchor], { offlineTestBoundary });
  if (!anchor.ok) return fail(anchor.reason);

  return {
    ok: true, version: EXECUTOR_ATTESTER_CONFIG_VERSION, issuer, fingerprint, publicKeyDerB64: env[ENV.publicKeyDerB64],
    readerAttester: Object.freeze({ issuer: readerIssuer, fingerprint: readerFingerprint }),
    listen: Object.freeze(listen), proofLifetimeMs, anchor: anchor.anchor,
    secretRefs: Object.freeze({ channelSecretEnvName: ENV.channelSecret, signingKeyEnvName: ENV.signingKeyPkcs8B64, observerDbUrlEnvName: ENV.observerDbUrl }),
  };
}
