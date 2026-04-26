import { NextResponse } from "next/server";
import { sbInsert, sbSelect, sbUpdate } from "@/lib/onboard/supabase-admin";
import { stepsForTier, durationForTier, normaliseTier } from "@/lib/verify/tiers";
import { isWellFormedCode } from "@/lib/verify/codes";

// POST /api/verify/finalize
//   { requestId, type, segments[], totalSecs, verificationCode, geo? }
//   segments[] = [{ stepId, url, storagePath, durationSecs }]
//
// The client uploads each segment directly to Supabase Storage (bypasses
// Vercel's 4.5MB body limit) and posts the resulting URLs here. We
// validate steps + duration + code, persist the vp_videos row + update
// the vp_request, and trigger AI analysis.
function decodeJwt(t: string): any {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"), "base64").toString()); }
  catch { return null; }
}

export async function POST(req: Request) {
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const payload = decodeJwt(token);
    if (!payload?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { requestId, type, segments, totalSecs, verificationCode, geo } = body || {};

    if (!requestId || !Array.isArray(segments) || segments.length === 0) {
      return NextResponse.json({ error: "requestId + segments required" }, { status: 400 });
    }
    if (type !== "hotel" && type !== "customer") {
      return NextResponse.json({ error: "type must be hotel|customer" }, { status: 400 });
    }

    const reqs = await sbSelect<any>("vp_requests", `id=eq.${requestId}&limit=1`);
    const vreq = reqs[0];
    if (!vreq) return NextResponse.json({ error: "request not found" }, { status: 404 });

    const tier = normaliseTier(vreq.tier);
    const requiredSecs = durationForTier(tier);
    const requiredSteps = stepsForTier(tier).filter((s) => s.required).map((s) => s.id);
    const completedStepIds = segments.map((s: any) => s.stepId);

    // Server-side validation
    if (totalSecs < Math.floor(requiredSecs * 0.9)) {
      return NextResponse.json({ error: `Video must be at least ${requiredSecs}s for ${tier} tier (got ${totalSecs}s)` }, { status: 400 });
    }
    const missing = requiredSteps.filter((s) => !completedStepIds.includes(s));
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

    // Use the FIRST segment's URL as the canonical playback URL.
    // (Adaptive player picks variants from urls{}; raw segments stored too.)
    const primaryUrl = segments[0].url;

    const vid = await sbInsert("vp_videos", {
      booking_id: vreq.booking_id,
      bid_id: vreq.bid_id,
      hotel_id: vreq.hotel_id,
      customer_id: vreq.customer_id,
      uploader_id: payload.id,
      type,
      tier,
      required_secs: requiredSecs,
      actual_secs: totalSecs,
      storage_path: segments[0].storagePath,
      url: primaryUrl,
      verification_code: verificationCode || vreq.verification_code,
      steps_completed: completedStepIds,
      geo,
      device_info: {
        ua: req.headers.get("user-agent") || null,
        recorded_in_app: true,
        segment_count: segments.length,
      },
      status: "uploaded",
      segments,
    });

    const patch: any = type === "hotel"
      ? { hotel_video_id: vid.id, status: "uploaded", updated_at: new Date().toISOString() }
      : { customer_video_id: vid.id, updated_at: new Date().toISOString() };
    await sbUpdate("vp_requests", `id=eq.${requestId}`, patch);

    return NextResponse.json({ video: vid });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "finalize failed" }, { status: 500 });
  }
}
