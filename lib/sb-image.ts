// ────────────────────────────────────────────────────────────────────────────
// Supabase Storage image-URL helper.
//
// Why: hotel/profile images uploaded at full resolution (often 2-3 MB) are
// served to every card render. On the Discover home, /hotels list, profile
// grid, and saved page that's millions of unnecessary bytes per session.
//
// Two modes:
//   1) Free plan (default): returns the original URL but encourages
//      `loading="lazy"` + `decoding="async"` at every call site.
//   2) Pro+ plan (set NEXT_PUBLIC_SB_IMAGE_TRANSFORM=1): rewrites
//      `/storage/v1/object/public/...` → `/storage/v1/render/image/public/...`
//      with width/quality/format query params. Supabase's image-transform
//      CDN does the resize + WebP conversion. Typical 200 KB JPEG → ~25 KB
//      WebP at width=600.
//
// Safe to call on ANY URL: non-Supabase URLs (Unsplash placeholders, blob:
// previews, http://) are returned unchanged.
// ────────────────────────────────────────────────────────────────────────────

export type SbImageOpts = {
  /** target width in px (height auto). Default 600. */
  width?: number;
  /** quality 1-100. Default 72. */
  quality?: number;
  /** "webp" | "origin". Default "webp" when transformation is on. */
  format?: "webp" | "origin";
  /** "cover" (default) | "contain". */
  resize?: "cover" | "contain";
};

const TRANSFORM_ON = process.env.NEXT_PUBLIC_SB_IMAGE_TRANSFORM === "1";

export function sbImage(url: string | undefined | null, opts: SbImageOpts = {}): string {
  if (!url) return "";
  if (!TRANSFORM_ON) return url;
  // Only rewrite Supabase Storage public-object URLs.
  // Pattern: <base>/storage/v1/object/public/<bucket>/<path>
  if (!url.includes("/storage/v1/object/public/")) return url;

  const {
    width = 600,
    quality = 72,
    format = "webp",
    resize = "cover",
  } = opts;

  // Swap the path: object/public → render/image/public, then append params.
  const rewritten = url.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/");
  const sep = rewritten.includes("?") ? "&" : "?";
  return `${rewritten}${sep}width=${width}&quality=${quality}${format !== "origin" ? `&format=${format}` : ""}&resize=${resize}`;
}

/** Convenience presets for the surfaces that dominate egress. */
export const SB_IMG_CARD     = { width: 600,  quality: 70, format: "webp" as const, resize: "cover" as const };
export const SB_IMG_THUMB    = { width: 240,  quality: 65, format: "webp" as const, resize: "cover" as const };
export const SB_IMG_AVATAR   = { width: 96,   quality: 70, format: "webp" as const, resize: "cover" as const };
export const SB_IMG_HERO     = { width: 1280, quality: 75, format: "webp" as const, resize: "cover" as const };
// Offline-kiosk BIG display (43"–75", often 4K). Request the largest crisp
// variant + higher quality so a wide screen never upscales a downsized file.
// The transform CDN never enlarges past the source, so this only ever helps.
export const SB_IMG_KIOSK    = { width: 2560, quality: 82, format: "webp" as const, resize: "cover" as const };
