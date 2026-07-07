// ────────────────────────────────────────────────────────────────────────────
// Server-side photo upload for the host property-listing form.
//
// Why this exists (Phase 1 of the hospitality property-listing redesign):
// The old client `addPhotos` uploaded via lib/supabase.ts `uploadImage`
// (PUBLISHABLE anon key) and swallowed EVERY per-file failure with a silent
// `catch { /* skip one */ }`. Result: photos silently never appeared and the
// user got zero feedback. If the anon key ever hits an RLS wall on the
// `hotel-images` bucket, every upload silently no-ops.
//
// The fix: route uploads through this server route which uses the SERVICE-ROLE
// key (via lib/onboard/storage.ts `uploadBuffer`) so RLS can never quietly
// 403, and returns a REAL error message the client can surface + retry on.
//
// Body: multipart/form-data with a single `file` field. The client resizes the
// image first (lib/image-resize.ts, ~350-500 KB) so it stays well under
// Vercel's ~4.5 MB serverless body limit.
// ────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { uploadBuffer, validateUpload } from "@/lib/onboard/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hard ceiling as a defence-in-depth guard (client already resizes small).
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB — matches validateUpload("hotel-images")

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData().catch(() => null);
    if (!form) {
      return NextResponse.json({ error: "Invalid upload — expected form data." }, { status: 400 });
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No image file received." }, { status: 400 });
    }

    if (file.size === 0) {
      return NextResponse.json({ error: "That image is empty (0 bytes)." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `Image is too large (${Math.round(file.size / 1024 / 1024)} MB). Max 8 MB.` },
        { status: 413 },
      );
    }

    // MIME + size gate (throws a friendly message on mismatch).
    try {
      validateUpload({ size: file.size, type: file.type }, "hotel-images");
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || "Unsupported image type." }, { status: 415 });
    }

    const body = await file.arrayBuffer();
    const result = await uploadBuffer({
      bucket: "hotel-images",
      fileName: file.name || "property-photo.jpg",
      contentType: file.type || "image/jpeg",
      body,
      pathPrefix: "property-photos",
    });

    return NextResponse.json({ url: result.url });
  } catch (e: any) {
    // uploadBuffer throws "Upload failed (403): ..." etc. — surface it.
    const msg = e?.message || "Upload failed. Please try again.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
