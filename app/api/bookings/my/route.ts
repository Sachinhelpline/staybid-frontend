// GET /api/bookings/my
// Returns every confirmation the customer owns across BOTH tables:
//   • bookings                          — direct-book reservations (Book Now / Flash Deal)
//   • bids (ACCEPTED / CHECKED_IN /      — reverse-auction wins that became reservations
//     CHECKED_OUT)                         AND the stays they legitimately progressed into
// Why merge? Most "bookings" on StayBid actually live in `bids` (a bid gets
// accepted → it IS the reservation, then the partner may CHECK_IN / CHECK_OUT
// the guest). If we only queried the bookings table, My Bookings / Wallet /
// Profile would look empty. The candidate bid read must cover the WHOLE stay
// lifecycle the canonical display filter can show — not just ACCEPTED — else a
// CHECKED_IN / CHECKED_OUT bid silently disappears from My Bookings once the
// stay advances (the single shared candidate-status constant below prevents that
// query/filter drift).
//
// Also handles the dual-user-id problem: a customer may have records stored
// under BOTH `8881555188` and `+918881555188` variants. resolveUserIds()
// unions both so nothing goes missing.
import { NextRequest, NextResponse } from "next/server";
import { authPayload, sbSelect, resolveUserIds } from "@/lib/sb-server";
import {
  isBidConfirmedStayForDisplay,
  myBookingsCandidateBidStatusFilter,
  projectedBidBookingStatus,
} from "@/lib/stay/confirmed-stay";
import { readVerifiedStayEvidenceForCustomers } from "@/lib/stay/verified-stay-evidence";

export async function GET(req: NextRequest) {
  const payload = authPayload(req);
  const primaryId = payload?.id || payload?.user_id || payload?.sub;
  if (!primaryId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const customerIds = await resolveUserIds(primaryId, payload?.phone);
  const inList = customerIds.join(",");

  const [bookings, candidateBids] = await Promise.all([
    sbSelect(`bookings?customerId=in.(${inList})&select=*`),
    // Fetch the WHOLE candidate lifecycle (ACCEPTED / CHECKED_IN / CHECKED_OUT),
    // not just ACCEPTED — the canonical display filter below decides what shows.
    sbSelect(`bids?customerId=in.(${inList})&${myBookingsCandidateBidStatusFilter()}&select=*`),
  ]);

  // This is the customer's OWN My-Bookings list — a DISPLAY surface, never an
  // authorization one. The canonical isBidConfirmedStayForDisplay() decides what
  // shows: CHECKED_IN / CHECKED_OUT (STRONG stay states) always show; an ACCEPTED
  // bid shows only when it carries a paid marker (so a truly-unpaid ACCEPTED bid
  // isn't shown as CONFIRMED). The "paid" marker is FORGEABLE (client-stamped
  // message / unauthenticated /api/bid/paid), but forging it only affects the
  // forger's own view — it can NEVER grant Verified-Guest proof, which is decided
  // server-side by isBidVerifiedStay (CHECKED_IN/CHECKED_OUT only, SEC-00B
  // fail-closed). So we intentionally do NOT read the forgeable `bid_paid_amounts`
  // ledger here.
  const confirmedBids = candidateBids.filter((b: any) =>
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

  // Confirmed / checked-in / checked-out bids projected as bookings (so
  // downstream UI treats them uniformly). Unpaid / stale ACCEPTED bids were
  // already dropped by the confirmed-stay authority above — they never appear.
  const bidEnriched = confirmedBids.map((b: any) => {
    const req = requests.find((r: any) => r.id === b.requestId) || null;
    return {
      id: b.id,
      _source: "bid",
      // The display status is TRUTHFUL to the lifecycle: a display-paid ACCEPTED
      // bid shows as "CONFIRMED", but a CHECKED_IN / CHECKED_OUT bid keeps its
      // real status (so the card reads "Checked In" / "Checked Out" and a
      // CHECKED_OUT stay still drives the completed/rating view). The REAL bid
      // status is ALSO carried on `_bidStatus` + `_projectedFromBid` so the
      // Share-CTA resolver applies the STRONG Verified-Guest rule
      // (CHECKED_IN/CHECKED_OUT only) and never treats a forgeable "paid"
      // ACCEPTED bid as a share-eligible confirmed stay.
      _projectedFromBid: true,
      _bidStatus: b.status,
      customerId: b.customerId,
      hotelId: b.hotelId,
      roomId: b.roomId,
      amount: b.amount,
      totalAmount: b.amount,
      status: projectedBidBookingStatus(b),
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

  // SEC-00B — flag which rows are genuinely SHARE-eligible, using ONLY the
  // protected, forge-proof verified_stay_evidence (service-role). The mutable
  // public bids/bookings status is never the authority for this. Fails closed:
  // no evidence / unconfigured → no `_shareEligible` → no "Share now" CTA (the
  // server upload gate re-checks evidence anyway).
  try {
    const evidence = await readVerifiedStayEvidenceForCustomers(customerIds);
    const evKeys = new Set(
      evidence.map((e) => `${String(e.hotel_id)}|${String(e.source_id)}`)
    );
    for (const row of enriched as any[]) {
      row._shareEligible = evKeys.has(`${String(row.hotelId)}|${String(row.id)}`);
    }
  } catch {
    /* fail closed — leave _shareEligible unset (falsey) */
  }

  return NextResponse.json({ bookings: enriched });
}
