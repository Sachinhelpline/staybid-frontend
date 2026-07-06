import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { resolveOperatedHotelIds } from "@/lib/partner/operator-access";
import { SB_URL, SB_KEY } from "@/lib/sb";

// JWT-format anon key required for RLS-enabled tables (users)

const SB_H    = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" };

function decodeJwt(t: string) {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"), "base64").toString()); }
  catch { return null; }
}

// Cross-pool resolver lives in lib/partner/owner-ids.ts — bridges the legacy
// `users` (Railway customer pool) with `onboarding_users` (self-service /onboard
// pool) by phone (with/without +91) and email, so a host who onboarded via
// /onboard can sign into /partner with the same phone and see their hotel.
const resolveOwnerIds = (id: string, p?: string, e?: string) => resolveOwnerIdsCrossPool(id, p, e);

export async function GET(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = decodeJwt(token);
  if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  // Resolve all user IDs for this phone (handles duplicate records with/without +91)
  const headerPhone = req.headers.get("x-phone") || "";
  const headerEmail = req.headers.get("x-email") || "";
  const ownerIds = await resolveOwnerIds(payload.id, payload.phone || headerPhone, payload.email || headerEmail);

  // Circle operators own physical units on StayBid-operated hotels (no ownerId
  // match) — union those hotel ids so they resolve here too.
  const operatedIds = await resolveOperatedHotelIds(ownerIds);
  const ownerFilter = `ownerId.in.(${ownerIds.join(",")})`;
  const hotelFilter = operatedIds.length
    ? `or=(${ownerFilter},id.in.(${operatedIds.map((i) => encodeURIComponent(i)).join(",")}))`
    : `ownerId=in.(${ownerIds.join(",")})`;

  const hRes  = await fetch(`${SB_URL}/rest/v1/hotels?${hotelFilter}&select=*&order=createdAt.asc`, { headers: SB_H });
  const hotels = await hRes.json();
  if (!Array.isArray(hotels) || !hotels[0]) return NextResponse.json({ error: "No hotel found" }, { status: 404 });

  // v285 — Multi-property: ?hotelId= picks a SPECIFIC owned hotel (ownership
  // verified against the resolved list). Default keeps hotels[0] so single-hotel
  // owners + legacy callers are byte-identical to pre-v285.
  const wantId = (new URL(req.url).searchParams.get("hotelId") || "").trim();
  const hotel = (wantId && hotels.find((h: any) => String(h.id) === wantId)) || hotels[0];
  const rRes  = await fetch(`${SB_URL}/rest/v1/rooms?hotelId=eq.${hotel.id}&select=*`, { headers: SB_H });
  const rooms = await rRes.json();

  // Phase 2 — Circle operator scoping. A hotel reached via unit-ownership (NOT
  // ownerId) is a multi-investor StayBid-operated property. The caller must see
  // + manage ONLY their own physical units, and NEVER another owner's bookings.
  const isOperator = !ownerIds.map(String).includes(String(hotel.ownerId));
  let ownedUnits: any[] = [];
  if (isOperator) {
    const inList = ownerIds.map((i) => encodeURIComponent(i)).join(",");
    const uRes = await fetch(
      `${SB_URL}/rest/v1/hotel_room_units?hotelId=eq.${encodeURIComponent(hotel.id)}&owner_user_id=in.(${inList})&select=*&order=roomNumber.asc`,
      { headers: SB_H },
    );
    const u = await uRes.json().catch(() => []);
    ownedUnits = Array.isArray(u) ? u : [];
  }

  // Bookings (accepted bids). For an operator-reached hotel we scope to bids
  // assigned to the caller's OWN units. Until the individual-room booking flow
  // assigns units (Phase 3), operators see zero shared-hotel bookings — which is
  // the correct, leak-free state (never surface another owner's booking).
  const ownedUnitIdSet = new Set(ownedUnits.map((u: any) => String(u.id)));
  let bookingsArr: any[] = [];
  if (!isOperator) {
    const bRes  = await fetch(
      `${SB_URL}/rest/v1/bids?hotelId=eq.${hotel.id}&status=eq.ACCEPTED&select=*&order=createdAt.desc&limit=100`,
      { headers: SB_H }
    );
    const bookingsRaw = await bRes.json();
    bookingsArr = Array.isArray(bookingsRaw) ? bookingsRaw : [];
  } else {
    const bRes  = await fetch(
      `${SB_URL}/rest/v1/bids?hotelId=eq.${hotel.id}&status=eq.ACCEPTED&select=*&order=createdAt.desc&limit=100`,
      { headers: SB_H }
    );
    const bookingsRaw = await bRes.json();
    const all = Array.isArray(bookingsRaw) ? bookingsRaw : [];
    // Only bids whose assigned unit the caller owns (assignedUnitId set once the
    // individual-room flow lands). No unit → excluded (leak-safe).
    bookingsArr = all.filter((b: any) => b.assignedUnitId && ownedUnitIdSet.has(String(b.assignedUnitId)));
  }

  // Enrich with user + request + room data
  const customerIds = Array.from(new Set(bookingsArr.map((b: any) => b.customerId).filter(Boolean)));
  const requestIds  = Array.from(new Set(bookingsArr.map((b: any) => b.requestId).filter(Boolean)));
  const roomIdsB    = Array.from(new Set(bookingsArr.map((b: any) => b.roomId).filter(Boolean)));

  const [users, requests, bRooms] = await Promise.all([
    customerIds.length
      ? fetch(`${SB_URL}/rest/v1/users?id=in.(${customerIds.join(",")})&select=id,name,phone`, { headers: SB_H }).then(r => r.json()).catch(() => [])
      : Promise.resolve([]),
    requestIds.length
      ? fetch(`${SB_URL}/rest/v1/bid_requests?id=in.(${requestIds.join(",")})&select=*`, { headers: SB_H }).then(r => r.json()).catch(() => [])
      : Promise.resolve([]),
    roomIdsB.length
      ? fetch(`${SB_URL}/rest/v1/rooms?id=in.(${roomIdsB.join(",")})&select=*`, { headers: SB_H }).then(r => r.json()).catch(() => [])
      : Promise.resolve([]),
  ]);
  const uArr  = Array.isArray(users)    ? users    : [];
  const rqArr = Array.isArray(requests) ? requests : [];
  const rmArr = Array.isArray(bRooms)   ? bRooms   : [];

  // BULLETPROOF: pull server-recorded paid amounts in one batch
  const paidByBid: Record<string, any> = {};
  try {
    const ids = bookingsArr.map((b: any) => b.id).filter(Boolean);
    if (ids.length) {
      const pRes = await fetch(
        `${SB_URL}/rest/v1/bid_paid_amounts?bid_id=in.(${ids.map((i: string) => encodeURIComponent(i)).join(",")})&select=bid_id,paid_total,paid_per_night,nights,flow,razorpay_payment_id`,
        { headers: SB_H }
      );
      const arr = await pRes.json();
      if (Array.isArray(arr)) for (const r of arr) paidByBid[r.bid_id] = r;
    }
  } catch { /* ignore */ }

  const bookings = bookingsArr.map((b: any) => {
    const u  = uArr.find((x: any) => x.id === b.customerId);
    const rq = rqArr.find((x: any) => x.id === b.requestId);
    const rm = rmArr.find((x: any) => x.id === b.roomId);
    // BULLETPROOF paid-amount resolution (priority order):
    //   1. bid_paid_amounts row (server-authoritative, written at booking time)
    //   2. legacy paid:/rate: tokens in bid.message (pre-bulletproof bookings)
    //   3. fall back to b.amount (may be corrupted to floor)
    const serverPaid = paidByBid[b.id];
    const msg = String(b.message || "");
    const paidTotalMsg = msg.match(/paid:\s*(\d+(?:\.\d+)?)/i);
    const paidRateMsg  = msg.match(/rate:\s*(\d+(?:\.\d+)?)/i);
    const perNight = serverPaid?.paid_per_night
      ? Number(serverPaid.paid_per_night)
      : (paidRateMsg ? parseFloat(paidRateMsg[1])
        : (paidTotalMsg ? parseFloat(paidTotalMsg[1]) : null));
    const totalPaid = serverPaid?.paid_total
      ? Number(serverPaid.paid_total)
      : (paidTotalMsg ? parseFloat(paidTotalMsg[1]) : null);
    return {
      ...b,
      amount: perNight ?? b.amount,
      paidTotal: totalPaid,
      paidPerNight: perNight,
      paidFlow: serverPaid?.flow || null,
      razorpayPaymentId: serverPaid?.razorpay_payment_id || null,
      guestName: u?.name || null,
      guestPhone: u?.phone || null,
      customer: u || null,
      request: rq || null,
      checkIn: rq?.checkIn || b.checkIn || null,
      checkOut: rq?.checkOut || b.checkOut || null,
      guests: rq?.guests || b.guests || null,
      room: rm || null,
    };
  });

  return NextResponse.json({
    hotel: {
      ...hotel,
      rooms: Array.isArray(rooms) ? rooms : [],
      // Phase 2 — Circle operator context. isOperator=true means the caller
      // reaches this hotel via unit-ownership; ownedUnits are the physical rooms
      // they manage. For a classic ownerId partner these are false/[].
      isOperator,
      ownedUnits,
    },
    bookings,
  });
}

