import { NextRequest, NextResponse } from "next/server";

// ─────────────────────────────────────────────────────────────────────────
// POST /api/kiosk/book
//   { phone, otp, hotelId, roomId, dealId, amount, guests, nights }
//
// Server-mediated same-day flash booking for the offline kiosk. The flow is
// IDENTICAL to the customer flash-deal path (create request → place bid with
// dealId → accept), but driven entirely server-side so the shared kiosk
// device never stores a customer JWT:
//
//   1. Verify the OTP at Railway → { token, user }  (token stays on server)
//   2. Call the SAME canonical Next.js bid routes the customer site uses,
//      with that token in Authorization. Reuses all floor/inventory/auto-
//      accept logic — zero duplication, zero drift.
//   3. Return a booking confirmation (id + summary) to the kiosk.
//
// `dealId` makes it an instant flash purchase (bypasses floor + per-hotel
// bid-conflict), matching the customer flash flow exactly.
// ─────────────────────────────────────────────────────────────────────────

const RAILWAY = "https://staybid-live-production.up.railway.app";

function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0); // noon to avoid TZ date-slip
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString();
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const phone = String(body?.phone || "").trim();
  const otp = String(body?.otp || "").trim();
  const hotelId = String(body?.hotelId || "");
  const roomId = String(body?.roomId || "");
  const dealId = body?.dealId ? String(body.dealId) : undefined;
  const amount = Math.round(Number(body?.amount) || 0);
  const guests = Math.max(1, Math.min(20, Math.floor(Number(body?.guests) || 2)));
  const nights = Math.max(1, Math.min(30, Math.floor(Number(body?.nights) || 1)));
  const rooms = Math.max(1, Math.min(10, Math.floor(Number(body?.rooms) || 1)));

  if (!phone || !otp) return NextResponse.json({ error: "Phone and OTP required" }, { status: 400 });
  if (!hotelId || !roomId || !amount) return NextResponse.json({ error: "Missing booking details" }, { status: 400 });

  // ─── 1) Verify OTP at Railway ─────────────────────────────────────────
  let token = "";
  let user: any = null;
  try {
    const r = await fetch(`${RAILWAY}/api/auth/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, otp }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.token) {
      return NextResponse.json({ error: j?.error || "Invalid OTP" }, { status: 401 });
    }
    token = j.token;
    user = j.user || null;
  } catch {
    return NextResponse.json({ error: "Verification service unavailable" }, { status: 502 });
  }

  const origin = req.nextUrl.origin;
  const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const checkIn = todayISO(0);
  const checkOut = todayISO(nights);

  // ─── 2) Create bid request (same canonical route) ─────────────────────
  let requestId = "";
  try {
    const r = await fetch(`${origin}/api/bids/request`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        hotelId, roomId, amount, checkIn, checkOut, guests,
        source: "flash", numRooms: rooms,
      }),
    });
    const j = await r.json().catch(() => ({}));
    requestId = j?.request?.id || j?.id || "";
    if (!requestId) {
      return NextResponse.json({ error: j?.error || "Could not start booking" }, { status: r.status || 500 });
    }
  } catch {
    return NextResponse.json({ error: "Booking service unavailable" }, { status: 502 });
  }

  // ─── 3) Place bid (dealId → instant flash purchase, bypasses floor) ───
  let bidId = "";
  try {
    const r = await fetch(`${origin}/api/bids/place`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        hotelId, roomId, amount, requestId, dealId,
        flow: "flash", guests, numRooms: rooms,
        message: "StayBid Kiosk · same-day flash booking",
      }),
    });
    const j = await r.json().catch(() => ({}));
    bidId = j?.bid?.id || j?.id || "";
    if (!bidId) {
      return NextResponse.json({ error: j?.error || "Could not confirm booking" }, { status: r.status || 500 });
    }
  } catch {
    return NextResponse.json({ error: "Booking service unavailable" }, { status: 502 });
  }

  // ─── 4) Accept → confirm (same as customer flash flow) ────────────────
  try {
    await fetch(`${origin}/api/bids/${bidId}/accept`, { method: "POST", headers: authHeaders });
  } catch {
    /* non-blocking — bid is placed; acceptance can still be settled later */
  }

  const bookingId = "SB-" + new Date().getFullYear() + "-" + bidId.slice(-6).toUpperCase();
  const masked = phone.replace(/(\d{2})\d{4}(\d{4})/, "$1XXXX$2");

  return NextResponse.json({
    ok: true,
    bookingId,
    bidId,
    requestId,
    amount,
    nights,
    rooms,
    total: amount * nights * rooms,
    checkIn,
    checkOut,
    phoneMasked: masked,
    userName: user?.name || "Guest",
  });
}
