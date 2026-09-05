// ═══════════════════════════════════════════════════════════════════════════
// SEC-00A — interim C2 containment: a shared, pure, server-safe allow-list for
// the media URLs the social-post write routes persist. It stops arbitrary
// client-controlled URLs (data:/blob:/javascript:/external hosts/wrong bucket)
// from being accepted as authoritative social media.
// ───────────────────────────────────────────────────────────────────────────
// SCOPE / HONESTY: this is an INTERIM bridge. It does NOT prove ownership,
// upload provenance, malware safety, or READY status — those come with the
// canonical media id + server-owned facts + READY authority in SEC-01/SEC-06.
// It only contains arbitrary-URL injection/persistence.
//
// PURE + SERVER-SAFE: no imports, no React/CreateFlow, no network, no env.
// Uses standards-based URL parsing (never startsWith/substring/endsWith or a
// regex over the whole raw URL for the security decision).
// ═══════════════════════════════════════════════════════════════════════════

/** The one approved public Storage host (the Supabase project host). */
export const SB_STORAGE_HOST = "uxxhbdqedazpmvbvaosh.supabase.co";
/** The one approved EXACT origin (scheme://host[:port]) — URL.origin excludes
 *  the default 443 port and INCLUDES any non-default port, so an exact-origin
 *  compare rejects host:444 / host:8443 lookalikes that share the hostname. */
export const SB_STORAGE_ORIGIN = "https://uxxhbdqedazpmvbvaosh.supabase.co";
/** The one approved public object prefix (public read of the social-media bucket). */
export const PUBLIC_SOCIAL_MEDIA_PREFIX = "/storage/v1/object/public/social-media/";
/** The current trusted licensed-demo audio host (SoundHelix), used by CreateFlow. */
export const SOUNDHELIX_HOST = "www.soundhelix.com";
/** The one approved EXACT SoundHelix origin (see SB_STORAGE_ORIGIN note). */
export const SOUNDHELIX_ORIGIN = "https://www.soundhelix.com";
/** The current CreateFlow SoundHelix catalogue is songs 1..16. */
export const SOUNDHELIX_MAX_SONG = 16;

/** Standards-based parse. Returns a URL or null (never throws). Rejects
 *  protocol-relative and non-string input up front. */
function parseUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (raw.startsWith("//")) return null; // protocol-relative "//host/..."
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** Common hard rules for any accepted media URL: https only, no embedded
 *  credentials/userinfo. */
function baseAllowed(u: URL): boolean {
  if (u.protocol !== "https:") return false;      // rejects http:/data:/blob:/javascript:/file:/ftp:
  if (u.username !== "" || u.password !== "") return false; // rejects user:pass@host tricks
  return true;
}

/** An approved StayBid PUBLIC social-media object URL (exact host + exact
 *  public prefix + a non-empty object key). Query/fragment cannot bypass:
 *  host/path are read from the parsed URL, not the raw string. */
export function isAllowedStayBidPublicMediaUrl(raw: unknown): boolean {
  const u = parseUrl(raw);
  if (!u || !baseAllowed(u)) return false;
  // SEC-00A-R1 remediation — EXACT approved origin (host AND port), not just
  // hostname: a non-default port is a different origin and must be rejected.
  if (u.origin !== SB_STORAGE_ORIGIN) return false;
  if (!u.pathname.startsWith(PUBLIC_SOCIAL_MEDIA_PREFIX)) return false;
  if (u.pathname.length <= PUBLIC_SOCIAL_MEDIA_PREFIX.length) return false; // must have an object key
  return true;
}

/** A current-catalogue SoundHelix demo track (exact host + exact path shape +
 *  song number in the known range). */
export function isAllowedSoundHelixUrl(raw: unknown): boolean {
  const u = parseUrl(raw);
  if (!u || !baseAllowed(u)) return false;
  // SEC-00A-R1 remediation — EXACT approved origin (host AND port).
  if (u.origin !== SOUNDHELIX_ORIGIN) return false;
  const m = /^\/examples\/mp3\/SoundHelix-Song-(\d{1,2})\.mp3$/.exec(u.pathname);
  if (!m) return false;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 && n <= SOUNDHELIX_MAX_SONG;
}

/** Main media + thumbnail: must be an approved StayBid public object URL. */
export function isAllowedMediaUrl(raw: unknown): boolean {
  return isAllowedStayBidPublicMediaUrl(raw);
}
export function isAllowedThumbnailUrl(raw: unknown): boolean {
  return isAllowedStayBidPublicMediaUrl(raw);
}
/** Sound: an approved StayBid public object URL (user-uploaded audio interim)
 *  OR a current SoundHelix catalogue track. */
export function isAllowedSoundUrl(raw: unknown): boolean {
  return isAllowedStayBidPublicMediaUrl(raw) || isAllowedSoundHelixUrl(raw);
}

/** Preserve existing route semantics: undefined/null/"" is an "absent"
 *  optional value (routes coerce it to null), NOT a URL to validate. */
export function isEmptyOptionalUrl(raw: unknown): boolean {
  return raw === undefined || raw === null || (typeof raw === "string" && raw.length === 0);
}

export type MediaUrlError = "Invalid media URL" | "Invalid thumbnail URL" | "Invalid sound URL";

/**
 * Validate the media-URL trio a POST route is about to persist. Returns the
 * first error label (fail-closed), or null when all supplied values pass.
 * `mediaUrl` is required; `thumbnailUrl`/`soundUrl` are optional (empty → ok).
 * The error label never echoes attacker-controlled URL content.
 */
export function validatePostMediaUrls(input: {
  mediaUrl: unknown;
  thumbnailUrl?: unknown;
  soundUrl?: unknown;
}): MediaUrlError | null {
  if (!isAllowedMediaUrl(input.mediaUrl)) return "Invalid media URL";
  if (!isEmptyOptionalUrl(input.thumbnailUrl) && !isAllowedThumbnailUrl(input.thumbnailUrl)) return "Invalid thumbnail URL";
  if (!isEmptyOptionalUrl(input.soundUrl) && !isAllowedSoundUrl(input.soundUrl)) return "Invalid sound URL";
  return null;
}

/** Validate a standalone optional sound URL (the two soundtrack PATCH paths).
 *  Empty/absent → ok (clears to null); a non-empty value must pass. */
export function validateOptionalSoundUrl(raw: unknown): MediaUrlError | null {
  if (isEmptyOptionalUrl(raw)) return null;
  return isAllowedSoundUrl(raw) ? null : "Invalid sound URL";
}
