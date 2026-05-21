// v173 — F&B ordering outlets (partner panel, Phase 2).
//
//   GET    ?hotelId=...  → outlets (each id is its public /order/<id> QR URL)
//   POST                 → create an outlet
//   PATCH                → rename / toggle an outlet
//   DELETE ?id=...       → delete an outlet
//
// Owner-scoped. Degrades gracefully until migration 2026-05-21-fnb-ordering.sql.
//
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_H_REPRESENT, sbSelect, decodeJwt, genId } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";

export const dynamic = "force-dynamic";

const TYPES = new Set(["room_service", "restaurant", "other"]);

async function ownedHotelIds(req: NextRequest): Promise<{ ids: string[] } | null> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const payload = decodeJwt(token);
  if (!payload?.id) return null;
  const ownerIds = await resolveOwnerIdsCrossPool(
    payload.id,
    payload.phone || req.headers.get("x-phone") || "",
    payload.email || req.headers.get("x-email") || ""
  );
  if (!ownerIds.length) return { ids: [] };
  const hotels = await sbSelect(`hotels?ownerId=in.(${ownerIds.join(",")})&select=id`);
  return { ids: (Array.isArray(hotels) ? hotels : []).map((h: any) => h.id) };
}

export async function GET(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const hotelId = new URL(req.url).searchParams.get("hotelId");
  if (!hotelId || !owned.ids.includes(hotelId))
    return NextResponse.json({ error: "hotelId required / not yours" }, { status: 403 });
  try {
    const r = await fetch(`${SB_URL}/rest/v1/food_outlets?hotel_id=eq.${encodeURIComponent(hotelId)}&select=*&order=created_at.asc`, { headers: SB_H });
    if (!r.ok) return NextResponse.json({ outlets: [], provisioned: false });
    const rows = await r.json().catch(() => []);
    return NextResponse.json({ outlets: Array.isArray(rows) ? rows : [], provisioned: true });
  } catch {
    return NextResponse.json({ outlets: [], provisioned: false });
  }
}

export async function POST(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch {}
  if (!body.hotelId || !owned.ids.includes(body.hotelId))
    return NextResponse.json({ error: "Not your hotel" }, { status: 403 });
  if (!String(body.name || "").trim())
    return NextResponse.json({ error: "Outlet name required" }, { status: 400 });

  const row = {
    id: genId("outlet"),
    hotel_id: body.hotelId,
    name: String(body.name).trim(),
    type: TYPES.has(String(body.type)) ? String(body.type) : "room_service",
    active: true,
  };
  try {
    const r = await fetch(`${SB_URL}/rest/v1/food_outlets`, {
      method: "POST", headers: SB_H_REPRESENT, body: JSON.stringify(row),
    });
    const txt = await r.text();
    if (!r.ok) {
      if (r.status === 404 || /does not exist/i.test(txt))
        return NextResponse.json({ error: "Ordering tables not provisioned yet. Apply migrations/2026-05-21-fnb-ordering.sql." }, { status: 412 });
      throw new Error(txt);
    }
    const j = txt ? JSON.parse(txt) : [];
    return NextResponse.json({ ok: true, outlet: Array.isArray(j) ? j[0] : j });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Create failed" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch {}
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const existing = await sbSelect(`food_outlets?id=eq.${encodeURIComponent(body.id)}&select=id,hotel_id`);
  if (!existing?.[0]) return NextResponse.json({ error: "Outlet not found" }, { status: 404 });
  if (!owned.ids.includes(existing[0].hotel_id))
    return NextResponse.json({ error: "Not your outlet" }, { status: 403 });

  const patch: any = {};
  if (body.name !== undefined) patch.name = String(body.name || "").trim();
  if (body.type !== undefined && TYPES.has(String(body.type))) patch.type = String(body.type);
  if (typeof body.active === "boolean") patch.active = body.active;
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  try {
    const r = await fetch(`${SB_URL}/rest/v1/food_outlets?id=eq.${encodeURIComponent(body.id)}`, {
      method: "PATCH", headers: SB_H_REPRESENT, body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error(await r.text());
    const j = await r.json().catch(() => []);
    return NextResponse.json({ ok: true, outlet: Array.isArray(j) ? j[0] : j });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const existing = await sbSelect(`food_outlets?id=eq.${encodeURIComponent(id)}&select=id,hotel_id`);
  if (!existing?.[0]) return NextResponse.json({ error: "Outlet not found" }, { status: 404 });
  if (!owned.ids.includes(existing[0].hotel_id))
    return NextResponse.json({ error: "Not your outlet" }, { status: 403 });

  try {
    const r = await fetch(`${SB_URL}/rest/v1/food_outlets?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: SB_H });
    if (!r.ok) throw new Error(await r.text());
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Delete failed" }, { status: 500 });
  }
}
