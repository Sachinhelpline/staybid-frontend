// Persistent Bid Hold state — replaces the localStorage MVP from phase 2.
// GET   /api/holds                   — current user's active+completed holds
// GET   /api/holds?bidId=X           — single hold (used by booking page)
// POST  /api/holds                   — create a hold (called after Razorpay)
// PATCH /api/holds/[bidId]/balance   — record balance settlement (separate file)

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ, userFromReq } from "@/lib/sb";

async function sbGet(path: string) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_READ });
  if (!r.ok) return [];
  return r.json();
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const bidId = searchParams.get("bidId");
  const ids   = searchParams.get("bidIds"); // comma-separated batch read
  const user = userFromReq(req);
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    if (bidId) {
      const rows = await sbGet(`bid_holds?bid_id=eq.${encodeURIComponent(bidId)}&customer_id=eq.${encodeURIComponent(user.id)}`);
      return NextResponse.json({ hold: (rows as any[])[0] || null });
    }
    if (ids) {
      const list = ids.split(",").filter(Boolean).slice(0, 200);
      if (!list.length) return NextResponse.json({ holds: [] });
      const inList = list.map((i) => `"${i}"`).join(",");
      const rows = await sbGet(`bid_holds?bid_id=in.(${encodeURIComponent(inList)})&customer_id=eq.${encodeURIComponent(user.id)}`);
      return NextResponse.json({ holds: rows });
    }
    // Default: this customer's holds, newest first
    const rows = await sbGet(`bid_holds?customer_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=100`);
    return NextResponse.json({ holds: rows });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST { bidId, hotelId, holdAmount, balanceDue, totalAmount, holdPaymentId,
//        expiresAt, flow, payAtHotel, checkIn?, checkOut?, roomType?, hotelName? }
export async function POST(req: NextRequest) {
  const user = userFromReq(req);
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    if (!body?.bidId || !body?.hotelId || !body?.expiresAt) {
      return NextResponse.json({ error: "bidId, hotelId, expiresAt required" }, { status: 400 });
    }
    const row = {
      bid_id:             body.bidId,
      hotel_id:           body.hotelId,
      customer_id:        user.id,
      hold_amount:        Number(body.holdAmount),
      balance_due:        Number(body.balanceDue),
      total_amount:       Number(body.totalAmount),
      hold_payment_id:    body.holdPaymentId || null,
      expires_at:         body.expiresAt,
      status:             "active",
      flow:               body.flow || null,
      pay_at_hotel:       !!body.payAtHotel,
      check_in:           body.checkIn || null,
      check_out:          body.checkOut || null,
      room_type:          body.roomType || null,
      hotel_name:         body.hotelName || null,
    };
    const r = await fetch(`${SB_URL}/rest/v1/bid_holds`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(row),
    });
    const data = await r.json();
    if (!r.ok) return NextResponse.json({ error: data?.message || "Save failed", detail: data }, { status: 500 });
    return NextResponse.json({ ok: true, hold: data?.[0] || data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
