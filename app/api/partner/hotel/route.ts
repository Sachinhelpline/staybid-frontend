import { NextRequest, NextResponse } from "next/server";

const SB_URL  = "https://uxxhbdqedazpmvbvaosh.supabase.co";
// JWT-format anon key required for RLS-enabled tables (users)
const SB_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
const SB_H    = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" };

function decodeJwt(t: string) {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"), "base64").toString()); }
  catch { return null; }
}

/** Find all user IDs sharing the same phone (handles +91 prefix variants) */
async function resolveOwnerIds(primaryId: string): Promise<string[]> {
  const ids: string[] = [primaryId];
  try {
    // Get phone for this user
    const uRes = await fetch(`${SB_URL}/rest/v1/users?id=eq.${primaryId}&select=phone`, { headers: SB_H });
    const users = await uRes.json();
    if (!Array.isArray(users) || !users[0]?.phone) return ids;

    const rawPhone = String(users[0].phone).replace(/^\+91/, "").replace(/\D/g, "");
    // Find all records with this phone (with or without +91)
    const allRes = await fetch(
      `${SB_URL}/rest/v1/users?or=(phone.eq.${rawPhone},phone.eq.%2B91${rawPhone})&select=id`,
      { headers: SB_H }
    );
    const all = await allRes.json();
    if (Array.isArray(all)) {
      all.forEach((u: any) => {
        if (u.id && !ids.includes(u.id)) ids.push(u.id);
      });
    }
  } catch { /* ignore */ }
  return ids;
}

export async function GET(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = decodeJwt(token);
  if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  // Resolve all user IDs for this phone (handles duplicate records with/without +91)
  const ownerIds = await resolveOwnerIds(payload.id);

  const hRes  = await fetch(`${SB_URL}/rest/v1/hotels?ownerId=in.(${ownerIds.join(",")})&select=*`, { headers: SB_H });
  const hotels = await hRes.json();
  if (!Array.isArray(hotels) || !hotels[0]) return NextResponse.json({ error: "No hotel found" }, { status: 404 });

  const hotel = hotels[0];
  const rRes  = await fetch(`${SB_URL}/rest/v1/rooms?hotelId=eq.${hotel.id}&select=*`, { headers: SB_H });
  const rooms = await rRes.json();

  // Bookings (accepted bids)
  const bRes  = await fetch(
    `${SB_URL}/rest/v1/bids?hotelId=eq.${hotel.id}&status=eq.ACCEPTED&select=*&order=createdAt.desc&limit=100`,
    { headers: SB_H }
  );
  const bookingsRaw = await bRes.json();
  const bookingsArr: any[] = Array.isArray(bookingsRaw) ? bookingsRaw : [];

  // Enrich with user + request + room data
  const customerIds = Array.from(new Set(bookingsArr.map((b: any) => b.customerId).filter(Boolean)));
  const requestIds  = Array.from(new Set(bookingsArr.map((b: any) => b.requestId).filter(Boolean)));
  const roomIdsB    = Array.from(new Set(bookingsArr.map((b: any) => b.roomId).filter(Boolean)));

  const [users, requests, bRooms] = await Promise.all([
    customerIds.length
      ? fetch(`${SB_URL}/rest/v1/users?id=in.(${customerIds.join(",")})&select=id,name,phone`, { headers: SB_H }).then(r => r.json()).catch(() => [])
      : Promise.resolve([]),
    requestIds.length
      ? fetch(`${SB_URL}/rest/v1/bid_requests?id=in.(${requestIds.join(",")})&select=*`, { headers: SB_H }).then(r => r.json()).catch(() => [])
      : Promise.resolve([]),
    roomIdsB.length
      ? fetch(`${SB_URL}/rest/v1/rooms?id=in.(${roomIdsB.join(",")})&select=*`, { headers: SB_H }).then(r => r.json()).catch(() => [])
      : Promise.resolve([]),
  ]);
  const uArr  = Array.isArray(users)    ? users    : [];
  const rqArr = Array.isArray(requests) ? requests : [];
  const rmArr = Array.isArray(bRooms)   ? bRooms   : [];

  const bookings = bookingsArr.map((b: any) => {
    const u  = uArr.find((x: any) => x.id === b.customerId);
    const rq = rqArr.find((x: any) => x.id === b.requestId);
    const rm = rmArr.find((x: any) => x.id === b.roomId);
    return {
      ...b,
      guestName: u?.name || null,
      guestPhone: u?.phone || null,
      customer: u || null,
      request: rq || null,
      checkIn: rq?.checkIn || b.checkIn || null,
      checkOut: rq?.checkOut || b.checkOut || null,
      guests: rq?.guests || b.guests || null,
      room: rm || null,
    };
  });

  return NextResponse.json({
    hotel: { ...hotel, rooms: Array.isArray(rooms) ? rooms : [] },
    bookings,
  });
}

export async function PATCH(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = decodeJwt(token);
  if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const updates = await req.json();
  const allowed: Record<string, any> = {};
  const fields = ["name","description","amenities","images","city","state","starRating"];
  for (const f of fields) { if (updates[f] !== undefined) allowed[f] = updates[f]; }

  // Update for any matching owner ID
  const ownerIds = await resolveOwnerIds(payload.id);
  const hRes = await fetch(`${SB_URL}/rest/v1/hotels?ownerId=in.(${ownerIds.join(",")})`, {
    method: "PATCH", headers: SB_H, body: JSON.stringify(allowed),
  });
  if (!hRes.ok) return NextResponse.json({ error: "Update failed" }, { status: 500 });
  const updated = await hRes.json().catch(() => []);
  return NextResponse.json({ hotel: Array.isArray(updated) ? updated[0] : updated, saved: true });
}
