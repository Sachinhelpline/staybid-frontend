import { NextResponse } from "next/server";
import { sbInsert, sbSelect, SB } from "@/lib/onboard/supabase-admin";

// POST /api/bid/paid
//   { bidId, hotelId?, roomId?, paidTotal, paidPerNight?, nights?, flow?, dealId?, razorpayPaymentId? }
// Idempotent — re-posting the same bidId updates the row.
//
// Customer JWT not required (Razorpay flow already verified payment server-side
// via /api/razorpay/verify). We just record what's already a fait accompli.
export async function POST(req: Request) {
  try {
    const b = await req.json();
    if (!b.bidId || b.paidTotal == null) {
      return NextResponse.json({ error: "bidId + paidTotal required" }, { status: 400 });
    }
    const existing = await sbSelect<any>("bid_paid_amounts", `bid_id=eq.${b.bidId}&limit=1`);
    if (existing[0]) {
      // Update via REST PATCH
      await fetch(`${SB.url}/rest/v1/bid_paid_amounts?bid_id=eq.${b.bidId}`, {
        method: "PATCH",
        headers: { apikey: SB.key, Authorization: `Bearer ${SB.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          paid_total: Number(b.paidTotal),
          paid_per_night: b.paidPerNight ? Number(b.paidPerNight) : null,
          nights: b.nights ? Number(b.nights) : 1,
          flow: b.flow || existing[0].flow,
          razorpay_payment_id: b.razorpayPaymentId || existing[0].razorpay_payment_id,
        }),
      });
      return NextResponse.json({ updated: true });
    }
    const row = await sbInsert("bid_paid_amounts", {
      bid_id: b.bidId,
      hotel_id: b.hotelId || null,
      room_id:  b.roomId  || null,
      customer_id: b.customerId || null,
      paid_total: Number(b.paidTotal),
      paid_per_night: b.paidPerNight ? Number(b.paidPerNight) : null,
      nights: b.nights ? Number(b.nights) : 1,
      flow: b.flow || "flash",
      deal_id: b.dealId || null,
      razorpay_payment_id: b.razorpayPaymentId || null,
    });
    return NextResponse.json({ row });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "record failed" }, { status: 500 });
  }
}

// GET /api/bid/paid?ids=bid1,bid2,bid3   — bulk fetch paid amounts
export async function GET(req: Request) {
  try {
    const ids = (new URL(req.url).searchParams.get("ids") || "").split(",").filter(Boolean);
    if (!ids.length) return NextResponse.json({ paid: {} });
    const rows = await sbSelect<any>(
      "bid_paid_amounts",
      `bid_id=in.(${ids.map((i) => encodeURIComponent(i)).join(",")})&limit=200`
    );
    const map: Record<string, any> = {};
    for (const r of rows) {
      map[r.bid_id] = {
        paidTotal: Number(r.paid_total),
        paidPerNight: r.paid_per_night ? Number(r.paid_per_night) : null,
        nights: r.nights, flow: r.flow,
        razorpayPaymentId: r.razorpay_payment_id,
      };
    }
    return NextResponse.json({ paid: map });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "fetch failed" }, { status: 500 });
  }
}
