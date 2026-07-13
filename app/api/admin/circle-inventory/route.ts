// v330 — Circle Phase C4: admin oversight for Model 3 pre-buy inventory.
//
//   GET  /api/admin/circle-inventory[?status=]
//     → blocks (enriched hotel/unit/investor) + recent sales + KPIs:
//        investor-net owed/paid, platform fees, GMV, block counts, buyback
//        obligations. Owed = what StayBid still has to pay investors for
//        settled resales (inventory_sales.payout_status='owed').
//   POST /api/admin/circle-inventory  { action, ... }
//     force_expire      { blockId }            owned|listed → expired + release hold
//     buyback           { blockId, amount? }   buyback_enabled + owned|listed|expired
//                                              → refunded + release hold + record obligation
//     mark_payout_paid  { saleId }             inventory_sales owed → paid
//     mark_buyback_paid { blockId }            block buyback obligation owed → paid
//
// Auth: adminFromReq (Bearer / x-admin-token). Every mutation logAdminAction'd.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { adminFromReq, logAdminAction } from "@/lib/admin/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const num = (n: any) => Number(n) || 0;
const idList = (ids: string[]) => ids.map((x) => encodeURIComponent(x)).join(",");

async function sb(path: string): Promise<any[]> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_H, cache: "no-store" });
    const j = await r.json().catch(() => []);
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

