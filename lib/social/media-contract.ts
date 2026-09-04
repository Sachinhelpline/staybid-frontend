// ═══════════════════════════════════════════════════════════════════════════
// Provider-neutral CLIENT READ contract for StayBid social media + a pure
// legacy mapper. This is the single seam a future managed video provider
// (e.g. Cloudflare Stream) plugs into: consumers read `ResolvedMedia`, never
// a raw social-post row and never a provider identifier.
// ───────────────────────────────────────────────────────────────────────────
// This module is PURE: no imports, no network, no DB, no provider calls, no
// browser globals, no env. `resolveLegacySocialMedia` returns a fresh object
// and never mutates its input. It represents ONLY today's legacy Supabase
// direct media; provider identities/URLs/tokens/secrets are deliberately NOT
// part of this client contract (they live server-side behind an adapter).
// ═══════════════════════════════════════════════════════════════════════════

export type MediaKind = "video" | "image";

export type MediaStatus = "READY" | "PROCESSING" | "FAILED" | "UNAVAILABLE";

/** A poster is either a real image URL or an explicit placeholder (no URL). */
export type PosterDescriptor =
  | { source: "staybid" | "provider"; url: string }
  | { source: "placeholder" };

/** Optional, intention-gated hover-preview source. Playable variants always
 *  carry a real URL — NONE is used when there is nothing to preview. */
export type PreviewDescriptor =
  | { type: "NONE" }
  | { type: "DIRECT"; url: string; mimeType?: string }
  | { type: "HLS"; url: string; expiresAt?: string }
  | { type: "ANIMATED"; url: string };

/** Full playback source. Playable variants always carry a real URL. Restricted
 *  media that must be resolved on demand uses RESOLVE_REQUIRED (an endpoint) —
 *  never an empty-URL HLS descriptor. */
export type PlaybackDescriptor =
  | { type: "NONE" }
  | { type: "DIRECT"; url: string; mimeType?: string }
  | { type: "HLS"; url: string; expiresAt?: string }
  | { type: "DASH"; url: string; expiresAt?: string }
  | { type: "RESOLVE_REQUIRED"; endpoint: string };

/** The only media shape a client surface consumes. Stable across a future
 *  provider migration — only preview/playback type+url change. */
export type ResolvedMedia = {
  v: 1;
  id: string;
  kind: MediaKind;
  status: MediaStatus;
  poster: PosterDescriptor;
  aspectRatio: number | null;
  durationMs: number | null;
  preview: PreviewDescriptor;
  playback: PlaybackDescriptor;
};

/** The minimal legacy fields the mapper needs — a subset of a social_posts
 *  row, never the whole business object. */
export type LegacySocialMediaInput = {
  id?: string | null;
  media_type?: string | null;
  media_url?: string | null;
  thumbnail_url?: string | null;
};

function cleanString(v: unknown): string {
  return typeof v === "string" && v.trim() ? v : "";
}

/**
 * Pure legacy resolver: current social_posts media fields → ResolvedMedia.
 * Mirrors today's Home behaviour exactly for videos (poster = thumbnail
 * else media_url; DIRECT preview/playback = media_url) and treats PHOTO/IMAGE
 * as a poster-only image (no video element, no request). Defensive on every
 * field: never throws, never mutates the input, never touches the network.
 */
export function resolveLegacySocialMedia(row: LegacySocialMediaInput): ResolvedMedia {
  const id = cleanString(row?.id) ? `legacy:${row!.id}` : "legacy:unknown";
  const t = cleanString(row?.media_type).toUpperCase();
  const mediaUrl = cleanString(row?.media_url);
  const thumbUrl = cleanString(row?.thumbnail_url);

  const kind: MediaKind = t === "PHOTO" || t === "IMAGE" ? "image" : "video";

  const posterUrl = thumbUrl || mediaUrl;
  const poster: PosterDescriptor = posterUrl
    ? { source: "staybid", url: posterUrl }
    : { source: "placeholder" };

  // Only a real video type with a real URL is playable. Unknown types stay
  // non-playable (the feed API rejects them in production); images never play.
  const playable =
    kind === "video" && !!mediaUrl && (t === "REEL" || t === "STORY" || t === "VIDEO");

  return {
    v: 1,
    id,
    kind,
    status: mediaUrl ? "READY" : "UNAVAILABLE",
    poster,
    aspectRatio: null,
    durationMs: null,
    preview: playable ? { type: "DIRECT", url: mediaUrl } : { type: "NONE" },
    playback: playable ? { type: "DIRECT", url: mediaUrl } : { type: "NONE" },
  };
}
