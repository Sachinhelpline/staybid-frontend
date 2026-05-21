// v174 — F&B order verification → billing (partner panel, Phase 3).
//
//   GET   ?hotelId=...  → incoming orders (+ items) + open folios
//   POST  { id, action } → verify or reject an order
//        action "verify"  → items become F&B charges on a folio
//                           (existing folioId, or createFolio: true)
//        action "reject"  → order marked rejected
//
// Owner-scoped. Verify is idempotent — the order is claimed
// (pending → added_to_folio) before charges are written.
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
    const oRes = await fetch(`${SB_URL}/rest/v1/food_orders?hotel_id=eq.${encodeURIComponent(hotelId)}&select=*&order=created_at.desc&limit=80`, { headers: SB_H });
    if (!oRes.ok) return NextResponse.json({ orders: [], folios: [], provisioned: false });
    const orders = await oRes.json().catch(() => []);
    const ids = (Array.isArray(orders) ? orders : []).map((o: any) => o.id);

    const [itemsRaw, folios] = await Promise.all([
      ids.length
        ? fetch(`${SB_URL}/rest/v1/food_order_items?order_id=in.(${ids.join(",")})&select=*`, { headers: SB_H }).then((r) => r.json()).catch(() => [])
        : Promise.resolve([]),
      sbSelect(`guest_folios?hotel_id=eq.${encodeURIComponent(hotelId)}&status=eq.open&select=id,guest_name,room_label,guest_phone,ref_type&order=created_at.desc`).catch(() => []),
    ]);
    const itemsByOrder: Record<string, any[]> = {};
    for (const it of Array.isArray(itemsRaw) ? itemsRaw : []) {
      (itemsByOrder[it.order_id] = itemsByOrder[it.order_id] || []).push(it);
    }
    return NextResponse.json({
      orders: (Array.isArray(orders) ? orders : []).map((o: any) => ({ ...o, items: itemsByOrder[o.id] || [] })),
      folios: Array.isArray(folios) ? folios : [],
      provisioned: true,
    });
  } catch {
    return NextResponse.json({ orders: [], folios: [], provisioned: false });
  }
}

export async function POST(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch {}
  const { id, action } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const orders = await sbSelect(`food_orders?id=eq.${encodeURIComponent(id)}&select=*`);
  const order = orders?.[0];
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (!owned.ids.includes(order.hotel_id))
    return NextResponse.json({ error: "Not your order" }, { status: 403 });

  // ── reject ────────────────────────────────────────────────────────────
  if (action === "reject") {
    try {
      await fetch(`${SB_URL}/rest/v1/food_orders?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH", headers: SB_H, body: JSON.stringify({ status: "rejected" }),
      });
      return NextResponse.json({ ok: true });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || "Reject failed" }, { status: 500 });
    }
  }

  if (action !== "verify")
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  // ── verify → claim the order (idempotent) ──────────────────────────────
  let claimed: any[] = [];
  try {
    const claimRes = await fetch(
      `${SB_URL}/rest/v1/food_orders?id=eq.${encodeURIComponent(id)}&status=eq.pending`,
      { method: "PATCH", headers: SB_H_REPRESENT, body: JSON.stringify({ status: "added_to_folio" }) }
    );
    claimed = await claimRes.json().catch(() => []);
  } catch {
    return NextResponse.json({ error: "Could not process order" }, { status: 500 });
  }
  if (!Array.isArray(claimed) || !claimed.length)
    return NextResponse.json({ error: "Order pehle hi process ho chuka hai" }, { status: 409 });

  // resolve the target folio — existing or freshly created
  let folioId: string = body.folioId || "";
  if (folioId) {
    const f = await sbSelect(`guest_folios?id=eq.${encodeURIComponent(folioId)}&select=id,hotel_id`);
    if (!f?.[0] || f[0].hotel_id !== order.hotel_id) {
      // bad folio — roll the order back to pending
      await fetch(`${SB_URL}/rest/v1/food_orders?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH", headers: SB_H, body: JSON.stringify({ status: "pending" }),
      }).catch(() => {});
      return NextResponse.json({ error: "Folio not found" }, { status: 404 });
    }
  } else {
    // create a fresh offline folio for this order
    const fId = genId("fol");
    const guest = order.guest_name || (order.location ? `Room ${order.location}` : "Guest");
    const insert = (r: any) =>
      fetch(`${SB_URL}/rest/v1/guest_folios`, { method: "POST", headers: SB_H_REPRESENT, body: JSON.stringify(r) });
    const base: any = {
      id: fId, hotel_id: order.hotel_id, guest_name: guest,
      guest_phone: order.guest_phone || null, ref_type: "manual",
      room_label: order.location || null, status: "open",
      tax_pct: 12, discount: 0, created_by: owned.userId,
    };
    let r = await insert({ ...base, gst_mode: "exclusive" });
    if (!r.ok) r = await insert(base); // gst_mode column may not exist yet
    if (!r.ok) {
      await fetch(`${SB_URL}/rest/v1/food_orders?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH", headers: SB_H, body: JSON.stringify({ status: "pending" }),
      }).catch(() => {});
      return NextResponse.json({ error: "Folio create failed" }, { status: 500 });
    }
    folioId = fId;
  }

  // order items → F&B folio charges
  const items = await sbSelect(`food_order_items?order_id=eq.${encodeURIComponent(id)}&select=*`).catch(() => []);
  const charges = (items || []).map((it: any) => ({
    id: genId("chg"), folio_id: folioId, hotel_id: order.hotel_id,
    kind: "food",
    label: `${it.item_name}${it.portion ? ` (${it.portion})` : ""}`,
    qty: Number(it.qty) || 1,
    unit_price: Number(it.unit_price) || 0,
    amount: Number(it.amount) || 0,
    created_by: owned.userId,
  }));
  if (charges.length) {
    try {
      await fetch(`${SB_URL}/rest/v1/folio_charges`, {
        method: "POST", headers: SB_H, body: JSON.stringify(charges),
      });
    } catch { /* charges best-effort; order already claimed */ }
  }
  return NextResponse.json({ ok: true, folioId, charges: charges.length });
}
