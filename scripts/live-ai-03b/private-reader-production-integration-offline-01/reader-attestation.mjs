// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — independent READER AUTHORITY ATTESTATION verification (OFFLINE). Node built-ins only.
//
// A reader-privilege / connection-identity claim is accepted ONLY as an Ed25519-signed attestation
// issued by an independent, Owner-controlled attester that lives OUTSIDE the reader host, the gateway,
// the probe and the activation executor. This module VERIFIES; it contains no signing key and no
// signing code (the reader host never holds signing authority).
//
// Reuse, not reinvention: canonical bytes, fingerprinting and Ed25519 verification are the ACCEPTED
// primitives from trusted-activation-boundary-01/pricing-approval-contract.mjs (canonicalize,
// publicKeyFingerprintFromDerB64, verifyEnvelopeSignature). A plain object carrying a "trusted"
// provenance string is never proof: without a valid signature under the deployment-pinned trust root,
// verification fails closed.
// ─────────────────────────────────────────────────────────────────────────
import { createPublicKey } from "node:crypto";
import { FIXED, canonicalize, publicKeyFingerprintFromDerB64, verifyEnvelopeSignature } from "../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import { READER_ROLE, READER_EXPECTED_SELECT_GRANTS, READER_PRIVILEGE_PROOF_CONTRACT } from "../private-reader-host-runtime-offline-01/reader-only-authority.mjs";

export const ATTESTATION_CONTRACT = "AiStagingReaderAttestationV1";
export const ATTESTATION_DOMAIN = "staybid.live-ai-03b.reader-authority-attestation.v1";
export const ATTESTATION_MAX_LIFETIME_MS = READER_PRIVILEGE_PROOF_CONTRACT.max_age_ms;        // 300000 (accepted ≤5 min)
export const ATTESTATION_FORWARD_TOLERANCE_MS = READER_PRIVILEGE_PROOF_CONTRACT.clock_forward_tolerance_ms; // 5000
export const TEST_ISSUER_PREFIX = "TEST-ONLY-";

const PAYLOAD_KEYS = ["connection", "contract", "domain", "expiresAtMs", "issuedAtMs", "issuer", "keyId", "privileges", "requestNonce", "target"].sort();
const TARGET_KEYS = ["environmentId", "pgServiceId", "projectId"].sort();
const CONNECTION_KEYS = ["role", "token"].sort();
const PRIVILEGE_KEYS = ["currentUser", "effectiveSelectOnly", "forbiddenObjectAccessible", "ownerOrExecutorAuthority", "selectGrantCount",
  "unapprovedRoleMembership", "unapprovedRoutineAuthority", "writePrivilegeCount"].sort();

function fail(reason) { return { ok: false, reason }; }
function exactKeys(o, keys) { return !!o && typeof o === "object" && !Array.isArray(o) && JSON.stringify(Object.keys(o).sort()) === JSON.stringify(keys); }
const isInt = (n) => Number.isInteger(n);

/**
 * Build the pinned attester trust root from DEPLOYMENT configuration (never from the attestation
 * channel). The fingerprint is recomputed from the DER key and must equal the separately configured
 * fingerprint; the key must be Ed25519. A TEST-ONLY issuer is refused unless `allowTestIssuer`.
 */
export function makeAttesterTrustRoot({ issuer, publicKeyDerB64, fingerprint } = {}, { allowTestIssuer = false } = {}) {
  if (typeof issuer !== "string" || !/^[A-Za-z0-9._:-]{3,128}$/.test(issuer)) return fail("trust_root_issuer_invalid");
  if (!allowTestIssuer && issuer.startsWith(TEST_ISSUER_PREFIX)) return fail("trust_root_test_issuer_refused");
  if (typeof fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(fingerprint)) return fail("trust_root_fingerprint_malformed");
  let fp, type;
  try {
    fp = publicKeyFingerprintFromDerB64(publicKeyDerB64);
    type = createPublicKey({ key: Buffer.from(publicKeyDerB64, "base64"), format: "der", type: "spki" }).asymmetricKeyType;
  } catch { return fail("trust_root_key_invalid"); }
  if (type !== "ed25519") return fail("trust_root_key_not_ed25519");
  if (fp !== fingerprint) return fail("trust_root_fingerprint_mismatch");
  return { ok: true, trustRoot: Object.freeze({ issuer, publicKeyDerB64, fingerprint, test: issuer.startsWith(TEST_ISSUER_PREFIX) }) };
}

/**
 * Verify a signed reader attestation envelope `{ payload, signatureB64 }` against the PINNED trust root
 * and the EXPECTED binding (the reader host's own observed connection token + the request nonce it sent).
 * Any key material inside the envelope is ignored. Returns { ok:true, attestation } (frozen payload) or
 * { ok:false, reason } with a fixed reason code.
 *   kind of failure: "untrusted" (shape/signature/issuer) vs "binding" vs "freshness" vs "drift" (a
 *   genuinely signed attestation that reports a privilege/target state the reader must not serve under).
 */
