// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 V2 PRODUCTION AUTHORITY PROVISIONING — reviewer PUBLIC trust root. OFFLINE candidate.
// Loads ONLY the independently pinned reviewer PUBLIC Ed25519 key (DER SPKI, base64) + its SHA-256 fingerprint
// from the validated V2 config. The fingerprint is RECOMPUTED with the accepted Step-1 V2 primitive and must
// equal the configured one. Private-key material in any form is refused. The key is never taken from an
// approval envelope (the frozen verifier only ever uses this pinned root).
// ─────────────────────────────────────────────────────────────────────────
import { createPublicKey, createPrivateKey } from "node:crypto";
import { publicKeyFingerprintFromDerB64 } from "../../m7-step1-hb1-consolidated-remediation-01/approval/pricing-approval-contract-v2.mjs";

const fail = (reason) => ({ ok: false, reason });
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function loadReviewerTrustRootV2(cfg) {
  if (!cfg || cfg.ok !== true || !cfg.reviewer) return fail("reviewer_config_absent");
  const der = cfg.reviewer.pinnedPublicKeyDerB64, fp = cfg.reviewer.pinnedFingerprint;
  if (typeof der !== "string" || der.length === 0) return fail("reviewer_public_key_absent");
  if (/PRIVATE|BEGIN /.test(der)) return fail("reviewer_private_key_material_refused");
  if (!B64.test(der) || der.length % 4 !== 0) return fail("reviewer_public_key_not_base64_der");
  const buf = Buffer.from(der, "base64");
  // a PKCS#8 private key parses as a private key — refuse it outright, whatever else it might also be.
  let isPrivate = false;
  try { createPrivateKey({ key: buf, format: "der", type: "pkcs8" }); isPrivate = true; } catch {}
  if (isPrivate) return fail("reviewer_private_key_material_refused");
  let type;
  try { type = createPublicKey({ key: buf, format: "der", type: "spki" }).asymmetricKeyType; } catch { return fail("reviewer_public_key_invalid_der"); }
  if (type !== "ed25519") return fail("reviewer_public_key_not_ed25519");
  let computed;
  try { computed = publicKeyFingerprintFromDerB64(der); } catch { return fail("reviewer_public_key_invalid_der"); }
  if (typeof fp !== "string" || !/^[0-9a-f]{64}$/.test(fp)) return fail("reviewer_fingerprint_malformed");
  if (computed !== fp) return fail("reviewer_fingerprint_mismatch");
  return { ok: true, trustRoot: Object.freeze({ pinnedPublicKeyDerB64: der, pinnedFingerprint: fp }) };
}
