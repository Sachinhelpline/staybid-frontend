// CRUD for hotel_room_units — physical room inventory (room numbers per category).
// A "room" in the existing schema = category (Deluxe, Suite). A "unit" = one actual
// numbered room (e.g. 101, 102 Deluxe). Units live in hotel_room_units and are
// optionally assigned to a booking/walk-in when the owner confirms.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_H_REPRESENT, sbSelect, decodeJwt } from "@/lib/sb-server";

export const dynamic = "force-dynamic";

function auth(req: NextRequest): { userId?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub };
}

// List all units for a hotel (optional roomId filter)
export async function GET(req: NextRequest) {
  const { userId } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const hotelId = url.searchParams.get("hotelId");
  const roomId  = url.searchParams.get("roomId");
  if (!hotelId) return NextResponse.json({ error: "hotelId required" }, { status: 400 });

  try {
    const filter = roomId ? `&roomId=eq.${roomId}` : "";
    const units = await sbSelect(`hotel_room_units?hotelId=eq.${hotelId}${filter}&select=*&order=roomNumber.asc`);
    return NextResponse.json({ units });
  } catch (e: any) {
    return NextResponse.json({ units: [], warning: e?.message });
  }
}

// Add a single unit OR bulk add ("bulk: [{ roomNumber, floor }, ...]")
export async function POST(req: NextRequest) {
  const { userId } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const { hotelId, roomId, roomNumber, floor, note, bulk } = body;

  if (!hotelId || !roomId) {
    return NextResponse.json({ error: "hotelId, roomId required" }, { status: 400 });
  }

  let rows: any[] = [];
  if (Array.isArray(bulk) && bulk.length) {
    rows = bulk
      .filter((x: any) => x.roomNumber)
      .map((x: any) => ({
        hotelId, roomId,
        roomNumber: String(x.roomNumber).trim(),
        floor: x.floor || null,
        note: x.note || null,
        status: "active",
      }));
  } else if (roomNumber) {
    rows = [{
      hotelId, roomId,
      roomNumber: String(roomNumber).trim(),
      floor: floor || null,
      note: note || null,
      status: "active",
    }];
  }

  if (!rows.length) return NextResponse.json({ error: "roomNumber or bulk required" }, { status: 400 });

  try {
    const r = await fetch(`${SB_URL}/rest/v1/hotel_room_units`, {
      method: "POST",
      headers: { ...SB_H_REPRESENT, Prefer: "return=representation,resolution=ignore-duplicates" },
      body: JSON.stringify(rows),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(t);
    const created = t ? JSON.parse(t) : [];
    return NextResponse.json({ ok: true, units: created });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

// Update one unit (status, note, floor)
export async function PATCH(req: NextRequest) {
  const { userId } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const { id, roomNumber, floor, status, note } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const patch: any = {};
  if (roomNumber !== undefined) patch.roomNumber = String(roomNumber).trim();
  if (floor      !== undefined) patch.floor = floor || null;
  if (status     !== undefined) patch.status = status;
  if (note       !== undefined) patch.note = note;

  try {
    const r = await fetch(`${SB_URL}/rest/v1/hotel_room_units?id=eq.${id}`, {
      method: "PATCH",
      headers: SB_H_REPRESENT,
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error(await r.text());
    const j = await r.json();
    return NextResponse.json({ ok: true, unit: Array.isArray(j) ? j[0] : j });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

// Remove a unit
export async function DELETE(req: NextRequest) {
  const { userId } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    await fetch(`${SB_URL}/rest/v1/hotel_room_units?id=eq.${id}`, {
      method: "DELETE",
      headers: SB_H,
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
