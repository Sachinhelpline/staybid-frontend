import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";

const SB_URL  = "https://uxxhbdqedazpmvbvaosh.supabase.co";
// JWT-format anon key required for RLS-enabled tables (users)
const SB_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
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

  const hRes  = await fetch(`${SB_URL}/rest/v1/hotels?ownerId=in.(${ownerIds.join(",")})&select=*`, { headers: SB_H });
  const hotels = await hRes.json();
  if (!Array.isArray(hotels) || !hotels[0]) return NextResponse.json({ error: "No hotel found" }, { status: 404 });

  const hotel = hotels[0];
  const rRes  = await fetch(`${SB_URL}/rest/v1/rooms?hotelId=eq.${hotel.id}&select=*`, { headers: SB_H });
  const rooms = await rRes.json();

  // Bookings (accepted bids)
  const bRes  = await fetch(
    `${SB_URL}/rest/v1/bids?hotelId=eq.${hotel.id}&status=eq.ACCEPTED&select=*&order=createdAt.desc&limit=100`,
    { headers: SB_H }
  );
  const bookingsRaw = await bRes.json();
  const bookingsArr: any[] = Array.isArray(bookingsRaw) ? bookingsRaw : [];

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
    hotel: { ...hotel, rooms: Array.isArray(rooms) ? rooms : [] },
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
  const fields = ["name","description","amenities","images","city","state","starRating"];
  for (const f of fields) { if (updates[f] !== undefined) allowed[f] = updates[f]; }

  // Update for any matching owner ID (across customer + onboarding pools)
  const ownerIds = await resolveOwnerIds(payload.id, payload.phone, payload.email);
  const hRes = await fetch(`${SB_URL}/rest/v1/hotels?ownerId=in.(${ownerIds.join(",")})`, {
    method: "PATCH", headers: SB_H, body: JSON.stringify(allowed),
  });
  if (!hRes.ok) return NextResponse.json({ error: "Update failed" }, { status: 500 });
  const updated = await hRes.json().catch(() => []);
  return NextResponse.json({ hotel: Array.isArray(updated) ? updated[0] : updated, saved: true });
}
