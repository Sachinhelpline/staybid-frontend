import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "sb_publishable_N2tMgg386VuuZcuy-Tpi8A_FLRK_-eE";
const SB_H   = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" };

function decodeJwt(t: string) {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"), "base64").toString()); }
  catch { return null; }
}

export async function GET(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = decodeJwt(token);
  if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const hRes  = await fetch(`${SB_URL}/rest/v1/hotels?ownerId=eq.${payload.id}&select=*`, { headers: SB_H });
  const hotels = await hRes.json();
  if (!Array.isArray(hotels) || !hotels[0]) return NextResponse.json({ error: "No hotel found" }, { status: 404 });

  const hotel = hotels[0];
  const rRes  = await fetch(`${SB_URL}/rest/v1/rooms?hotelId=eq.${hotel.id}&select=*`, { headers: SB_H });
  const rooms = await rRes.json();

  // Bookings (accepted bids)
  const bRes  = await fetch(
    `${SB_URL}/rest/v1/bids?hotelId=eq.${hotel.id}&status=eq.ACCEPTED&select=*&order=createdAt.desc&limit=50`,
    { headers: SB_H }
  );
  const bookings = await bRes.json();

  return NextResponse.json({
    hotel: { ...hotel, rooms: Array.isArray(rooms) ? rooms : [] },
    bookings: Array.isArray(bookings) ? bookings : [],
  });
}

export async function PATCH(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = decodeJwt(token);
  if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const updates = await req.json();
  // Whitelist allowed hotel fields
  const allowed: Record<string, any> = {};
  const fields = ["name","description","amenities","images","city","state","starRating"];
  for (const f of fields) { if (updates[f] !== undefined) allowed[f] = updates[f]; }

  const hRes = await fetch(`${SB_URL}/rest/v1/hotels?ownerId=eq.${payload.id}`, {
    method: "PATCH", headers: SB_H, body: JSON.stringify(allowed),
  });
  if (!hRes.ok) return NextResponse.json({ error: "Update failed" }, { status: 500 });
  const updated = await hRes.json().catch(() => []);
  return NextResponse.json({ hotel: Array.isArray(updated) ? updated[0] : updated, saved: true });
}
