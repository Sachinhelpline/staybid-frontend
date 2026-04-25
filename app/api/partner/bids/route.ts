import { NextRequest, NextResponse } from "next/server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";

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

// resolveOwnerIds: cross-pool resolver in lib/partner/owner-ids.ts
const resolveOwnerIds = (id: string, p?: string, e?: string) => resolveOwnerIdsCrossPool(id, p, e);

async function enrichBids(bids: any[]): Promise<any[]> {
  if (!bids.length) return [];
  const customerIds = Array.from(new Set(bids.map((b: any) => b.customerId).filter(Boolean)));
  const requestIds  = Array.from(new Set(bids.map((b: any) => b.requestId).filter(Boolean)));
  const roomIds     = Array.from(new Set(bids.map((b: any) => b.roomId).filter(Boolean)));

  const [users, requests, rooms] = await Promise.all([
    customerIds.length
      ? fetch(`${SB_URL}/rest/v1/users?id=in.(${customerIds.join(",")})&select=id,name,phone`, { headers: SB_HEADERS }).then(r => r.json()).catch(() => [])
      : Promise.resolve([]),
    requestIds.length
      ? fetch(`${SB_URL}/rest/v1/bid_requests?id=in.(${requestIds.join(",")})&select=*`, { headers: SB_HEADERS }).then(r => r.json()).catch(() => [])
      : Promise.resolve([]),
    roomIds.length
      ? fetch(`${SB_URL}/rest/v1/rooms?id=in.(${roomIds.join(",")})&select=*`, { headers: SB_HEADERS }).then(r => r.json()).catch(() => [])
      : Promise.resolve([]),
  ]);

  const uArr = Array.isArray(users) ? users : [];
  const rqArr = Array.isArray(requests) ? requests : [];
  const rmArr = Array.isArray(rooms) ? rooms : [];

  return bids.map((b: any) => {
    const u = uArr.find((x: any) => x.id === b.customerId);
    const rq = rqArr.find((x: any) => x.id === b.requestId);
    const rm = rmArr.find((x: any) => x.id === b.roomId);
    return {
      ...b,
      guestName: u?.name || b.guestName || null,
      guestPhone: u?.phone || null,
      customer: u || null,
      request: rq || null,
      checkIn: rq?.checkIn || b.checkIn || null,
      checkOut: rq?.checkOut || b.checkOut || null,
      guests: rq?.guests || b.guests || null,
      room: rm || null,
      roomType: rm?.type || rm?.name || null,
    };
  });
}

export async function GET(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = decodeJwt(token);
  if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  let bids: any[] = [];
  try {
    const res = await fetch(`${RAILWAY}/api/bids/hotel`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data = await res.json();
      bids = Array.isArray(data?.bids) ? data.bids : (Array.isArray(data) ? data : []);
    }
  } catch { /* fall through */ }

  if (!bids.length) {
    const ownerIds = await resolveOwnerIds(payload.id, payload.phone, payload.email);
    const hotelRes = await fetch(
      `${SB_URL}/rest/v1/hotels?ownerId=in.(${ownerIds.join(",")})&select=id`,
      { headers: SB_HEADERS }
    );
    const hotels = await hotelRes.json();
    if (!Array.isArray(hotels) || hotels.length === 0) return NextResponse.json({ bids: [] });
    const hotelIds = hotels.map((h: any) => h.id);
    const bidsRes = await fetch(
      `${SB_URL}/rest/v1/bids?hotelId=in.(${hotelIds.join(",")})&select=*&order=createdAt.desc&limit=200`,
      { headers: SB_HEADERS }
    );
    const raw = await bidsRes.json();
    bids = Array.isArray(raw) ? raw : [];
  }

  const enriched = await enrichBids(bids);
  return NextResponse.json({ bids: enriched });
}
