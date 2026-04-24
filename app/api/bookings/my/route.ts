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

  // Collect lookup ids across both sources
  const hotelIds = Array.from(new Set([
    ...bookings.map((b: any) => b.hotelId),
    ...acceptedBids.map((b: any) => b.hotelId),
  ].filter(Boolean)));
  const roomIds = Array.from(new Set([
    ...bookings.map((b: any) => b.roomId),
    ...acceptedBids.map((b: any) => b.roomId),
  ].filter(Boolean)));
  const requestIds = Array.from(new Set(
    acceptedBids.map((b: any) => b.requestId).filter(Boolean)
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

  // Accepted bids projected as bookings (so downstream UI treats them uniformly)
  const bidEnriched = acceptedBids.map((b: any) => {
    const req = requests.find((r: any) => r.id === b.requestId) || null;
    return {
      id: b.id,
      _source: "bid",
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
