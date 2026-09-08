const UUID_V4_LOWER =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export function isMediaSessionId(v: unknown): v is string {
  return typeof v === "string" && UUID_V4_LOWER.test(v);
}

export function isMediaRefSignature(v: unknown): v is string {
  return typeof v === "string" && SHA256_RE.test(v);
}

// The reference token is the immutable SHA-256 recorded by the trusted
// processing worker when the session becomes READY. It is not caller authority:
// the owner-bound status endpoint is the only place that reveals it before
// publication, and the delivery route additionally requires an APPROVED /
// AUTO_APPROVED social_posts reference before serving bytes.
export function secureMediaPath(
  sessionId: string,
  processedSha256: string,
): string | null {
  if (!isMediaSessionId(sessionId) || !isMediaRefSignature(processedSha256)) {
    return null;
  }
  return `/api/social/media/${sessionId}/${processedSha256}`;
}

export function verifySecureMediaRef(
  sessionId: string,
  processedSha256: string,
  signature: string,
): boolean {
  return (
    isMediaSessionId(sessionId) &&
    isMediaRefSignature(processedSha256) &&
    isMediaRefSignature(signature) &&
    processedSha256 === signature
  );
}
