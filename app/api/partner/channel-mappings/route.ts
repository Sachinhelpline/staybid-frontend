// v317 — Channel Manager Phase 3: room-mapping + markup CRUD.
//
// A channel_room_mappings row ties a local room to an OTA room/rate-plan ref
// and a per-channel markup%. The console reads these to render each channel's
// rate preview (spine live_price × markup). Owner ∪ operated scoped (Circle
// partners included) so every method verifies the caller owns the hotel.
//
import { NextRequest, NextResponse } from "next/server";
import { sbSelect, SB_URL, SB_H, genId } from "@/lib/sb-server";
import { partnerHotelScope } from "@/lib/partner/hotel-scope";

export const dynamic = "force-dynamic";

function clampMarkup(v: any): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  // Sensible bounds: -50% (never below half the spine price) to +200%.
  return Math.max(-50, Math.min(200, Math.round(n * 100) / 100));
}

export async function GET(req: NextRequest) {
  const scope = await partnerHotelScope(req);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const hotelId = url.searchParams.get("hotelId") || "";
  if (!hotelId) return NextResponse.json({ error: "hotelId required" }, { status: 400 });
  if (!scope.hotelIds.includes(hotelId))
    return NextResponse.json({ error: "Not your hotel" }, { status: 403 });

  const connectionId = url.searchParams.get("connectionId") || "";
  let q = `channel_room_mappings?hotel_id=eq.${encodeURIComponent(hotelId)}&select=*&order=created_at.desc`;
  if (connectionId) q += `&connection_id=eq.${encodeURIComponent(connectionId)}`;

  try {
    const rows = await sbSelect(q);
    return NextResponse.json({ mappings: Array.isArray(rows) ? rows : [] });
  } catch {
    return NextResponse.json({ mappings: [] });
  }
}

export async function POST(req: NextRequest) {
  const scope = await partnerHotelScope(req);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const { hotelId, connectionId, roomId } = body;
  if (!hotelId || !connectionId || !roomId)
    return NextResponse.json({ error: "hotelId, connectionId, roomId required" }, { status: 400 });
  if (!scope.hotelIds.includes(hotelId))
    return NextResponse.json({ error: "Not your hotel" }, { status: 403 });

  // Integrity: room must belong to this hotel
  const room = await sbSelect(
    `rooms?id=eq.${encodeURIComponent(roomId)}&hotelId=eq.${encodeURIComponent(hotelId)}&select=id`,
  ).catch(() => []);
  if (!room?.[0])
    return NextResponse.json({ error: "Room does not belong to this hotel" }, { status: 400 });

  const nowIso = new Date().toISOString();
  const row = {
    id: genId("crm"),
    connection_id: String(connectionId),
    hotel_id: String(hotelId),
    room_id: String(roomId),
    ota_room_ref: body.otaRoomRef ? String(body.otaRoomRef).trim() : null,
    ota_rate_plan_ref: body.otaRatePlanRef ? String(body.otaRatePlanRef).trim() : null,
    markup_pct: clampMarkup(body.markupPct),
    active: body.active === false ? false : true,
    updated_at: nowIso,
  };

  // UNIQUE(connection_id, room_id) → upsert so re-saving a room updates it.
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/channel_room_mappings?on_conflict=connection_id,room_id`,
      {
        method: "POST",
        headers: { ...SB_H, Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(row),
      },
    );
    if (!r.ok) throw new Error(await r.text());
    const saved = await r.json().catch(() => [row]);
    return NextResponse.json({ ok: true, mapping: Array.isArray(saved) ? saved[0] : row });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to save mapping" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const scope = await partnerHotelScope(req);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const existing = await sbSelect(
    `channel_room_mappings?id=eq.${encodeURIComponent(id)}&select=id,hotel_id`,
  ).catch(() => []);
  if (!existing?.[0]) return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  if (!scope.hotelIds.includes(existing[0].hotel_id))
    return NextResponse.json({ error: "Not your mapping" }, { status: 403 });

  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if ("otaRoomRef" in body) patch.ota_room_ref = body.otaRoomRef ? String(body.otaRoomRef).trim() : null;
  if ("otaRatePlanRef" in body) patch.ota_rate_plan_ref = body.otaRatePlanRef ? String(body.otaRatePlanRef).trim() : null;
  if ("markupPct" in body) patch.markup_pct = clampMarkup(body.markupPct);
  if (typeof body.active === "boolean") patch.active = body.active;

  try {
    const r = await fetch(`${SB_URL}/rest/v1/channel_room_mappings?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: SB_H,
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error(await r.text());
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const scope = await partnerHotelScope(req);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const existing = await sbSelect(
    `channel_room_mappings?id=eq.${encodeURIComponent(id)}&select=id,hotel_id`,
  ).catch(() => []);
  if (!existing?.[0]) return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  if (!scope.hotelIds.includes(existing[0].hotel_id))
    return NextResponse.json({ error: "Not your mapping" }, { status: 403 });

  try {
    await fetch(`${SB_URL}/rest/v1/channel_room_mappings?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: SB_H,
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Delete failed" }, { status: 500 });
  }
}
