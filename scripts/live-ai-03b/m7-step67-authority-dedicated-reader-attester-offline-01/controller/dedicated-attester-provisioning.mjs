// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP6/7 — P3 in-memory generation of the dedicated attester's NEW identity. OFFLINE candidate.
// Executed only inside ONE separately authorized P3 controller run. Node built-ins only; never prints a secret.
//   • Ed25519 key pair from node:crypto (CSPRNG); PKCS#8 DER (secret) + SPKI DER (public) + accepted fingerprint;
//   • self-check: the ACCEPTED reader-attester signing adapter, given the new private key, derives exactly the same
//     public key + keyId the Authority will pin (so a mismatched custody pair is impossible to stage);
//   • distinctness against the Owner-supplied PUBLIC pins (M5 reader attester + executor attester fingerprints);
//   • a NEW v2 channel secret: 48 random bytes, base64url (64 chars ≥ the accepted 32-char minimum).
// The returned object is consumed immediately by the stdin writer and then dropped (JS strings cannot be zeroised;
// the process exits at the end of P3 — see SECURITY-CONTRACT.md §custody).
// ─────────────────────────────────────────────────────────────────────────
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { publicKeyFingerprintFromDerB64 } from "../../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import { createSigningAdapter } from "../../private-reader-attester-offline-01/signing-adapter.mjs";
import { DEDICATED_PLAN } from "./reference-plan.mjs";
import { DEDICATED_READER_ATTESTER_ISSUER, DEDICATED_ATTESTER_ENV as DA, DEDICATED_PUBLIC_CUSTODY_ENV as DP } from "../src/constants.mjs";
import { ref } from "./reference-plan.mjs";

const HEX64 = /^[0-9a-f]{64}$/;

export function generateDedicatedIdentity({ forbiddenFingerprints }) {
  if (!Array.isArray(forbiddenFingerprints) || forbiddenFingerprints.length < 2 || !forbiddenFingerprints.every((f) => HEX64.test(f))) return { ok: false, reason: "forbidden_fingerprint_pins_required" };
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const signingKeyPkcs8B64 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
  const publicKeyDerB64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const fingerprint = publicKeyFingerprintFromDerB64(publicKeyDerB64);
  const sig = createSigningAdapter({ issuer: DEDICATED_READER_ATTESTER_ISSUER, privateKeyPkcs8B64: signingKeyPkcs8B64, proofLifetimeMs: 120000 });
  if (!sig.ok || sig.signer.keyId !== fingerprint || sig.signer.publicKeyDerB64 !== publicKeyDerB64) return { ok: false, reason: "accepted_signer_self_check_failed" };
  if (forbiddenFingerprints.includes(fingerprint)) return { ok: false, reason: "generated_key_collides_with_existing_attester" };
  const channelSecret = randomBytes(48).toString("base64url");
  return { ok: true, identity: Object.freeze({ signingKeyPkcs8B64, publicKeyDerB64, fingerprint, channelSecret, issuer: DEDICATED_READER_ATTESTER_ISSUER }) };
}

/** The ordered stdin writes for P3 (public + references first, the two secrets LAST). Values are stdin-only. */
export function dedicatedWrites(identity) {
  const out = [];
  for (const e of DEDICATED_PLAN) {
    let v, cls;
    if (e.kind === "reference") { v = ref(e.service, e.variable); cls = "reference_expression"; }
    else if (e.kind === "literal") { v = e.value; cls = "public_literal"; }
    else if (e.dest === DP.publicKeyDerB64) { v = identity.publicKeyDerB64; cls = "public_generated"; }
    else if (e.dest === DP.fingerprint) { v = identity.fingerprint; cls = "public_generated"; }
    else if (e.dest === DA.signingKeyPkcs8B64) { v = identity.signingKeyPkcs8B64; cls = "secret_generated"; }
    else if (e.dest === DA.channelSecret) { v = identity.channelSecret; cls = "secret_generated"; }
    else return { ok: false, reason: "unplanned_destination:" + e.dest };
    out.push(Object.freeze({ name: e.dest, stdinValue: v, class: cls }));
  }
  out.sort((a, b) => (a.class === "secret_generated") - (b.class === "secret_generated"));
  return { ok: true, writes: out };
}

/** Public, non-secret P3 receipt fields (the Owner records these as the future Step6/7 pins). */
export const publicIdentityOf = (identity) => Object.freeze({ issuer: identity.issuer, fingerprint: identity.fingerprint });
