// SEC-00A + SEC-00B media URL policy.
//
// Legacy social-media public object URLs remain accepted so existing posts keep
// rendering before/after cutover. SEC-00B adds a second, strictly-relative
// StayBid delivery reference for READY media produced by the private pipeline.

export const SB_STORAGE_HOST = "uxxhbdqedazpmvbvaosh.supabase.co";
export const SB_STORAGE_ORIGIN = "https://uxxhbdqedazpmvbvaosh.supabase.co";
export const PUBLIC_SOCIAL_MEDIA_PREFIX = "/storage/v1/object/public/social-media/";
export const SOUNDHELIX_HOST = "www.soundhelix.com";
export const SOUNDHELIX_ORIGIN = "https://www.soundhelix.com";
export const SOUNDHELIX_MAX_SONG = 16;

const SECURE_MEDIA_PREFIX = "/api/social/media/";
const UUID_V4_LOWER =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SIG_RE = /^[0-9a-f]{64}$/;

function parseUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (raw.startsWith("//")) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function baseAllowed(u: URL): boolean {
  if (u.protocol !== "https:") return false;
  if (u.username !== "" || u.password !== "") return false;
  return true;
}

export function secureMediaParts(
  raw: unknown,
): { sessionId: string; signature: string } | null {
  if (typeof raw !== "string" || !raw.startsWith(SECURE_MEDIA_PREFIX)) return null;
  if (raw.includes("?") || raw.includes("#")) return null;
  const rest = raw.slice(SECURE_MEDIA_PREFIX.length);
  const parts = rest.split("/");
  if (parts.length !== 2) return null;
  const [sessionId, signature] = parts;
  if (!UUID_V4_LOWER.test(sessionId) || !SIG_RE.test(signature)) return null;
  return `${SECURE_MEDIA_PREFIX}${sessionId}/${signature}` === raw
    ? { sessionId, signature }
    : null;
}

export function isAllowedSecureMediaPath(raw: unknown): boolean {
  return secureMediaParts(raw) !== null;
}

export function isAllowedStayBidPublicMediaUrl(raw: unknown): boolean {
  const u = parseUrl(raw);
  if (!u || !baseAllowed(u)) return false;
  if (u.origin !== SB_STORAGE_ORIGIN) return false;
  if (!u.pathname.startsWith(PUBLIC_SOCIAL_MEDIA_PREFIX)) return false;
  if (u.pathname.length <= PUBLIC_SOCIAL_MEDIA_PREFIX.length) return false;
  return true;
}

export function isAllowedSoundHelixUrl(raw: unknown): boolean {
  const u = parseUrl(raw);
  if (!u || !baseAllowed(u)) return false;
  if (u.origin !== SOUNDHELIX_ORIGIN) return false;
  const m = /^\/examples\/mp3\/SoundHelix-Song-(\d{1,2})\.mp3$/.exec(u.pathname);
  if (!m) return false;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 && n <= SOUNDHELIX_MAX_SONG;
}

export function isAllowedMediaUrl(raw: unknown): boolean {
  return isAllowedSecureMediaPath(raw) || isAllowedStayBidPublicMediaUrl(raw);
}

export function isAllowedThumbnailUrl(raw: unknown): boolean {
  return isAllowedSecureMediaPath(raw) || isAllowedStayBidPublicMediaUrl(raw);
}

export function isAllowedSoundUrl(raw: unknown): boolean {
  return (
    isAllowedSecureMediaPath(raw) ||
    isAllowedStayBidPublicMediaUrl(raw) ||
    isAllowedSoundHelixUrl(raw)
  );
}

export function isEmptyOptionalUrl(raw: unknown): boolean {
  return (
    raw === undefined ||
    raw === null ||
    (typeof raw === "string" && raw.length === 0)
  );
}

export type MediaUrlError =
  | "Invalid media URL"
  | "Invalid thumbnail URL"
  | "Invalid sound URL";

export function validatePostMediaUrls(input: {
  mediaUrl: unknown;
  thumbnailUrl?: unknown;
  soundUrl?: unknown;
}): MediaUrlError | null {
  if (!isAllowedMediaUrl(input.mediaUrl)) return "Invalid media URL";
  if (
    !isEmptyOptionalUrl(input.thumbnailUrl) &&
    !isAllowedThumbnailUrl(input.thumbnailUrl)
  ) {
    return "Invalid thumbnail URL";
  }
  if (
    !isEmptyOptionalUrl(input.soundUrl) &&
    !isAllowedSoundUrl(input.soundUrl)
  ) {
    return "Invalid sound URL";
  }
  return null;
}

export function validateOptionalSoundUrl(raw: unknown): MediaUrlError | null {
  if (isEmptyOptionalUrl(raw)) return null;
  return isAllowedSoundUrl(raw) ? null : "Invalid sound URL";
}
