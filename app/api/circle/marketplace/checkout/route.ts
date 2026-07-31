// v340 — Circle Marketplace Phase M1: Model-3 pre-buy DEMAND-side checkout.
//
// POST /api/circle/marketplace/checkout  { hotelId, roomId, from, to }
//   An investor who owns NOTHING yet pre-buys a date range of a StayBid-OPERATED
//   host-circle room. This is the M1 twist vs C1/C2 (which required the caller to
//   ALREADY OWN the unit): here the checkout AUTO-ASSIGNS a free physical unit,
//   re-quotes the Spine to FREEZE the buy (client NEVER sets ₹), creates a
//   Razorpay order, and INSERTS a NEW `inventory_blocks` row (pending_payment).
//   The sibling verify route flips it to `owned`, STAMPS
//   hotel_room_units.owner_user_id = buyer, writes the inventory hold, and grants
//   the circle_model3 marker service.
//
// Auth: customer sb_token → cross-pool owner ids. Buyer PRIMARY id = user.id
// (always inside the resolved set, so subsequent lookups still find the block).
// Tamper-safe: amount is the server-recomputed Spine buy; a post-insert
// self-excluding overlap re-guard drops the orphan on a concurrent-buyer race.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_H_REPRESENT, genId } from "@/lib/sb-server";
import { userFromReq } from "@/lib/sb";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { assignFreeUnit } from "@/lib/inventory/assign";
import { quoteInventoryBlock } from "@/lib/inventory/quote";
import { isCheckInWithinWindow, windowRejectReason } from "@/lib/inventory/prebuy-window";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public LIVE key id (safe in client code) — same source as every checkout.
import { razorpayKeyId } from "@/lib/razorpay-server";

// Public checkout key id — server env only (hotfix v621.2, RAZORPAY_KEY_ID);
// the POST fails closed with payment_config_missing when absent/malformed.
const PUBLIC_KEY_ID = razorpayKeyId();

