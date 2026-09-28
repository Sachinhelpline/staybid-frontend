// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP 2 — V2 NON-SECRET runtime configuration contract + fail-closed loader.
// OFFLINE, Node built-ins only. NO secret VALUE is ever returned or logged — NAMES + presence only.
//
// Successor of trusted-executor-runtime-01/runtime-config.mjs (V1, frozen; targets from V1 FIXED).
// Keeps the accepted deployment env NAMES unchanged and ADDS one explicit contract selector:
//   LIVE_AI_03B_RUNTIME_CONTRACT_VERSION = "V2"
// so a V1-era deployment config can never silently drive the V2 runtime (and a V2 config cannot be
// mistaken for V1). Targets come ONLY from the V2 identity (FIXED_V2).
// ─────────────────────────────────────────────────────────────────────────

import { TARGETS_V2, RUNTIME_CONTRACT_VERSION } from "../identity/v2-identity.mjs";

export const REQUIRED_ENV_NAMES_V2 = Object.freeze({
  runtimeContractVersion: "LIVE_AI_03B_RUNTIME_CONTRACT_VERSION",       // must be exactly "V2"
  executorDbUrl: "LIVE_AI_03B_TRUSTED_EXECUTOR_DB_URL",                 // SECRET value (never read here)
  readerDbUrl: "LIVE_AI_03B_TRUSTED_READER_DB_URL",                     // SECRET value (never read here)
  reviewerTrustRootDerB64: "LIVE_AI_03B_REVIEWER_TRUST_ROOT_DER_B64",   // public key material (non-secret)
  reviewerTrustRootFingerprint: "LIVE_AI_03B_REVIEWER_TRUST_ROOT_FINGERPRINT",
  aiStagingProjectId: "LIVE_AI_03B_AI_STAGING_PROJECT_ID",
  aiStagingEnvironmentId: "LIVE_AI_03B_AI_STAGING_ENVIRONMENT_ID",
  aiStagingPgServiceId: "LIVE_AI_03B_AI_STAGING_PG_SERVICE_ID",
  aiStagingGatewayServiceId: "LIVE_AI_03B_AI_STAGING_GATEWAY_SERVICE_ID",
  connectionIdentityProofRef: "LIVE_AI_03B_CONNECTION_IDENTITY_PROOF_REF",
});
export const SECRET_ENV_NAMES_V2 = Object.freeze([REQUIRED_ENV_NAMES_V2.executorDbUrl, REQUIRED_ENV_NAMES_V2.readerDbUrl]);
// names this runtime must NEVER be given (provider / gateway signing / CORE / reviewer private key).
export const FORBIDDEN_ENV_NAMES_V2 = Object.freeze(["OPENAI_API_KEY", "LIVE_AI_SESSION_SIGNING_PRIVATE_KEY", "LIVE_AI_03B_REVIEWER_PRIVATE_KEY", "CORE_DATABASE_URL"]);

function present(env, name) { const v = env ? env[name] : undefined; return typeof v === "string" && v.trim() !== ""; }

export function loadRuntimeConfigV2(env) {
  if (!env || typeof env !== "object") return { ok: false, reason: "env_absent", missing: Object.values(REQUIRED_ENV_NAMES_V2) };
  for (const n of FORBIDDEN_ENV_NAMES_V2) if (present(env, n)) return { ok: false, reason: "forbidden_secret_present_in_executor_env" };
  const missing = Object.values(REQUIRED_ENV_NAMES_V2).filter((n) => !present(env, n));
  if (missing.length) return { ok: false, reason: "runtime_config_incomplete", missing };
  if (env[REQUIRED_ENV_NAMES_V2.runtimeContractVersion] !== RUNTIME_CONTRACT_VERSION) return { ok: false, reason: "runtime_contract_version_not_v2" };
  const projectId = env[REQUIRED_ENV_NAMES_V2.aiStagingProjectId];
  const environmentId = env[REQUIRED_ENV_NAMES_V2.aiStagingEnvironmentId];
  const pgServiceId = env[REQUIRED_ENV_NAMES_V2.aiStagingPgServiceId];
  const gatewayServiceId = env[REQUIRED_ENV_NAMES_V2.aiStagingGatewayServiceId];
  if (pgServiceId === TARGETS_V2.core_excluded_postgres || projectId === TARGETS_V2.core_excluded_project) return { ok: false, reason: "config_targets_core_prod" };
  if (projectId !== TARGETS_V2.project) return { ok: false, reason: "ai_staging_project_id_mismatch" };
  if (environmentId !== TARGETS_V2.environment) return { ok: false, reason: "ai_staging_environment_id_mismatch" };
  if (pgServiceId !== TARGETS_V2.postgres) return { ok: false, reason: "ai_staging_pg_service_id_mismatch" };
  if (gatewayServiceId !== TARGETS_V2.gateway) return { ok: false, reason: "ai_staging_gateway_service_id_mismatch" };
  const fp = env[REQUIRED_ENV_NAMES_V2.reviewerTrustRootFingerprint];
  if (!/^[0-9a-f]{64}$/.test(fp)) return { ok: false, reason: "reviewer_fingerprint_malformed" };
  return {
    ok: true, contractVersion: RUNTIME_CONTRACT_VERSION,
    targets: { projectId, environmentId, pgServiceId, gatewayServiceId },
    reviewer: { pinnedPublicKeyDerB64: env[REQUIRED_ENV_NAMES_V2.reviewerTrustRootDerB64], pinnedFingerprint: fp },
    secretRefs: { executorDbUrlName: REQUIRED_ENV_NAMES_V2.executorDbUrl, readerDbUrlName: REQUIRED_ENV_NAMES_V2.readerDbUrl,
      connectionIdentityProofRef: env[REQUIRED_ENV_NAMES_V2.connectionIdentityProofRef] },
  };
}
