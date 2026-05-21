// v172 — F&B menu: categories + full menu read (partner panel).
//
//   GET    ?hotelId=...  → { categories, items }
//   POST                 → create a menu category
//   PATCH                → rename / reorder / toggle a category
//   DELETE ?id=...       → delete a category + its items
//
// Items CRUD lives in ./items. Owner-scoped. Degrades gracefully until
// migrations/2026-05-21-fnb-menu.sql is applied.
//
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_H_REPRESENT, sbSelect, decodeJwt, genId } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";

export const dynamic = "force-dynamic";

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

  try {
    const [cRes, iRes] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/menu_categories?hotel_id=eq.${encodeURIComponent(hotelId)}&select=*&order=sort.asc,created_at.asc`, { headers: SB_H }),
      fetch(`${SB_URL}/rest/v1/menu_items?hotel_id=eq.${encodeURIComponent(hotelId)}&select=*&order=sort.asc,created_at.asc`, { headers: SB_H }),
    ]);
    if (!cRes.ok) return NextResponse.json({ categories: [], items: [], provisioned: false });
    const categories = await cRes.json().catch(() => []);
    const items = iRes.ok ? await iRes.json().catch(() => []) : [];
    return NextResponse.json({
      categories: Array.isArray(categories) ? categories : [],
      items: Array.isArray(items) ? items : [],
      provisioned: true,
    });
  } catch {
    return NextResponse.json({ categories: [], items: [], provisioned: false });
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
    return NextResponse.json({ error: "Category name required" }, { status: 400 });

  const row = {
    id: genId("mcat"),
    hotel_id: body.hotelId,
    name: String(body.name).trim(),
    sort: Number(body.sort) || 0,
    active: true,
  };
  try {
    const r = await fetch(`${SB_URL}/rest/v1/menu_categories`, {
      method: "POST", headers: SB_H_REPRESENT, body: JSON.stringify(row),
    });
    const txt = await r.text();
    if (!r.ok) {
      if (r.status === 404 || /does not exist/i.test(txt))
        return NextResponse.json({ error: "Menu tables not provisioned yet. Apply migrations/2026-05-21-fnb-menu.sql." }, { status: 412 });
      throw new Error(txt);
    }
    const j = txt ? JSON.parse(txt) : [];
    return NextResponse.json({ ok: true, category: Array.isArray(j) ? j[0] : j });
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

  const existing = await sbSelect(`menu_categories?id=eq.${encodeURIComponent(body.id)}&select=id,hotel_id`);
  if (!existing?.[0]) return NextResponse.json({ error: "Category not found" }, { status: 404 });
  if (!owned.ids.includes(existing[0].hotel_id))
    return NextResponse.json({ error: "Not your category" }, { status: 403 });

  const patch: any = {};
  if (body.name !== undefined) patch.name = String(body.name || "").trim();
  if (body.sort !== undefined) patch.sort = Number(body.sort) || 0;
  if (typeof body.active === "boolean") patch.active = body.active;
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  try {
    const r = await fetch(`${SB_URL}/rest/v1/menu_categories?id=eq.${encodeURIComponent(body.id)}`, {
      method: "PATCH", headers: SB_H_REPRESENT, body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error(await r.text());
    const j = await r.json().catch(() => []);
    return NextResponse.json({ ok: true, category: Array.isArray(j) ? j[0] : j });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const existing = await sbSelect(`menu_categories?id=eq.${encodeURIComponent(id)}&select=id,hotel_id`);
  if (!existing?.[0]) return NextResponse.json({ error: "Category not found" }, { status: 404 });
  if (!owned.ids.includes(existing[0].hotel_id))
    return NextResponse.json({ error: "Not your category" }, { status: 403 });

  try {
    // delete the category's items first, then the category
    await fetch(`${SB_URL}/rest/v1/menu_items?category_id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: SB_H });
    const r = await fetch(`${SB_URL}/rest/v1/menu_categories?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: SB_H });
    if (!r.ok) throw new Error(await r.text());
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Delete failed" }, { status: 500 });
  }
}
