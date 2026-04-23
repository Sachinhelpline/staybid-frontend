import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
const SB_H = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = await params;

  const [hotelRes, roomsRes, reviewsRes] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/hotels?id=eq.${id}&select=*`, { headers: SB_H }),
    fetch(`${SB_URL}/rest/v1/rooms?hotelId=eq.${id}&select=*`, { headers: SB_H }),
    fetch(`${SB_URL}/rest/v1/reviews?hotelId=eq.${id}&select=*&limit=20`, { headers: SB_H }),
  ]);

  let hotels:  any[] = [];
  let rooms:   any[] = [];
  let reviews: any[] = [];
  try { hotels  = JSON.parse(await hotelRes.text());   if (!Array.isArray(hotels))  hotels  = []; } catch { hotels  = []; }
  try { rooms   = JSON.parse(await roomsRes.text());   if (!Array.isArray(rooms))   rooms   = []; } catch { rooms   = []; }
  try { reviews = JSON.parse(await reviewsRes.text()); if (!Array.isArray(reviews)) reviews = []; } catch { reviews = []; }

  if (!hotels[0]) {
    return NextResponse.json({ error: "Hotel not found" }, { status: 404 });
  }

  const hotel = {
    ...hotels[0],
    rooms: Array.isArray(rooms) ? rooms : [],
    reviews: Array.isArray(reviews) ? reviews : [],
  };

  return NextResponse.json({ hotel });
}
