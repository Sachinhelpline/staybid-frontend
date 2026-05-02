import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

export async function GET() {
  const res = await fetch(
    `${SB_URL}/rest/v1/rooms?select=id,type,floorPrice,aiPrice,hotelId,hotels(name,city)&order=hotelId.asc&limit=500`,
    { headers: H }
  );
  const data = res.ok ? await res.json() : [];
  return NextResponse.json({ rooms: data });
}

export async function PATCH(req: NextRequest) {
  const { roomId, floorPrice, aiPrice } = await req.json();
  if (!roomId) return NextResponse.json({ error: "roomId required" }, { status: 400 });
  const patch: any = {};
  if (floorPrice != null) patch.floorPrice = Number(floorPrice);
  if (aiPrice != null) patch.aiPrice = Number(aiPrice);
  const res = await fetch(`${SB_URL}/rest/v1/rooms?id=eq.${roomId}`, {
    method: "PATCH",
    headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  return NextResponse.json({ ok: res.ok });
}
