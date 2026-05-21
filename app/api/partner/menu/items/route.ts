// v172 — F&B menu items CRUD (partner panel).
//
//   POST              → create a dish
//   PATCH             → edit a dish (name / portions / availability …)
//   DELETE ?id=...    → remove a dish
//
// portions is a JSONB array of { label, price } — Half / Full etc.
// Owner-scoped.
//
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_H_REPRESENT, sbSelect, decodeJwt, genId } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";

export const dynamic = "force-dynamic";

const FOOD_TYPES = new Set(["veg", "nonveg", "egg"]);

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

// normalise portions → [{label, price}] with numeric, non-negative prices
function cleanPortions(raw: any): { label: string; price: number }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p: any) => ({ label: String(p?.label ?? "").trim(), price: Math.max(0, Number(p?.price) || 0) }))
    .filter((p: any) => p.price > 0 || p.label);
}

export async function POST(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch {}
  if (!body.hotelId || !owned.ids.includes(body.hotelId))
    return NextResponse.json({ error: "Not your hotel" }, { status: 403 });
  if (!String(body.name || "").trim())
    return NextResponse.json({ error: "Item name required" }, { status: 400 });

  const portions = cleanPortions(body.portions);
  if (!portions.length)
    return NextResponse.json({ error: "Kam se kam ek portion + price daalo" }, { status: 400 });

  const row = {
    id: genId("mitm"),
    hotel_id: body.hotelId,
    category_id: body.categoryId || null,
    name: String(body.name).trim(),
    description: body.description ? String(body.description) : null,
    food_type: FOOD_TYPES.has(String(body.foodType)) ? String(body.foodType) : "veg",
    image: body.image || null,
    portions,
    available: body.available !== false,
    sort: Number(body.sort) || 0,
  };
  try {
    const r = await fetch(`${SB_URL}/rest/v1/menu_items`, {
      method: "POST", headers: SB_H_REPRESENT, body: JSON.stringify(row),
    });
    const txt = await r.text();
    if (!r.ok) {
      if (r.status === 404 || /does not exist/i.test(txt))
        return NextResponse.json({ error: "Menu tables not provisioned yet." }, { status: 412 });
      throw new Error(txt);
    }
    const j = txt ? JSON.parse(txt) : [];
    return NextResponse.json({ ok: true, item: Array.isArray(j) ? j[0] : j });
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

  const existing = await sbSelect(`menu_items?id=eq.${encodeURIComponent(body.id)}&select=id,hotel_id`);
  if (!existing?.[0]) return NextResponse.json({ error: "Item not found" }, { status: 404 });
  if (!owned.ids.includes(existing[0].hotel_id))
    return NextResponse.json({ error: "Not your item" }, { status: 403 });

  const patch: any = {};
  if (body.categoryId !== undefined) patch.category_id = body.categoryId || null;
  if (body.name !== undefined)       patch.name = String(body.name || "").trim();
  if (body.description !== undefined) patch.description = body.description ? String(body.description) : null;
  if (body.foodType !== undefined && FOOD_TYPES.has(String(body.foodType))) patch.food_type = String(body.foodType);
  if (body.image !== undefined)      patch.image = body.image || null;
  if (body.portions !== undefined) {
    const p = cleanPortions(body.portions);
    if (!p.length) return NextResponse.json({ error: "Kam se kam ek portion + price daalo" }, { status: 400 });
    patch.portions = p;
  }
  if (typeof body.available === "boolean") patch.available = body.available;
  if (body.sort !== undefined) patch.sort = Number(body.sort) || 0;
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  try {
    const r = await fetch(`${SB_URL}/rest/v1/menu_items?id=eq.${encodeURIComponent(body.id)}`, {
      method: "PATCH", headers: SB_H_REPRESENT, body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error(await r.text());
    const j = await r.json().catch(() => []);
    return NextResponse.json({ ok: true, item: Array.isArray(j) ? j[0] : j });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const existing = await sbSelect(`menu_items?id=eq.${encodeURIComponent(id)}&select=id,hotel_id`);
  if (!existing?.[0]) return NextResponse.json({ error: "Item not found" }, { status: 404 });
  if (!owned.ids.includes(existing[0].hotel_id))
    return NextResponse.json({ error: "Not your item" }, { status: 403 });

  try {
    const r = await fetch(`${SB_URL}/rest/v1/menu_items?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: SB_H });
    if (!r.ok) throw new Error(await r.text());
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Delete failed" }, { status: 500 });
  }
}
