// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — P1-02 TRUSTED EXECUTOR RUNTIME (Implementation I foundation) —
// NON-SECRET runtime configuration contract + fail-closed loader. OFFLINE,
// Node built-ins only. NO secret VALUE is ever read into a return value or logged
// — only NAMES, presence, and the non-secret target IDs / reviewer fingerprint.
//
// The AI-STAGING / CORE-PROD target IDs come from the FROZEN accepted contract
// (pricing-approval-contract.mjs FIXED), never hardcoded or reconstructed here.
// ─────────────────────────────────────────────────────────────────────────

import { FIXED } from "../trusted-activation-boundary-01/pricing-approval-contract.mjs";

// Required environment variable NAMES (values are provisioned later, out of band).
// Secret-bearing names (never logged/returned as values): the two restricted DB URLs
// and the reviewer public key material reference.
export const REQUIRED_ENV_NAMES = Object.freeze({
  // restricted, credential-isolated DB connections (SECRET values; NAMES only here)
  executorDbUrl: "LIVE_AI_03B_TRUSTED_EXECUTOR_DB_URL",   // EXECUTE-only on the trusted activate fn
  readerDbUrl: "LIVE_AI_03B_TRUSTED_READER_DB_URL",       // read-only, no table DML
  // independently-pinned reviewer trust root (PUBLIC key + fingerprint — non-secret)
  reviewerTrustRootDerB64: "LIVE_AI_03B_REVIEWER_TRUST_ROOT_DER_B64",
  reviewerTrustRootFingerprint: "LIVE_AI_03B_REVIEWER_TRUST_ROOT_FINGERPRINT",
  // non-secret AI-STAGING target IDs (must equal the frozen FIXED contract)
  aiStagingProjectId: "LIVE_AI_03B_AI_STAGING_PROJECT_ID",
  aiStagingEnvironmentId: "LIVE_AI_03B_AI_STAGING_ENVIRONMENT_ID",
  aiStagingPgServiceId: "LIVE_AI_03B_AI_STAGING_PG_SERVICE_ID",
  aiStagingGatewayServiceId: "LIVE_AI_03B_AI_STAGING_GATEWAY_SERVICE_ID",
  // NAME of the independent connection→service-identity proof source (never a DB name)
  connectionIdentityProofRef: "LIVE_AI_03B_CONNECTION_IDENTITY_PROOF_REF",
});

// Names whose VALUES are secrets — this module must never place their values in a
// return object or log line.
export const SECRET_ENV_NAMES = Object.freeze([
  REQUIRED_ENV_NAMES.executorDbUrl,
  REQUIRED_ENV_NAMES.readerDbUrl,
]);

function present(env, name) { const v = env ? env[name] : undefined; return typeof v === "string" && v.trim() !== ""; }

/**
 * Fail-closed non-secret config load. Returns { ok:true, targets, reviewer, secretRefs }
 * on success, or { ok:false, reason, missing } when any required name is absent or a
 * supplied non-secret target ID disagrees with the frozen FIXED contract. Secret VALUES
 * (DB URLs) are NEVER returned — only their NAMES, as references for the real client.
 */
export function loadRuntimeConfig(env) {
  if (!env || typeof env !== "object") return { ok: false, reason: "env_absent", missing: Object.values(REQUIRED_ENV_NAMES) };
  const missing = Object.values(REQUIRED_ENV_NAMES).filter((n) => !present(env, n));
  if (missing.length) return { ok: false, reason: "runtime_config_incomplete", missing };

  // non-secret target IDs must equal the frozen FIXED contract (reject drift / CORE mixups).
  const projectId = env[REQUIRED_ENV_NAMES.aiStagingProjectId];
  const envId = env[REQUIRED_ENV_NAMES.aiStagingEnvironmentId];
  const pgServiceId = env[REQUIRED_ENV_NAMES.aiStagingPgServiceId];
  const gatewayServiceId = env[REQUIRED_ENV_NAMES.aiStagingGatewayServiceId];
  if (projectId !== FIXED.ai_staging_project) return { ok: false, reason: "ai_staging_project_id_mismatch" };
  if (envId !== FIXED.ai_staging_environment) return { ok: false, reason: "ai_staging_environment_id_mismatch" };
  if (pgServiceId !== FIXED.ai_staging_postgres) return { ok: false, reason: "ai_staging_pg_service_id_mismatch" };
  if (gatewayServiceId !== FIXED.ai_staging_gateway) return { ok: false, reason: "ai_staging_gateway_service_id_mismatch" };
  // an operator must never point config at CORE-PROD.
  if (pgServiceId === FIXED.core_excluded_postgres || projectId === FIXED.core_excluded_project) return { ok: false, reason: "config_targets_core_prod" };

  const reviewerDerB64 = env[REQUIRED_ENV_NAMES.reviewerTrustRootDerB64];
  const reviewerFingerprint = env[REQUIRED_ENV_NAMES.reviewerTrustRootFingerprint];
  if (typeof reviewerFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(reviewerFingerprint)) {
    return { ok: false, reason: "reviewer_fingerprint_malformed" };
  }

  return {
    ok: true,
    targets: { projectId, environmentId: envId, pgServiceId, gatewayServiceId },
    reviewer: { pinnedPublicKeyDerB64: reviewerDerB64, pinnedFingerprint: reviewerFingerprint },
    // NAMES only — the real client resolves the secret values itself; never carried here.
    secretRefs: { executorDbUrlName: REQUIRED_ENV_NAMES.executorDbUrl, readerDbUrlName: REQUIRED_ENV_NAMES.readerDbUrl,
      connectionIdentityProofRef: env[REQUIRED_ENV_NAMES.connectionIdentityProofRef] },
  };
}
