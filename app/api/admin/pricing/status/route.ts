import { NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";

export async function GET() {
  const [rooms, deals] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/rooms?select=id,aiPrice,floorPrice`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    }).then((r) => (r.ok ? r.json() : [])),
    fetch(`${SB_URL}/rest/v1/flash_deals?select=*`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    }).then((r) => (r.ok ? r.json() : [])),
  ]);

  const aiManaged = (rooms as any[]).filter((r) => r.aiPrice).length;
  const manual = (rooms as any[]).length - aiManaged;

  return NextResponse.json({
    aiManaged,
    manual,
    totalRooms: (rooms as any[]).length,
    flashDeals: deals,
    activeDeals: (deals as any[]).filter((d: any) => new Date(d.validUntil) > new Date()).length,
    lastRecalc: new Date().toISOString(),
  });
}
