// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — production-integration NON-SECRET configuration (OFFLINE). Node built-ins only.
// Returns NAMES and non-secret values only; the reader DB URL value is never read here (the physical
// factory reads it itself at connect time) and no secret value is ever returned or logged.
// ─────────────────────────────────────────────────────────────────────────
import { REQUIRED_ENV_NAMES as EXECUTOR_RUNTIME_ENV } from "../trusted-executor-runtime-01/runtime-config.mjs";
import { READER_STATEMENT_TIMEOUT_MAX_MS } from "../private-reader-host-runtime-offline-01/reader-only-authority.mjs";
import { ENV_TRANSPORT_SECRET } from "../private-reader-host-runtime-offline-01/runtime-config.mjs";
import { makeAttesterTrustRoot } from "./reader-attestation.mjs";
import { validateAttesterChannelConfig } from "./attestation-source-channel.mjs";

export const ENV = Object.freeze({
  readerDbUrl: EXECUTOR_RUNTIME_ENV.readerDbUrl,                 // accepted NAME "LIVE_AI_03B_TRUSTED_READER_DB_URL" (secret value)
  attesterIssuer: "LIVE_AI_03B_READER_ATTESTER_ISSUER",           // non-secret issuer id
  attesterPublicKeyDerB64: "LIVE_AI_03B_READER_ATTESTER_PUBKEY_DER_B64", // non-secret Ed25519 SPKI (verification only)
  attesterFingerprint: "LIVE_AI_03B_READER_ATTESTER_FINGERPRINT", // non-secret sha256(SPKI), configured separately
  statementTimeoutMs: "LIVE_AI_03B_READER_STATEMENT_TIMEOUT_MS",  // optional; default 2000; must be 1..2000
  // approved attestation-source channel (reader-attestation-channel-v1) — deployment-owned
  attesterHost: "LIVE_AI_03B_READER_ATTESTER_HOST",               // *.railway.internal or literal private IP
  attesterPort: "LIVE_AI_03B_READER_ATTESTER_PORT",               // decimal 1..65535
  attesterChannelSecret: "LIVE_AI_03B_READER_ATTESTER_CHANNEL_SECRET", // SECRET: channel HMAC key (≥32; ≠ transport secret)
});
// Credentials that must NEVER be present in the reader host's environment (presence check only).
export const FORBIDDEN_ENV = Object.freeze([EXECUTOR_RUNTIME_ENV.executorDbUrl]);
export const DEFAULT_STATEMENT_TIMEOUT_MS = READER_STATEMENT_TIMEOUT_MAX_MS; // 2000

const present = (env, n) => typeof env[n] === "string" && env[n].trim() !== "";

export function loadIntegrationConfig(env) {
  if (!env || typeof env !== "object") return { ok: false, reason: "env_absent" };
  for (const n of FORBIDDEN_ENV) if (present(env, n)) return { ok: false, reason: "executor_credential_present" };
  const required = [ENV.readerDbUrl, ENV.attesterIssuer, ENV.attesterPublicKeyDerB64, ENV.attesterFingerprint, ENV.attesterHost, ENV.attesterPort, ENV.attesterChannelSecret];
  const missing = required.filter((n) => !present(env, n));
  if (missing.length) return { ok: false, reason: "integration_config_incomplete", missing };
  let st = DEFAULT_STATEMENT_TIMEOUT_MS;
  if (present(env, ENV.statementTimeoutMs)) {
    st = /^[0-9]{1,5}$/.test(env[ENV.statementTimeoutMs]) ? Number(env[ENV.statementTimeoutMs]) : NaN;
    if (!Number.isInteger(st) || st < 1 || st > READER_STATEMENT_TIMEOUT_MAX_MS) return { ok: false, reason: "statement_timeout_config_invalid" };
  }
  const tr = makeAttesterTrustRoot({ issuer: env[ENV.attesterIssuer], publicKeyDerB64: env[ENV.attesterPublicKeyDerB64], fingerprint: env[ENV.attesterFingerprint] }, { allowTestIssuer: false });
  if (!tr.ok) return { ok: false, reason: tr.reason };
  const port = /^[0-9]{1,5}$/.test(env[ENV.attesterPort]) ? Number(env[ENV.attesterPort]) : NaN;
  const ch = validateAttesterChannelConfig({ host: env[ENV.attesterHost], port, channelSecret: env[ENV.attesterChannelSecret], transportSecret: env[ENV_TRANSPORT_SECRET] }, { offlineTestBoundary: false });
  if (!ch.ok) return { ok: false, reason: ch.reason };
  // non-secret channel destination + the secret's env NAME only (value read at composition, never returned)
  return { ok: true, trustRoot: tr.trustRoot, statementTimeoutMs: st, readerDbUrlEnvName: ENV.readerDbUrl,
    attesterChannel: Object.freeze({ host: env[ENV.attesterHost], port, channelSecretEnvName: ENV.attesterChannelSecret }) };
}
