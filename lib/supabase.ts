import { resizeImageBeforeUpload } from "@/lib/image-resize";

const SUPABASE_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SUPABASE_ANON = "sb_publishable_N2tMgg386VuuZcuy-Tpi8A_FLRK_-eE";

export async function uploadImage(file: File, folder: string = "hotels"): Promise<string> {
  // v131.2 — client-side resize before upload. Phone photos (often 3-8 MB)
  // get clamped to 1600px / 80% JPEG before they hit Storage. The same
  // image is then served from Storage to every listing visitor; resizing
  // once at upload time saves egress *permanently* for that asset.
  const resized = await resizeImageBeforeUpload(file, { maxDim: 1600, quality: 0.8 });

  // Use the resized file's actual MIME — resizeImageBeforeUpload may have
  // re-encoded HEIC/AVIF/WEBP to JPEG, so use the new extension.
  const safeExt = (resized.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${safeExt}`;

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/hotel-images/${fileName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON}`,
      "Content-Type": resized.type,
      "x-upsert": "true",
    },
    body: resized,
  });

  if (!res.ok) throw new Error("Upload failed");

  return `${SUPABASE_URL}/storage/v1/object/public/hotel-images/${fileName}`;
}