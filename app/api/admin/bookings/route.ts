import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";

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

    const [bids, hotels, paidAmounts, bidRequests] = await Promise.all([
      sb(bidQuery),
      sb("hotels?select=id,name,city"),
      sb("bid_paid_amounts?select=bidId,customerId,paid_total,flow_type"),
      sb("bid_requests?select=id,checkIn,checkOut,city,guests"),
    ]);

    const hotelsMap = Object.fromEntries((hotels as any[]).map((h) => [h.id, h]));
    const paidMap = Object.fromEntries((paidAmounts as any[]).map((p) => [p.bidId, p]));
    const reqMap = Object.fromEntries((bidRequests as any[]).map((r) => [r.id, r]));

    let enriched = (bids as any[]).map((b: any) => {
      const h = hotelsMap[b.hotelId] || {};
      const paid = paidMap[b.id];
      const req = reqMap[b.requestId];
      return {
        ...b,
        hotelName: h.name || b.hotelId,
        hotelCity: h.city || "",
        paidTotal: paid?.paid_total || b.amount,
        flowType: paid?.flow_type || "",
        checkIn: req?.checkIn || "",
        checkOut: req?.checkOut || "",
        guests: req?.guests || 0,
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