export function verifyReaderAttestation(envelope, { trustRoot, expectedConnectionToken, expectedRequestNonce, now } = {}) {
  if (!trustRoot || typeof trustRoot.publicKeyDerB64 !== "string") return fail("trust_root_absent");
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return fail("attestation_absent");
  const { payload, signatureB64 } = envelope;
  if (!exactKeys(payload, PAYLOAD_KEYS)) return fail("attestation_malformed");
  if (typeof signatureB64 !== "string" || signatureB64.length < 16 || signatureB64.length > 256) return fail("attestation_signature_malformed");
  if (payload.contract !== ATTESTATION_CONTRACT || payload.domain !== ATTESTATION_DOMAIN) return fail("attestation_contract_mismatch");
  if (!exactKeys(payload.target, TARGET_KEYS) || !exactKeys(payload.connection, CONNECTION_KEYS) || !exactKeys(payload.privileges, PRIVILEGE_KEYS)) return fail("attestation_malformed");
  // canonical bytes must be computable (no floats / unsupported types) before any signature check
  try { canonicalize(payload); } catch { return fail("attestation_malformed"); }
  if (payload.issuer !== trustRoot.issuer) return fail("attestation_issuer_untrusted");
  if (payload.keyId !== trustRoot.fingerprint) return fail("attestation_key_untrusted");
  if (!verifyEnvelopeSignature(payload, signatureB64, trustRoot.publicKeyDerB64)) return fail("attestation_signature_invalid");

  // ── freshness (≤ 5 min, not future-dated, not expired) ──
  if (typeof now !== "number" || !Number.isFinite(now)) return fail("clock_absent");
  const { issuedAtMs, expiresAtMs } = payload;
  if (!isInt(issuedAtMs) || !isInt(expiresAtMs) || expiresAtMs <= issuedAtMs) return fail("attestation_validity_malformed");
  if (expiresAtMs - issuedAtMs > ATTESTATION_MAX_LIFETIME_MS) return fail("attestation_lifetime_too_long");
  if (issuedAtMs - now > ATTESTATION_FORWARD_TOLERANCE_MS) return fail("attestation_future_dated");
  if (now - issuedAtMs > ATTESTATION_MAX_LIFETIME_MS) return fail("attestation_stale");
  if (now >= expiresAtMs) return fail("attestation_expired");

  // ── binding to THIS physical reader connection + THIS request ──
  if (typeof expectedConnectionToken !== "string" || expectedConnectionToken.length < 16) return fail("expected_connection_token_absent");
  if (payload.connection.token !== expectedConnectionToken) return fail("attestation_connection_mismatch");
  if (payload.connection.role !== READER_ROLE) return fail("attestation_role_mismatch");
  if (typeof expectedRequestNonce !== "string" || payload.requestNonce !== expectedRequestNonce) return fail("attestation_request_nonce_mismatch");

  // ── independently observed target (AI-STAGING only; CORE-PROD refused) ──
  const t = payload.target;
  if (t.pgServiceId === FIXED.core_excluded_postgres || t.projectId === FIXED.core_excluded_project) return fail("drift_target_is_core_prod");
  if (t.pgServiceId !== FIXED.ai_staging_postgres || t.projectId !== FIXED.ai_staging_project || t.environmentId !== FIXED.ai_staging_environment) return fail("drift_target_not_ai_staging");

  // ── independently observed effective privileges of THIS connection ──
  const p = payload.privileges;
  if (p.currentUser !== READER_ROLE) return fail("drift_current_user");
  if (p.effectiveSelectOnly !== true) return fail("drift_not_select_only");
  if (p.writePrivilegeCount !== 0) return fail("drift_write_privilege");
  if (p.selectGrantCount !== READER_EXPECTED_SELECT_GRANTS) return fail("drift_select_grant_count");
  if (p.forbiddenObjectAccessible !== false) return fail("drift_forbidden_object_accessible");
  if (p.unapprovedRoleMembership !== false) return fail("drift_role_membership");
  if (p.unapprovedRoutineAuthority !== false) return fail("drift_routine_authority");
  if (p.ownerOrExecutorAuthority !== false) return fail("drift_owner_or_executor_authority");

  return { ok: true, attestation: Object.freeze({ ...payload, target: Object.freeze({ ...t }), connection: Object.freeze({ ...payload.connection }), privileges: Object.freeze({ ...p }) }) };
}

export const isDriftReason = (reason) => typeof reason === "string" && reason.startsWith("drift_");
