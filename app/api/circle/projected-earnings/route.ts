// S1 (design: CIRCLE-SETTLEMENT-ATTRIBUTION-DESIGN.md) — READ-ONLY projected earnings.
//
//   GET /api/circle/projected-earnings
//     Shows a Circle owner/investor what they WOULD be owed from real, confirmed
//     guest bookings on their room-nights, using the pure attribution resolver
//     (money follows the transferable inventory_blocks.investor_user_id, per night,
//     falling back to the unit owner_user_id). PROJECTION ONLY — writes nothing,
//     moves no money, and the fee shown is illustrative (the committed fee is an
//     owner decision in the settlement phase, S2).
//
// Auth: the owner's customer sb_token → cross-pool owner ids.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, decodeJwt } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import {
  enumerateNights, resolveNightlyPayees, CIRCLE_BOOKING_FEE_PCT_DEFAULT,
  type BlockOverlay,
} from "@/lib/circle/attribution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function auth(req: NextRequest): { userId?: string; phone?: string; email?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub, phone: p?.phone, email: p?.email };
}

const csv = (xs: string[]) => xs.map((x) => encodeURIComponent(x)).join(",");
async function getJson(url: string): Promise<any[]> {
  try { const r = await fetch(url, { headers: SB_H }); const j = r.ok ? await r.json().catch(() => []) : []; return Array.isArray(j) ? j : []; }
  catch { return []; }
}

export async function GET(req: NextRequest) {
  const { userId, phone, email } = auth(req);
  if (!userId) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const ownerIds = await resolveOwnerIdsCrossPool(userId, phone, email);
  const empty = { projectedNetOwed: 0, projectedGross: 0, bookingCount: 0, nightsCount: 0, feePct: CIRCLE_BOOKING_FEE_PCT_DEFAULT, items: [] as any[] };
  if (!ownerIds.length) return NextResponse.json(empty);
  const ownerSet = new Set(ownerIds.map(String));
  const idsCsv = csv(ownerIds);

  // 1) The owner's physical units + their owned/listed commercial-right blocks.
  const [ownedUnits, ownedBlocks] = await Promise.all([
    getJson(`${SB_URL}/rest/v1/hotel_room_units?owner_user_id=in.(${idsCsv})&select=id,hotelId,roomId,owner_user_id&limit=500`),
    getJson(`${SB_URL}/rest/v1/inventory_blocks?investor_user_id=in.(${idsCsv})&status=in.(owned,listed)&select=id,unit_id,hotel_id,room_id,date_from,date_to,status&limit=500`),
  ]);

  const candidateUnitIds = Array.from(new Set([
    ...ownedUnits.map((u) => String(u.id)),
    ...ownedBlocks.map((b) => String(b.unit_id)).filter((x) => x && x !== "null"),
  ].filter(Boolean)));
  if (!candidateUnitIds.length) return NextResponse.json(empty);
  const unitCsv = csv(candidateUnitIds);

  // 2) Full context for every candidate unit: the unit (owner), its hotel, and
  //    ALL live blocks on it (from any investor — so a night owned by a DIFFERENT
  //    investor is correctly attributed away from this owner).
  const [allUnits, allBlocks] = await Promise.all([
    getJson(`${SB_URL}/rest/v1/hotel_room_units?id=in.(${unitCsv})&select=id,hotelId,roomId,owner_user_id&limit=500`),
    getJson(`${SB_URL}/rest/v1/inventory_blocks?unit_id=in.(${unitCsv})&status=in.(owned,listed)&select=unit_id,investor_user_id,date_from,date_to,status&limit=1000`),
  ]);
  const hotelIds = Array.from(new Set(allUnits.map((u) => String(u.hotelId)).filter(Boolean)));
  const hotels = hotelIds.length
    ? await getJson(`${SB_URL}/rest/v1/hotels?id=in.(${csv(hotelIds)})&select=id,ownerId,owner_type,name&limit=500`)
    : [];
  const unitById: Record<string, any> = {}; allUnits.forEach((u) => { unitById[String(u.id)] = u; });
  const hotelById: Record<string, any> = {}; hotels.forEach((h) => { hotelById[String(h.id)] = h; });
  const blocksByUnit: Record<string, BlockOverlay[]> = {};
  allBlocks.forEach((b) => {
    const k = String(b.unit_id);
    (blocksByUnit[k] ||= []).push({ investor_user_id: String(b.investor_user_id), date_from: String(b.date_from), date_to: String(b.date_to), status: String(b.status) });
  });

  // 3) Bids assigned to these units → the bookings that confirmed against them.
  const bids = await getJson(`${SB_URL}/rest/v1/bids?assignedUnitId=in.(${unitCsv})&select=id,assignedUnitId,hotelId,roomId,numRooms&limit=1000`);
  if (!bids.length) return NextResponse.json(empty);
  const bidById: Record<string, any> = {}; bids.forEach((b) => { bidById[String(b.id)] = b; });
  const bidIds = bids.map((b) => String(b.id));

  // Confirmed, paid, non-refunded bookings only.
  const bookings = await getJson(
    `${SB_URL}/rest/v1/bookings?bidId=in.(${csv(bidIds)})&paidAmount=gt.0` +
      `&status=not.in.(CANCELLED,cancelled,REFUNDED,refunded,FAILED,failed)` +
      `&select=id,bidId,checkIn,checkOut,paidAmount,numRooms,hotelId,roomId,status&limit=1000`,
  );

  const feePct = CIRCLE_BOOKING_FEE_PCT_DEFAULT;
  let projectedNetOwed = 0, projectedGross = 0, nightsCount = 0;
  const items: any[] = [];

  for (const bk of bookings) {
    const bid = bidById[String(bk.bidId)];
    const unitId = bid ? String(bid.assignedUnitId) : "";
    if (!unitId) continue;
    const unit = unitById[unitId];
    const hotel = unit ? hotelById[String(unit.hotelId)] : null;

    const allNights = enumerateNights(String(bk.checkIn), String(bk.checkOut));
    if (!allNights.length) continue;
    const resolved = resolveNightlyPayees(allNights, {
      blocks: blocksByUnit[unitId] || [],
      ownerUserId: unit?.owner_user_id ? String(unit.owner_user_id) : null,
      hotelOwnerId: hotel?.ownerId ? String(hotel.ownerId) : null,
      hotelOwnerType: hotel?.owner_type || null,
    });
    const myNights = resolved.filter((n) => n.payeeUserId && ownerSet.has(n.payeeUserId)).length;
    if (myNights <= 0) continue;

    // Pro-rate the booking's paid amount to the owner's share of the stay's nights.
    const paid = Math.round(Number(bk.paidAmount) || 0);
    const myGross = Math.round(paid * (myNights / allNights.length));
    const myNet = Math.round(myGross * (1 - feePct / 100));
    projectedGross += myGross;
    projectedNetOwed += myNet;
    nightsCount += myNights;
    items.push({
      bookingId: bk.id,
      hotelName: hotel?.name || bk.hotelId,
      checkIn: String(bk.checkIn).slice(0, 10),
      checkOut: String(bk.checkOut).slice(0, 10),
      nights: myNights,
      status: bk.status,
      gross: myGross,
      net: myNet,
    });
  }
  items.sort((a, b) => (a.checkIn < b.checkIn ? 1 : -1));

  return NextResponse.json({
    projectedNetOwed, projectedGross, bookingCount: items.length, nightsCount, feePct,
    items: items.slice(0, 100),
    note: "Projected from confirmed bookings. Illustrative only — the platform fee and actual payout are set in the settlement phase; no money has been recorded or moved.",
  });
}
