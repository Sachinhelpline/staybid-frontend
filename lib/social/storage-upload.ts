// ═══════════════════════════════════════════════════════════════════════════
// Social-feed media uploader. Takes the blob URLs / data URLs the Composer
// already produces locally and pushes them to Supabase Storage so the
// resulting URLs are publicly addressable across devices and sessions.
// ───────────────────────────────────────────────────────────────────────────
// Reuses the existing buckets (hotel-videos for video, hotel-images for
// photos + thumbnails). Both buckets are pre-configured with public read +
// anon-key write — same pattern used by /influencer/upload.
// ═══════════════════════════════════════════════════════════════════════════
"use client";

const SB_URL  = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";

type Bucket = "hotel-videos" | "hotel-images";

function safeExt(mime: string, fallback: string): string {
  const m = (mime || "").split("/")[1]?.split(";")[0]?.toLowerCase() || fallback;
  // Strip any non-alphanumerics — Storage paths must stay simple.
  return m.replace(/[^a-z0-9]/gi, "").slice(0, 8) || fallback;
}

async function pushToStorage(blob: Blob, bucket: Bucket, path: string, contentType: string): Promise<string> {
  const r = await fetch(`${SB_URL}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SB_ANON}`,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: blob,
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => r.statusText);
    throw new Error(`Storage upload failed (${r.status}): ${detail.slice(0, 240)}`);
  }
  return `${SB_URL}/storage/v1/object/public/${bucket}/${path}`;
}

export type UploadedMedia = {
  mediaUrl: string;       // public URL of the main asset (video or photo)
  thumbnailUrl: string;   // public URL of poster JPEG (videos) OR same as mediaUrl (photos)
  bucket: Bucket;
};

/**
 * Upload a media file (referenced by a blob: URL the browser holds) and an
 * optional poster image (data: URL captured at upload time) to Supabase
 * Storage. Returns the public URLs to persist in social_posts.
 *
 * For PHOTO posts: `posterDataUrl` can be omitted — the photo itself is
 * its own thumbnail.
 *
 * For REEL/STORY posts: pass the captured first-frame JPEG as
 * `posterDataUrl` so the feed has a poster even before the video can
 * stream-decode (and so the profile grid renders without spinning up
 * a <video> element per tile).
 */
export async function uploadSocialMedia({
  mediaBlobUrl, mediaMime, kind, posterDataUrl, userId,
}: {
  mediaBlobUrl: string;
  mediaMime: string;
  kind: "PHOTO" | "REEL" | "STORY";
  posterDataUrl?: string;
  userId: string;
}): Promise<UploadedMedia> {
  // 1) Resolve the in-memory blob via the existing object URL.
  const mediaBlob = await fetch(mediaBlobUrl).then((r) => r.blob());
  const isVideo = kind === "REEL" || kind === "STORY" || (mediaMime || "").startsWith("video/");
  const bucket: Bucket = isVideo ? "hotel-videos" : "hotel-images";
  const ext = safeExt(mediaMime, isVideo ? "mp4" : "jpg");
  const stamp = Date.now();
  const rand  = Math.random().toString(36).slice(2, 8);
  const owner = (userId || "anon").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "anon";
  const path  = `social/${owner}/${stamp}-${rand}.${ext}`;
  const mediaUrl = await pushToStorage(
    mediaBlob,
    bucket,
    path,
    mediaMime || (isVideo ? "video/mp4" : "image/jpeg")
  );

  // 2) Thumbnail: data URL → blob → image bucket.
  let thumbnailUrl = "";
  if (isVideo && posterDataUrl?.startsWith("data:")) {
    try {
      const posterBlob = await fetch(posterDataUrl).then((r) => r.blob());
      const posterPath = `social/${owner}/thumb-${stamp}-${rand}.jpg`;
      thumbnailUrl = await pushToStorage(posterBlob, "hotel-images", posterPath, "image/jpeg");
    } catch {
      thumbnailUrl = ""; // poster upload failure is non-fatal
    }
  } else if (!isVideo) {
    thumbnailUrl = mediaUrl;
  }

  return { mediaUrl, thumbnailUrl, bucket };
}