async function releaseHold(blockId: string): Promise<boolean> {
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/room_blocks?id=eq.${encodeURIComponent(`invhold_${blockId}`)}`,
      { method: "DELETE", headers: SB_H },
    );
    return r.ok;
  } catch { return false; }
}

async function loadBlock(blockId: string): Promise<any | null> {
  const rows = await sb(`inventory_blocks?id=eq.${encodeURIComponent(blockId)}&select=*`);
  return rows[0] || null;
}

export async function GET(req: NextRequest) {
  if (!adminFromReq(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const status = (new URL(req.url).searchParams.get("status") || "").trim();
  let blockQ = `select=*&order=created_at.desc&limit=200`;
  if (status && status !== "all") blockQ += `&status=eq.${encodeURIComponent(status)}`;

  const [blocks, sales, statusRows, paidSales] = await Promise.all([
    sb(`inventory_blocks?${blockQ}`),
    sb(`inventory_sales?select=*&order=created_at.desc&limit=200`),
    sb(`inventory_blocks?select=status&limit=2000`),
    // Lightweight aggregate for accurate KPI totals (numeric cols only).
    sb(`inventory_sales?status=eq.paid&select=investor_net,platform_fee,resale_total,payout_status&limit=2000`),
  ]);

  // Enrich blocks + sales with hotel name / unit # / investor name.
  const hotelIds = Array.from(new Set([...blocks, ...sales].map((x) => String(x.hotel_id)).filter(Boolean)));
  const unitIds = Array.from(new Set([...blocks, ...sales].map((x) => String(x.unit_id)).filter(Boolean)));
  const userIds = Array.from(new Set([
    ...blocks.map((x) => String(x.investor_user_id)),
    ...sales.map((x) => String(x.investor_user_id)),
  ].filter(Boolean)));

  const [hotels, unitsRows, usersRows] = await Promise.all([
    hotelIds.length ? sb(`hotels?id=in.(${idList(hotelIds)})&select=id,name,city`) : Promise.resolve([]),
    unitIds.length ? sb(`hotel_room_units?id=in.(${idList(unitIds)})&select=id,roomNumber`) : Promise.resolve([]),
    userIds.length ? sb(`users?id=in.(${idList(userIds)})&select=id,name,phone`) : Promise.resolve([]),
  ]);
  const hotelBy: Record<string, any> = {}; hotels.forEach((h: any) => { hotelBy[h.id] = h; });
  const unitBy: Record<string, any> = {}; unitsRows.forEach((u: any) => { unitBy[u.id] = u; });
  const userBy: Record<string, any> = {}; usersRows.forEach((u: any) => { userBy[u.id] = u; });

  const enrichBlock = (b: any) => ({
    ...b,
    hotel_name: hotelBy[b.hotel_id]?.name || null,
    hotel_city: hotelBy[b.hotel_id]?.city || null,
    unit_number: unitBy[b.unit_id]?.roomNumber || null,
    investor_name: userBy[b.investor_user_id]?.name || null,
    investor_phone: userBy[b.investor_user_id]?.phone || null,
  });
  const enrichSale = (s: any) => ({
    ...s,
    hotel_name: hotelBy[s.hotel_id]?.name || null,
    investor_name: userBy[s.investor_user_id]?.name || null,
  });

  // KPIs.
  const byStatus: Record<string, number> = {};
  statusRows.forEach((r: any) => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });

  let investorOwed = 0, investorPaid = 0, platformFees = 0, gmv = 0;
  paidSales.forEach((s: any) => {
    platformFees += num(s.platform_fee);
    gmv += num(s.resale_total);
    if (s.payout_status === "paid") investorPaid += num(s.investor_net);
    else investorOwed += num(s.investor_net);
  });

  // Buyback obligations (refunded blocks still owed a buyback payout).
  const buybackOwed = blocks.filter(
    (b: any) => b.status === "refunded" && b?.metadata?.buybackPayoutStatus === "owed",
  ).length;

  return NextResponse.json({
    ok: true,
    kpis: {
      investorOwed: Math.round(investorOwed),
      investorPaid: Math.round(investorPaid),
      platformFees: Math.round(platformFees),
      gmv: Math.round(gmv),
      byStatus,
      totalBlocks: statusRows.length,
      buybackOwed,
    },
    blocks: blocks.map(enrichBlock),
    sales: sales.map(enrichSale),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const action = String(body?.action || "").trim();
  const nowIso = new Date().toISOString();

  // ── force_expire: owned|listed → expired + release hold ──────────────────
  if (action === "force_expire") {
    const blockId = String(body?.blockId || "").trim();
    if (!blockId) return NextResponse.json({ error: "blockId required" }, { status: 400 });
    const block = await loadBlock(blockId);
    if (!block) return NextResponse.json({ error: "Block not found" }, { status: 404 });
    if (!["owned", "listed"].includes(String(block.status))) {
      return NextResponse.json({ error: `A ${String(block.status).replace(/_/g, " ")} block can't be force-expired.` }, { status: 409 });
    }
    const meta = (block.metadata && typeof block.metadata === "object") ? block.metadata : {};
    const r = await fetch(
      `${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(blockId)}&status=in.(owned,listed)`,
      {
        method: "PATCH",
        headers: { ...SB_H, Prefer: "return=representation" },
        body: JSON.stringify({
          status: "expired",
          metadata: { ...meta, expiredAt: nowIso, expiredReason: "admin_force", expiredBy: admin.id || null },
          updated_at: nowIso,
        }),
      },
    );
    const rows = r.ok ? await r.json().catch(() => []) : [];
    if (!Array.isArray(rows) || !rows.length) {
      return NextResponse.json({ error: "Block changed — refresh and try again." }, { status: 409 });
    }
    const released = await releaseHold(blockId);
    logAdminAction({ admin, action: "circle_inventory.force_expire", targetType: "inventory_block", targetId: blockId, details: { released } });
    return NextResponse.json({ ok: true, block: rows[0], released });
  }

  // ── buyback: StayBid buys the unsold nights back off the investor ────────
  if (action === "buyback") {
    const blockId = String(body?.blockId || "").trim();
    if (!blockId) return NextResponse.json({ error: "blockId required" }, { status: 400 });
    const block = await loadBlock(blockId);
    if (!block) return NextResponse.json({ error: "Block not found" }, { status: 404 });
    if (!block.buyback_enabled) {
      return NextResponse.json({ error: "This block isn't opted into buyback protection." }, { status: 409 });
    }
    if (!["owned", "listed", "expired"].includes(String(block.status))) {
      return NextResponse.json({ error: `A ${String(block.status).replace(/_/g, " ")} block can't be bought back.` }, { status: 409 });
    }
    // Refund amount defaults to the wholesale cost the investor paid.
    const rawAmt = Number(body?.amount);
    const amount = Number.isFinite(rawAmt) && rawAmt >= 0 ? Math.round(rawAmt) : Math.round(num(block.buy_total));
    const meta = (block.metadata && typeof block.metadata === "object") ? block.metadata : {};
    const r = await fetch(
      `${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(blockId)}&status=in.(owned,listed,expired)`,
      {
        method: "PATCH",
        headers: { ...SB_H, Prefer: "return=representation" },
        body: JSON.stringify({
          status: "refunded",
          metadata: {
            ...meta,
            buyback: { amount, at: nowIso, by: admin.id || null, reason: String(body?.reason || "").slice(0, 200) || null },
            buybackPayoutStatus: "owed",
          },
          updated_at: nowIso,
        }),
      },
    );
    const rows = r.ok ? await r.json().catch(() => []) : [];
    if (!Array.isArray(rows) || !rows.length) {
      return NextResponse.json({ error: "Block changed — refresh and try again." }, { status: 409 });
    }
    const released = await releaseHold(blockId);
    logAdminAction({ admin, action: "circle_inventory.buyback", targetType: "inventory_block", targetId: blockId, details: { amount, released } });
    return NextResponse.json({ ok: true, block: rows[0], amount, released });
  }

  // ── mark_payout_paid: settle a resale's investor-net obligation ──────────
  if (action === "mark_payout_paid") {
    const saleId = String(body?.saleId || "").trim();
    if (!saleId) return NextResponse.json({ error: "saleId required" }, { status: 400 });
    const rows0 = await sb(`inventory_sales?id=eq.${encodeURIComponent(saleId)}&select=*`);
    const sale = rows0[0];
    if (!sale) return NextResponse.json({ error: "Sale not found" }, { status: 404 });
    const meta = (sale.metadata && typeof sale.metadata === "object") ? sale.metadata : {};
    const r = await fetch(
      `${SB_URL}/rest/v1/inventory_sales?id=eq.${encodeURIComponent(saleId)}&status=eq.paid&payout_status=eq.owed`,
      {
        method: "PATCH",
        headers: { ...SB_H, Prefer: "return=representation" },
        body: JSON.stringify({
          payout_status: "paid",
          metadata: { ...meta, payoutPaidAt: nowIso, payoutPaidBy: admin.id || null },
        }),
      },
    );
    const rows = r.ok ? await r.json().catch(() => []) : [];
    if (!Array.isArray(rows) || !rows.length) {
      return NextResponse.json({ error: "Sale already settled or not payable." }, { status: 409 });
    }
    logAdminAction({ admin, action: "circle_inventory.payout_paid", targetType: "inventory_sale", targetId: saleId, details: { investor_net: num(sale.investor_net) } });
    return NextResponse.json({ ok: true, sale: rows[0] });
  }

  // ── mark_buyback_paid: settle a refunded block's buyback obligation ──────
  if (action === "mark_buyback_paid") {
    const blockId = String(body?.blockId || "").trim();
    if (!blockId) return NextResponse.json({ error: "blockId required" }, { status: 400 });
    const block = await loadBlock(blockId);
    if (!block) return NextResponse.json({ error: "Block not found" }, { status: 404 });
    if (block.status !== "refunded" || block?.metadata?.buybackPayoutStatus !== "owed") {
      return NextResponse.json({ error: "No open buyback obligation on this block." }, { status: 409 });
    }
    const meta = (block.metadata && typeof block.metadata === "object") ? block.metadata : {};
    const r = await fetch(
      `${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(blockId)}&status=eq.refunded`,
      {
        method: "PATCH",
        headers: { ...SB_H, Prefer: "return=representation" },
        body: JSON.stringify({
          metadata: { ...meta, buybackPayoutStatus: "paid", buybackPaidAt: nowIso, buybackPaidBy: admin.id || null },
          updated_at: nowIso,
        }),
      },
    );
    const rows = r.ok ? await r.json().catch(() => []) : [];
    if (!Array.isArray(rows) || !rows.length) {
      return NextResponse.json({ error: "Block changed — refresh and try again." }, { status: 409 });
    }
    logAdminAction({ admin, action: "circle_inventory.buyback_paid", targetType: "inventory_block", targetId: blockId, details: { amount: num(meta?.buyback?.amount) } });
    return NextResponse.json({ ok: true, block: rows[0] });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
