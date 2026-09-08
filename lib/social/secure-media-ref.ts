import { createHmac, timingSafeEqual } from "node:crypto";

const DOMAIN = "staybid:sec00b:media-ref:v1";
const UUID_V4_LOWER =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SIG_RE = /^[0-9a-f]{64}$/;

function signingKey(): string | null {
  const raw = (process.env.JWT_ACCESS_SECRET || "").trim();
  return raw.length >= 32 ? raw : null;
}

export function isMediaSessionId(v: unknown): v is string {
  return typeof v === "string" && UUID_V4_LOWER.test(v);
}

export function isMediaRefSignature(v: unknown): v is string {
  return typeof v === "string" && SIG_RE.test(v);
}

export function signSecureMediaRef(
  sessionId: string,
  ownerUserId: string,
): string | null {
  const key = signingKey();
  if (
    !key ||
    !isMediaSessionId(sessionId) ||
    typeof ownerUserId !== "string" ||
    ownerUserId.length === 0
  ) {
    return null;
  }
  return createHmac("sha256", key)
    .update(`${DOMAIN}\n${sessionId}\n${ownerUserId}`)
    .digest("hex");
}

export function verifySecureMediaRef(
  sessionId: string,
  ownerUserId: string,
  signature: string,
): boolean {
  if (!isMediaRefSignature(signature)) return false;
  const expected = signSecureMediaRef(sessionId, ownerUserId);
  if (!expected) return false;
  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(signature, "hex"),
  );
}

export function secureMediaPath(
  sessionId: string,
  ownerUserId: string,
): string | null {
  const sig = signSecureMediaRef(sessionId, ownerUserId);
  return sig ? `/api/social/media/${sessionId}/${sig}` : null;
}
