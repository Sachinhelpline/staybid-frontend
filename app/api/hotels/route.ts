import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";


const SB_H = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const city = searchParams.get("city") || "";
  const q    = searchParams.get("q")    || "";

  // Build hotel filter — no camelCase ordering (PostgREST requires quoted identifiers)
  const qs = new URLSearchParams({ select: "*", limit: "100" });
  if (city) qs.set("city", `ilike.${city}`);
  if (q)    qs.set("name", `ilike.*${q}*`);

  const [hotelsRes, roomsRes] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/hotels?${qs.toString()}`, { headers: SB_H }),
    fetch(`${SB_URL}/rest/v1/rooms?select=*&limit=500`, { headers: SB_H }),
  ]);

  const hotelsRaw = await hotelsRes.text();
  const roomsRaw  = await roomsRes.text();

  let hotels: any[] = [];
  let rooms:  any[] = [];
  try { hotels = JSON.parse(hotelsRaw); if (!Array.isArray(hotels)) hotels = []; } catch { hotels = []; }
  try { rooms  = JSON.parse(roomsRaw);  if (!Array.isArray(rooms))  rooms  = []; } catch { rooms  = []; }

  // Attach rooms to each hotel
  const hotelsWithRooms = hotels.map((h: any) => ({
    ...h,
    rooms: rooms.filter((r: any) => r.hotelId === h.id),
  }));

  return NextResponse.json({ hotels: hotelsWithRooms, total: hotelsWithRooms.length });
}
