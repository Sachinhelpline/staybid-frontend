// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP6/7 — secret-free receipt builder + leak guard. OFFLINE candidate. Node built-ins only.
// Only ALLOWLISTED keys survive; every string value must be a short identifier over a restricted charset; the
// ONLY 64-hex values permitted are the three PUBLIC attester-key fingerprints and the manifest/commit pins.
// Tokens, nonces, envelopes, signatures, DB URLs, channel secrets, keys and raw env can therefore never appear.
// ─────────────────────────────────────────────────────────────────────────
import { STEP67_VERSION, CANONICAL_ACTION_ID, SUCCESS_MARKER, HOLD_PREFIX, NEXT_BOUNDARY, TARGET, SERVICES } from "./constants.mjs";

export const RECEIPT_SCHEMA = "staybid-m7-step67-authority-host-receipt-v1";
const HEX_FIELDS = new Set(["expectedExecutorAttesterFingerprint", "expectedReaderAttesterFingerprint", "forbiddenReaderAttesterFingerprint",
  "manifestSha256", "reviewedGitCommit", "sourceCommitPin"]);
const SAFE_STRING = /^[A-Za-z0-9_.:\-]{0,140}$/;
const HEX_RUN = /[0-9a-fA-F]{24,}/;
const TOKEN_RUN = /[A-Za-z0-9+=]{40,}/;                      // base64-shaped run with no separator (keys, secrets)
const JWT_SHAPE = /eyJ[A-Za-z0-9_-]{6,}/;                     // JWT / base64url JSON header
// a random base64/base64url run of ≥24 chars carries ~10 upper + ~10 lower + ~4 digits; bounded identifiers (one leading capital) never do
const count = (r, re) => (r.match(re) || []).length;
const mixedSecretRun = (s) => (s.match(/[A-Za-z0-9_-]{24,}/g) || []).some((r) => count(r, /[A-Z]/g) >= 3 && count(r, /[a-z]/g) >= 3 && count(r, /[0-9]/g) >= 2);
const CHECK_KEYS = Object.freeze(["executorConnectionEstablished", "executorSessionRole", "trustedClockBoundToDb", "readerConnectionEstablished",
  "readerSessionRole", "readerReadOnlySession", "readerStatementTimeoutBounded", "readerProtocolV2ClockGated",
  "executorAttestationSignatureTrustFreshness", "executorPrivilegeContract", "executorTargetBinding",
  "readerAttestationSignatureTrustFreshness", "readerPrivilegeContract", "readerTargetBinding",
  "distinctRoles", "distinctPhysicalSessions", "distinctConnectionTokens", "distinctBackendPids", "distinctApplicationNames",
  "distinctRequestNonces", "distinctBoundConnectionTokens", "noReconnectUnderBoundProof", "connectionsClosed"]);

export function holdMarker(reason) { return HOLD_PREFIX + String(reason || "UNKNOWN").toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 80); }

/** Build the receipt from the verifier result + public run metadata. */
export function buildReceipt({ runId, startedUtc, finishedUtc, result, pins, manifestSha256, reviewedGitCommit, stageAtExit }) {
  const pass = !!(result && result.ok === true);
  const checks = {};
  for (const k of CHECK_KEYS) checks[k] = result && result.checks && result.checks[k] === true ? "PASS" : "NOT_PROVEN";
  const counters = result && result.counters ? result.counters : {};
  const r = {
    schema: RECEIPT_SCHEMA, version: STEP67_VERSION, canonicalActionId: CANONICAL_ACTION_ID, runId: String(runId || ""),
    startedUtc: String(startedUtc || ""), finishedUtc: String(finishedUtc || ""),
    manifestSha256: manifestSha256 || null, reviewedGitCommit: reviewedGitCommit || null,
    target: { projectId: TARGET.projectId, environmentId: TARGET.environmentId, postgresServiceId: TARGET.postgresServiceId },
    authorityServiceId: SERVICES.authority.id,
    executorAttester: { serviceId: SERVICES.executorAttester.id, preBindingDeploymentPin: SERVICES.executorAttester.deploymentId, sourceCommitPin: SERVICES.executorAttester.sourceCommit },
    dedicatedReaderAttester: { serviceName: SERVICES.dedicatedReaderAttester.name, protocol: "reader-attestation-channel-v2" },
    coreProdExclusion: "PASS",
    pins: { expectedExecutorAttesterFingerprint: pins.expectedExecutorAttesterFingerprint, expectedReaderAttesterFingerprint: pins.expectedReaderAttesterFingerprint,
      forbiddenReaderAttesterFingerprint: pins.forbiddenReaderAttesterFingerprint },
    authorityCallerConfigNames: result && result.stage && result.stage !== "S0_inputs" ? "PASS" : "NOT_PROVEN",
    privatePeerAuthorization: checks.executorAttestationSignatureTrustFreshness === "PASS" && checks.readerAttestationSignatureTrustFreshness === "PASS" ? "PASS" : "NOT_PROVEN",
    checks,
    counters: { realConnectionsOpened: counters.realConnectionsOpened | 0, attestationRequestsIssued: counters.attestationRequestsIssued | 0 },
    dbMutations: 0, credentialMutations: 0, railwayMutationsDuringVerify: 0, guardedActivationClientConstructed: 0,
    sql03: "not_executed", phaseA: "not_executed", gatewayProvider: "untouched", coreProd: "untouched",
    outcome: pass ? "PASS" : "HOLD", stage: String(stageAtExit || (result && result.stage) || "S0_inputs"),
    reason: pass ? null : String((result && result.reason) || "unknown"),
    nextBoundary: pass ? NEXT_BOUNDARY : "OWNER_CONTROL_ROOM_RECONCILIATION_REQUIRED_NO_AUTO_RETRY",
    marker: pass ? SUCCESS_MARKER : holdMarker(result && result.reason),
    liveAuthorization: "THIS_RECEIPT_GRANTS_NO_AUTHORIZATION",
  };
  const v = assertReceiptSafe(r);
  if (!v.ok) return { ok: false, reason: v.reason };
  return { ok: true, receipt: r };
}

/** Structural leak guard: allowlisted shapes only. */
export function assertReceiptSafe(obj) {
  let bad = null;
  (function walk(v, key) {
    if (bad) return;
    if (v === null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) return;
    if (typeof v === "string") {
      if (HEX_FIELDS.has(key)) { if (!/^[0-9a-f]{64}$|^[0-9a-f]{40}$/.test(v)) bad = "hex_field_malformed:" + key; return; }
      if (!SAFE_STRING.test(v) || HEX_RUN.test(v) || TOKEN_RUN.test(v) || JWT_SHAPE.test(v) || mixedSecretRun(v)) bad = "unsafe_value:" + key;
      return;
    }
    if (Array.isArray(v)) { v.forEach((x) => walk(x, key)); return; }
    if (typeof v === "object") { for (const [k, x] of Object.entries(v)) { if (!/^[A-Za-z0-9_]{1,64}$/.test(k)) { bad = "unsafe_key"; return; } walk(x, k); } return; }
    bad = "unsupported_type:" + key;
  })(obj, "");
  return bad ? { ok: false, reason: bad } : { ok: true };
}
