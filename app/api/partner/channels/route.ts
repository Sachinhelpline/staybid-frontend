// v170 — Channel Manager connections (partner panel, Phase 3).
//
//   GET    ?hotelId=...  → saved OTA connections + per-room iCal export URLs
//   POST                 → upsert a connection for one OTA
//   DELETE ?id=...       → remove a connection
//
// The owner pastes credentials they got from their own OTA partner
// account. Owner-scoped. Degrades gracefully until the migration is
// applied (the iCal export URLs still work — they need no table).
//
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_H_REPRESENT, sbSelect, decodeJwt, genId } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { icalUrl } from "@/lib/partner/ical-token";

export const dynamic = "force-dynamic";

const OTAS = new Set(["booking", "mmt", "airbnb", "agoda", "goibibo", "expedia", "other"]);

async function ownedHotelIds(req: NextRequest): Promise<{ ids: string[]; userId: string } | null> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const payload = decodeJwt(token);
  if (!payload?.id) return null;
  const ownerIds = await resolveOwnerIdsCrossPool(
    payload.id,
    payload.phone || req.headers.get("x-phone") || "",
    payload.email || req.headers.get("x-email") || ""
  );
  if (!ownerIds.length) return { ids: [], userId: payload.id };
  const hotels = await sbSelect(`hotels?ownerId=in.(${ownerIds.join(",")})&select=id`);
  return { ids: (Array.isArray(hotels) ? hotels : []).map((h: any) => h.id), userId: payload.id };
}

export async function GET(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const hotelId = new URL(req.url).searchParams.get("hotelId");
  if (!hotelId || !owned.ids.includes(hotelId))
    return NextResponse.json({ error: "hotelId required / not yours" }, { status: 403 });

  // per-room iCal export URLs (work regardless of the channel table)
  const origin = req.nextUrl.origin;
  let icalExports: any[] = [];
  try {
    const rooms = await sbSelect(`rooms?hotelId=eq.${encodeURIComponent(hotelId)}&select=id,name,type`);
    icalExports = (Array.isArray(rooms) ? rooms : []).map((r: any) => ({
      roomId: r.id,
      name: r.name || r.type || "Room",
      url: icalUrl(origin, r.id),
    }));
  } catch { /* ignore */ }

  let connections: any[] = [];
  let provisioned = true;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/channel_connections?hotel_id=eq.${encodeURIComponent(hotelId)}&select=*`, { headers: SB_H });
    if (r.ok) connections = await r.json().catch(() => []);
    else provisioned = false;
  } catch { provisioned = false; }

  return NextResponse.json({
    connections: Array.isArray(connections) ? connections : [],
    icalExports,
    provisioned,
  });
}

export async function POST(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch {}
  const { hotelId } = body;
  if (!hotelId || !owned.ids.includes(hotelId))
    return NextResponse.json({ error: "Not your hotel" }, { status: 403 });
  const ota = OTAS.has(String(body.ota)) ? String(body.ota) : "";
  if (!ota) return NextResponse.json({ error: "Invalid OTA" }, { status: 400 });

  const existing = await sbSelect(
    `channel_connections?hotel_id=eq.${encodeURIComponent(hotelId)}&ota=eq.${ota}&select=id`
  ).catch(() => []);
  const row: any = {
    id: existing?.[0]?.id || genId("chn"),
    hotel_id: hotelId,
    ota,
    mode: body.mode === "ical" ? "ical" : "api",
    label: body.label ?? null,
    api_key: body.apiKey ?? null,
    api_secret: body.apiSecret ?? null,
    property_id: body.propertyId ?? null,
    endpoint_url: body.endpointUrl ?? null,
    status: "configured",
    note: body.note ?? null,
    updated_by: owned.userId,
    updated_at: new Date().toISOString(),
  };
  try {
    const r = await fetch(`${SB_URL}/rest/v1/channel_connections?on_conflict=hotel_id,ota`, {
      method: "POST",
      headers: { ...SB_H_REPRESENT, Prefer: "return=representation,resolution=merge-duplicates" },
      body: JSON.stringify(row),
    });
    const txt = await r.text();
    if (!r.ok) {
      if (r.status === 404 || /does not exist/i.test(txt))
        return NextResponse.json({ error: "Channel table not provisioned yet. Apply migrations/2026-05-21-channel-connections.sql." }, { status: 412 });
      throw new Error(txt);
    }
    const j = txt ? JSON.parse(txt) : [];
    return NextResponse.json({ ok: true, connection: Array.isArray(j) ? j[0] : j });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Save failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const existing = await sbSelect(`channel_connections?id=eq.${encodeURIComponent(id)}&select=id,hotel_id`);
  if (!existing?.[0]) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  if (!owned.ids.includes(existing[0].hotel_id))
    return NextResponse.json({ error: "Not your connection" }, { status: 403 });

  try {
    const r = await fetch(`${SB_URL}/rest/v1/channel_connections?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: SB_H });
    if (!r.ok) throw new Error(await r.text());
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Delete failed" }, { status: 500 });
  }
}
