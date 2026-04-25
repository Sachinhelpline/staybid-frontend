// Server-side Supabase Storage uploader for the onboarding panel.
// Uses the same key resolution as supabase-admin.ts (service-role preferred,
// anon fallback). Buckets must already exist (created in migration v2).

import { SB } from "./supabase-admin";

export type UploadKind = "hotel-images" | "room-images" | "kyc-documents" | "bank-docs" | "verification-videos";

export type UploadResult = {
  url: string;
  storagePath: string;
  bucket: UploadKind;
  size: number;
  mimeType: string;
};

/**
 * Upload a buffer (e.g. from a multipart form) to a Supabase Storage bucket.
 * Returns a public URL for the public buckets and a signed URL for private buckets.
 */
export async function uploadBuffer(opts: {
  bucket: UploadKind;
  fileName: string;
  contentType: string;
  body: ArrayBuffer | Buffer | Uint8Array;
  pathPrefix?: string;        // e.g. "hotelId/cover"
  signedUrlSeconds?: number;  // for private buckets (default 7 days)
}): Promise<UploadResult> {
  const ext = opts.fileName.split(".").pop()?.toLowerCase() || "bin";
  const safeBase = opts.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60);
  const key = `${opts.pathPrefix || "misc"}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeBase}`;

  const url = `${SB.url}/storage/v1/object/${opts.bucket}/${key}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SB.key}`,
      apikey: SB.key,
      "Content-Type": opts.contentType,
      "x-upsert": "true",
    },
    body: opts.body as any,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Upload failed (${r.status}): ${t}`);
  }

  const isPublic = opts.bucket === "hotel-images" || opts.bucket === "room-images";
  // verification-videos and KYC docs are private; signed URL below.
  let publicUrl = `${SB.url}/storage/v1/object/public/${opts.bucket}/${key}`;
  if (!isPublic) {
    // Issue a signed URL for private buckets (default 7-day expiry)
    const sec = opts.signedUrlSeconds ?? 60 * 60 * 24 * 7;
    const sr = await fetch(`${SB.url}/storage/v1/object/sign/${opts.bucket}/${key}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SB.key}`, apikey: SB.key, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: sec }),
    });
    const sj: any = await sr.json();
    if (sj.signedURL) publicUrl = `${SB.url}/storage/v1${sj.signedURL}`;
    else if (sj.signedUrl) publicUrl = `${SB.url}/storage/v1${sj.signedUrl}`;
  }

  const size =
    opts.body instanceof ArrayBuffer ? opts.body.byteLength :
    (opts.body as any).byteLength ?? (opts.body as any).length ?? 0;

  return { url: publicUrl, storagePath: key, bucket: opts.bucket, size, mimeType: opts.contentType };
}

export function validateUpload(file: { size: number; type: string }, kind: UploadKind) {
  const MAX = kind === "hotel-images" || kind === "room-images" ? 8 * 1024 * 1024 : 5 * 1024 * 1024;
  if (file.size > MAX) throw new Error(`File too large (max ${Math.round(MAX / 1024 / 1024)}MB)`);
  const allowedImg = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
  const allowedDoc = [...allowedImg, "application/pdf"];
  const allowed = (kind === "kyc-documents" || kind === "bank-docs") ? allowedDoc : allowedImg;
  if (!allowed.includes(file.type)) throw new Error(`File type ${file.type} not allowed for ${kind}`);
}
