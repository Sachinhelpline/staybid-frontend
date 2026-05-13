import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";



async function sb(path: string) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) return [];
  return res.json();
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const hotel = searchParams.get("hotel");

  try {
    let bidQuery =
      "bids?select=id,hotelId,roomId,customerId,amount,counterAmount,status,message,createdAt,requestId&order=createdAt.desc&limit=200";
    if (status && status !== "all") bidQuery += `&status=eq.${status}`;

    const [bids, hotels, paidAmounts, bidRequests, attributions] = await Promise.all([
      sb(bidQuery),
      sb("hotels?select=id,name,city"),
      sb("bid_paid_amounts?select=bid_id,customer_id,paid_total,flow"),
      sb("bid_requests?select=id,checkIn,checkOut,city,guests"),
      // v94 — booking-source attributions for every recent bid
      sb("bid_attributions?select=*&limit=2000"),
    ]);

    const hotelsMap = Object.fromEntries((hotels as any[]).map((h) => [h.id, h]));
    const paidMap = Object.fromEntries((paidAmounts as any[]).map((p) => [p.bid_id, p]));
    const reqMap = Object.fromEntries((bidRequests as any[]).map((r) => [r.id, r]));
    const attrMap = Object.fromEntries((attributions as any[]).map((a) => [a.bid_id, a]));

    let enriched = (bids as any[]).map((b: any) => {
      const h = hotelsMap[b.hotelId] || {};
      const paid = paidMap[b.id];
      const req = reqMap[b.requestId];
      const attr = attrMap[b.id];
      return {
        ...b,
        hotelName: h.name || b.hotelId,
        hotelCity: h.city || "",
        paidTotal: paid?.paid_total || b.amount,
        flowType: paid?.flow || attr?.flow || "",
        checkIn: req?.checkIn || "",
        checkOut: req?.checkOut || "",
        guests: req?.guests || 0,
        // v94 — source attribution pass-through
        source:        attr?.source || "direct",
        creatorHandle: attr?.creator_handle || null,
        creatorType:   attr?.creator_type || null,
        videoId:       attr?.video_id || null,
      };
    });

    if (hotel && hotel !== "all") {
      enriched = enriched.filter((b) => b.hotelName?.toLowerCase().includes(hotel.toLowerCase()) || b.hotelId === hotel);
    }

    return NextResponse.json({ bookings: enriched, total: enriched.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
