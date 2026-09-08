"use client";

import { createClient } from "@supabase/supabase-js";

// SEC-00B final writer cutover.
//
// Before final activation the server-side MEDIA_SECURE_WRITER_ENABLED flag is
// absent/false, so this module deliberately preserves the legacy writer.
// Once that flag is explicitly enabled, /api/social/upload-mode returns
// "secure" only when the upload-session + observation prerequisites are also
// enabled. In secure mode there is NO fallback to the legacy public writer.

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
const LEGACY_BUCKET = "social-media";
const QUARANTINE_BUCKET = "social-media-quarantine";
const PROCESSED_BUCKET = "social-media-processed";

type LegacyBucket = typeof LEGACY_BUCKET;
export type UploadedMedia = {
  mediaUrl: string;
  thumbnailUrl: string;
  bucket: LegacyBucket | typeof PROCESSED_BUCKET;
};

type UploadMode = "legacy" | "secure" | "blocked";
type SecureMediaClass = "photo" | "reel" | "story" | "audio";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function token(): string {
  try {
    return localStorage.getItem("sb_token") || "";
  } catch {
    return "";
  }
}

function safeExt(mime: string, fallback: string): string {
  const m = (mime || "").split("/")[1]?.split(";")[0]?.toLowerCase() || fallback;
  return m.replace(/[^a-z0-9]/gi, "").slice(0, 8) || fallback;
}

async function uploadMode(): Promise<UploadMode> {
  const r = await fetch("/api/social/upload-mode", {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!r.ok) throw new Error("Secure media upload control unavailable");
  const j = await r.json().catch(() => null);
  return j?.mode === "secure" || j?.mode === "legacy" || j?.mode === "blocked"
    ? j.mode
    : "blocked";
}

function legacyPushToStorage(
  blob: Blob,
  bucket: LegacyBucket,
  path: string,
  contentType: string,
  onProgress?: (pct: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
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
    xhr.ontimeout = () =>
      reject(new Error("Storage upload timed out after 90s. Check your connection and tap Retry."));
    xhr.onabort = () => reject(new Error("Storage upload aborted."));
    xhr.send(blob);
  });
}

const secureStorage = createClient(SB_URL, SB_ANON, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sb-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

async function secureUploadBlob(
  blob: Blob,
  mediaClass: SecureMediaClass,
  contentType: string,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const bearer = token();
  if (!bearer) throw new Error("Please sign in again before uploading media.");

  onProgress?.(5);
  const sessionRes = await fetch("/api/social/upload-session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearer}`,
    },
    cache: "no-store",
    body: JSON.stringify({
      mediaClass,
      contentType,
      byteSize: blob.size,
      idempotencyKey: newIdempotencyKey(),
    }),
  });
  const session = await sessionRes.json().catch(() => ({}));
  if (!sessionRes.ok) {
    throw new Error(session?.error || "Could not authorize secure media upload.");
  }
  if (
    typeof session?.sessionId !== "string" ||
    typeof session?.path !== "string" ||
    typeof session?.token !== "string" ||
    !session.sessionId ||
    !session.path ||
    !session.token
  ) {
    throw new Error("Secure media upload authorization was malformed.");
  }

  onProgress?.(15);
  const uploaded = await secureStorage.storage
    .from(QUARANTINE_BUCKET)
    .uploadToSignedUrl(session.path, session.token, blob, {
      contentType,
      upsert: false,
    });
  if (uploaded.error) {
    throw new Error("Secure media upload failed.");
  }
  onProgress?.(72);

  const completeRes = await fetch("/api/social/upload-session/complete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearer}`,
    },
    cache: "no-store",
    body: JSON.stringify({ sessionId: session.sessionId }),
  });
  const completed = await completeRes.json().catch(() => ({}));
  if (!completeRes.ok || completed?.status !== "accepted") {
    throw new Error(completed?.error || "Secure media observation failed.");
  }
  onProgress?.(78);

  for (let i = 0; i < 300; i += 1) {
    const statusRes = await fetch("/api/social/upload-session/status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bearer}`,
      },
      cache: "no-store",
      body: JSON.stringify({ sessionId: session.sessionId }),
    });
    const status = await statusRes.json().catch(() => ({}));
    if (!statusRes.ok) {
      throw new Error(status?.error || "Secure media processing status unavailable.");
    }
    if (status?.status === "ready" && typeof status?.mediaUrl === "string") {
      onProgress?.(100);
      return status.mediaUrl;
    }
    if (status?.status === "rejected" || status?.status === "expired") {
      throw new Error("Media could not pass the secure processing checks.");
    }
    onProgress?.(Math.min(98, 78 + Math.floor(i / 14)));
    await sleep(1000);
  }
  throw new Error("Secure media processing timed out. Please retry.");
}

