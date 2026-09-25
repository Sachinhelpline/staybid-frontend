// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — BOOTSTRAP: versioned PRODUCTION configuration loaders (OFFLINE). Node built-ins only.
//
// Validates the EXACT env NAMES the bootstrap layer needs and the anchored AI-STAGING Railway target. It reads
// non-secret values (identity, host/port, service names, issuer/fingerprint) and only records env NAMES for the
// secret-bearing values (DB URLs, signing key, channel secret) — their values are consumed at point of use in the
// composition, never returned or logged here. Fail-closed on any missing/invalid input; rejects the executor DB
// credential and any foreign credential category; the clock DB is DIRECT PostgreSQL against the anchored
// AI-STAGING service (never Supabase / PostgREST / SB_URL / an HTTP clock source).
//
// A production composition MUST NOT accept caller-injected authority (clock/signer/trust-root/db/query/resolver/
// attestation source/generation/secret). Synthetic injection is allowed ONLY behind the explicit offline-test
// boundary. The PRODUCTION option-key whitelist + test-injection blacklist below enforce that.
// ─────────────────────────────────────────────────────────────────────────
import { REQUIRED_ENV_NAMES as EXEC_ENV } from "../trusted-executor-runtime-01/runtime-config.mjs";
import { FIXED } from "../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import { parseDeploymentAnchor } from "../private-reader-attester-offline-01/target-binding.mjs";
import { makeAttesterTrustRoot } from "../private-reader-production-integration-offline-01/reader-attestation.mjs";
import { MIN_CHANNEL_SECRET_LEN } from "../private-reader-production-integration-offline-01/attestation-source-channel.mjs";
import { RAILWAY_INTERNAL_RE } from "./private-peer-resolver.mjs";
import { SERVICE_ABS_BOUND_MS } from "./clock-interval.mjs";

export const PRODUCTION_CONFIG_VERSION = "reader-bootstrap-production-config-v1";

// ── env NAMES (values never inlined) ──
export const READER_ENV = Object.freeze({
  readerDbUrl: EXEC_ENV.readerDbUrl,                                  // "LIVE_AI_03B_TRUSTED_READER_DB_URL" (read-only reader credential)
  aiStagingProjectId: EXEC_ENV.aiStagingProjectId,
  aiStagingEnvironmentId: EXEC_ENV.aiStagingEnvironmentId,
  aiStagingPgServiceId: EXEC_ENV.aiStagingPgServiceId,
  attesterServiceName: "LIVE_AI_03B_ATTESTER_SERVICE_NAME",          // <name>.railway.internal (private)
  attesterPort: "LIVE_AI_03B_ATTESTER_PORT",
  channelSecret: "LIVE_AI_03B_READER_ATTESTER_CHANNEL_SECRET",       // secret (name only)
  attesterIssuer: "LIVE_AI_03B_ATTESTER_ISSUER",
  attesterPublicKeyDerB64: "LIVE_AI_03B_ATTESTER_PUBLIC_KEY_DER_B64",
  attesterFingerprint: "LIVE_AI_03B_ATTESTER_KEY_FINGERPRINT",
  anchorJson: "LIVE_AI_03B_DEPLOYMENT_ANCHOR_JSON",                 // owner-issued anchor (non-secret) → the anchored cluster fingerprint the reader clock probe must observe
  clockStatementTimeoutMs: "LIVE_AI_03B_CLOCK_STATEMENT_TIMEOUT_MS", // optional; within frozen bounds
});
export const ATTESTER_ENV = Object.freeze({
  observerDbUrl: "LIVE_AI_03B_ATTESTER_OBSERVER_DB_URL",             // read-only observer credential (name only)
  signingKeyPkcs8B64: "LIVE_AI_03B_ATTESTER_SIGNING_KEY_PKCS8_B64",  // secret (name only)
  issuer: "LIVE_AI_03B_ATTESTER_ISSUER",
  anchorJson: "LIVE_AI_03B_DEPLOYMENT_ANCHOR_JSON",                  // owner-issued anchor (non-secret)
  channelSecret: "LIVE_AI_03B_READER_ATTESTER_CHANNEL_SECRET",       // secret (name only)
  readerServiceName: "LIVE_AI_03B_READER_SERVICE_NAME",             // <name>.railway.internal (private)
  bindHost: "LIVE_AI_03B_ATTESTER_BIND_HOST",
  port: "LIVE_AI_03B_ATTESTER_PORT",
  aiStagingProjectId: EXEC_ENV.aiStagingProjectId,
  aiStagingEnvironmentId: EXEC_ENV.aiStagingEnvironmentId,
  aiStagingPgServiceId: EXEC_ENV.aiStagingPgServiceId,
  clockStatementTimeoutMs: "LIVE_AI_03B_CLOCK_STATEMENT_TIMEOUT_MS",
});

