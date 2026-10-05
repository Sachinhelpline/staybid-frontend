// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP6/7 — narrow Authority-side configuration loader. OFFLINE candidate. NO I/O.
//
// Loads ONLY what Step6/7 needs from the Authority environment and returns env NAMES, public identifiers and pinned
// PUBLIC trust roots — never a secret value. Composes accepted primitives (never re-implements them):
//   • screenForbiddenSecrets (accepted authority forbidden-secret screen) + a Step6/7 screen that refuses ANY
//     attester signing key, observer credential or attester-side custody name inside the Authority;
//   • makeAttesterTrustRoot (accepted: Ed25519 DER, fingerprint recomputed, TEST-ONLY issuers refused in production);
//   • validateAttesterChannelConfig (accepted executor destination rule: *.railway.internal / literal private IP);
//   • RAILWAY_INTERNAL_RE (accepted: the dedicated reader attester must be a private Railway service name);
//   • parseDeploymentAnchor (accepted AiStagingDeploymentAnchorV1 parser: AI-STAGING only, CORE-PROD refused).
// Independent pins (Owner-supplied from accepted receipts, public values only) are REQUIRED in production: the
// expected executor-attester fingerprint, the expected dedicated-reader-attester fingerprint, and the M5
// reader-attester fingerprint the dedicated one must NOT equal. A trust root is accepted only when the
// reference-resolved deployment value equals the independent pin.
// ─────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { screenForbiddenSecrets } from "../../m7-v2-production-authority-provisioning-offline-01/src/provisioning-config.mjs";
import { makeAttesterTrustRoot } from "../../private-reader-production-integration-offline-01/reader-attestation.mjs";
import { validateAttesterChannelConfig, MIN_CHANNEL_SECRET_LEN } from "../../private-reader-production-integration-offline-01/attestation-source-channel.mjs";
import { RAILWAY_INTERNAL_RE } from "../../private-reader-bootstrap-clock-peer-offline-01/private-peer-resolver.mjs";
import { parseDeploymentAnchor } from "../../private-reader-attester-offline-01/target-binding.mjs";
import {
  DB_ENV, AUTHORITY_EXECUTOR_ATTESTER_ENV as EX, AUTHORITY_READER_ATTESTER_ENV as RD, AUTHORITY_ANCHOR_ENV,
  STEP67_FORBIDDEN_ENV_NAMES, STEP67_FORBIDDEN_ENV_PATTERNS, TARGET,
} from "./constants.mjs";

export const STEP67_CONFIG_VERSION = "m7-step67-authority-config-v1";
const HEX64 = /^[0-9a-f]{64}$/;
const present = (env, n) => typeof env[n] === "string" && env[n].trim() !== "";
const fail = (reason, extra) => Object.freeze({ ok: false, reason, ...(extra || {}) });
const digest = (v) => createHash("sha256").update(String(v), "utf8").digest("hex");

/** Every Authority variable NAME Step6/7 requires (the DB references + the two caller groups + the anchor). */
export const REQUIRED_AUTHORITY_NAMES = Object.freeze([
  DB_ENV.executorDbUrl, DB_ENV.readerDbUrl,
  EX.issuer, EX.publicKeyDerB64, EX.fingerprint, EX.host, EX.port, EX.channelSecret,
  RD.issuer, RD.publicKeyDerB64, RD.fingerprint, RD.host, RD.port, RD.channelSecret,
  AUTHORITY_ANCHOR_ENV,
]);

export function screenStep67Forbidden(env) {
  const base = screenForbiddenSecrets(env);
  if (!base.ok) return fail(base.reason);
  for (const n of STEP67_FORBIDDEN_ENV_NAMES) if (present(env, n)) return fail("step67_forbidden_secret_class_present");
  for (const n of Object.keys(env)) if (present(env, n) && STEP67_FORBIDDEN_ENV_PATTERNS.some((re) => re.test(n))) return fail("step67_forbidden_secret_class_present");
  return { ok: true };
}

function parsePort(v) { return typeof v === "string" && /^[0-9]{1,5}$/.test(v) ? Number(v) : NaN; }

/**
 * @param env  the Authority process environment (values read here are never returned; secrets only compared by digest)
 * @param pins { expectedExecutorAttesterFingerprint, expectedReaderAttesterFingerprint, forbiddenReaderAttesterFingerprint }
 * @param opts { testBoundary } — TEST-ONLY issuers + loopback destinations are accepted ONLY under the explicit offline test boundary
 */
