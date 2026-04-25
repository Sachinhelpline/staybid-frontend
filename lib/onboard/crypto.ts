// AES-256-GCM symmetric encryption for sensitive at-rest fields (bank account
// number primarily). Key sourced from ONBOARD_ENC_KEY (recommended: 32-byte
// hex). Falls back to a derived key from ONBOARD_JWT_SECRET so the system
// always functions; production deployments should set ONBOARD_ENC_KEY explicitly.

import crypto from "crypto";

function getKey(): Buffer {
  const k = process.env.ONBOARD_ENC_KEY;
  if (k && /^[0-9a-fA-F]{64}$/.test(k)) return Buffer.from(k, "hex");
  const seed = process.env.ONBOARD_JWT_SECRET || "staybid-onboarding-dev-secret-change-in-prod";
  return crypto.createHash("sha256").update(seed + ":enc").digest();
}

/** Returns base64 string of [iv(12)|tag(16)|ciphertext]. */
export function encryptString(plain: string): string {
  if (!plain) return "";
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptString(packed: string): string {
  if (!packed) return "";
  const buf = Buffer.from(packed, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const key = getKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function last4(s: string): string {
  const digits = (s || "").replace(/\D/g, "");
  return digits.slice(-4);
}
