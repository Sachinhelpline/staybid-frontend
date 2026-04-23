import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
const SB_H = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const city = searchParams.get("city") || "";
  const q    = searchParams.get("q")    || "";

  // Build hotel filter
  let hotelFilter = "select=*&order=createdAt.desc&limit=100";
  if (city) hotelFilter += `&city=ilike.${encodeURIComponent(city)}`;
  if (q)    hotelFilter += `&name=ilike.${encodeURIComponent(`%${q}%`)}`;

  const [hotelsRes, roomsRes] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/hotels?${hotelFilter}`, { headers: SB_H }),
    fetch(`${SB_URL}/rest/v1/rooms?select=*`, { headers: SB_H }),
  ]);

  const hotels: any[] = hotelsRes.ok ? await hotelsRes.json() : [];
  const rooms:  any[] = roomsRes.ok  ? await roomsRes.json()  : [];

  // Attach rooms to each hotel
  const hotelsWithRooms = hotels.map((h: any) => ({
    ...h,
    rooms: rooms.filter((r: any) => r.hotelId === h.id),
  }));

  return NextResponse.json({ hotels: hotelsWithRooms, total: hotelsWithRooms.length });
}