// Foreign credential categories that MUST NOT be present in a reader/attester process.
export const FORBIDDEN_ENV = Object.freeze([
  EXEC_ENV.executorDbUrl,                    // the EXECUTE-capable executor credential — never in reader/attester
]);
// A clock DB via Supabase/PostgREST/SB_URL is not a supported source; these NAMES are never read as the clock.
export const UNSUPPORTED_CLOCK_ENV = Object.freeze(["SB_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "POSTGREST_URL"]);

// PRODUCTION option-key whitelist + test-injection blacklist (§18).
export const PRODUCTION_OPTION_KEYS = Object.freeze(["env", "log"]);
export const TEST_INJECTION_KEYS = Object.freeze([
  "takeSampleFn", "signer", "trustRoot", "observerProvider", "observerFactory", "dbClient", "query",
  "clockProbe", "clockProbeFn", "resolver", "peerCidrs", "attestationSource", "obtainV2Fn", "generation",
  "channelSecret", "anchor", "monoNowUs", "connectionToken", "offlineTest", "offlineTestBoundary", "signingKeyPkcs8B64",
]);

const present = (env, n) => typeof env[n] === "string" && env[n].trim() !== "";
const CLOCK_ST_MAX_MS = SERVICE_ABS_BOUND_MS;   // clock statement_timeout stays within the per-service bound
const CLOCK_ST_DEFAULT_MS = 2000;

/** Reject any production call carrying a test-injection option key (only env/log allowed). */
export function rejectTestInjection(opts) {
  if (!opts || typeof opts !== "object") return null;
  for (const k of Object.keys(opts)) {
    if (PRODUCTION_OPTION_KEYS.includes(k)) continue;
    return k;                                // ANY non-whitelisted key (incl. every TEST_INJECTION_KEYS entry) is rejected
  }
  return null;
}

function checkForbidden(env) {
  for (const n of FORBIDDEN_ENV) if (present(env, n)) return "executor_credential_present";
  return null;
}
function checkAiStaging(env, names) {
  if (env[names.aiStagingProjectId] !== FIXED.ai_staging_project) return "ai_staging_project_id_mismatch";
  if (env[names.aiStagingEnvironmentId] !== FIXED.ai_staging_environment) return "ai_staging_environment_id_mismatch";
  if (env[names.aiStagingPgServiceId] !== FIXED.ai_staging_postgres) return "ai_staging_pg_service_id_mismatch";
  if (env[names.aiStagingPgServiceId] === FIXED.core_excluded_postgres || env[names.aiStagingProjectId] === FIXED.core_excluded_project) return "config_targets_core_prod";
  return null;
}
function parsePort(v) { return /^[0-9]{1,5}$/.test(v) ? Number(v) : NaN; }
function parseStatementTimeout(env, name) {
  if (!present(env, name)) return CLOCK_ST_DEFAULT_MS;
  const n = /^[0-9]{1,6}$/.test(env[name]) ? Number(env[name]) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > CLOCK_ST_MAX_MS) return NaN;
  return n;
}

/**
 * Load + validate the READER production configuration from env. Returns { ok:true, config } (non-secret values +
 * env NAMES for secrets) or { ok:false, reason }. No secret value is returned.
 */
export function loadReaderProductionConfig(env) {
  if (!env || typeof env !== "object") return { ok: false, reason: "env_absent" };
  const forb = checkForbidden(env); if (forb) return { ok: false, reason: forb };
  const required = [READER_ENV.readerDbUrl, READER_ENV.aiStagingProjectId, READER_ENV.aiStagingEnvironmentId, READER_ENV.aiStagingPgServiceId,
    READER_ENV.attesterServiceName, READER_ENV.attesterPort, READER_ENV.channelSecret, READER_ENV.attesterIssuer, READER_ENV.attesterPublicKeyDerB64, READER_ENV.attesterFingerprint, READER_ENV.anchorJson];
  const missing = required.filter((n) => !present(env, n));
  if (missing.length) return { ok: false, reason: "reader_config_incomplete", missing };
  const ai = checkAiStaging(env, READER_ENV); if (ai) return { ok: false, reason: ai };
  if (!RAILWAY_INTERNAL_RE.test(env[READER_ENV.attesterServiceName])) return { ok: false, reason: "attester_service_name_not_railway_internal" };
  const port = parsePort(env[READER_ENV.attesterPort]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, reason: "attester_port_invalid" };
  if (env[READER_ENV.channelSecret].length < MIN_CHANNEL_SECRET_LEN) return { ok: false, reason: "channel_secret_too_short" };
  const st = parseStatementTimeout(env, READER_ENV.clockStatementTimeoutMs);
  if (!Number.isInteger(st)) return { ok: false, reason: "clock_statement_timeout_invalid" };
  const parsed = parseDeploymentAnchor(env[READER_ENV.anchorJson]);
  if (!parsed.ok) return { ok: false, reason: "anchor_" + parsed.reason };
  const tr = makeAttesterTrustRoot({ issuer: env[READER_ENV.attesterIssuer], publicKeyDerB64: env[READER_ENV.attesterPublicKeyDerB64], fingerprint: env[READER_ENV.attesterFingerprint] }, { allowTestIssuer: false });
  if (!tr.ok) return { ok: false, reason: "trust_root_" + tr.reason };
  return {
    ok: true,
    config: Object.freeze({
      version: PRODUCTION_CONFIG_VERSION,
      readerDbUrlEnvName: READER_ENV.readerDbUrl,
      channelSecretEnvName: READER_ENV.channelSecret,
      attesterServiceName: env[READER_ENV.attesterServiceName],
      attesterPort: port,
      trustRoot: tr.trustRoot,
      anchor: parsed.anchor,
      expectedFingerprint: parsed.anchor.clusterFingerprint,   // the anchored cluster the reader clock probe MUST observe
      clockStatementTimeoutMs: st,
      aiStaging: Object.freeze({ project: FIXED.ai_staging_project, environment: FIXED.ai_staging_environment, pgService: FIXED.ai_staging_postgres }),
    }),
  };
}

/**
 * Load + validate the ATTESTER production configuration from env. Returns { ok:true, config } or { ok:false, reason }.
 * No secret value is returned. The signing key + channel secret are consumed by env NAME at point of use.
 */
export function loadAttesterProductionConfig(env) {
  if (!env || typeof env !== "object") return { ok: false, reason: "env_absent" };
  const forb = checkForbidden(env); if (forb) return { ok: false, reason: forb };
  const required = [ATTESTER_ENV.observerDbUrl, ATTESTER_ENV.signingKeyPkcs8B64, ATTESTER_ENV.issuer, ATTESTER_ENV.anchorJson,
    ATTESTER_ENV.channelSecret, ATTESTER_ENV.readerServiceName, ATTESTER_ENV.bindHost, ATTESTER_ENV.port,
    ATTESTER_ENV.aiStagingProjectId, ATTESTER_ENV.aiStagingEnvironmentId, ATTESTER_ENV.aiStagingPgServiceId];
  const missing = required.filter((n) => !present(env, n));
  if (missing.length) return { ok: false, reason: "attester_config_incomplete", missing };
  const ai = checkAiStaging(env, ATTESTER_ENV); if (ai) return { ok: false, reason: ai };
  if (!RAILWAY_INTERNAL_RE.test(env[ATTESTER_ENV.readerServiceName])) return { ok: false, reason: "reader_service_name_not_railway_internal" };
  const port = parsePort(env[ATTESTER_ENV.port]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, reason: "attester_port_invalid" };
  if (env[ATTESTER_ENV.channelSecret].length < MIN_CHANNEL_SECRET_LEN) return { ok: false, reason: "channel_secret_too_short" };
  const st = parseStatementTimeout(env, ATTESTER_ENV.clockStatementTimeoutMs);
  if (!Number.isInteger(st)) return { ok: false, reason: "clock_statement_timeout_invalid" };
  const parsed = parseDeploymentAnchor(env[ATTESTER_ENV.anchorJson]);
  if (!parsed.ok) return { ok: false, reason: "anchor_" + parsed.reason };
  if (typeof env[ATTESTER_ENV.issuer] !== "string" || !/^[A-Za-z0-9._:-]{3,128}$/.test(env[ATTESTER_ENV.issuer])) return { ok: false, reason: "issuer_invalid" };
  return {
    ok: true,
    config: Object.freeze({
      version: PRODUCTION_CONFIG_VERSION,
      observerDbUrlEnvName: ATTESTER_ENV.observerDbUrl,
      signingKeyEnvName: ATTESTER_ENV.signingKeyPkcs8B64,
      channelSecretEnvName: ATTESTER_ENV.channelSecret,
      issuer: env[ATTESTER_ENV.issuer],
      anchor: parsed.anchor,
      expectedFingerprint: parsed.anchor.clusterFingerprint,   // the anchored cluster the attester clock probe MUST observe (same as reader)
      readerServiceName: env[ATTESTER_ENV.readerServiceName],
      bindHost: env[ATTESTER_ENV.bindHost],
      port,
      clockStatementTimeoutMs: st,
      aiStaging: Object.freeze({ project: FIXED.ai_staging_project, environment: FIXED.ai_staging_environment, pgService: FIXED.ai_staging_postgres }),
    }),
  };
}
