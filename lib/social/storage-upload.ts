// ═══════════════════════════════════════════════════════════════════════════
// Social-feed media uploader. Takes the blob URLs / data URLs the Composer
// already produces locally and pushes them to Supabase Storage so the
// resulting URLs are publicly addressable across devices and sessions.
// ───────────────────────────────────────────────────────────────────────────
// Bucket: `social-media` (public read, anon-key write).
// Created via the social_media_bucket migration on 2026-05-10 — note this
// is a SINGLE bucket for both video and photo content because (a) the
// CLAUDE.md-noted `hotel-videos` bucket never actually existed and the
// /influencer/upload code 404'd silently against it, and (b) Supabase
// Storage doesn't care about file MIME for retrieval — only the policies
// + URL path matter. One bucket = one policy set = simpler.
// ═══════════════════════════════════════════════════════════════════════════
"use client";

const SB_URL  = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";

const BUCKET = "social-media";
type Bucket = typeof BUCKET;

function safeExt(mime: string, fallback: string): string {
  const m = (mime || "").split("/")[1]?.split(";")[0]?.toLowerCase() || fallback;
  // Strip any non-alphanumerics — Storage paths must stay simple.
  return m.replace(/[^a-z0-9]/gi, "").slice(0, 8) || fallback;
}

/**
 * Push a blob to Supabase Storage with REAL upload progress events + a
 * timeout watchdog. Replaces the v110 fetch() call which had two problems:
 *   1. fetch() has no upload progress events — composer was stuck on a
 *      vague 15% milestone the entire time the video was streaming up.
 *   2. fetch() never times out on a stalled connection — bad Wi-Fi or a
 *      transparent proxy would leave the user staring at "Posting…" with
 *      no signal that anything was wrong.
 *
 * XHR exposes `upload.onprogress` which yields the actual bytes streamed
 * to the server, and aborts cleanly when our 90s watchdog fires.
 */
function pushToStorage(
  blob: Blob,
  bucket: Bucket,
  path: string,
  contentType: string,
  onProgress?: (pct: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    // Big videos on India 3G can take 60s+. 90s is the watchdog ceiling —
    // generous for slow networks but bounded so the user gets a real
    // error instead of an infinite "Posting…".
    xhr.timeout = 90_000;
    xhr.open("POST", `${SB_URL}/storage/v1/object/${bucket}/${path}`, true);
    xhr.setRequestHeader("Authorization", `Bearer ${SB_ANON}`);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader("x-upsert", "true");
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress((e.loaded / e.total) * 100);
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(`${SB_URL}/storage/v1/object/public/${bucket}/${path}`);
      } else {
        const detail = (xhr.responseText || xhr.statusText || "").slice(0, 240);
        reject(new Error(`Storage upload failed (${xhr.status}): ${detail}`));
      }
    };
    xhr.onerror = () => reject(new Error("Storage upload failed: network error"));
    xhr.ontimeout = () => reject(new Error("Storage upload timed out after 90s. Check your connection and tap Retry."));
    xhr.onabort = () => reject(new Error("Storage upload aborted."));
    xhr.send(blob);
  });
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
  mediaBlobUrl, mediaMime, kind, posterDataUrl, userId, onProgress,
}: {
  mediaBlobUrl: string;
  mediaMime: string;
  kind: "PHOTO" | "REEL" | "STORY";
  posterDataUrl?: string;
  userId: string;
  /** v115 — fires for every upload progress event (0-100). The composer
      shows a real progress bar with this value instead of milestones. */
  onProgress?: (pct: number) => void;
}): Promise<UploadedMedia> {
  // 1) Resolve the in-memory blob via the existing object URL.
  const mediaBlob = await fetch(mediaBlobUrl).then((r) => r.blob());
  const isVideo = kind === "REEL" || kind === "STORY" || (mediaMime || "").startsWith("video/");
  const ext = safeExt(mediaMime, isVideo ? "mp4" : "jpg");
  const stamp = Date.now();
  const rand  = Math.random().toString(36).slice(2, 8);
  const owner = (userId || "anon").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "anon";
  const subdir = isVideo ? "videos" : "photos";
  const path = `${subdir}/${owner}/${stamp}-${rand}.${ext}`;
  const mediaUrl = await pushToStorage(
    mediaBlob,
    BUCKET,
    path,
    mediaMime || (isVideo ? "video/mp4" : "image/jpeg"),
    // Reserve 0-92% for the main upload; thumbnail covers 93-100. The
    // composer translates this into a real progress bar.
    onProgress ? (pct) => onProgress(Math.round(pct * 0.92)) : undefined,
  );

  // 2) Thumbnail: data URL → blob → same bucket, thumbs subdir.
  let thumbnailUrl = "";
  if (isVideo && posterDataUrl?.startsWith("data:")) {
    try {
      const posterBlob = await fetch(posterDataUrl).then((r) => r.blob());
      const posterPath = `thumbs/${owner}/${stamp}-${rand}.jpg`;
      thumbnailUrl = await pushToStorage(
        posterBlob, BUCKET, posterPath, "image/jpeg",
        onProgress ? (pct) => onProgress(92 + Math.round(pct * 0.08)) : undefined,
      );
    } catch {
      thumbnailUrl = ""; // poster upload failure is non-fatal
    }
  } else if (!isVideo) {
    thumbnailUrl = mediaUrl;
  }

  onProgress?.(100);
  return { mediaUrl, thumbnailUrl, bucket: BUCKET };
}

/**
 * v115 — Upload a device-attached audio blob to Storage so cross-device
 * audio replacement works. Without this, the composer ships an audio.url
 * of `blob:...` which is only valid on the uploader's device — viewers
 * on every other device get a dead URL and the original video audio
 * keeps playing. The audio file lives next to media in the same bucket
 * under an `audio/<owner>/` subdir.
 */
export async function uploadSocialAudio({
  blobUrl, mime, userId,
}: { blobUrl: string; mime: string; userId: string; }): Promise<string> {
  const blob = await fetch(blobUrl).then((r) => r.blob());
  const ext = safeExt(mime, "mp3");
  const stamp = Date.now();
  const rand  = Math.random().toString(36).slice(2, 8);
  const owner = (userId || "anon").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "anon";
  const path = `audio/${owner}/${stamp}-${rand}.${ext}`;
  return pushToStorage(blob, BUCKET, path, mime || "audio/mpeg");
}
