import { NextResponse } from "next/server";
import { requireOnboardUser } from "@/lib/onboard/jwt";
import { sbInsert, sbSelect, sbUpdate } from "@/lib/onboard/supabase-admin";

// GET    /api/onboard/rooms?hotelId=...
// POST   /api/onboard/rooms     { hotelId, type, capacity, basePrice, floorPrice, amenities[], description, quantity, size_sqft }
// DELETE /api/onboard/rooms?id=...
export async function GET(req: Request) {
  try {
    requireOnboardUser(req);
    const hotelId = new URL(req.url).searchParams.get("hotelId");
    if (!hotelId) return NextResponse.json({ rooms: [] });
    const rooms = await sbSelect<any>("rooms", `"hotelId"=eq.${encodeURIComponent(hotelId)}&order="floorPrice".asc`);
    return NextResponse.json({ rooms });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "rooms fetch failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const claims = requireOnboardUser(req);
    const body = await req.json();
    if (!body.hotelId) return NextResponse.json({ error: "hotelId required" }, { status: 400 });

    // Ownership check
    const own = await sbSelect<any>("hotels", `id=eq.${encodeURIComponent(body.hotelId)}&"ownerId"=eq.${claims.sub}&limit=1`);
    if (!own[0]) return NextResponse.json({ error: "hotel not found or not yours" }, { status: 404 });

    // Existing customer schema uses `mrp` (rack rate) + `floorPrice` (min bid).
    // The wizard's "basePrice" maps to `mrp`. There is no separate basePrice column.
    const type = body.type || "Standard Room";
    const mrp = body.mrp || body.basePrice || 4999;
    const floorPrice = body.floorPrice || Math.round(mrp * 0.78);
    const row: any = {
      hotelId: body.hotelId,
      type,
      name: body.name || type,
      mrp,
      capacity: body.capacity || 2,
      floorPrice,
      amenities: body.amenities || [],
      description: body.description || "",
      bedrooms: body.bedrooms || 1,
      bathrooms: body.bathrooms || 1,
      size_sqft: body.size_sqft || null,
      quantity: body.quantity || 1,
    };
    let room;
    if (body.id) {
      const upd = await sbUpdate("rooms", `id=eq.${encodeURIComponent(body.id)}`, row);
      room = Array.isArray(upd) ? upd[0] : upd;
    } else {
      room = await sbInsert("rooms", row);
    }
    return NextResponse.json({ room });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "room save failed" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    requireOnboardUser(req);
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    // Plain DELETE via REST
    const { SB } = await import("@/lib/onboard/supabase-admin");
    await fetch(`${SB.url}/rest/v1/rooms?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${SB.key}`, apikey: SB.key },
    });
    await fetch(`${SB.url}/rest/v1/room_images?room_id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${SB.key}`, apikey: SB.key },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "room delete failed" }, { status: 500 });
  }
}