export function loadStep67Config(env, pins, opts) {
  const testBoundary = !!(opts && opts.testBoundary === true);
  if (!env || typeof env !== "object") return fail("env_absent");
  const fs = screenStep67Forbidden(env); if (!fs.ok) return fs;
  const missing = REQUIRED_AUTHORITY_NAMES.filter((n) => !present(env, n));
  if (missing.length) return fail("authority_caller_config_incomplete", { missing });
  // independent public pins
  const p = pins || {};
  for (const k of ["expectedExecutorAttesterFingerprint", "expectedReaderAttesterFingerprint", "forbiddenReaderAttesterFingerprint"]) {
    if (typeof p[k] !== "string" || !HEX64.test(p[k])) return fail("pin_" + k + "_invalid");
  }
  // DB credential references: present + DISTINCT (compared by digest only)
  if (digest(env[DB_ENV.executorDbUrl]) === digest(env[DB_ENV.readerDbUrl])) return fail("executor_and_reader_share_a_credential");
  // executor attester (accepted trust-root + destination rules)
  const exTr = makeAttesterTrustRoot({ issuer: env[EX.issuer], publicKeyDerB64: env[EX.publicKeyDerB64], fingerprint: env[EX.fingerprint] }, { allowTestIssuer: testBoundary });
  if (!exTr.ok) return fail("executor_" + exTr.reason);
  const exPort = parsePort(env[EX.port]);
  const exCh = validateAttesterChannelConfig({ host: env[EX.host], port: exPort, channelSecret: env[EX.channelSecret] }, { offlineTestBoundary: testBoundary });
  if (!exCh.ok) return fail("executor_" + exCh.reason);
  // dedicated reader attester (v2): private Railway service name (or loopback ONLY in tests), port, secret length
  const rdTr = makeAttesterTrustRoot({ issuer: env[RD.issuer], publicKeyDerB64: env[RD.publicKeyDerB64], fingerprint: env[RD.fingerprint] }, { allowTestIssuer: testBoundary });
  if (!rdTr.ok) return fail("reader_" + rdTr.reason);
  const rdHost = env[RD.host];
  const rdHostOk = RAILWAY_INTERNAL_RE.test(rdHost) || (testBoundary && (rdHost === "127.0.0.1" || rdHost === "::1"));
  if (!rdHostOk) return fail("reader_attester_host_not_railway_internal");
  const rdPort = parsePort(env[RD.port]);
  if (!Number.isInteger(rdPort) || rdPort < 1 || rdPort > 65535) return fail("reader_attester_port_invalid");
  if (env[RD.channelSecret].length < MIN_CHANNEL_SECRET_LEN) return fail("reader_attester_channel_secret_invalid");
  // distinctness of the two attesters (identity + channel custody)
  if (exTr.trustRoot.issuer === rdTr.trustRoot.issuer) return fail("attester_issuers_not_distinct");
  if (exTr.trustRoot.fingerprint === rdTr.trustRoot.fingerprint) return fail("attester_keys_not_distinct");
  if (digest(env[EX.channelSecret]) === digest(env[RD.channelSecret])) return fail("attester_channel_secrets_not_distinct");
  if (env[EX.host] === rdHost && exPort === rdPort) return fail("attester_destinations_not_distinct");
  // independent pins: the deployment-resolved trust roots must equal the Owner's public pins
  if (exTr.trustRoot.fingerprint !== p.expectedExecutorAttesterFingerprint) return fail("executor_attester_fingerprint_not_pinned_value");
  if (rdTr.trustRoot.fingerprint !== p.expectedReaderAttesterFingerprint) return fail("reader_attester_fingerprint_not_pinned_value");
  if (rdTr.trustRoot.fingerprint === p.forbiddenReaderAttesterFingerprint) return fail("dedicated_reader_attester_reuses_m5_signing_key");
  if (p.expectedReaderAttesterFingerprint === p.expectedExecutorAttesterFingerprint) return fail("pins_not_distinct");
  // anchored cluster fingerprint for the reader clock probe (accepted parser; AI-STAGING only)
  const an = parseDeploymentAnchor(env[AUTHORITY_ANCHOR_ENV]);
  if (!an.ok) return fail("anchor_" + an.reason);
  if (an.anchor.projectId !== TARGET.projectId || an.anchor.pgServiceId !== TARGET.postgresServiceId || an.anchor.environmentId !== TARGET.environmentId) return fail("anchor_target_not_ai_staging");
  return Object.freeze({
    ok: true, version: STEP67_CONFIG_VERSION, testBoundary,
    executorDbUrlEnvName: DB_ENV.executorDbUrl, readerDbUrlEnvName: DB_ENV.readerDbUrl,
    executorAttester: Object.freeze({ trustRoot: exTr.trustRoot, host: env[EX.host], port: exPort, channelSecretEnvName: EX.channelSecret }),
    readerAttester: Object.freeze({ trustRoot: rdTr.trustRoot, host: rdHost, port: rdPort, channelSecretEnvName: RD.channelSecret, protocol: "reader-attestation-channel-v2" }),
    anchorClusterFingerprint: an.anchor.clusterFingerprint,
  });
}
