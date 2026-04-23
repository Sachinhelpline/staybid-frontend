import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

async function sb(path: string) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_H });
    const t = await r.text();
    const j = JSON.parse(t);
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

export async function GET(req: NextRequest) {
  const city = req.nextUrl.searchParams.get("city") || "";
  const nowIso = new Date().toISOString();

  let filter = `select=*&isActive=eq.true&validUntil=gt.${encodeURIComponent(nowIso)}`;
  if (city) filter += `&city=ilike.${encodeURIComponent(city)}`;

  const [deals, hotels, rooms] = await Promise.all([
    sb(`flash_deals?${filter}`),
    sb(`hotels?select=*`),
    sb(`rooms?select=*`),
  ]);

  const dealsEnriched = deals.map((d: any) => ({
    ...d,
    hotel: hotels.find((h: any) => h.id === d.hotelId) || null,
    room:  rooms.find((r: any) => r.id === d.roomId)  || null,
  }));

  return NextResponse.json({ deals: dealsEnriched });
}
