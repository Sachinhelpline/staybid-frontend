import { NextRequest, NextResponse } from "next/server";
import { authUserId, authPayload, ensureUser, sbSelect, sbInsert, genId } from "@/lib/sb-server";

// v200 — One active bid per (customer × HOTEL). Per-flow timers:
//   • Negotiate (1:1 single hotel)    → 3h
//   • /bid      (1:N reverse auction) → 1h
const NEGOTIATE_MS = 3 * 3600_000;
const PLACE_MS     = 1 * 3600_000;
const expiresAtFor = (flow?: string) =>
  new Date(Date.now() + (flow === "place" ? PLACE_MS : NEGOTIATE_MS)).toISOString();

// v200 — Returns the conflicting active bid (PENDING / COUNTER / unpaid
// ACCEPTED) on THIS SAME hotel, or null. Per Sachin's confirmed rule
// (2026-05-24): one active bid per (customer × hotel). Different hotels
// in the same city are OK — a /bid broadcast still works because we
// exempt same-requestId.
//
// `currentRequestId` is the requestId attached to the incoming placeBid. /bid
// broadcasts N hotels in one city under ONE bid_request — so all N share the
// same requestId. We treat same-requestId rows as the same logical bid and
// skip them, so a single /bid submit doesn't 409 itself across its own
// per-hotel calls. A new /bid run (new requestId) does 409 against the
// still-active prior bid ON THE SAME hotel, which is the desired guard.
//
// We DROP the `expiresAt > now()` filter that was in v195 — stale ACCEPTED-
// unpaid bids (past 15-min payment window) had `expiresAt` in the past, so
// the old query silently returned no conflict and the customer could
// place duplicates (Sachin SS1/SS2 showed 4 stacked ACCEPTED on the same
// hotel). New rule: trust the STATUS column; the row stays ACCEPTED until
// either paid (bookings.paidAmount > 0) OR cron sweeps it to EXPIRED.
// While ACCEPTED-unpaid, no new bids on the same hotel can be placed.
async function findActiveBidOnHotel(
  customerIds: string[],
  hotelId: string,
  currentRequestId?: string | null,
): Promise<any | null> {
  if (!customerIds.length || !hotelId) return null;
  const ids = customerIds.join(",");
  const bids = await sbSelect(
    `bids?customerId=in.(${ids})&hotelId=eq.${hotelId}&status=in.(PENDING,COUNTER,ACCEPTED)&select=id,hotelId,roomId,requestId,status,amount,counterAmount,expiresAt`
  );
  if (!bids.length) return null;

  // ACCEPTED only locks while there's no paid booking yet.
  const acceptedIds = bids.filter((b: any) => b.status === "ACCEPTED").map((b: any) => b.id);
  let paidByBidId = new Map<string, number>();
  if (acceptedIds.length) {
    const bks = await sbSelect(
      `bookings?bidId=in.(${acceptedIds.join(",")})&select=bidId,paidAmount`
    );
    paidByBidId = new Map(bks.map((b: any) => [b.bidId, Number(b.paidAmount || 0)]));
  }

  let hotelMeta: any = null;
  for (const b of bids) {
    if (b.status === "ACCEPTED" && (paidByBidId.get(b.id) || 0) > 0) continue;
    if (currentRequestId && b.requestId && b.requestId === currentRequestId) continue;
    if (!hotelMeta) {
      const hotels = await sbSelect(`hotels?id=eq.${hotelId}&select=id,name,city`);
      hotelMeta = hotels[0] || { id: hotelId, name: "this hotel", city: "" };
    }
    return {
      bidId:         b.id,
      hotelId:       b.hotelId,
      hotelName:     hotelMeta.name || "this hotel",
      city:          hotelMeta.city || "",
      status:        b.status,
      amount:        b.amount,
      counterAmount: b.counterAmount,
      expiresAt:     b.expiresAt,
    };
  }
  return null;
}

export async function POST(req: NextRequest) {
  const customerId = authUserId(req);
  if (!customerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const p = authPayload(req);
  await ensureUser(customerId, p?.phone, p?.name);

  const body = await req.json().catch(() => ({}));
  const { hotelId, roomId, amount, requestId, dealId, message, flow } = body || {};

  if (!hotelId || !roomId || !amount) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // Floor-price check (skipped when dealId is present)
  if (!dealId) {
    const rooms = await sbSelect(`rooms?id=eq.${roomId}&select=floorPrice`);
    const floor = rooms[0]?.floorPrice;
    if (floor && Number(amount) < Number(floor)) {
      return NextResponse.json(
        { error: `Amount too low. Minimum: ₹${floor}` },
        { status: 400 }
      );
    }
  }

  // v200 — Pre-flight: 409 if customer already has an active bid on THIS
  // hotel. Skipped for flash-deal bookings — those are instant-purchase,
  // not bids. Per-hotel rule (was per-city in v195) — customer can bid on
  // different hotels in the same city, but only one bid per hotel.
  if (!dealId) {
    const conflict = await findActiveBidOnHotel([customerId], hotelId, requestId);
    if (conflict) {
      return NextResponse.json(
        {
          error: `You already have an active bid on ${conflict.hotelName}. Update its budget instead of placing a new one.`,
          conflict,
        },
        { status: 409 }
      );
    }
  }

  try {
    // v196 Sachin-rule: for /bid (flow="place") broadcasts, hotels whose floor
    // is at or below the customer's offer auto-accept INSTANTLY — the user
    // explicitly asked for this ("jish hotel ne auto accept hui hai unke price
    // rule ke according"). This overrides the v130 "let competition settle"
    // design — Sachin owns the product decision. Negotiate (single hotel) keeps
    // its existing schedule-accept lifecycle via /api/bids/[id]/schedule-accept.
    // We re-read the floor here (not from the earlier check) so dealId-bypass
    // bids never auto-accept (their floor check was skipped).
    let autoAccept = false;
    if (flow === "place" && !dealId) {
      const rooms = await sbSelect(`rooms?id=eq.${roomId}&select=floorPrice`);
      const floor = Number(rooms[0]?.floorPrice || 0);
      autoAccept = floor > 0 && Number(amount) >= floor;
    }

    const bid = await sbInsert("bids", {
      id: genId("bid"),
      customerId,
      hotelId,
      roomId,
      amount: Number(amount),
      requestId: requestId || null,
      status: autoAccept ? "ACCEPTED" : "PENDING",
      message: message || null,
      // Auto-accepted bids open the 15-min pay-window timer (same window the
      // hotel-accept path uses). Pending bids keep their per-flow timer.
      expiresAt: autoAccept
        ? new Date(Date.now() + 15 * 60_000).toISOString()
        : expiresAtFor(flow),
      isBestDeal: false,
    });
    return NextResponse.json({ bid, autoAccepted: autoAccept });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Bid failed" }, { status: 500 });
  }
}
