import { NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";

export async function GET() {
  const [hotels, bookings] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/hotels?select=id,name,city`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    }).then((r) => (r.ok ? r.json() : [])),
    fetch(`${SB_URL}/rest/v1/bookings?select=id,hotelId,totalAmount,status,createdAt`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    }).then((r) => (r.ok ? r.json() : [])),
  ]);

  const ledger = (hotels as any[]).map((h: any) => {
    const hotelBookings = (bookings as any[]).filter((b: any) => b.hotelId === h.id);
    const gmv = hotelBookings.reduce((s: number, b: any) => s + (Number(b.totalAmount) || 0), 0);
    const commission = 5;
    return {
      hotelId: h.id,
      hotelName: h.name,
      city: h.city,
      bookings: hotelBookings.length,
      gmv,
      commissionPct: commission,
      commissionEarned: Math.round((gmv * commission) / 100),
      netPayout: gmv - Math.round((gmv * commission) / 100),
    };
  });

  return NextResponse.json({ ledger, total: ledger.length });
}
