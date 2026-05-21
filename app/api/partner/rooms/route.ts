// Partner self-serve Room Category CRUD.
//
// A "room" row in this schema = a room CATEGORY / type (Deluxe, Suite…)
// with its own `quantity`. Physical numbered rooms (101, 102) live in
// hotel_room_units (see ./room-units). This route lets a hotel owner
// create / fully edit / delete a category from the partner dashboard —
// previously only the onboarding wizard could create rooms.
//
// Auth: partner Bearer JWT → resolveOwnerIdsCrossPool → hotel ownership.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_H_REPRESENT, sbSelect, decodeJwt, genId } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";

export const dynamic = "force-dynamic";

// Resolve every hotel id owned by the caller. Returns null when unauthenticated.
async function ownedHotelIds(req: NextRequest): Promise<{ ids: string[] } | null> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const payload = decodeJwt(token);
  if (!payload?.id) return null;
  const headerPhone = req.headers.get("x-phone") || "";
  const headerEmail = req.headers.get("x-email") || "";
  const ownerIds = await resolveOwnerIdsCrossPool(
    payload.id,
    payload.phone || headerPhone,
    payload.email || headerEmail
  );
  if (!ownerIds.length) return { ids: [] };
  const hotels = await sbSelect(`hotels?ownerId=in.(${ownerIds.join(",")})&select=id`);
  return { ids: (Array.isArray(hotels) ? hotels : []).map((h: any) => h.id) };
}

function num(v: any): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// POST — create a new room category
export async function POST(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  if (!body.hotelId) return NextResponse.json({ error: "hotelId required" }, { status: 400 });
  if (!owned.ids.includes(body.hotelId))
    return NextResponse.json({ error: "Hotel not found or not yours" }, { status: 403 });
  if (!String(body.name || body.type || "").trim())
    return NextResponse.json({ error: "Room category name required" }, { status: 400 });

  const type = String(body.type || body.name).trim();
  const mrp = num(body.mrp) ?? 4999;
  const floorPrice = num(body.floorPrice) ?? Math.round(mrp * 0.78);
  const row: any = {
    id: genId("rm"),
    hotelId: body.hotelId,
    type,
    name: String(body.name || type).trim(),
    description: String(body.description || ""),
    mrp,
    floorPrice,
    capacity: num(body.capacity) ?? 2,
    bedrooms: num(body.bedrooms) ?? 1,
    bathrooms: num(body.bathrooms) ?? 1,
    quantity: num(body.quantity) ?? 1,
    amenities: Array.isArray(body.amenities) ? body.amenities : [],
    images: Array.isArray(body.images) ? body.images : [],
    isAvailable: body.isAvailable === false ? false : true,
  };
  const flash = num(body.flashFloorPrice);
  if (flash != null) row.flashFloorPrice = flash;
  const size = num(body.size_sqft);
  if (size != null) row.size_sqft = size;

  const insert = (r: any) =>
    fetch(`${SB_URL}/rest/v1/rooms`, { method: "POST", headers: SB_H_REPRESENT, body: JSON.stringify(r) });

  let res = await insert(row);
  if (!res.ok) {
    // Graceful retry without the newer optional columns (older schemas).
    const { flashFloorPrice, size_sqft, ...slim } = row;
    res = await insert(slim);
  }
  if (!res.ok)
    return NextResponse.json({ error: (await res.text()) || "Create failed" }, { status: 500 });

  const created = await res.json().catch(() => []);
  return NextResponse.json({ ok: true, room: Array.isArray(created) ? created[0] : created });
}

// PATCH — full edit of an existing room category
export async function PATCH(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  if (!body.id) return NextResponse.json({ error: "room id required" }, { status: 400 });

  const existing = await sbSelect(`rooms?id=eq.${encodeURIComponent(body.id)}&select=id,hotelId`);
  if (!existing?.[0]) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (!owned.ids.includes(existing[0].hotelId))
    return NextResponse.json({ error: "Not your room" }, { status: 403 });

  const patch: any = {};
  for (const k of ["type", "name", "description"])
    if (body[k] !== undefined) patch[k] = String(body[k] ?? "");
  for (const k of ["mrp", "floorPrice", "flashFloorPrice", "capacity", "bedrooms", "bathrooms", "quantity", "size_sqft"]) {
    if (body[k] !== undefined) { const n = num(body[k]); if (n != null) patch[k] = n; }
  }
  if (Array.isArray(body.amenities)) patch.amenities = body.amenities;
  if (Array.isArray(body.images)) patch.images = body.images;
  if (typeof body.isAvailable === "boolean") patch.isAvailable = body.isAvailable;
  if (!Object.keys(patch).length)
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const update = (p: any) =>
    fetch(`${SB_URL}/rest/v1/rooms?id=eq.${encodeURIComponent(body.id)}`, {
      method: "PATCH", headers: SB_H_REPRESENT, body: JSON.stringify(p),
    });

  let res = await update(patch);
  if (!res.ok) {
    const { flashFloorPrice, size_sqft, ...slim } = patch;
    if (Object.keys(slim).length) res = await update(slim);
  }
  if (!res.ok)
    return NextResponse.json({ error: (await res.text()) || "Update failed" }, { status: 500 });

  const j = await res.json().catch(() => []);
  return NextResponse.json({ ok: true, room: Array.isArray(j) ? j[0] : j });
}

// DELETE — remove a room category (?id=) + its physical units
export async function DELETE(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const existing = await sbSelect(`rooms?id=eq.${encodeURIComponent(id)}&select=id,hotelId`);
  if (!existing?.[0]) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (!owned.ids.includes(existing[0].hotelId))
    return NextResponse.json({ error: "Not your room" }, { status: 403 });

  const res = await fetch(`${SB_URL}/rest/v1/rooms?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE", headers: SB_H,
  });
  if (!res.ok)
    return NextResponse.json({ error: (await res.text()) || "Delete failed" }, { status: 500 });

  // Best-effort: drop the category's physical room units too.
  try {
    await fetch(`${SB_URL}/rest/v1/hotel_room_units?roomId=eq.${encodeURIComponent(id)}`, {
      method: "DELETE", headers: SB_H,
    });
  } catch {}

  return NextResponse.json({ ok: true });
}
