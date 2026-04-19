import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "sb_publishable_N2tMgg386VuuZcuy-Tpi8A_FLRK_-eE";
const SB_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const RAILWAY = "https://staybid-live-production.up.railway.app";

function decodeJwt(token: string): any {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = decodeJwt(token);
  if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  try {
    // Try Railway backend first
    const res = await fetch(`${RAILWAY}/api/bids/hotel`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch { /* fall through to Supabase */ }

  // Fallback: Supabase direct
  const hotelRes = await fetch(`${SB_URL}/rest/v1/hotels?ownerId=eq.${payload.id}&select=id`, { headers: SB_HEADERS });
  const hotels = await hotelRes.json();
  if (!Array.isArray(hotels) || hotels.length === 0) return NextResponse.json({ bids: [] });

  const hotelId = hotels[0].id;
  const bidsRes = await fetch(
    `${SB_URL}/rest/v1/bids?hotelId=eq.${hotelId}&select=*&order=createdAt.desc&limit=100`,
    { headers: SB_HEADERS }
  );
  const bids = await bidsRes.json();
  return NextResponse.json({ bids: Array.isArray(bids) ? bids : [] });
}
