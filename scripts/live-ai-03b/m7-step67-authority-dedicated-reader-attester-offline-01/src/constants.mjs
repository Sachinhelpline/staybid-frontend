// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP6/7 (DEDICATED AUTHORITY READER-ATTESTER + AUTHORITY-HOST V2 BINDING) — frozen pins.
// OFFLINE candidate. Node built-ins only. NON-SECRET identifiers and env NAMES only — never a value.
// ─────────────────────────────────────────────────────────────────────────
import { FIXED } from "../../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import { EXECUTOR_ATTESTER_ENV, READER_ATTESTER_ENV } from "../../m7-v2-production-authority-provisioning-offline-01/src/provisioning-config.mjs";
import { ATTESTER_ENV as BOOTSTRAP_ATTESTER_ENV, READER_ENV as BOOTSTRAP_READER_ENV } from "../../private-reader-bootstrap-clock-peer-offline-01/production-config.mjs";
import { REQUIRED_ENV_NAMES as EXEC_RUNTIME_ENV } from "../../trusted-executor-runtime-01/runtime-config.mjs";

export const PACKAGE_DIR = "scripts/live-ai-03b/m7-step67-authority-dedicated-reader-attester-offline-01";
export const STEP67_VERSION = "m7-step67-authority-dedicated-reader-attester-v2-offline-01";
export const CANONICAL_ACTION_ID = "M7-STEP6-7-EFFECTIVE-PRIVILEGE-DUAL-IDENTITY-BINDING";
export const SUCCESS_MARKER = "M7_STEP6_7_AUTHORITY_HOST_EFFECTIVE_PRIVILEGE_DUAL_BINDING_PASS_READY_FOR_REVIEWER_TRUST_ROOT";
export const HOLD_PREFIX = "HOLD_M7_STEP6_7_AUTHORITY_HOST_";
export const NEXT_BOUNDARY = "READY_FOR_REVIEWER_TRUST_ROOT";

/** Exact AI-STAGING pins (re-exported from the ACCEPTED frozen contract — never retyped). */
export const TARGET = Object.freeze({
  projectId: FIXED.ai_staging_project,
  environmentId: FIXED.ai_staging_environment,
  postgresServiceId: FIXED.ai_staging_postgres,
  coreProdProjectId: FIXED.core_excluded_project,
  coreProdPostgresId: FIXED.core_excluded_postgres,
});

/** Railway services (ids from the Control Room pins; names are the Railway reference-variable namespace). */
export const SERVICES = Object.freeze({
  authority: Object.freeze({ id: "1f7daf27-7489-410f-8969-da758459fb4d", name: "live-ai-03b-v2-authority" }),
  executorAttester: Object.freeze({ id: "c74d7558-2e04-46fc-b5a1-871b5931b0cc", name: "live-ai-03b-executor-attester",
    deploymentId: "52c7c0b2-7863-45e4-987f-5587415d67a7", sourceCommit: "023450821bc7dbf75165acbf3ee349a3d5984b1b" }),
  m5ReaderAttester: Object.freeze({ id: "3a7e5f80-e6a9-4026-b335-0df9aae42c50", name: "live-ai-03b-reader-attester",
    deploymentId: "25a73e94-b65e-4c95-b8e0-9a6d46d9a54a" }),
  m5ReaderHost: Object.freeze({ id: "88c74a23-6b01-4ec8-8600-90e23628ff72" }),
  // the NEW service (does not exist yet — created only in future phase P2 under its own Owner authorization)
  dedicatedReaderAttester: Object.freeze({ id: null, name: "live-ai-03b-authority-reader-attester" }),
});

/** The dedicated attester's stable, non-test production issuer (accepted regex /^[A-Za-z0-9._:-]{3,128}$/, no TEST-ONLY- prefix). */
export const DEDICATED_READER_ATTESTER_ISSUER = "staybid-live-ai-03b-authority-reader-attester-v1";
/** Dedicated attester private port (a fixed choice for the new service; private network only). */
export const DEDICATED_READER_ATTESTER_PORT = "8563";
/** Dedicated attester bind host: wildcard IPv6 (Railway private networking); admission is the exact-host peer allowlist + HMAC. */
export const DEDICATED_READER_ATTESTER_BIND_HOST = "::";

