// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 V2 EXECUTOR ATTESTATION ISSUER — Ed25519 SIGNING ADAPTER. OFFLINE candidate.
//
// The issuer's OWN signing key exists only inside this closure (loaded from its own secret custody at startup). It
// is never logged, returned, placed in an envelope or error, and is not the reader attester's key (its fingerprint
// must differ from the configured reader-attester fingerprint, and equal this issuer's configured public identity).
//
// The adapter cannot sign a caller-supplied payload: issue() takes MEASURED evidence + the request nonce it answers
// and builds the EXACT AiStagingExecutorAttestationV1 payload itself, with the accepted primitives (canonicalize +
// Ed25519, the same bytes verifyEnvelopeSignature checks). issuedAtMs comes from the issuer's trusted host clock
// (bound to the DB clock by the evaluator); expiresAtMs = issuedAtMs + the configured lifetime (≤ the preserved
// verifier's ATTESTATION_MAX_LIFETIME_MS). No caller time, no caller expiry.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
import { createPrivateKey, createPublicKey, sign as edSign } from "node:crypto";
import { canonicalize, publicKeyFingerprintFromDerB64 } from "../../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import { EXECUTOR_ATTESTATION_CONTRACT, EXECUTOR_ATTESTATION_DOMAIN, ATTESTATION_MAX_LIFETIME_MS, EXECUTOR_PRIVILEGE_KEYS }
  from "../../m7-v2-production-authority-provisioning-offline-01/src/executor-attestation.mjs";
import { TEST_ISSUER_PREFIX } from "../../private-reader-production-integration-offline-01/reader-attestation.mjs";
import { EXECUTOR_ROLE } from "./executor-evidence-queries.mjs";

const fail = (reason) => ({ ok: false, reason });
const ISSUER_RE = /^[A-Za-z0-9._:-]{3,128}$/;

/**
 * @param issuer this issuer's id · @param privateKeyPkcs8B64 its OWN Ed25519 PKCS#8 key (secret)
 * @param expectedPublicKeyDerB64 / expectedFingerprint its configured PUBLIC identity (must match the key)
 * @param readerAttesterFingerprint the accepted reader attester's public fingerprint (must DIFFER)
 */
export function createExecutorSigningAdapter({ issuer, privateKeyPkcs8B64, expectedPublicKeyDerB64, expectedFingerprint, readerAttesterFingerprint,
  proofLifetimeMs, nowProvider = Date.now, offlineTestBoundary = false }) {
  if (typeof issuer !== "string" || !ISSUER_RE.test(issuer)) return fail("issuer_invalid");
  if (!offlineTestBoundary && issuer.startsWith(TEST_ISSUER_PREFIX)) return fail("issuer_test_only_refused");
  if (!Number.isInteger(proofLifetimeMs) || proofLifetimeMs < 1000 || proofLifetimeMs > ATTESTATION_MAX_LIFETIME_MS) return fail("proof_lifetime_invalid");
  let key, publicKeyDerB64, keyId;
  try {
    key = createPrivateKey({ key: Buffer.from(String(privateKeyPkcs8B64), "base64"), format: "der", type: "pkcs8" });
    if (key.asymmetricKeyType !== "ed25519") return fail("signing_key_not_ed25519");
    publicKeyDerB64 = createPublicKey(key).export({ type: "spki", format: "der" }).toString("base64");
    keyId = publicKeyFingerprintFromDerB64(publicKeyDerB64);
  } catch { return fail("signing_key_invalid"); }
  if (publicKeyDerB64 !== expectedPublicKeyDerB64 || keyId !== expectedFingerprint) return fail("signing_key_not_configured_identity");
  if (typeof readerAttesterFingerprint !== "string" || keyId === readerAttesterFingerprint) return fail("signing_key_not_distinct_from_reader_attester");

  /** Build + sign the exact payload from MEASURED evidence. The caller supplies only the nonce it is answering. */
  function issue({ requestNonce, target, connection, privileges }) {
    if (typeof requestNonce !== "string" || !/^[0-9a-f]{32}$/.test(requestNonce)) return fail("request_nonce_invalid");
    if (!target || !connection || !privileges) return fail("evidence_incomplete");
    if (connection.role !== EXECUTOR_ROLE || typeof connection.token !== "string" || !/^[0-9a-f]{64}$/.test(connection.token)) return fail("evidence_incomplete");
    if (JSON.stringify(Object.keys(privileges).sort()) !== JSON.stringify(EXECUTOR_PRIVILEGE_KEYS)) return fail("evidence_incomplete");
    const t = nowProvider();
    if (!Number.isSafeInteger(t)) return fail("clock_invalid");
    const payload = {
      contract: EXECUTOR_ATTESTATION_CONTRACT, domain: EXECUTOR_ATTESTATION_DOMAIN, issuer, keyId,
      issuedAtMs: t, expiresAtMs: t + proofLifetimeMs, requestNonce,
      target: { projectId: target.projectId, environmentId: target.environmentId, pgServiceId: target.pgServiceId },
      connection: { role: connection.role, token: connection.token },
      privileges: {
        budgetTablePrivilegeCount: privileges.budgetTablePrivilegeCount,
        currentUser: privileges.currentUser,
        executableRoutines: [...privileges.executableRoutines],
        ledgerPrivilegeCount: privileges.ledgerPrivilegeCount,
        publicOrDefaultPrivilegeWidening: privileges.publicOrDefaultPrivilegeWidening,
        rolbypassrls: privileges.rolbypassrls, rolcreatedb: privileges.rolcreatedb, rolcreaterole: privileges.rolcreaterole,
        rolreplication: privileges.rolreplication, rolsuper: privileges.rolsuper,
        roleMemberships: [...privileges.roleMemberships],
        schemaCreate: [...privileges.schemaCreate],
        sessionUser: privileges.sessionUser,
        trustedSchemaUsage: [...privileges.trustedSchemaUsage],
        unapprovedRoutineExecute: privileges.unapprovedRoutineExecute,
      },
    };
    let signatureB64;
    try { signatureB64 = edSign(null, Buffer.from(canonicalize(payload), "utf8"), key).toString("base64"); } catch { return fail("signing_failed"); }
    return { ok: true, envelope: { payload, signatureB64 } };
  }

  return { ok: true, signer: Object.freeze({ issuer, keyId, publicKeyDerB64, proofLifetimeMs, test: issuer.startsWith(TEST_ISSUER_PREFIX), issue }) };
}
