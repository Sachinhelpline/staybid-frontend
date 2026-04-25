import { NextResponse } from "next/server";
import { requireOnboardUser } from "@/lib/onboard/jwt";
import { uploadBuffer, validateUpload, UploadKind } from "@/lib/onboard/storage";

// POST /api/onboard/upload  (multipart/form-data)
//   fields: file (required), kind (hotel-images|room-images|kyc-documents|bank-docs),
//           pathPrefix (optional, e.g. "hotelId/cover")
//
// Returns: { url, storagePath, bucket, size, mimeType }
export const runtime = "nodejs";       // need Buffer

export async function POST(req: Request) {
  try {
    const claims = requireOnboardUser(req);
    const form = await req.formData();
    const file = form.get("file");
    const kind = (form.get("kind") || "") as UploadKind;
    const pathPrefix = (form.get("pathPrefix") || claims.sub) as string;

    if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
    if (!["hotel-images", "room-images", "kyc-documents", "bank-docs"].includes(kind)) {
      return NextResponse.json({ error: "invalid kind" }, { status: 400 });
    }

    validateUpload({ size: file.size, type: file.type }, kind);
    const buf = await file.arrayBuffer();

    const out = await uploadBuffer({
      bucket: kind,
      fileName: file.name,
      contentType: file.type,
      body: buf,
      pathPrefix,
      signedUrlSeconds: 60 * 60 * 24 * 30,  // 30-day signed URL for private docs
    });

    return NextResponse.json(out);
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "upload failed" }, { status: 500 });
  }
}