/** Authority-side DB credential reference NAMES (already provisioned + verified; never mutated). */
export const DB_ENV = Object.freeze({ executorDbUrl: EXEC_RUNTIME_ENV.executorDbUrl, readerDbUrl: EXEC_RUNTIME_ENV.readerDbUrl });
/** Authority-side caller names: the ACCEPTED executor-attester names + the ACCEPTED reader-attester (integration) names. */
export const AUTHORITY_EXECUTOR_ATTESTER_ENV = EXECUTOR_ATTESTER_ENV;
export const AUTHORITY_READER_ATTESTER_ENV = READER_ATTESTER_ENV;
/** The reader-side clock probe needs the anchored cluster fingerprint (accepted bootstrap READER_ENV name). */
export const AUTHORITY_ANCHOR_ENV = BOOTSTRAP_READER_ENV.anchorJson;   // "LIVE_AI_03B_DEPLOYMENT_ANCHOR_JSON"
/** The dedicated attester runs the UNCHANGED accepted bootstrap attester: its env names are the accepted ATTESTER_ENV. */
export const DEDICATED_ATTESTER_ENV = BOOTSTRAP_ATTESTER_ENV;
/** Non-secret public-key custody names added on the dedicated service (the accepted reader-side names). */
export const DEDICATED_PUBLIC_CUSTODY_ENV = Object.freeze({
  publicKeyDerB64: BOOTSTRAP_READER_ENV.attesterPublicKeyDerB64,   // "LIVE_AI_03B_ATTESTER_PUBLIC_KEY_DER_B64"
  fingerprint: BOOTSTRAP_READER_ENV.attesterFingerprint,          // "LIVE_AI_03B_ATTESTER_KEY_FINGERPRINT"
});

/** Accepted start command of the reused attester (byte-unchanged accepted source). */
export const DEDICATED_ATTESTER_START_COMMAND = "node scripts/live-ai-03b/private-reader-bootstrap-clock-peer-offline-01/bootstrap-entrypoint-attester.mjs";
/** Authority start command (standby only — no DB, no attester, no listener). */
export const AUTHORITY_STANDBY_START_COMMAND = `node ${PACKAGE_DIR}/src/authority-standby-entrypoint.mjs`;
export const AUTHORITY_VERIFY_COMMAND_PATH = `${PACKAGE_DIR}/src/step67-verification-entrypoint.mjs`;
export const AUTHORITY_PEER_IDENTITY_COMMAND_PATH = `${PACKAGE_DIR}/src/authority-peer-identity.mjs`;

/** Statement-timeout choices (within the accepted bounds of each accepted session module). */
export const EXECUTOR_STATEMENT_TIMEOUT_MS = 10000;   // accepted provisioning default (1000..15000)
export const READER_STATEMENT_TIMEOUT_MS = 2000;      // accepted reader bound (≤ 2000)

/** Secret classes the Authority Step6/7 process must NEVER hold (in addition to the accepted forbidden screen). */
export const STEP67_FORBIDDEN_ENV_NAMES = Object.freeze([
  BOOTSTRAP_ATTESTER_ENV.signingKeyPkcs8B64,                   // reader-attester signing key
  BOOTSTRAP_ATTESTER_ENV.observerDbUrl,                        // reader-attester observer credential
  "LIVE_AI_03B_EXECUTOR_ATTESTER_SIGNING_KEY_PKCS8_B64",       // executor-attester signing key
  "LIVE_AI_03B_EXECUTOR_ATTESTER_OBSERVER_DB_URL",             // executor-attester observer credential
  "LIVE_AI_03B_ATTESTER_DEPLOYMENT_ANCHOR",                    // attester-side custody (not a caller input)
  "LIVE_AI_03B_EXECUTOR_ATTESTER_DEPLOYMENT_ANCHOR",
  "LIVE_AI_03B_REVIEWER_PRIVATE_KEY",
]);
export const STEP67_FORBIDDEN_ENV_PATTERNS = Object.freeze([/SIGNING_KEY/, /PKCS8/, /OBSERVER_DB_URL/, /PRIVATE_KEY/, /SUPERUSER/, /^PG(PASSWORD|USER)$/]);
