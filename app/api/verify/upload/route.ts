import { NextResponse } from "next/server";
import { sbInsert, sbUpdate, sbSelect, SB } from "@/lib/onboard/supabase-admin";
import { uploadBuffer } from "@/lib/onboard/storage";
import { stepsForTier, durationForTier, Tier, normaliseTier } from "@/lib/verify/tiers";
import { isWellFormedCode } from "@/lib/verify/codes";

// POST /api/verify/upload (multipart/form-data)
//   fields:
//     file              video blob (recorded in-app — webm/mp4)
//     requestId         vp_requests.id
//     type              "hotel" | "customer"
//     stepsCompleted    JSON array of step ids hit during recording
//     actualSecs        actual recorded length in seconds
//     verificationCode  the SB-XXXX code echoed back from the recording session
//     geo               JSON { lat, lng } (optional, required for platinum)
//
// Server enforces: tier-based duration, step coverage, code match, in-app recording marker.
// On success: creates a vp_videos row and updates the matching vp_requests row.

export const runtime = "nodejs";

function decodeJwt(t: string): any {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"), "base64").toString()); }
  catch { return null; }
}

export async function POST(req: Request) {
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const payload = decodeJwt(token);
    if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const form = await req.formData();
    const file = form.get("file");
    const requestId = String(form.get("requestId") || "");
    const type = String(form.get("type") || "");
    const stepsCompleted = JSON.parse(String(form.get("stepsCompleted") || "[]"));
    const actualSecs = parseInt(String(form.get("actualSecs") || "0"), 10);
    const verificationCode = String(form.get("verificationCode") || "");
    const geoRaw = form.get("geo");
    const geo = geoRaw ? JSON.parse(String(geoRaw)) : null;

    if (!(file instanceof File))                return NextResponse.json({ error: "file required" }, { status: 400 });
    if (!requestId)                              return NextResponse.json({ error: "requestId required" }, { status: 400 });
    if (type !== "hotel" && type !== "customer") return NextResponse.json({ error: "type must be hotel|customer" }, { status: 400 });

    // Load request
    const reqs = await sbSelect<any>("vp_requests", `id=eq.${requestId}&limit=1`);
    const vreq = reqs[0];
    if (!vreq) return NextResponse.json({ error: "request not found" }, { status: 404 });

    const tier: Tier = normaliseTier(vreq.tier);
    const requiredSecs = durationForTier(tier);
    const requiredSteps = stepsForTier(tier).filter((s) => s.required).map((s) => s.id);

    // Server-side enforcement
    if (actualSecs < Math.floor(requiredSecs * 0.9)) {
      return NextResponse.json({ error: `Video must be at least ${requiredSecs}s for ${tier} tier (got ${actualSecs}s)` }, { status: 400 });
    }
    const missing = requiredSteps.filter((s) => !stepsCompleted.includes(s));
    if (missing.length) {
      return NextResponse.json({ error: `Missing required steps: ${missing.join(", ")}` }, { status: 400 });
    }
    if (type === "hotel") {
      if (!isWellFormedCode(verificationCode) || verificationCode !== vreq.verification_code) {
        return NextResponse.json({ error: "Verification code mismatch — please re-record" }, { status: 400 });
      }
      if (tier === "platinum" && !(geo?.lat && geo?.lng)) {
        return NextResponse.json({ error: "Geo capture required for platinum tier" }, { status: 400 });
      }
    }

    // Upload to private storage
    const buf = await file.arrayBuffer();
    const up = await uploadBuffer({
      bucket: "verification-videos" as any,
      fileName: file.name || `${type}-${requestId}.webm`,
      contentType: file.type || "video/webm",
      body: buf,
      pathPrefix: `${vreq.hotel_id}/${requestId}/${type}`,
      signedUrlSeconds: 60 * 60 * 24 * 30,
    });

    // Insert video row
    const vid = await sbInsert("vp_videos", {
      booking_id: vreq.booking_id,
      bid_id: vreq.bid_id,
      hotel_id: vreq.hotel_id,
      customer_id: vreq.customer_id,
      uploader_id: payload.id,
      type,
      tier,
      required_secs: requiredSecs,
      actual_secs: actualSecs,
      storage_path: up.storagePath,
      url: up.url,
      verification_code: verificationCode || vreq.verification_code,
      steps_completed: stepsCompleted,
      geo,
      device_info: {
        ua: req.headers.get("user-agent") || null,
        mime: file.type,
        recorded_in_app: true,
      },
      status: "uploaded",
    });

    // Update request
    const patch: any = type === "hotel"
      ? { hotel_video_id: vid.id, status: "uploaded", updated_at: new Date().toISOString() }
      : { customer_video_id: vid.id, updated_at: new Date().toISOString() };
    await sbUpdate("vp_requests", `id=eq.${requestId}`, patch);

    return NextResponse.json({ video: vid });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "upload failed" }, { status: 500 });
  }
}
