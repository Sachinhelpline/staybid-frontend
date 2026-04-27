import { NextResponse } from "next/server";
import { sbInsert, sbSelect, sbUpdate, SB } from "@/lib/onboard/supabase-admin";

function decodeJwt(t: string): any {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"), "base64").toString()); }
  catch { return null; }
}

// POST /api/partner/checkin/[bidId]
// Hotel partner marks the guest as checked in. Idempotent (re-marking
// just updates the timestamp). Does NOT touch any existing booking flow —
// purely additive. Status pushed to bids row as `CHECKED_IN`.
export async function POST(req: Request, { params }: { params: { bidId: string } }) {
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const payload = decodeJwt(token);
    if (!payload?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const bid = (await sbSelect<any>("bids", `id=eq.${params.bidId}&limit=1`))[0];
    if (!bid) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

    const now = new Date().toISOString();
    const existing = (await sbSelect<any>("checkin_checkout_logs", `booking_id=eq.${params.bidId}&limit=1`))[0];
    if (existing) {
      await sbUpdate("checkin_checkout_logs", `booking_id=eq.${params.bidId}`, {
        checkin_time: now, marked_by: payload.id, updated_at: now,
      });
    } else {
      await sbInsert("checkin_checkout_logs", {
        booking_id: params.bidId, hotel_id: bid.hotelId, customer_id: bid.customerId,
        checkin_time: now, marked_by: payload.id,
      });
    }

    // Best-effort: push status to bids row (legacy field — partner panel reads it)
    try {
      await fetch(`${SB.url}/rest/v1/bids?id=eq.${params.bidId}`, {
        method: "PATCH",
        headers: { apikey: SB.key, Authorization: `Bearer ${SB.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CHECKED_IN" }),
      });
    } catch {}

    return NextResponse.json({ ok: true, checkin_time: now });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "checkin failed" }, { status: 500 });
  }
}
