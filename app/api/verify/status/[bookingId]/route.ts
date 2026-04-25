import { NextResponse } from "next/server";
import { sbSelect } from "@/lib/onboard/supabase-admin";

// GET /api/verify/status/[bookingId]
// Returns the latest verification_request + linked videos + AI report (if any).
export async function GET(_req: Request, { params }: { params: { bookingId: string } }) {
  try {
    const { bookingId } = params;
    const reqs = await sbSelect<any>(
      "vp_requests",
      `booking_id=eq.${encodeURIComponent(bookingId)}&order=created_at.desc&limit=1`
    );
    const r = reqs[0];
    if (!r) return NextResponse.json({ request: null });

    const [hVids, cVids, reps] = await Promise.all([
      r.hotel_video_id
        ? sbSelect<any>("vp_videos", `id=eq.${r.hotel_video_id}&limit=1`)
        : Promise.resolve([]),
      r.customer_video_id
        ? sbSelect<any>("vp_videos", `id=eq.${r.customer_video_id}&limit=1`)
        : Promise.resolve([]),
      r.ai_report_id
        ? sbSelect<any>("vp_ai_reports", `id=eq.${r.ai_report_id}&limit=1`)
        : Promise.resolve([]),
    ]);
    return NextResponse.json({
      request: r,
      hotelVideo: hVids[0] || null,
      customerVideo: cVids[0] || null,
      report: reps[0] || null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "status failed" }, { status: 500 });
  }
}