// The room must belong to a host-circle hotel open for pre-buy. Also returns the
// optional M2 pre-buy window so the caller can gate the requested check-in.
async function loadPrebuyRoom(
  hotelId: string,
  roomId: string,
): Promise<{ windowStart: string | null; windowEnd: string | null } | null> {
  try {
    const hr = await fetch(
      `${SB_URL}/rest/v1/hotels?id=eq.${encodeURIComponent(hotelId)}` +
        `&owner_type=eq.host_circle&prebuy_enabled=eq.true` +
        `&select=id,prebuy_window_start,prebuy_window_end`,
      { headers: SB_H },
    );
    const hotel = (hr.ok ? await hr.json().catch(() => []) : [])?.[0];
    if (!hotel) return null;
    const rr = await fetch(
      `${SB_URL}/rest/v1/rooms?id=eq.${encodeURIComponent(roomId)}` +
        `&hotelId=eq.${encodeURIComponent(hotelId)}&select=id`,
      { headers: SB_H },
    );
    const room = (rr.ok ? await rr.json().catch(() => []) : [])?.[0];
    if (!room) return null;
    return {
      windowStart: hotel.prebuy_window_start || null,
      windowEnd: hotel.prebuy_window_end || null,
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  if (!PUBLIC_KEY_ID) return NextResponse.json({ error: "payment_config_missing" }, { status: 503 });
  const user = userFromReq(req);
  if (!user?.id) {
    return NextResponse.json({ error: "Please sign in to pre-buy this stay." }, { status: 401 });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const hotelId = String(body?.hotelId || "").trim();
  const roomId = String(body?.roomId || "").trim();
  const from = String(body?.from || "").slice(0, 10);
  const to = String(body?.to || "").slice(0, 10);

  if (!hotelId || !roomId || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from >= to) {
    return NextResponse.json({ error: "hotelId, roomId, from, to (from < to) required" }, { status: 400 });
  }
  const today = new Date().toISOString().slice(0, 10);
  if (from < today) {
    return NextResponse.json({ error: "Pick a future check-in date." }, { status: 400 });
  }

  // The supply gate — decoupled from the customer-feed gate.
  const prebuy = await loadPrebuyRoom(hotelId, roomId);
  if (!prebuy) {
    return NextResponse.json({ error: "This room isn't open for pre-buy." }, { status: 404 });
  }

  // M2 — the check-in date must fall inside the hotel's pre-buy window (if any).
  // 409 here (payment gate) mirrors the overlap re-guard's conflict semantics.
  if (!isCheckInWithinWindow(from, prebuy.windowStart, prebuy.windowEnd)) {
    return NextResponse.json(
      { error: windowRejectReason(from, prebuy.windowStart, prebuy.windowEnd) || "Check-in date is outside the pre-buy window." },
      { status: 409 },
    );
  }

  const buyerIds = await resolveOwnerIdsCrossPool(user.id, user.phone, user.email);
  if (!buyerIds.length) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const buyerPrimary = String(user.id);

  // 1) Auto-assign a free physical unit (M1 twist — buyer owns nothing yet).
  const freeUnit = await assignFreeUnit({ hotelId, roomId, from, to, buyerIds });
  if (!freeUnit) {
    return NextResponse.json(
      { error: "No rooms free for these nights — try different dates." },
      { status: 409 },
    );
  }

  // 2) Re-quote the Spine NOW → freeze the wholesale buy at pay time.
  const quote = await quoteInventoryBlock({ roomId, from, to });
  if (!quote || quote.buyTotal <= 0) {
    return NextResponse.json({ error: "Couldn't price this range right now — try again." }, { status: 422 });
  }

  // 3) Razorpay order for the frozen buy (amount rupees; route → paise).
  const origin = new URL(req.url).origin;
  let rzp: any = null;
  try {
    const orderRes = await fetch(`${origin}/api/razorpay/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: quote.buyTotal,
        receipt: `cmkt_${roomId}`.slice(0, 40),
        notes: { kind: "circle_marketplace", hotelId, roomId, unitId: freeUnit.unitId },
      }),
    });
    rzp = await orderRes.json().catch(() => ({}));
    if (!orderRes.ok || !rzp?.id) {
      return NextResponse.json(
        { error: rzp?.error || "Could not start payment.", detail: rzp?.code || null },
        { status: 502 },
      );
    }
  } catch {
    return NextResponse.json({ error: "Payment gateway unreachable." }, { status: 502 });
  }

  // 4) INSERT a NEW pending_payment block (buyer as investor, assigned unit).
  const blockId = genId("inv");
  let block: any = null;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/inventory_blocks`, {
      method: "POST",
      headers: SB_H_REPRESENT,
      body: JSON.stringify({
        id: blockId,
        investor_user_id: buyerPrimary,
        hotel_id: hotelId,
        unit_id: freeUnit.unitId,
        room_id: roomId,
        date_from: from,
        date_to: to,
        nights: quote.nights,
        buy_price_per_night: quote.avgBuyPerNight,
        buy_total: quote.buyTotal,
        resale_price_per_night: quote.avgResalePerNight,
        platform_fee_pct: quote.feePct,
        status: "pending_payment",
        razorpay_order_id: rzp.id,
        metadata: {
          source: "circle_marketplace",
          roomNumber: freeUnit.roomNumber,
          suggestedResaleTotal: quote.suggestedResaleTotal,
          checkoutAt: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }),
    });
    const rows = res.ok ? await res.json().catch(() => []) : [];
    block = Array.isArray(rows) ? rows[0] : null;
    if (!block) {
      const err = await res.text().catch(() => "");
      return NextResponse.json({ error: "Could not start pre-buy.", detail: err.slice(0, 160) }, { status: 500 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Checkout failed" }, { status: 500 });
  }

  // 5) Post-insert self-excluding overlap re-guard — a DIFFERENT non-terminal
  //    block may have grabbed the same unit/nights in the race window. If so,
  //    drop our orphan pending block and 409 so the buyer re-picks.
  try {
    const clashRes = await fetch(
      `${SB_URL}/rest/v1/inventory_blocks?unit_id=eq.${encodeURIComponent(freeUnit.unitId)}` +
        `&id=neq.${encodeURIComponent(blockId)}` +
        `&status=not.in.(expired,cancelled,refunded)` +
        `&date_from=lt.${to}&date_to=gt.${from}&select=id&limit=1`,
      { headers: SB_H },
    );
    const clash = clashRes.ok ? await clashRes.json().catch(() => []) : [];
    if (Array.isArray(clash) && clash.length) {
      // Roll back our orphan pending block (no payment has been made yet).
      await fetch(
        `${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(blockId)}&status=eq.pending_payment`,
        { method: "DELETE", headers: SB_H },
      ).catch(() => {});
      return NextResponse.json(
        { error: "These nights were just taken — pick different dates." },
        { status: 409 },
      );
    }
  } catch { /* non-fatal — the verify + hold write is the final integrity gate */ }

  return NextResponse.json({
    ok: true,
    keyId: PUBLIC_KEY_ID,
    order: { id: rzp.id, amount: rzp.amount, currency: rzp.currency || "INR" },
    buyTotal: quote.buyTotal,
    blockId,
    block,
  });
}
