// v330 — Circle Phase C4: admin oversight for Model 3 pre-buy inventory.
//
//   GET  /api/admin/circle-inventory[?status=]
//     → blocks (enriched hotel/unit/investor) + recent sales + B2B trade
//        settlements + KPIs: investor-net owed/paid, platform fees, GMV, block
//        counts, buyback obligations, and Model-4 exchange owed/paid/fees/GMV.
//        Owed = what StayBid still has to pay investors for settled resales
//        (inventory_sales.payout_status='owed') and sellers for completed B2B
//        trades (settlement_ledger.kind='b2b_trade', payout_status='owed').
//   POST /api/admin/circle-inventory  { action, ... }
//     force_expire         { blockId }         owned|listed → expired + release hold
//     buyback              { blockId, amount? } buyback_enabled + owned|listed|expired
//                                              → refunded + release hold + record obligation
//     mark_payout_paid     { saleId }          inventory_sales owed → paid
//     mark_buyback_paid    { blockId }          block buyback obligation owed → paid
//     mark_settlement_paid { settlementId }    settlement_ledger b2b_trade owed → paid
//
// Auth: adminFromReq (Bearer / x-admin-token). Every mutation logAdminAction'd.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { adminFromReq, logAdminAction } from "@/lib/admin/audit";
import { resaleAskPerNight } from "@/lib/b2b/engine";
import { isRazorpayXConfigured, ensureFundAccount, createPayout } from "@/lib/circle/razorpayx";

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

  const [blocks, sales, statusRows, paidSales, settlements, settleAgg, b2bListingsRaw, b2bTradesRaw, b2bListingStatusRows] = await Promise.all([
    sb(`inventory_blocks?${blockQ}`),
    sb(`inventory_sales?select=*&order=created_at.desc&limit=200`),
    sb(`inventory_blocks?select=status&limit=2000`),
    // Lightweight aggregate for accurate KPI totals (numeric cols only).
    sb(`inventory_sales?status=eq.paid&select=investor_net,platform_fee,resale_total,payout_status&limit=2000`),
    // v333 (D3) — Model 4 B2B trade settlements owed to sellers.
    sb(`settlement_ledger?kind=eq.b2b_trade&select=*&order=created_at.desc&limit=200`),
    sb(`settlement_ledger?kind=eq.b2b_trade&select=gross_amount,platform_fee,net_amount,payout_status&limit=2000`),
    // v334 (D4) — Model 4 B2B exchange oversight: listings + trades + status counts.
    sb(`b2b_listings?select=*&order=created_at.desc&limit=200`),
    sb(`b2b_trades?select=*&order=created_at.desc&limit=200`),
    sb(`b2b_listings?select=status&limit=2000`),
  ]);

  // S2 — guest-booking owner settlements (kind='guest_booking') written by the
  // settlement reconciler. Owed = what StayBid owes Circle owners from confirmed
  // guest bookings; mark_guest_booking_paid flips owed→paid.
  const [gbSettlements, gbAgg] = await Promise.all([
    sb(`settlement_ledger?kind=eq.guest_booking&select=*&order=created_at.desc&limit=200`),
    sb(`settlement_ledger?kind=eq.guest_booking&select=gross_amount,platform_fee,net_amount,payout_status&limit=5000`),
  ]);

  // v390 — payout batches: owed guest_booking rows grouped per owner + whether
  // that owner has added a payout account (the money-out prerequisite).
  const gbOwedRows = gbSettlements.filter((s: any) => String(s.payout_status) === "owed");
  const batchByPayee: Record<string, { payeeId: string; totalOwed: number; rowCount: number }> = {};
  gbOwedRows.forEach((s: any) => {
    const p = String(s.payee_user_id);
    (batchByPayee[p] ||= { payeeId: p, totalOwed: 0, rowCount: 0 });
    batchByPayee[p].totalOwed += num(s.net_amount);
    batchByPayee[p].rowCount += 1;
  });
  const batchPayeeIds = Object.keys(batchByPayee);
  const payoutAccts = batchPayeeIds.length
    ? await sb(`circle_payout_accounts?user_id=in.(${idList(batchPayeeIds)})&select=user_id,method,status`)
    : [];
  const acctByUser: Record<string, any> = {}; payoutAccts.forEach((a: any) => { acctByUser[String(a.user_id)] = a; });
  const payoutBatches = batchPayeeIds
    .map((p) => ({ ...batchByPayee[p], hasAccount: !!acctByUser[p], accountMethod: acctByUser[p]?.method || null, accountStatus: acctByUser[p]?.status || null }))
    .sort((a, b) => b.totalOwed - a.totalOwed);

  // v333 (D3) — side-load the B2B trades behind each settlement (ref_id → trade)
  // so a settlement row can show unit # / hotel / dates.
  const settleTradeIds = Array.from(new Set(settlements.map((s: any) => String(s.ref_id)).filter(Boolean)));
  const trades = settleTradeIds.length
    ? await sb(`b2b_trades?id=in.(${idList(settleTradeIds)})&select=id,unit_id,hotel_id,date_from,date_to,nights,seller_user_id,buyer_user_id`)
    : [];
  const tradeBy: Record<string, any> = {}; trades.forEach((t: any) => { tradeBy[t.id] = t; });

  // Enrich blocks + sales + B2B listings/trades with hotel name / unit # / investor name.
  const hotelIds = Array.from(new Set([...blocks, ...sales, ...trades, ...b2bListingsRaw, ...b2bTradesRaw].map((x) => String(x.hotel_id)).filter(Boolean)));
  const unitIds = Array.from(new Set([...blocks, ...sales, ...trades, ...b2bListingsRaw, ...b2bTradesRaw].map((x) => String(x.unit_id)).filter(Boolean)));
  const userIds = Array.from(new Set([
    ...blocks.map((x) => String(x.investor_user_id)),
    ...sales.map((x) => String(x.investor_user_id)),
    ...settlements.map((x: any) => String(x.payee_user_id)),
    ...b2bListingsRaw.map((x: any) => String(x.seller_user_id)),
    ...b2bTradesRaw.flatMap((x: any) => [String(x.seller_user_id), String(x.buyer_user_id)]),
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
  // v334 (D4) — B2B listing / trade enrichment.
  const enrichListing = (l: any) => ({
    ...l,
    hotel_name: hotelBy[l.hotel_id]?.name || null,
    hotel_city: hotelBy[l.hotel_id]?.city || null,
    unit_number: unitBy[l.unit_id]?.roomNumber || null,
    seller_name: userBy[l.seller_user_id]?.name || null,
    seller_phone: userBy[l.seller_user_id]?.phone || null,
  });
  const enrichTrade = (t: any) => ({
    ...t,
    hotel_name: hotelBy[t.hotel_id]?.name || null,
    unit_number: unitBy[t.unit_id]?.roomNumber || null,
    seller_name: userBy[t.seller_user_id]?.name || null,
    buyer_name: userBy[t.buyer_user_id]?.name || null,
  });
  // v333 (D3) — a B2B settlement: pull unit/hotel/dates from its trade.
  const enrichSettlement = (s: any) => {
    const t = tradeBy[s.ref_id] || {};
    return {
      ...s,
      hotel_name: hotelBy[t.hotel_id]?.name || null,
      unit_number: unitBy[t.unit_id]?.roomNumber || null,
      date_from: t.date_from || null,
      date_to: t.date_to || null,
      nights: t.nights ?? null,
      seller_name: userBy[s.payee_user_id]?.name || null,
      seller_phone: userBy[s.payee_user_id]?.phone || null,
    };
  };

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

  // v333 (D3) — B2B trade settlement KPIs (seller net owed / paid, StayBid fees, GMV).
  let b2bOwed = 0, b2bPaid = 0, b2bFees = 0, b2bGmv = 0;
  settleAgg.forEach((s: any) => {
    b2bFees += num(s.platform_fee);
    b2bGmv += num(s.gross_amount);
    if (s.payout_status === "paid") b2bPaid += num(s.net_amount);
    else b2bOwed += num(s.net_amount);
  });

  // v334 (D4) — B2B exchange listing KPIs.
  const b2bListingsByStatus: Record<string, number> = {};
  b2bListingStatusRows.forEach((r: any) => { b2bListingsByStatus[r.status] = (b2bListingsByStatus[r.status] || 0) + 1; });
  const b2bListingsActive = (b2bListingsByStatus.draft || 0) + (b2bListingsByStatus.listed || 0);
  const b2bListedGmv = Math.round(
    b2bListingsRaw.filter((l: any) => l.status === "listed").reduce((s: number, l: any) => s + num(l.ask_total), 0),
  );

  // S2 — guest-booking settlement aggregate.
  let gbOwed = 0, gbPaid = 0, gbFees = 0;
  gbAgg.forEach((s: any) => {
    const net = num(s.net_amount), fee = num(s.platform_fee), st = String(s.payout_status);
    gbFees += fee;
    if (st === "owed") gbOwed += net;
    else if (st === "paid") gbPaid += net;
  });

  return NextResponse.json({
    ok: true,
    kpis: {
      // S2 — guest-booking owner settlements.
      gbOwed: Math.round(gbOwed),
      gbPaid: Math.round(gbPaid),
      gbFees: Math.round(gbFees),
      gbCount: gbSettlements.length,
      investorOwed: Math.round(investorOwed),
      investorPaid: Math.round(investorPaid),
      platformFees: Math.round(platformFees),
      gmv: Math.round(gmv),
      byStatus,
      totalBlocks: statusRows.length,
      buybackOwed,
      // v333 (D3) — Model 4 exchange settlements.
      b2bOwed: Math.round(b2bOwed),
      b2bPaid: Math.round(b2bPaid),
      b2bFees: Math.round(b2bFees),
      b2bGmv: Math.round(b2bGmv),
      // v334 (D4) — Model 4 exchange listings.
      b2bListingsByStatus,
      b2bListingsActive,
      b2bListedGmv,
      b2bListingsTotal: b2bListingStatusRows.length,
    },
    blocks: blocks.map(enrichBlock),
    sales: sales.map(enrichSale),
    settlements: settlements.map(enrichSettlement),
    guestBookingSettlements: gbSettlements.map((s: any) => ({
      id: s.id, payee_user_id: s.payee_user_id, gross_amount: num(s.gross_amount),
      platform_fee: num(s.platform_fee), net_amount: num(s.net_amount),
      payout_status: s.payout_status, ref_id: s.ref_id, metadata: s.metadata, created_at: s.created_at,
    })),
    payoutBatches,
    razorpayxConfigured: isRazorpayXConfigured(),
    b2bListings: b2bListingsRaw.map(enrichListing),
    b2bTrades: b2bTradesRaw.map(enrichTrade),
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

  // ── mark_settlement_paid: settle a B2B trade's seller-net obligation (D3) ─
  if (action === "mark_settlement_paid") {
    const settlementId = String(body?.settlementId || "").trim();
    if (!settlementId) return NextResponse.json({ error: "settlementId required" }, { status: 400 });
    const rows0 = await sb(`settlement_ledger?id=eq.${encodeURIComponent(settlementId)}&kind=eq.b2b_trade&select=*`);
    const s = rows0[0];
    if (!s) return NextResponse.json({ error: "Settlement not found" }, { status: 404 });
    const meta = (s.metadata && typeof s.metadata === "object") ? s.metadata : {};
    const r = await fetch(
      `${SB_URL}/rest/v1/settlement_ledger?id=eq.${encodeURIComponent(settlementId)}&kind=eq.b2b_trade&payout_status=eq.owed`,
      {
        method: "PATCH",
        headers: { ...SB_H, Prefer: "return=representation" },
        body: JSON.stringify({
          payout_status: "paid",
          paid_at: nowIso,
          metadata: { ...meta, payoutPaidAt: nowIso, payoutPaidBy: admin.id || null },
          updated_at: nowIso,
        }),
      },
    );
    const rows = r.ok ? await r.json().catch(() => []) : [];
    if (!Array.isArray(rows) || !rows.length) {
      return NextResponse.json({ error: "Settlement already paid or not payable." }, { status: 409 });
    }
    logAdminAction({ admin, action: "circle_inventory.settlement_paid", targetType: "settlement_ledger", targetId: settlementId, details: { net_amount: num(s.net_amount) } });
    return NextResponse.json({ ok: true, settlement: rows[0] });
  }

  // ── mark_guest_booking_paid: settle a guest-booking owner obligation (S2) ─
  //    Manual payout reconciliation for kind='guest_booking' owed rows written
  //    by the settlement reconciler; owed → paid. (Auto RazorpayX payout is S3.)
  if (action === "mark_guest_booking_paid") {
    const settlementId = String(body?.settlementId || "").trim();
    if (!settlementId) return NextResponse.json({ error: "settlementId required" }, { status: 400 });
    const rows0 = await sb(`settlement_ledger?id=eq.${encodeURIComponent(settlementId)}&kind=eq.guest_booking&select=*`);
    const s = rows0[0];
    if (!s) return NextResponse.json({ error: "Settlement not found" }, { status: 404 });
    const meta = (s.metadata && typeof s.metadata === "object") ? s.metadata : {};
    const r = await fetch(
      `${SB_URL}/rest/v1/settlement_ledger?id=eq.${encodeURIComponent(settlementId)}&kind=eq.guest_booking&payout_status=eq.owed`,
      {
        method: "PATCH",
        headers: { ...SB_H, Prefer: "return=representation" },
        body: JSON.stringify({
          payout_status: "paid",
          paid_at: nowIso,
          metadata: { ...meta, payoutPaidAt: nowIso, payoutPaidBy: admin.id || null },
          updated_at: nowIso,
        }),
      },
    );
    const rows = r.ok ? await r.json().catch(() => []) : [];
    if (!Array.isArray(rows) || !rows.length) {
      return NextResponse.json({ error: "Settlement already paid or not payable." }, { status: 409 });
    }
    logAdminAction({ admin, action: "circle_inventory.guest_booking_paid", targetType: "settlement_ledger", targetId: settlementId, details: { net_amount: num(s.net_amount) } });
    return NextResponse.json({ ok: true, settlement: rows[0] });
  }

  // ── mark_owner_batch_paid: settle ALL owed guest_booking rows for one owner ─
  //    (v390) — the per-owner payout batch. owed → paid in one action. Interim
  //    manual reconciliation until the RazorpayX money-out cron (S3) lands.
  if (action === "mark_owner_batch_paid") {
    const payeeUserId = String(body?.payeeUserId || "").trim();
    if (!payeeUserId) return NextResponse.json({ error: "payeeUserId required" }, { status: 400 });
    const r = await fetch(
      `${SB_URL}/rest/v1/settlement_ledger?kind=eq.guest_booking&payee_user_id=eq.${encodeURIComponent(payeeUserId)}&payout_status=eq.owed`,
      {
        method: "PATCH",
        headers: { ...SB_H, Prefer: "return=representation" },
        body: JSON.stringify({ payout_status: "paid", paid_at: nowIso, updated_at: nowIso }),
      },
    );
    const rows = r.ok ? await r.json().catch(() => []) : [];
    const count = Array.isArray(rows) ? rows.length : 0;
    const total = (Array.isArray(rows) ? rows : []).reduce((s: number, x: any) => s + num(x.net_amount), 0);
    logAdminAction({ admin, action: "circle_inventory.owner_batch_paid", targetType: "user", targetId: payeeUserId, details: { rows: count, total } });
    return NextResponse.json({ ok: true, paidRows: count, paidTotal: total });
  }

  // ── payout_owner_batch: EXECUTE a RazorpayX payout for one owner's owed rows ─
  //    (v391) Two-phase claim (owed→paying) BEFORE the payout API call so a retry
  //    / concurrent run can never double-pay; the payout idempotency key is
  //    derived from the exact claimed row set. Inert unless RazorpayX is configured.
  if (action === "payout_owner_batch") {
    if (!isRazorpayXConfigured()) {
      return NextResponse.json({ error: "RazorpayX is not configured — set RAZORPAYX_KEY_ID / RAZORPAYX_KEY_SECRET / RAZORPAYX_ACCOUNT_NUMBER, then retry." }, { status: 400 });
    }
    const payeeUserId = String(body?.payeeUserId || "").trim();
    if (!payeeUserId) return NextResponse.json({ error: "payeeUserId required" }, { status: 400 });

    const acct = (await sb(`circle_payout_accounts?user_id=eq.${encodeURIComponent(payeeUserId)}&select=*&limit=1`))[0];
    if (!acct) return NextResponse.json({ error: "This owner hasn't added a payout account yet." }, { status: 409 });

    // 1) CLAIM: flip this owner's owed rows → paying, capturing EXACTLY the rows
    //    THIS request transitioned (return=representation). Processing only the
    //    self-claimed set — never a follow-up "select all paying" — closes the
    //    double-pay race: a concurrent/retried run can no longer fold another
    //    request's in-flight rows into a second, different-keyed payout.
    const encPayee = encodeURIComponent(payeeUserId);
    let claimed: any[] = [];
    try {
      const cr = await fetch(`${SB_URL}/rest/v1/settlement_ledger?kind=eq.guest_booking&payee_user_id=eq.${encPayee}&payout_status=eq.owed`, {
        method: "PATCH", headers: { ...SB_H, Prefer: "return=representation" },
        body: JSON.stringify({ payout_status: "paying", updated_at: nowIso }),
      });
      if (cr.ok) { const j = await cr.json().catch(() => []); claimed = Array.isArray(j) ? j : []; }
    } catch { /* fall through to crash-recovery */ }

    // 2) Crash-recovery ONLY: this request claimed nothing new (rows already
    //    `paying` from a prior crashed attempt) → adopt that stale set so the
    //    owner still gets paid. No fresh owed→paying happened here, so there is
    //    no new set to overlap — the idempotency key stays stable.
    if (!claimed.length) {
      claimed = await sb(`settlement_ledger?kind=eq.guest_booking&payee_user_id=eq.${encPayee}&payout_status=eq.paying&select=id,net_amount&limit=500`);
    }
    if (!claimed.length) return NextResponse.json({ error: "Nothing to pay for this owner." }, { status: 409 });

    const ids = claimed.map((r: any) => String(r.id)).sort();
    const totalRupees = claimed.reduce((s: number, r: any) => s + num(r.net_amount), 0);
    const amountPaise = Math.round(totalRupees * 100);
    let h = 0; const seed = ids.join(","); for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
    const idemKey = `gbpo_${payeeUserId}_${(h >>> 0).toString(36)}`.slice(0, 40);

    const releaseClaim = async () => {
      try {
        await fetch(`${SB_URL}/rest/v1/settlement_ledger?id=in.(${idList(ids)})&payout_status=eq.paying`, {
          method: "PATCH", headers: { ...SB_H, Prefer: "return=minimal" },
          body: JSON.stringify({ payout_status: "owed", updated_at: new Date().toISOString() }),
        });
      } catch { /* best-effort release */ }
    };

    try {
      const fa = await ensureFundAccount(
        { method: acct.method, account_holder: acct.account_holder, account_number: acct.account_number, ifsc: acct.ifsc, upi_id: acct.upi_id },
        payeeUserId,
        acct.razorpayx_fund_account_id,
      );
      if (fa.created) {
        await fetch(`${SB_URL}/rest/v1/circle_payout_accounts?id=eq.${encodeURIComponent(acct.id)}`, {
          method: "PATCH", headers: { ...SB_H, Prefer: "return=minimal" },
          body: JSON.stringify({ razorpayx_fund_account_id: fa.fundAccountId, status: "verified", updated_at: nowIso }),
        });
      }
      const payout = await createPayout({ fundAccountId: fa.fundAccountId, amountPaise, idempotencyKey: idemKey, referenceId: idemKey, narration: "StayBid Circle payout" });

      // 3) SUCCESS: paying → paid + stamp the payout_ref so the async payout
      //    webhook can later claw the exact rows back to `owed` if RazorpayX
      //    reverses/fails the payout (createPayout returning ≠ money delivered).
      await fetch(`${SB_URL}/rest/v1/settlement_ledger?id=in.(${idList(ids)})&payout_status=eq.paying`, {
        method: "PATCH", headers: { ...SB_H, Prefer: "return=minimal" },
        body: JSON.stringify({ payout_status: "paid", paid_at: nowIso, payout_ref: String(payout.id), updated_at: nowIso }),
      });
      logAdminAction({ admin, action: "circle_inventory.payout_executed", targetType: "user", targetId: payeeUserId, details: { rows: ids.length, total: totalRupees, payoutId: payout.id, status: payout.status } });
      return NextResponse.json({ ok: true, payoutId: payout.id, status: payout.status, paidRows: ids.length, paidTotal: totalRupees });
    } catch (e: any) {
      await releaseClaim(); // FAILURE: paying → owed so it can be retried.
      return NextResponse.json({ error: `Payout failed: ${String(e?.message || e).slice(0, 160)}` }, { status: 502 });
    }
  }

  // ── expire_listing / cancel_listing: retire a live B2B listing (D4) ──────
  // draft|listed → expired|cancelled. The underlying inventory_block STAYS
  // `owned` (seller keeps their right) — no hold is touched.
  if (action === "expire_listing" || action === "cancel_listing") {
    const listingId = String(body?.listingId || "").trim();
    if (!listingId) return NextResponse.json({ error: "listingId required" }, { status: 400 });
    const rows0 = await sb(`b2b_listings?id=eq.${encodeURIComponent(listingId)}&select=*`);
    const listing = rows0[0];
    if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    if (!["draft", "listed"].includes(String(listing.status))) {
      return NextResponse.json({ error: `A ${String(listing.status).replace(/_/g, " ")} listing can't be retired.` }, { status: 409 });
    }
    const newStatus = action === "expire_listing" ? "expired" : "cancelled";
    const meta = (listing.metadata && typeof listing.metadata === "object") ? listing.metadata : {};
    const r = await fetch(
      `${SB_URL}/rest/v1/b2b_listings?id=eq.${encodeURIComponent(listingId)}&status=in.(draft,listed)`,
      {
        method: "PATCH",
        headers: { ...SB_H, Prefer: "return=representation" },
        body: JSON.stringify({
          status: newStatus,
          metadata: {
            ...meta,
            [`${newStatus}At`]: nowIso,
            [`${newStatus}Reason`]: "admin_action",
            [`${newStatus}By`]: admin.id || null,
          },
          updated_at: nowIso,
        }),
      },
    );
    const rows = r.ok ? await r.json().catch(() => []) : [];
    if (!Array.isArray(rows) || !rows.length) {
      return NextResponse.json({ error: "Listing changed — refresh and try again." }, { status: 409 });
    }
    logAdminAction({ admin, action: `circle_inventory.${action}`, targetType: "b2b_listing", targetId: listingId, details: { newStatus } });
    return NextResponse.json({ ok: true, listing: rows[0] });
  }

  // ── set_listing_multiplier: per-room/per-listing resale multiplier ───────
  // v355 — re-price ONE live (draft|listed) listing at its own multiplier so a
  // specific room can differ from the global default. Recomputes the ask from
  // the FROZEN own price/night × the new multiplier; own_per_night + buy_total +
  // fees are untouched (tamper-safe). Sold/expired listings can't be re-priced.
  if (action === "set_listing_multiplier") {
    const listingId = String(body?.listingId || "").trim();
    const multiplier = Number(body?.multiplier);
    if (!listingId) return NextResponse.json({ error: "listingId required" }, { status: 400 });
    if (!Number.isFinite(multiplier) || multiplier < 1 || multiplier > 20) {
      return NextResponse.json({ error: "multiplier must be 1–20." }, { status: 400 });
    }
    const rows0 = await sb(`b2b_listings?id=eq.${encodeURIComponent(listingId)}&select=*`);
    const listing = rows0[0];
    if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    if (!["draft", "listed"].includes(String(listing.status))) {
      return NextResponse.json({ error: `A ${String(listing.status).replace(/_/g, " ")} listing can't be re-priced.` }, { status: 409 });
    }
    const nights = Math.max(1, num(listing.nights) || 1);
    // own price/night — the frozen basis, or derived from buy_total for legacy rows.
    const ownPerNight = num(listing.own_per_night) || Math.round(num(listing.buy_total) / nights);
    if (ownPerNight <= 0) {
      return NextResponse.json({ error: "This listing has no own-price basis to re-price from." }, { status: 422 });
    }
    const askPerNight = resaleAskPerNight(ownPerNight, multiplier);
    const askTotal = askPerNight * nights;
    const meta = (listing.metadata && typeof listing.metadata === "object") ? listing.metadata : {};
    const r = await fetch(
      `${SB_URL}/rest/v1/b2b_listings?id=eq.${encodeURIComponent(listingId)}&status=in.(draft,listed)`,
      {
        method: "PATCH",
        headers: { ...SB_H, Prefer: "return=representation" },
        body: JSON.stringify({
          price_multiplier: multiplier,
          own_per_night: ownPerNight,       // stamp it if it was a legacy null
          ask_per_night: askPerNight,
          ask_total: askTotal,
          metadata: { ...meta, multiplier, ownPerNight, repricedAt: nowIso, repricedBy: admin.id || null },
          updated_at: nowIso,
        }),
      },
    );
    const rows = r.ok ? await r.json().catch(() => []) : [];
    if (!Array.isArray(rows) || !rows.length) {
      return NextResponse.json({ error: "Listing changed — refresh and try again." }, { status: 409 });
    }
    logAdminAction({ admin, action: "circle_inventory.set_listing_multiplier", targetType: "b2b_listing", targetId: listingId, details: { multiplier, ownPerNight, askPerNight, askTotal } });
    return NextResponse.json({ ok: true, listing: rows[0] });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
