// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — INDEPENDENT ATTESTER: non-secret configuration contract (OFFLINE). Node built-ins only.
//
// The attester is the Owner-controlled authority that lives OUTSIDE the reader host, the gateway, the
// probe and the activation executor. This module validates its deployment-owned configuration by env
// NAME. It returns NO secret value: the observer DB URL and the Ed25519 signing key are read only at the
// point of use, and the channel secret only when the request handler is constructed.
//
// Reader-host-facing identifiers (issuer, keyId) are the attester's OWN identity; the reader host pins
// them separately in ITS configuration. Nothing here can weaken the reader host's verification.
// ─────────────────────────────────────────────────────────────────────────
import { validateListenConfig } from "../private-reader-host-runtime-offline-01/observation-transport.mjs";
import { MIN_CHANNEL_SECRET_LEN } from "../private-reader-production-integration-offline-01/attestation-source-channel.mjs";
import { ATTESTATION_MAX_LIFETIME_MS } from "../private-reader-production-integration-offline-01/reader-attestation.mjs";
import { FIXED } from "../trusted-activation-boundary-01/pricing-approval-contract.mjs";

export const ATTESTER_ID = "live-ai-03b-reader-attester";
export const ENV = Object.freeze({
  observerDbUrl: "LIVE_AI_03B_ATTESTER_OBSERVER_DB_URL",       // SECRET: least-privilege observer role
  signingKeyPkcs8B64: "LIVE_AI_03B_ATTESTER_SIGNING_KEY_PKCS8_B64", // SECRET: Ed25519 private key (attester only)
  issuer: "LIVE_AI_03B_ATTESTER_ISSUER",                       // non-secret issuer id (the reader host pins it)
  bindHost: "LIVE_AI_03B_ATTESTER_BIND_HOST",                  // private bind address (:: allowed with the ack below)
  port: "LIVE_AI_03B_ATTESTER_PORT",                           // decimal 1..65535
  allowedPeerCidrs: "LIVE_AI_03B_ATTESTER_ALLOWED_PEER_CIDRS", // private CIDRs of the permitted reader host
  allowWildcardBind: "LIVE_AI_03B_ATTESTER_ALLOW_WILDCARD_BIND", // exactly "true"
  channelSecret: "LIVE_AI_03B_READER_ATTESTER_CHANNEL_SECRET", // SECRET: shared with the reader host ONLY
  proofLifetimeMs: "LIVE_AI_03B_ATTESTER_PROOF_LIFETIME_MS",   // optional; default 120000; max 300000
  deploymentAnchorRef: "LIVE_AI_03B_ATTESTER_DEPLOYMENT_ANCHOR", // optional: future verified target anchor (see target-binding.mjs)
});
// Credentials the attester must NEVER hold (presence ⇒ fail closed): the reader's own DB credential, the
// reader↔gateway transport secret, and any executor credential.
export const FORBIDDEN_ENV = Object.freeze([
  "LIVE_AI_03B_TRUSTED_READER_DB_URL",
  "LIVE_AI_03B_TRUSTED_EXECUTOR_DB_URL",
  "LIVE_AI_03B_READER_TRANSPORT_SECRET",
]);
export const DEFAULT_PROOF_LIFETIME_MS = 120000;
export const AI_STAGING = Object.freeze({
  projectId: FIXED.ai_staging_project, environmentId: FIXED.ai_staging_environment, pgServiceId: FIXED.ai_staging_postgres,
  excludedProjectId: FIXED.core_excluded_project, excludedPgServiceId: FIXED.core_excluded_postgres,
});

const present = (env, n) => typeof env[n] === "string" && env[n].trim() !== "";
function fail(reason) { return { ok: false, reason }; }

/**
 * Validate the attester's listen configuration with the ACCEPTED private-network listener contract
 * (observation-transport.mjs validateListenConfig): a literal private (RFC 1918 / ULA) bind address, or a
 * wildcard bind ONLY with explicit acknowledgement; a mandatory private peer-CIDR allowlist (no /0, no
 * over-broad range, no public or loopback peer); no hostname bind. Nothing is bound here.
 */
export function validateAttesterListen(listen, { offlineTestBoundary = false } = {}) {
  if (!listen || typeof listen !== "object") return fail("listen_config_absent");
  try {
    validateListenConfig({ mode: "private-network", bindHost: listen.bindHost, port: listen.port,
      allowedPeerCidrs: listen.allowedPeerCidrs, allowWildcardBind: listen.allowWildcardBind === true }, { testBoundary: offlineTestBoundary });
  } catch (e) { return fail("listen_" + (e && typeof e.message === "string" && /^transport_[a-z_]+$/.test(e.message) ? e.message.slice("transport_".length) : "invalid")); }
  return { ok: true };
}

/** Fail-closed config load. Returns NAMES + non-secret values only. */
export function loadAttesterConfig(env, { offlineTestBoundary = false } = {}) {
  if (!env || typeof env !== "object") return fail("env_absent");
  for (const n of FORBIDDEN_ENV) if (present(env, n)) return fail("foreign_credential_present");
  const required = [ENV.observerDbUrl, ENV.signingKeyPkcs8B64, ENV.issuer, ENV.bindHost, ENV.port, ENV.allowedPeerCidrs, ENV.channelSecret];
  const missing = required.filter((n) => !present(env, n));
  if (missing.length) return { ok: false, reason: "attester_config_incomplete", missing };

  const issuer = env[ENV.issuer];
  if (!/^[A-Za-z0-9._:-]{3,128}$/.test(issuer)) return fail("issuer_invalid");
  if (!offlineTestBoundary && issuer.startsWith("TEST-ONLY-")) return fail("issuer_test_only_refused");
  if (env[ENV.channelSecret].length < MIN_CHANNEL_SECRET_LEN) return fail("channel_secret_invalid");

  const port = /^[0-9]{1,5}$/.test(env[ENV.port]) ? Number(env[ENV.port]) : NaN;
  const listen = { bindHost: env[ENV.bindHost], port, allowWildcardBind: env[ENV.allowWildcardBind] === "true",
    allowedPeerCidrs: env[ENV.allowedPeerCidrs].split(",").map((x) => x.trim()).filter((x) => x.length > 0) };
  const lv = validateAttesterListen(listen, { offlineTestBoundary });
  if (!lv.ok) return fail(lv.reason);

  let lifetimeMs = DEFAULT_PROOF_LIFETIME_MS;
  if (present(env, ENV.proofLifetimeMs)) {
    lifetimeMs = /^[0-9]{1,7}$/.test(env[ENV.proofLifetimeMs]) ? Number(env[ENV.proofLifetimeMs]) : NaN;
    if (!Number.isInteger(lifetimeMs) || lifetimeMs < 1000 || lifetimeMs > ATTESTATION_MAX_LIFETIME_MS) return fail("proof_lifetime_invalid");
  }
  return { ok: true, issuer, listen: Object.freeze(listen), proofLifetimeMs: lifetimeMs,
    secretRefs: Object.freeze({ observerDbUrlEnvName: ENV.observerDbUrl, signingKeyEnvName: ENV.signingKeyPkcs8B64, channelSecretEnvName: ENV.channelSecret }),
    deploymentAnchorRef: present(env, ENV.deploymentAnchorRef) ? env[ENV.deploymentAnchorRef] : null };
}
