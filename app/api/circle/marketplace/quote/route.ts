// v340 — Circle Marketplace Phase M1: Model-3 pre-buy price QUOTE (public, read-only).
//
// POST /api/circle/marketplace/quote  { hotelId, roomId, from, to }
//   Prices a date range for a StayBid-OPERATED host-circle room open for pre-buy,
//   and reports whether a free physical unit exists (so the yearly-calendar can
//   show a live wholesale price + an availability hint BEFORE the buyer signs in).
//   READ-ONLY — no auth, no write, no charge. The checkout sibling route freezes
//   the price + auto-assigns a unit + charges (that one needs sign-in).
//
// Pricing goes through the SAME `quoteInventoryBlock` (Spine) the C1/C2 owner
// flow uses, so preview == charge. Availability is a hint only (checkout re-runs
// assignFreeUnit + a self-excluding overlap re-guard for the real gate).

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { quoteInventoryBlock } from "@/lib/inventory/quote";
import { unitsFreeForRange } from "@/lib/availability";
import { isCheckInWithinWindow, windowRejectReason } from "@/lib/inventory/prebuy-window";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

// The room must belong to a host-circle hotel that is open for pre-buy
// (owner_type='host_circle' AND prebuy_enabled=true). This is the marketplace's
// supply gate — decoupled from the customer-feed gate (approval_status=approved).
// Also returns the optional pre-buy window (M2) so the caller can gate check-in.
async function loadPrebuyRoom(
  hotelId: string,
  roomId: string,
): Promise<{ hotelId: string; roomId: string; windowStart: string | null; windowEnd: string | null } | null> {
  try {
    const hr = await fetch(
      `${SB_URL}/rest/v1/hotels?id=eq.${encodeURIComponent(hotelId)}` +
        `&owner_type=eq.host_circle&prebuy_enabled=eq.true` +
        `&select=id,prebuy_window_start,prebuy_window_end`,
      { headers: SB_H, cache: "no-store" },
    );
    const hotel = (hr.ok ? await hr.json().catch(() => []) : [])?.[0];
    if (!hotel) return null;
    const rr = await fetch(
      `${SB_URL}/rest/v1/rooms?id=eq.${encodeURIComponent(roomId)}` +
        `&hotelId=eq.${encodeURIComponent(hotelId)}&select=id`,
      { headers: SB_H, cache: "no-store" },
    );
    const room = (rr.ok ? await rr.json().catch(() => []) : [])?.[0];
    if (!room) return null;
    return {
      hotelId,
      roomId,
      windowStart: hotel.prebuy_window_start || null,
      windowEnd: hotel.prebuy_window_end || null,
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
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

  const room = await loadPrebuyRoom(hotelId, roomId);
  if (!room) {
    return NextResponse.json({ error: "This room isn't open for pre-buy." }, { status: 404 });
  }

  // M2 — the check-in date must fall inside the hotel's pre-buy window (if any).
  if (!isCheckInWithinWindow(from, room.windowStart, room.windowEnd)) {
    return NextResponse.json(
      { error: windowRejectReason(from, room.windowStart, room.windowEnd) || "Check-in date is outside the pre-buy window." },
      { status: 400 },
    );
  }

  const quote = await quoteInventoryBlock({ roomId, from, to });
  if (!quote || quote.buyTotal <= 0) {
    return NextResponse.json({ error: "Couldn't price this range (needs a live rate)." }, { status: 422 });
  }

  // Availability HINT — fail-open when no capacity signal (checkout is the gate).
  let unitsFree: number | null = null;
  let available = true;
  try {
    const av = await unitsFreeForRange({ hotelId, roomId, from, to });
    if (av) { unitsFree = av.free; available = av.free >= 1; }
  } catch { /* hint only */ }

  return NextResponse.json({
    ok: true,
    quote: {
      nights: quote.nights,
      buyTotal: quote.buyTotal,
      avgBuyPerNight: quote.avgBuyPerNight,
      suggestedResaleTotal: quote.suggestedResaleTotal,
      avgResalePerNight: quote.avgResalePerNight,
      feePct: quote.feePct,
      perNight: quote.perNight,
    },
    available,
    unitsFree,
  }, { headers: { "Cache-Control": "no-store" } });
}