async function legacyUploadSocialMedia({
  mediaBlobUrl,
  mediaMime,
  kind,
  posterDataUrl,
  userId,
  onProgress,
}: {
  mediaBlobUrl: string;
  mediaMime: string;
  kind: "PHOTO" | "REEL" | "STORY";
  posterDataUrl?: string;
  userId: string;
  onProgress?: (pct: number) => void;
}): Promise<UploadedMedia> {
  const mediaBlob = await fetch(mediaBlobUrl).then((r) => r.blob());
  const isVideo = kind === "REEL" || kind === "STORY" || (mediaMime || "").startsWith("video/");
  const ext = safeExt(mediaMime, isVideo ? "mp4" : "jpg");
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const owner = (userId || "anon").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "anon";
  const subdir = isVideo ? "videos" : "photos";
  const path = `${subdir}/${owner}/${stamp}-${rand}.${ext}`;
  const mediaUrl = await legacyPushToStorage(
    mediaBlob,
    LEGACY_BUCKET,
    path,
    mediaMime || (isVideo ? "video/mp4" : "image/jpeg"),
    onProgress ? (pct) => onProgress(Math.round(pct * 0.92)) : undefined,
  );

  let thumbnailUrl = "";
  if (isVideo && posterDataUrl?.startsWith("data:")) {
    try {
      const posterBlob = await fetch(posterDataUrl).then((r) => r.blob());
      const posterPath = `thumbs/${owner}/${stamp}-${rand}.jpg`;
      thumbnailUrl = await legacyPushToStorage(
        posterBlob,
        LEGACY_BUCKET,
        posterPath,
        "image/jpeg",
        onProgress ? (pct) => onProgress(92 + Math.round(pct * 0.08)) : undefined,
      );
    } catch {
      thumbnailUrl = "";
    }
  } else if (!isVideo) {
    thumbnailUrl = mediaUrl;
  }
  onProgress?.(100);
  return { mediaUrl, thumbnailUrl, bucket: LEGACY_BUCKET };
}

export async function uploadSocialMedia(args: {
  mediaBlobUrl: string;
  mediaMime: string;
  kind: "PHOTO" | "REEL" | "STORY";
  posterDataUrl?: string;
  userId: string;
  onProgress?: (pct: number) => void;
}): Promise<UploadedMedia> {
  const mode = await uploadMode();
  if (mode === "legacy") return legacyUploadSocialMedia(args);
  if (mode !== "secure") {
    throw new Error("Secure media upload is temporarily unavailable.");
  }

  const mediaBlob = await fetch(args.mediaBlobUrl).then((r) => r.blob());
  const mainClass: SecureMediaClass =
    args.kind === "PHOTO" ? "photo" : args.kind === "REEL" ? "reel" : "story";

  const mediaUrl = await secureUploadBlob(
    mediaBlob,
    mainClass,
    args.mediaMime || mediaBlob.type || (args.kind === "PHOTO" ? "image/jpeg" : "video/mp4"),
    args.onProgress ? (pct) => args.onProgress(Math.round(pct * 0.86)) : undefined,
  );

  let thumbnailUrl = "";
  const isVideo = args.kind === "REEL" || args.kind === "STORY" || args.mediaMime.startsWith("video/");
  if (isVideo && args.posterDataUrl?.startsWith("data:")) {
    const posterBlob = await fetch(args.posterDataUrl).then((r) => r.blob());
    thumbnailUrl = await secureUploadBlob(
      posterBlob,
      "photo",
      posterBlob.type || "image/jpeg",
      args.onProgress ? (pct) => args.onProgress(86 + Math.round(pct * 0.14)) : undefined,
    );
  } else if (!isVideo) {
    thumbnailUrl = mediaUrl;
  }
  args.onProgress?.(100);
  return { mediaUrl, thumbnailUrl, bucket: PROCESSED_BUCKET };
}

export async function uploadSocialAudio({
  blobUrl,
  mime,
  userId,
}: {
  blobUrl: string;
  mime: string;
  userId: string;
}): Promise<string> {
  const mode = await uploadMode();
  const blob = await fetch(blobUrl).then((r) => r.blob());

  if (mode === "secure") {
    return secureUploadBlob(blob, "audio", mime || blob.type || "audio/mpeg");
  }
  if (mode === "blocked") {
    throw new Error("Secure audio upload is temporarily unavailable.");
  }

  const ext = safeExt(mime, "mp3");
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const owner = (userId || "anon").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "anon";
  const path = `audio/${owner}/${stamp}-${rand}.${ext}`;
  return legacyPushToStorage(blob, LEGACY_BUCKET, path, mime || "audio/mpeg");
}
