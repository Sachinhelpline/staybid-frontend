import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "sb_publishable_N2tMgg386VuuZcuy-Tpi8A_FLRK_-eE";

function decodeJwt(token: string): any {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch { return null; }
}

const SB_HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

async function sbGet(path: string) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_HEADERS });
  return res.json();
}

export async function GET(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = decodeJwt(token);
  if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const userId = payload.id;

  // Fetch hotel owned by this user
  const hotels = await sbGet(`hotels?ownerId=eq.${userId}&select=*`);
  if (!Array.isArray(hotels) || hotels.length === 0)
    return NextResponse.json({ error: "No hotel found for this account" }, { status: 404 });

  const hotel = hotels[0];

  // Fetch rooms for this hotel
  const rooms = await sbGet(`rooms?hotelId=eq.${hotel.id}&select=*`);

  return NextResponse.json({ hotel: { ...hotel, rooms: Array.isArray(rooms) ? rooms : [] } });
}
