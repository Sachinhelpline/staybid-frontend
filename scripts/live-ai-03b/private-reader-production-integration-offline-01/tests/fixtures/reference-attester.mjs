// OFFLINE REFERENCE ATTESTER — TEST FIXTURE ONLY. Never imported by any production module (source-scan
// asserted). Models the independent, Owner-controlled attestation authority that lives OUTSIDE the reader
// host / gateway / probe / executor: it holds the signing key, INDEPENDENTLY observes the synthetic
// database's session table + privilege state (it does not trust the requester's claims), and signs an
// AiStagingReaderAttestationV1 over the accepted canonical bytes. Its issuer id is TEST-ONLY-prefixed,
// so production configuration refuses its trust root.
import { generateKeyPairSync, sign } from "node:crypto";
import { FIXED, canonicalize, publicKeyFingerprintFromDerB64 } from "../../../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import { ATTESTATION_CONTRACT, ATTESTATION_DOMAIN } from "../../reader-attestation.mjs";
import { connectionTokenFor } from "../../reader-session.mjs";

export function makeReferenceAttester({ db, nowProvider, issuer = "TEST-ONLY-reference-attester", lifetimeMs = 300000 } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyDerB64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const fingerprint = publicKeyFingerprintFromDerB64(publicKeyDerB64);
  const ctl = { fail: false, mutate: null, replay: null, issued: 0 };
  const signPayload = (payload) => sign(null, Buffer.from(canonicalize(payload), "utf8"), privateKey).toString("base64");
  const source = {
    async obtain(req) {
      if (ctl.fail) throw new Error("attester unavailable");
      if (ctl.replay) return ctl.replay;                 // returns a previously issued envelope verbatim
      // independent observation: find the live session whose OWN observed identity yields this token
      const s = db.observeSessions().find((x) => connectionTokenFor(x) === req.connectionToken);
      if (!s) throw new Error("no such session");
      const pv = db.observePrivileges(s);
      const t = nowProvider();
      let payload = {
        contract: ATTESTATION_CONTRACT, domain: ATTESTATION_DOMAIN, issuer, keyId: fingerprint,
        issuedAtMs: t, expiresAtMs: t + lifetimeMs, requestNonce: req.requestNonce,
        target: { projectId: db.target.projectId, environmentId: db.target.environmentId, pgServiceId: db.target.pgServiceId },
        connection: { token: connectionTokenFor(s), role: s.usename },
        privileges: { ...pv },
      };
      if (ctl.mutate) payload = ctl.mutate(payload);
      ctl.issued++;
      const env = { payload, signatureB64: signPayload(payload) };
      ctl.last = env;
      return env;
    },
  };
  return { trustRootConfig: { issuer, publicKeyDerB64, fingerprint }, source, ctl, signPayload };
}

export const AI_STAGING_TARGET = Object.freeze({ projectId: FIXED.ai_staging_project, environmentId: FIXED.ai_staging_environment, pgServiceId: FIXED.ai_staging_postgres });
