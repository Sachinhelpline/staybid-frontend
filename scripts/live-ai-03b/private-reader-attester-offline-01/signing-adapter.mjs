// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — ATTESTER: Ed25519 SIGNING ADAPTER (OFFLINE). Node built-ins only.
//
// The signing key exists ONLY here, loaded from the attester's own secret custody at startup. It is never
// logged, returned, placed in an envelope, shared with the reader host or gateway, or written to any
// artifact. The adapter cannot sign a caller-supplied payload: it accepts only measured evidence fields
// and builds the accepted AiStagingReaderAttestationV1 payload itself.
// ─────────────────────────────────────────────────────────────────────────
import { createPrivateKey, createPublicKey, sign as edSign } from "node:crypto";
import { canonicalize, publicKeyFingerprintFromDerB64 } from "../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import { ATTESTATION_CONTRACT, ATTESTATION_DOMAIN, ATTESTATION_MAX_LIFETIME_MS } from "../private-reader-production-integration-offline-01/reader-attestation.mjs";
import { READER_ROLE } from "./evidence-queries.mjs";

function fail(reason) { return { ok: false, reason }; }

/**
 * Load the Ed25519 signing key from a PKCS#8 base64 secret. Returns a closure-held signer exposing only
 * issue() and the PUBLIC identity (issuer + keyId) the reader host pins separately.
 */
export function createSigningAdapter({ issuer, privateKeyPkcs8B64, proofLifetimeMs, nowProvider = Date.now }) {
  if (typeof issuer !== "string" || !/^[A-Za-z0-9._:-]{3,128}$/.test(issuer)) return fail("issuer_invalid");
  if (!Number.isInteger(proofLifetimeMs) || proofLifetimeMs < 1000 || proofLifetimeMs > ATTESTATION_MAX_LIFETIME_MS) return fail("proof_lifetime_invalid");
  let key, publicKeyDerB64, keyId;
  try {
    key = createPrivateKey({ key: Buffer.from(String(privateKeyPkcs8B64), "base64"), format: "der", type: "pkcs8" });
    if (key.asymmetricKeyType !== "ed25519") return fail("signing_key_not_ed25519");
    publicKeyDerB64 = createPublicKey(key).export({ type: "spki", format: "der" }).toString("base64");
    keyId = publicKeyFingerprintFromDerB64(publicKeyDerB64);
  } catch { return fail("signing_key_invalid"); }

  /**
   * Build + sign the accepted payload from MEASURED evidence only. The caller supplies no payload field
   * other than the request nonce it is answering.
   */
  function issue({ requestNonce, target, connection, privileges }) {
    if (typeof requestNonce !== "string" || !/^[0-9a-f]{32}$/.test(requestNonce)) return fail("request_nonce_invalid");
    if (!target || !connection || !privileges) return fail("evidence_incomplete");
    if (connection.role !== READER_ROLE || typeof connection.token !== "string" || !/^[0-9a-f]{64}$/.test(connection.token)) return fail("evidence_incomplete");
    const t = nowProvider();
    if (!Number.isInteger(t)) return fail("clock_invalid");
    const payload = {
      contract: ATTESTATION_CONTRACT, domain: ATTESTATION_DOMAIN, issuer, keyId,
      issuedAtMs: t, expiresAtMs: t + proofLifetimeMs, requestNonce,
      target: { projectId: target.projectId, environmentId: target.environmentId, pgServiceId: target.pgServiceId },
      connection: { role: connection.role, token: connection.token },
      privileges: {
        currentUser: privileges.currentUser, effectiveSelectOnly: privileges.effectiveSelectOnly,
        forbiddenObjectAccessible: privileges.forbiddenObjectAccessible, ownerOrExecutorAuthority: privileges.ownerOrExecutorAuthority,
        selectGrantCount: privileges.selectGrantCount, unapprovedRoleMembership: privileges.unapprovedRoleMembership,
        unapprovedRoutineAuthority: privileges.unapprovedRoutineAuthority, writePrivilegeCount: privileges.writePrivilegeCount,
      },
    };
    let signatureB64;
    try { signatureB64 = edSign(null, Buffer.from(canonicalize(payload), "utf8"), key).toString("base64"); }
    catch { return fail("signing_failed"); }
    return { ok: true, envelope: { payload, signatureB64 } };
  }

  return { ok: true, signer: Object.freeze({ issuer, keyId, publicKeyDerB64, issue }) };
}
