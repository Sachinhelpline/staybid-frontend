import { NextResponse } from "next/server";
import { sbInsert, sbSelect, sbUpdate, SB } from "@/lib/onboard/supabase-admin";

const FEEDBACK_WINDOW_HOURS = 4;

function decodeJwt(t: string): any {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"), "base64").toString()); }
  catch { return null; }
}

// POST /api/partner/checkout/[bidId]
// Hotel partner marks check-out. Side-effects (all additive):
//   1. checkin_checkout_logs.checkout_time set
//   2. bids.status → CHECKED_OUT
//   3. video_lifecycle row created with expiry_time = now + 4 hours
//   4. feedback_tracking row initialised (submitted=false)
//   5. notifications row queued ("Submit feedback within 4 hours…")
//      — actual delivery handled by the existing notification consumer
export async function POST(req: Request, { params }: { params: { bidId: string } }) {
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const payload = decodeJwt(token);
    if (!payload?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const bid = (await sbSelect<any>("bids", `id=eq.${params.bidId}&limit=1`))[0];
    if (!bid) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

    const now = new Date();
    const expiry = new Date(now.getTime() + FEEDBACK_WINDOW_HOURS * 3600_000);

    // 1. checkin_checkout_logs
    const existing = (await sbSelect<any>("checkin_checkout_logs", `booking_id=eq.${params.bidId}&limit=1`))[0];
    if (existing) {
      await sbUpdate("checkin_checkout_logs", `booking_id=eq.${params.bidId}`, {
        checkout_time: now.toISOString(), marked_by: payload.id, updated_at: now.toISOString(),
      });
    } else {
      await sbInsert("checkin_checkout_logs", {
        booking_id: params.bidId, hotel_id: bid.hotelId, customer_id: bid.customerId,
        checkout_time: now.toISOString(), marked_by: payload.id,
      });
    }

    // 2. bids.status
    try {
      await fetch(`${SB.url}/rest/v1/bids?id=eq.${params.bidId}`, {
        method: "PATCH",
        headers: { apikey: SB.key, Authorization: `Bearer ${SB.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CHECKED_OUT" }),
      });
    } catch {}

    // 3. video_lifecycle (idempotent)
    const vlcExisting = (await sbSelect<any>("video_lifecycle", `booking_id=eq.${params.bidId}&limit=1`))[0];
    const vp = (await sbSelect<any>("vp_requests", `booking_id=eq.${params.bidId}&order=created_at.desc&limit=1`))[0];
    if (!vlcExisting) {
      await sbInsert("video_lifecycle", {
        booking_id: params.bidId, hotel_id: bid.hotelId, customer_id: bid.customerId,
        vp_request_id: vp?.id || null,
        expiry_time: expiry.toISOString(),
        status: "active",
      });
    }

    // 4. feedback_tracking
    const fbExisting = (await sbSelect<any>("feedback_tracking", `booking_id=eq.${params.bidId}&limit=1`))[0];
    if (!fbExisting) {
      await sbInsert("feedback_tracking", {
        booking_id: params.bidId, hotel_id: bid.hotelId, customer_id: bid.customerId,
        submitted: false,
      });
    }

    // 5. queue initial notification (best-effort)
    try {
      await sbInsert("notifications", {
        userId: bid.customerId,
        type: "feedback_window_opened",
        title: "How was your stay?",
        body: `You have ${FEEDBACK_WINDOW_HOURS} hours to submit feedback. Your verification video will be deleted after that.`,
        meta: { bookingId: params.bidId, expiry: expiry.toISOString() },
      });
    } catch { /* notifications table schema may differ — non-fatal */ }

    return NextResponse.json({ ok: true, checkout_time: now.toISOString(), expiry_time: expiry.toISOString() });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "checkout failed" }, { status: 500 });
  }
}
