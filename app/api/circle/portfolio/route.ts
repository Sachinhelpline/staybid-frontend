// v345 — Circle Marketplace Phase M6: unified investor "My Circle" aggregator.
//
// GET /api/circle/portfolio
//   ONE place that gathers everything a logged-in investor holds ACROSS models,
//   keyed on their CROSS-POOL owner ids (so a holding created under any of their
//   identity twins is never missed):
//     • Model 3/4 inventory blocks  (inventory_blocks.investor_user_id)
//     • their B2B exchange listings (b2b_listings.seller_user_id)
//     • their B2B trades            (b2b_trades buyer + seller)
//     • operated-hotel dashboard access (hotel_room_units.owner_user_id)
//     • derived resale-performance KPIs
//   Side-loads hotel names + unit numbers (no PostgREST FK embed — none exists).
//   Read-only. Model-1 bundles/payouts stay on the pre-existing /api/circle/me
//   (raw user.id) — this route is purely additive.
//
// Auth: the investor's customer sb_token Bearer → decodeJwt → cross-pool ids
// (the same resolver /api/b2b/* + /api/circle/owned-summary already use).

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, decodeJwt } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function auth(req: NextRequest): { userId?: string; phone?: string; email?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub, phone: p?.phone, email: p?.email };
}

const idList = (ids: string[]) => ids.map((x) => encodeURIComponent(x)).join(",");

async function getJson(url: string): Promise<any[]> {
  try {
    const r = await fetch(url, { headers: SB_H });
    const j = r.ok ? await r.json().catch(() => []) : [];
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

export async function GET(req: NextRequest) {
  const { userId, phone, email } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ownerIds = await resolveOwnerIdsCrossPool(userId, phone, email);
  if (!ownerIds.length) {
    return NextResponse.json({
      ownerIds: [], blocks: [], listings: [], trades: { asBuyer: [], asSeller: [] },
      operatedHotels: [], kpis: {},
    });
  }
  const ids = idList(ownerIds);

  // Fan out — all cross-pool scoped.
  const [blocks, listings, tradesBuyer, tradesSeller, ownedUnits] = await Promise.all([
    getJson(`${SB_URL}/rest/v1/inventory_blocks?investor_user_id=in.(${ids})&select=*&order=created_at.desc&limit=300`),
    getJson(`${SB_URL}/rest/v1/b2b_listings?seller_user_id=in.(${ids})&select=*&order=created_at.desc&limit=200`),
    getJson(`${SB_URL}/rest/v1/b2b_trades?buyer_user_id=in.(${ids})&status=in.(pending_payment,completed)&select=*&order=created_at.desc&limit=200`),
    getJson(`${SB_URL}/rest/v1/b2b_trades?seller_user_id=in.(${ids})&status=in.(pending_payment,completed)&select=*&order=created_at.desc&limit=200`),
    getJson(`${SB_URL}/rest/v1/hotel_room_units?owner_user_id=in.(${ids})&status=eq.active&select=id,hotelId`),
  ]);

  // Side-load hotel names + unit numbers across every row (one call each).
  const allRows = [...blocks, ...listings, ...tradesBuyer, ...tradesSeller];
  const unitIds = Array.from(new Set(allRows.map((r) => String(r.unit_id)).filter(Boolean)));
  const hotelIds = Array.from(new Set(
    [...allRows.map((r) => String(r.hotel_id)), ...ownedUnits.map((u) => String(u.hotelId))].filter(Boolean),
  ));
  const unitNo: Record<string, string> = {};
  const hotelName: Record<string, string> = {};
  if (unitIds.length) {
    (await getJson(`${SB_URL}/rest/v1/hotel_room_units?id=in.(${idList(unitIds)})&select=id,roomNumber`))
      .forEach((x: any) => { unitNo[x.id] = x.roomNumber || x.id; });
  }
  if (hotelIds.length) {
    (await getJson(`${SB_URL}/rest/v1/hotels?id=in.(${idList(hotelIds)})&select=id,name,city`))
      .forEach((x: any) => { hotelName[x.id] = x.name || x.id; });
  }

  const enrich = (r: any) => ({
    ...r,
    unit_number: r.unit_id ? unitNo[String(r.unit_id)] || null : null,
    hotel_name: hotelName[String(r.hotel_id)] || null,
  });
  const eBlocks = blocks.map(enrich);
  const eListings = listings.map(enrich);
  const eBuyer = tradesBuyer.map(enrich);
  const eSeller = tradesSeller.map(enrich);

  // Operated hotels the investor can manage (owns ≥1 active unit).
  const unitCountByHotel: Record<string, number> = {};
  for (const u of ownedUnits) {
    const h = String(u.hotelId || "");
    if (h) unitCountByHotel[h] = (unitCountByHotel[h] || 0) + 1;
  }
  const operatedHotels = Object.keys(unitCountByHotel).map((h) => ({
    id: h, name: hotelName[h] || h, unitCount: unitCountByHotel[h],
  }));

  // Derived resale-performance KPIs (all actual — never projected).
  const num = (v: any) => Number(v) || 0;
  const byStatus = (s: string) => eBlocks.filter((b) => String(b.status) === s);
  const ownedBlocks = byStatus("owned").length;
  const listedBlocks = byStatus("listed").length;
  const soldBlocks = byStatus("sold").length;
  // Wholesale value still on the books (owned + listed, not yet sold).
  const inventoryValue = eBlocks
    .filter((b) => ["owned", "listed"].includes(String(b.status)))
    .reduce((s, b) => s + num(b.buy_total), 0);
  const activeListings = eListings.filter((l) => ["draft", "listed"].includes(String(l.status))).length;
  const soldAsSeller = eSeller.filter((t) => String(t.status) === "completed");
  const boughtAsBuyer = eBuyer.filter((t) => String(t.status) === "completed");
  // Net actually earned from B2B sell-through (seller_net on completed sales).
  const b2bNetEarned = soldAsSeller.reduce((s, t) => s + num(t.seller_net), 0);
  const b2bSpent = boughtAsBuyer.reduce((s, t) => s + num(t.ask_total), 0);

  return NextResponse.json({
    ownerIds,
    blocks: eBlocks,
    listings: eListings,
    trades: { asBuyer: eBuyer, asSeller: eSeller },
    operatedHotels,
    kpis: {
      ownedBlocks, listedBlocks, soldBlocks,
      inventoryValue,
      activeListings,
      b2bSoldCount: soldAsSeller.length,
      b2bBoughtCount: boughtAsBuyer.length,
      b2bNetEarned,
      b2bSpent,
      operatedHotelCount: operatedHotels.length,
    },
  });
}
