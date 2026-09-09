// GET /api/bookings/my
// Returns every confirmation the customer owns across BOTH tables:
//   • bookings           — direct-book reservations (Book Now / Flash Deal)
//   • bids (ACCEPTED)    — reverse-auction wins that became reservations
// Why merge? Most "bookings" on StayBid actually live in `bids` with
// status=ACCEPTED (bid gets accepted → it IS the reservation). If we only
// queried the bookings table, My Bookings / Wallet / Profile would look empty.
//
// Also handles the dual-user-id problem: a customer may have records stored
// under BOTH `8881555188` and `+918881555188` variants. resolveUserIds()
// unions both so nothing goes missing.
import { NextRequest, NextResponse } from "next/server";
import { authPayload, sbSelect, resolveUserIds } from "@/lib/sb-server";
import { isBidConfirmedStayForDisplay } from "@/lib/stay/confirmed-stay";

export async function GET(req: NextRequest) {
  const payload = authPayload(req);
  const primaryId = payload?.id || payload?.user_id || payload?.sub;
  if (!primaryId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const customerIds = await resolveUserIds(primaryId, payload?.phone);
  const inList = customerIds.join(",");

  const [bookings, acceptedBids] = await Promise.all([
    sbSelect(`bookings?customerId=in.(${inList})&select=*`),
    sbSelect(`bids?customerId=in.(${inList})&status=eq.ACCEPTED&select=*`),
  ]);

  // This is the customer's OWN My-Bookings list — a DISPLAY surface, never an
  // authorization one. Show an accepted bid as a booking only when it carries a
  // paid marker (so a truly-unpaid ACCEPTED bid isn't shown as CONFIRMED). The
  // "paid" marker is FORGEABLE (client-stamped message / unauthenticated
  // /api/bid/paid), but forging it only affects the forger's own view — it can
  // NEVER grant Verified-Guest proof, which is decided server-side by
  // isBidVerifiedStay (CHECKED_IN/CHECKED_OUT only, SEC-00B fail-closed). So we
  // intentionally do NOT read the forgeable `bid_paid_amounts` ledger here.
  const confirmedBids = acceptedBids.filter((b: any) =>
    isBidConfirmedStayForDisplay(b)
  );

  // Collect lookup ids across both sources
  const hotelIds = Array.from(new Set([
    ...bookings.map((b: any) => b.hotelId),
    ...confirmedBids.map((b: any) => b.hotelId),
  ].filter(Boolean)));
  const roomIds = Array.from(new Set([
    ...bookings.map((b: any) => b.roomId),
    ...confirmedBids.map((b: any) => b.roomId),
  ].filter(Boolean)));
  const requestIds = Array.from(new Set(
    confirmedBids.map((b: any) => b.requestId).filter(Boolean)
  ));

  const [hotels, rooms, requests] = await Promise.all([
    hotelIds.length   ? sbSelect(`hotels?id=in.(${hotelIds.join(",")})&select=*`)          : Promise.resolve([]),
    roomIds.length    ? sbSelect(`rooms?id=in.(${roomIds.join(",")})&select=*`)            : Promise.resolve([]),
    requestIds.length ? sbSelect(`bid_requests?id=in.(${requestIds.join(",")})&select=*`) : Promise.resolve([]),
  ]);

  // Real bookings
  const realEnriched = bookings.map((b: any) => ({
    ...b,
    _source: "booking",
    hotel: hotels.find((h: any) => h.id === b.hotelId) || null,
    room:  rooms.find((r: any) => r.id === b.roomId)  || null,
  }));

  // Confirmed (paid) accepted bids projected as bookings (so downstream UI
  // treats them uniformly). Unpaid / stale ACCEPTED bids were already dropped
  // by the confirmed-stay authority above — they never appear as "CONFIRMED".
  const bidEnriched = confirmedBids.map((b: any) => {
    const req = requests.find((r: any) => r.id === b.requestId) || null;
    return {
      id: b.id,
      _source: "bid",
      // The display status shows "CONFIRMED"; the REAL bid status is carried on
      // `_bidStatus` + `_projectedFromBid` so the Share-CTA resolver applies the
      // STRONG Verified-Guest rule (CHECKED_IN/CHECKED_OUT only) and never treats
      // a forgeable "paid" bid as a share-eligible confirmed stay.
      _projectedFromBid: true,
      _bidStatus: b.status,
      customerId: b.customerId,
      hotelId: b.hotelId,
      roomId: b.roomId,
      amount: b.amount,
      totalAmount: b.amount,
      status: "CONFIRMED",
      checkIn: req?.checkIn || null,
      checkOut: req?.checkOut || null,
      guests: req?.guests || null,
      createdAt: b.updatedAt || b.createdAt,
      hotel: hotels.find((h: any) => h.id === b.hotelId) || null,
      room:  rooms.find((r: any) => r.id === b.roomId)  || null,
    };
  });

  // Dedup: if a real booking exists for same (hotelId,roomId,createdAt-ish), drop the bid projection
  const realKeys = new Set(realEnriched.map((b: any) => `${b.hotelId}|${b.roomId}`));
  const mergedBids = bidEnriched.filter((b: any) => !realKeys.has(`${b.hotelId}|${b.roomId}`));

  const enriched = [...realEnriched, ...mergedBids].sort((a: any, b: any) =>
    new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );

  return NextResponse.json({ bookings: enriched });
}
