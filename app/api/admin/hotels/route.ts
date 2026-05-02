import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";

async function sb(path: string) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) return [];
  return res.json();
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const city = searchParams.get("city");
  const status = searchParams.get("status");
  const search = searchParams.get("search");

  try {
    let query = "hotels?select=id,name,city,state,ownerId,status,images,starRating,createdAt&order=createdAt.desc&limit=200";
    if (city && city !== "all") query += `&city=eq.${city}`;
    if (status && status !== "all") query += `&status=eq.${status}`;

    let hotels = (await sb(query)) as any[];

    if (search) {
      const s = search.toLowerCase();
      hotels = hotels.filter(
        (h) => h.name?.toLowerCase().includes(s) || h.city?.toLowerCase().includes(s)
      );
    }

    const [rooms, bookings] = await Promise.all([
      sb("rooms?select=id,hotelId,type,floorPrice,aiPrice"),
      sb("bookings?select=id,hotelId,totalAmount,status,createdAt"),
    ]);

    const enriched = hotels.map((h: any) => {
      const hotelRooms = (rooms as any[]).filter((r) => r.hotelId === h.id);
      const hotelBookings = (bookings as any[]).filter((b) => b.hotelId === h.id);
      const monthAgo = new Date(); monthAgo.setMonth(monthAgo.getMonth() - 1);
      const monthBookings = hotelBookings.filter((b) => new Date(b.createdAt) >= monthAgo);
      const gmv = hotelBookings.reduce((s: number, b: any) => s + (Number(b.totalAmount) || 0), 0);
      return {
        ...h,
        roomsCount: hotelRooms.length,
        bookingsThisMonth: monthBookings.length,
        gmv,
        commission: h.commission || 5,
      };
    });

    return NextResponse.json({ hotels: enriched, total: enriched.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const { hotelId, action, value } = await req.json();
  try {
    let update: Record<string, unknown> = {};
    if (action === "status") update = { status: value };
    else if (action === "commission") update = { commission: value };
    else return NextResponse.json({ error: "Unknown action" }, { status: 400 });

    const res = await fetch(`${SB_URL}/rest/v1/hotels?id=eq.${hotelId}`, {
      method: "PATCH",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(update),
    });
    const data = await res.json();
    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
