import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
const SB_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const RAILWAY = "https://staybid-live-production.up.railway.app";

function decodeJwt(token: string): any {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch { return null; }
}

/** Resolve all user IDs sharing the same phone (handles +91 duplicate records) */
async function resolveOwnerIds(primaryId: string): Promise<string[]> {
  const ids: string[] = [primaryId];
  try {
    const uRes = await fetch(`${SB_URL}/rest/v1/users?id=eq.${primaryId}&select=phone`, { headers: SB_HEADERS });
    const users = await uRes.json();
    if (!Array.isArray(users) || !users[0]?.phone) return ids;
    const rawPhone = String(users[0].phone).replace(/^\+91/, "").replace(/\D/g, "");
    const allRes = await fetch(
      `${SB_URL}/rest/v1/users?or=(phone.eq.${rawPhone},phone.eq.%2B91${rawPhone})&select=id`,
      { headers: SB_HEADERS }
    );
    const all = await allRes.json();
    if (Array.isArray(all)) all.forEach((u: any) => { if (u.id && !ids.includes(u.id)) ids.push(u.id); });
  } catch { /* ignore */ }
  return ids;
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

  // Fallback: Supabase direct — resolve all owner IDs to handle +91 duplicate accounts
  const ownerIds = await resolveOwnerIds(payload.id);
  const hotelRes = await fetch(
    `${SB_URL}/rest/v1/hotels?ownerId=in.(${ownerIds.join(",")})&select=id`,
    { headers: SB_HEADERS }
  );
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
