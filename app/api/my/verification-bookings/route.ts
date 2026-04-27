import { NextResponse } from "next/server";
import { sbSelect } from "@/lib/onboard/supabase-admin";

// GET /api/my/verification-bookings?customerId=...
//
// Supabase-DIRECT bookings + verification status feed for the customer
// /verification page. Bypasses the Railway /api/bids/my + /api/bookings/my
// roundtrip entirely so:
//   • Firebase-token users get their bookings (Railway often returns empty)
//   • newest accepted bid is always at the top
//   • each booking ships with its vp_request, hotel video URL + AI report
//
// Single query path = no dedup bugs, no checkIn-mismatch drops.
export async function GET(req: Request) {
  try {
    const customerId = new URL(req.url).searchParams.get("customerId");
    if (!customerId) return NextResponse.json({ bookings: [] });

    // 1. ACCEPTED bids for this customer
    const bids = await sbSelect<any>(
      "bids",
      `customerId=eq.${encodeURIComponent(customerId)}&status=eq.ACCEPTED&order=createdAt.desc&limit=50`
    );
    if (!bids.length) return NextResponse.json({ bookings: [] });

    // 2. Pull hotels, requests (for checkIn dates), vp_requests, vp_videos, ai_reports — all batched
    const hotelIds   = Array.from(new Set(bids.map((b) => b.hotelId).filter(Boolean)));
    const requestIds = Array.from(new Set(bids.map((b) => b.requestId).filter(Boolean)));
    const bookingIds = bids.map((b) => b.id);

    const [hotels, bidReqs, vpReqs] = await Promise.all([
      hotelIds.length ? sbSelect<any>("hotels", `id=in.(${hotelIds.join(",")})&select=id,name,city,images`) : Promise.resolve([]),
      requestIds.length ? sbSelect<any>("bid_requests", `id=in.(${requestIds.join(",")})&select=id,checkIn,checkOut`) : Promise.resolve([]),
      sbSelect<any>("vp_requests", `booking_id=in.(${bookingIds.join(",")})&order=created_at.desc`),
    ]);

    const hotelById   = Object.fromEntries(hotels.map((h: any) => [h.id, h]));
    const reqById     = Object.fromEntries(bidReqs.map((r: any) => [r.id, r]));
    const vpReqByBid: Record<string, any> = {};
    for (const v of vpReqs) {
      // Most recent vp_request per booking (rows are sorted desc above)
      if (!vpReqByBid[v.booking_id]) vpReqByBid[v.booking_id] = v;
    }

    // 3. Pull videos + ai_reports linked from those vp_requests
    const videoIds = Array.from(new Set([
      ...Object.values(vpReqByBid).map((v: any) => v.hotel_video_id).filter(Boolean),
      ...Object.values(vpReqByBid).map((v: any) => v.customer_video_id).filter(Boolean),
    ]));
    const reportIds = Object.values(vpReqByBid).map((v: any) => v.ai_report_id).filter(Boolean) as string[];

    const [videos, reports] = await Promise.all([
      videoIds.length ? sbSelect<any>("vp_videos", `id=in.(${videoIds.join(",")})&select=id,url,urls,actual_secs,segments,type,status`) : Promise.resolve([]),
      reportIds.length ? sbSelect<any>("vp_ai_reports", `id=in.(${reportIds.join(",")})&select=id,trust_score,hotel_validity,issues,fraud_flag,checks`) : Promise.resolve([]),
    ]);
    const videoById  = Object.fromEntries(videos.map((v: any) => [v.id, v]));
    const reportById = Object.fromEntries(reports.map((r: any) => [r.id, r]));

    // 4. Pull authoritative paid amounts (so display is consistent with /bookings)
    const paidRows = await sbSelect<any>(
      "bid_paid_amounts",
      `bid_id=in.(${bookingIds.join(",")})&select=bid_id,paid_total,paid_per_night`
    ).catch(() => []);
    const paidByBid = Object.fromEntries(paidRows.map((r: any) => [r.bid_id, r]));

    const bookings = bids.map((b: any) => {
      const h = hotelById[b.hotelId] || null;
      const r = reqById[b.requestId] || null;
      const vp = vpReqByBid[b.id];
      const hVid = vp?.hotel_video_id    ? videoById[vp.hotel_video_id]    : null;
      const cVid = vp?.customer_video_id ? videoById[vp.customer_video_id] : null;
      const rep  = vp?.ai_report_id      ? reportById[vp.ai_report_id]    : null;
      const paid = paidByBid[b.id];
      return {
        id: b.id,
        bidId: b.id,
        hotelId: b.hotelId,
        hotelName: h?.name || "Hotel",
        hotelCity: h?.city || "",
        hotelImage: h?.images?.[0] || null,
        status: b.status,
        checkIn:  r?.checkIn  || null,
        checkOut: r?.checkOut || null,
        amount: paid ? Number(paid.paid_total) : Number(b.amount || 0),
        verification: vp ? {
          requestId: vp.id,
          status: vp.status,
          tier: vp.tier,
          requiredSecs: vp.required_secs,
          verificationCode: vp.verification_code,
          dueBy: vp.due_by,
          hotelVideo: hVid,
          customerVideo: cVid,
          report: rep,
        } : null,
      };
    });

    return NextResponse.json({ bookings });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "fetch failed" }, { status: 500 });
  }
}