export async function PATCH(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = decodeJwt(token);
  if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const updates = await req.json();
  const allowed: Record<string, any> = {};
  // v170 — property_type / meal_plans / addon_services let a hotel
  // declare what it offers, so the categorized /bid auction targets it.
  const fields = [
    "name","description","amenities","images","city","state","starRating",
    "property_type","meal_plans","addon_services",
  ];
  for (const f of fields) { if (updates[f] !== undefined) allowed[f] = updates[f]; }

  // Update for any matching owner ID (across customer + onboarding pools)
  const ownerIds = await resolveOwnerIds(payload.id, payload.phone, payload.email);

  // v285 — Multi-property: scope the PATCH to ONE owned hotel when hotelId is
  // provided (query param OR body). Pre-v285 this PATCHed EVERY owned hotel —
  // fine for single-hotel owners, but a data-corruption bug once a partner owns
  // 2+ properties. We verify the target belongs to this owner before writing.
  const wantId = (new URL(req.url).searchParams.get("hotelId") || String(updates.hotelId || "")).trim();
  let scope = `ownerId=in.(${ownerIds.join(",")})`;
  if (wantId) {
    const oRes = await fetch(
      `${SB_URL}/rest/v1/hotels?id=eq.${encodeURIComponent(wantId)}&ownerId=in.(${ownerIds.join(",")})&select=id`,
      { headers: SB_H }
    );
    const owned = await oRes.json().catch(() => []);
    if (!Array.isArray(owned) || !owned[0]) {
      return NextResponse.json({ error: "Not your hotel" }, { status: 403 });
    }
    scope = `id=eq.${encodeURIComponent(wantId)}`;
  }

  const hRes = await fetch(`${SB_URL}/rest/v1/hotels?${scope}`, {
    method: "PATCH", headers: SB_H, body: JSON.stringify(allowed),
  });
  if (!hRes.ok) return NextResponse.json({ error: "Update failed" }, { status: 500 });
  const updated = await hRes.json().catch(() => []);
  return NextResponse.json({ hotel: Array.isArray(updated) ? updated[0] : updated, saved: true });
}
