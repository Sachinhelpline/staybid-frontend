import { NextRequest, NextResponse } from "next/server";
import { authUserId, authPayload, ensureUser, sbSelect, sbInsert, genId } from "@/lib/sb-server";

// One active bid per (customer × city). Per-flow timers:
//   • Negotiate (1:1 single hotel)    → 3h
//   • /bid      (1:N reverse auction) → 1h
const NEGOTIATE_MS = 3 * 3600_000;
const PLACE_MS     = 1 * 3600_000;
const expiresAtFor = (flow?: string) =>
  new Date(Date.now() + (flow === "place" ? PLACE_MS : NEGOTIATE_MS)).toISOString();

// Returns the conflicting active bid (PENDING / COUNTER / unpaid ACCEPTED)
// in the same city, or null.
//
// `currentRequestId` is the requestId attached to the incoming placeBid. /bid
// broadcasts N hotels in one city under ONE bid_request — so all N share the
// same requestId. We treat same-requestId rows as the same logical bid and
// skip them, so a single /bid submit doesn't 409 itself across its own
// per-hotel calls. A new /bid run (new requestId) does 409 against the
// still-active prior broadcast, which is the desired guard.
async function findActiveBidInCity(
  customerIds: string[],
  city: string,
  currentRequestId?: string | null,
): Promise<any | null> {
  if (!customerIds.length || !city) return null;
  const ids = customerIds.join(",");
  const bids = await sbSelect(
    `bids?customerId=in.(${ids})&status=in.(PENDING,COUNTER,ACCEPTED)&expiresAt=gt.${encodeURIComponent(new Date().toISOString())}&select=id,hotelId,roomId,requestId,status,amount,counterAmount,expiresAt`
  );
  if (!bids.length) return null;

  const hotelIds = Array.from(new Set(bids.map((b: any) => b.hotelId).filter(Boolean)));
  const hotels = await sbSelect(`hotels?id=in.(${hotelIds.join(",")})&select=id,name,city`);
  const hotelById = new Map(hotels.map((h: any) => [h.id, h]));
  const cityNorm = city.toLowerCase().trim();

  // ACCEPTED only locks while there's no paid booking yet.
  const acceptedIds = bids.filter((b: any) => b.status === "ACCEPTED").map((b: any) => b.id);
  let paidByBidId = new Map<string, number>();
  if (acceptedIds.length) {
    const bks = await sbSelect(
      `bookings?bidId=in.(${acceptedIds.join(",")})&select=bidId,paidAmount`
    );
    paidByBidId = new Map(bks.map((b: any) => [b.bidId, Number(b.paidAmount || 0)]));
  }

  for (const b of bids) {
    const hotel = hotelById.get(b.hotelId);
    if (!hotel || String(hotel.city || "").toLowerCase().trim() !== cityNorm) continue;
    if (b.status === "ACCEPTED" && (paidByBidId.get(b.id) || 0) > 0) continue;
    if (currentRequestId && b.requestId && b.requestId === currentRequestId) continue;
    return {
      bidId:         b.id,
      hotelId:       b.hotelId,
      hotelName:     hotel.name || "Hotel",
      city:          hotel.city,
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

  // Pre-flight: 409 if customer already has an active bid in this city.
  // Skipped for flash-deal bookings — those are instant-purchase, not bids.
  if (!dealId) {
    const hotels = await sbSelect(`hotels?id=eq.${hotelId}&select=city`);
    const city = hotels[0]?.city;
    if (city) {
      const conflict = await findActiveBidInCity([customerId], city, requestId);
      if (conflict) {
        return NextResponse.json(
          {
            error: `You already have an active bid in ${city}. Update its budget instead of placing a new one.`,
            conflict,
          },
          { status: 409 }
        );
      }
    }
  }

  try {
    const bid = await sbInsert("bids", {
      id: genId("bid"),
      customerId,
      hotelId,
      roomId,
      amount: Number(amount),
      requestId: requestId || null,
      status: "PENDING",
      message: message || null,
      expiresAt: expiresAtFor(flow),
      isBestDeal: false,
    });
    return NextResponse.json({ bid });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Bid failed" }, { status: 500 });
  }
}
