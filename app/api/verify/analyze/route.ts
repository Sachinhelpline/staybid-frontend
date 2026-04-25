import { NextResponse } from "next/server";
import { sbInsert, sbSelect, sbUpdate } from "@/lib/onboard/supabase-admin";
import { analyze } from "@/lib/verify/ai";

// POST /api/verify/analyze  { requestId }
// Pulls request + linked videos, runs the pluggable AI provider,
// stores the report, and updates request.status accordingly.
export async function POST(req: Request) {
  try {
    const { requestId } = await req.json();
    if (!requestId) return NextResponse.json({ error: "requestId required" }, { status: 400 });

    const reqs = await sbSelect<any>("vp_requests", `id=eq.${requestId}&limit=1`);
    const r = reqs[0];
    if (!r) return NextResponse.json({ error: "request not found" }, { status: 404 });

    const [hVids, cVids] = await Promise.all([
      r.hotel_video_id    ? sbSelect<any>("vp_videos", `id=eq.${r.hotel_video_id}&limit=1`)    : Promise.resolve([]),
      r.customer_video_id ? sbSelect<any>("vp_videos", `id=eq.${r.customer_video_id}&limit=1`) : Promise.resolve([]),
    ]);

    const result = await analyze({
      requestId,
      tier: r.tier,
      hotelVideo: hVids[0] && {
        url: hVids[0].url, storagePath: hVids[0].storage_path,
        durationSecs: hVids[0].actual_secs || 0,
        stepsCompleted: hVids[0].steps_completed || [],
        verificationCode: hVids[0].verification_code,
      },
      customerVideo: cVids[0] && {
        url: cVids[0].url, storagePath: cVids[0].storage_path,
        durationSecs: cVids[0].actual_secs || 0,
        stepsCompleted: cVids[0].steps_completed || [],
      },
    });

    const reportRow = await sbInsert("vp_ai_reports", {
      request_id: requestId,
      hotel_video_id: r.hotel_video_id,
      customer_video_id: r.customer_video_id,
      trust_score: result.trust_score,
      hotel_validity: result.hotel_validity,
      customer_claim_validity: result.customer_claim_validity,
      issues: result.issues_detected,
      fraud_flag: result.fraud_flag,
      checks: result.checks,
      provider: result.provider,
      raw: result.raw || null,
    });

    const newStatus = result.fraud_flag ? "rejected" : (result.hotel_validity === "high" ? "verified" : "uploaded");
    await sbUpdate("vp_requests", `id=eq.${requestId}`, {
      ai_report_id: reportRow.id,
      status: newStatus,
      updated_at: new Date().toISOString(),
    });

    return NextResponse.json({ report: reportRow, requestStatus: newStatus });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "analyze failed" }, { status: 500 });
  }
}
