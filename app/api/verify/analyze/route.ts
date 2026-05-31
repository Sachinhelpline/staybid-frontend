import { NextResponse } from "next/server";
import { sbInsert, sbSelect, sbUpdate } from "@/lib/onboard/supabase-admin";
import { analyze } from "@/lib/verify/ai";
import { ROOM_TYPE_REQUIREMENTS } from "@/lib/verify/tiers";

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

    // ── v251 — real-vision inputs: per-step keyframes + hotel geo + room-type rule ──
    const hv = hVids[0];
    const frames: string[] = Array.isArray(hv?.segments)
      ? hv.segments.map((s: any) => s?.frameUrl).filter(Boolean)
      : [];

    // Hotel coordinates → platinum geo rule (haversine in the analyzer).
    let hotelGeo: { lat: number; lng: number } | null = null;
    try {
      const hotels = await sbSelect<any>("hotels", `id=eq.${encodeURIComponent(r.hotel_id)}&select=lat,lng&limit=1`);
      if (hotels[0]?.lat != null && hotels[0]?.lng != null) hotelGeo = { lat: Number(hotels[0].lat), lng: Number(hotels[0].lng) };
    } catch {}

    // Best-effort room type → ROOM_TYPE_REQUIREMENTS object rule.
    let expectedRoomType: string | null = null;
    try {
      if (r.bid_id) {
        const bids = await sbSelect<any>("bids", `id=eq.${encodeURIComponent(r.bid_id)}&select=roomId,room_id&limit=1`);
        const roomId = bids[0]?.roomId || bids[0]?.room_id;
        if (roomId) {
          const rooms = await sbSelect<any>("rooms", `id=eq.${encodeURIComponent(roomId)}&select=type&limit=1`);
          expectedRoomType = rooms[0]?.type || null;
        }
      }
    } catch {}
    const expectedObjects = expectedRoomType && ROOM_TYPE_REQUIREMENTS[expectedRoomType]
      ? ROOM_TYPE_REQUIREMENTS[expectedRoomType]
      : ["bed", "ac", "tv", "washbasin", "window"];

    const result = await analyze({
      requestId,
      tier: r.tier,
      frames,
      expectedObjects,
      expectedRoomType,
      recordedGeo: hv?.geo || null,
      hotelGeo,
      hotelVideo: hv && {
        url: hv.url, storagePath: hv.storage_path,
        durationSecs: hv.actual_secs || 0,
        stepsCompleted: hv.steps_completed || [],
        verificationCode: hv.verification_code,
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
