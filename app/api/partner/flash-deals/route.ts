import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
const SB_H   = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" };

function decodeJwt(t: string) {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"), "base64").toString()); }
  catch { return null; }
}

// Cross-pool resolver — bridges customer + onboarding pools so partners can
// log in with the same phone they used at /onboard signup.
const resolveOwnerIds = (id: string, p?: string, e?: string) => resolveOwnerIdsCrossPool(id, p, e);

export async function GET(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = decodeJwt(token);
  if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const ownerIds = await resolveOwnerIds(payload.id, payload.phone, payload.email);
  const hRes = await fetch(
    `${SB_URL}/rest/v1/hotels?ownerId=in.(${ownerIds.join(",")})&select=id`,
    { headers: SB_H }
  );
  const hotels = await hRes.json();
  if (!Array.isArray(hotels) || !hotels[0]) return NextResponse.json({ deals: [] });

  const fRes = await fetch(
    `${SB_URL}/rest/v1/flash_deals?hotelId=eq.${hotels[0].id}&select=*&order=createdAt.desc`,
    { headers: SB_H }
  );
  const deals = await fRes.json();
  return NextResponse.json({ deals: Array.isArray(deals) ? deals : [] });
}

export async function POST(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = decodeJwt(token);
  if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const body = await req.json();
  const { hotelId, roomId, dealPrice, discount, durationHours, maxRooms } = body;

  // Verify ownership using all owner IDs
  const ownerIds = await resolveOwnerIds(payload.id, payload.phone, payload.email);
  const hRes = await fetch(
    `${SB_URL}/rest/v1/hotels?ownerId=in.(${ownerIds.join(",")})&id=eq.${hotelId}&select=id`,
    { headers: SB_H }
  );
  const hotels = await hRes.json();
  if (!Array.isArray(hotels) || !hotels[0]) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const validUntil = new Date(Date.now() + (durationHours || 24) * 3600000).toISOString();
  const res = await fetch(`${SB_URL}/rest/v1/flash_deals`, {
    method: "POST",
    headers: SB_H,
    body: JSON.stringify({ hotelId, roomId, dealPrice, discount, validUntil, maxRooms: maxRooms || 1, isActive: true }),
  });
  if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: 500 });
  const deal = await res.json().catch(() => []);
  return NextResponse.json({ deal: Array.isArray(deal) ? deal[0] : deal, created: true });
}

export async function DELETE(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await req.json();
  const res = await fetch(`${SB_URL}/rest/v1/flash_deals?id=eq.${id}`, {
    method: "PATCH", headers: SB_H, body: JSON.stringify({ isActive: false }),
  });
  return res.ok ? NextResponse.json({ deleted: true }) : NextResponse.json({ error: "Failed" }, { status: 500 });
}
