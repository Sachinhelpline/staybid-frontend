// v173 — Public F&B ordering API (Phase 2).
//
//   GET  /api/order/<outletId>   → hotel + outlet + live menu
//   POST /api/order/<outletId>   → place an order (status: pending)
//
// Public — no auth, gated by the unguessable outlet id. Prices are
// re-resolved server-side from menu_items so a tampered client cannot
// change them. Verified orders flow into billing in Phase 3.
//
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_H_REPRESENT, sbSelect, genId } from "@/lib/sb-server";

export const dynamic = "force-dynamic";

async function loadOutlet(outletId: string) {
  const rows = await sbSelect(`food_outlets?id=eq.${encodeURIComponent(outletId)}&select=*`).catch(() => []);
  return rows?.[0] || null;
}

export async function GET(_req: NextRequest, { params }: { params: { outlet: string } }) {
  const outlet = await loadOutlet(params.outlet);
  if (!outlet) return NextResponse.json({ error: "Menu not found" }, { status: 404 });
  if (outlet.active === false) return NextResponse.json({ error: "This menu is currently unavailable" }, { status: 403 });

  const [hotels, categories, items] = await Promise.all([
    sbSelect(`hotels?id=eq.${encodeURIComponent(outlet.hotel_id)}&select=id,name,city`).catch(() => []),
    sbSelect(`menu_categories?hotel_id=eq.${encodeURIComponent(outlet.hotel_id)}&active=is.true&select=*&order=sort.asc,created_at.asc`).catch(() => []),
    sbSelect(`menu_items?hotel_id=eq.${encodeURIComponent(outlet.hotel_id)}&available=is.true&select=*&order=sort.asc,created_at.asc`).catch(() => []),
  ]);
  const hotel = hotels?.[0] || { name: "Hotel" };
  return NextResponse.json({
    hotel: { name: hotel.name, city: hotel.city || "" },
    outlet: { id: outlet.id, name: outlet.name, type: outlet.type },
    categories: Array.isArray(categories) ? categories : [],
    items: Array.isArray(items) ? items : [],
  });
}

export async function POST(req: NextRequest, { params }: { params: { outlet: string } }) {
  const outlet = await loadOutlet(params.outlet);
  if (!outlet) return NextResponse.json({ error: "Menu not found" }, { status: 404 });
  if (outlet.active === false) return NextResponse.json({ error: "This menu is currently unavailable" }, { status: 403 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const lines: any[] = Array.isArray(body.items) ? body.items : [];
  if (!lines.length) return NextResponse.json({ error: "Cart khali hai" }, { status: 400 });
  if (!String(body.location || "").trim())
    return NextResponse.json({ error: "Room / table number daalo" }, { status: 400 });

  // Re-resolve prices from the live menu — never trust the client.
  const menu = await sbSelect(
    `menu_items?hotel_id=eq.${encodeURIComponent(outlet.hotel_id)}&select=id,name,food_type,portions,available`
  ).catch(() => []);
  const byId: Record<string, any> = {};
  for (const m of menu || []) byId[m.id] = m;

  const orderId = genId("ford");
  const itemRows: any[] = [];
  let total = 0;
  for (const ln of lines) {
    const mi = byId[ln.itemId];
    if (!mi || mi.available === false) continue;
    const portions = Array.isArray(mi.portions) ? mi.portions : [];
    const portion = portions.find((p: any) => (p.label || "") === (ln.portionLabel || "")) || portions[0];
    if (!portion) continue;
    const qty = Math.max(1, Math.min(50, Number(ln.qty) || 1));
    const unit = Math.max(0, Number(portion.price) || 0);
    const amount = unit * qty;
    total += amount;
    itemRows.push({
      id: genId("foit"), order_id: orderId, hotel_id: outlet.hotel_id,
      item_name: mi.name, portion: portion.label || null,
      qty, unit_price: unit, amount, food_type: mi.food_type || null,
    });
  }
  if (!itemRows.length) return NextResponse.json({ error: "Order me koi valid item nahi" }, { status: 400 });

  try {
    const oRes = await fetch(`${SB_URL}/rest/v1/food_orders`, {
      method: "POST", headers: SB_H_REPRESENT,
      body: JSON.stringify({
        id: orderId, hotel_id: outlet.hotel_id,
        outlet_id: outlet.id, outlet_name: outlet.name,
        location: String(body.location).trim(),
        guest_name: body.guestName ? String(body.guestName).trim() : null,
        guest_phone: body.guestPhone ? String(body.guestPhone).trim() : null,
        items_total: total, status: "pending",
        note: body.note ? String(body.note).trim() : null,
      }),
    });
    const oTxt = await oRes.text();
    if (!oRes.ok) {
      if (oRes.status === 404 || /does not exist/i.test(oTxt))
        return NextResponse.json({ error: "Ordering abhi setup nahi hua." }, { status: 412 });
      throw new Error(oTxt);
    }
    await fetch(`${SB_URL}/rest/v1/food_order_items`, {
      method: "POST", headers: SB_H, body: JSON.stringify(itemRows),
    });
    return NextResponse.json({ ok: true, orderId, total });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Order failed" }, { status: 500 });
  }
}
