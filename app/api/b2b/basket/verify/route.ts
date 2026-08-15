// v350 — Circle Model 2 basket verify. HMAC-verifies the single basket payment,
// then settles EVERY pending b2b_trade tagged with that order id: marks each
// completed, transfers/mints its block per source, flips its listing sold, and
// writes each settlement. All steps are guarded + idempotent (a re-verify is a
// no-op). Auth: buyer sb_token → cross-pool ids.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, decodeJwt, genId } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { assertClassicHoldStillOurs } from "@/lib/inventory/assign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function auth(req: NextRequest): { userId?: string; phone?: string; email?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub, phone: p?.phone, email: p?.email };
}

async function stampUnitOwner(unitId: string, buyerPrimary: string, buyerIds: string[]): Promise<void> {
  if (!unitId) return;
  try {
    const idsCsv = buyerIds.map((x) => encodeURIComponent(x)).join(",");
    await fetch(`${SB_URL}/rest/v1/hotel_room_units?id=eq.${encodeURIComponent(unitId)}&or=(owner_user_id.is.null,owner_user_id.in.(${idsCsv}))`, {
      method: "PATCH", headers: { ...SB_H, Prefer: "return=minimal" }, body: JSON.stringify({ owner_user_id: buyerPrimary }),
    });
  } catch { /* best-effort */ }
}
// v734 — branches on assignment shape:
//   • UNIT block  → existing upsert path (unchanged, race-safe via unit_id).
//   • CLASSIC block (unit_id NULL) → ASSERT-ONLY. The invhold was written by
//     reserve_classic_block at checkout; verify must never silently recreate
//     a released hold (that would reintroduce the post-payment race the RPC
//     was designed to close). Returns {held, needsOpsReview} so the caller
//     records the ops-review flag on the block metadata.
// See sibling app/api/b2b/listings/[id]/verify/route.ts for the fuller
// comment on the reasoning.
async function writeHold(block: any): Promise<{ held: boolean; needsOpsReview: boolean; reason?: string }> {
  const hasUnit = !!block?.unit_id;
  if (!hasUnit) {
    const assertion = await assertClassicHoldStillOurs(String(block?.id || ""));
    if (assertion.ok && assertion.held) return { held: true, needsOpsReview: false };
    return { held: false, needsOpsReview: true, reason: assertion.reason || "hold_missing" };
  }
  try {
    let unitNumber: string | null = block?.metadata?.roomNumber || null;
    if (!unitNumber) {
      try {
        const ur = await fetch(`${SB_URL}/rest/v1/hotel_room_units?id=eq.${encodeURIComponent(String(block.unit_id))}&select=roomNumber`, { headers: SB_H });
        unitNumber = (await ur.json().catch(() => []))?.[0]?.roomNumber || null;
      } catch { /* optional */ }
    }
    const holdBody: Record<string, any> = {
      id: `invhold_${block.id}`, hotelId: String(block.hotel_id), roomId: String(block.room_id),
      fromDate: String(block.date_from), toDate: String(block.date_to), source: "inventory",
      note: "StayBid Circle B2B pre-buy hold", createdBy: String(block.investor_user_id),
      assignedUnitId: String(block.unit_id), assignedUnitNumber: unitNumber,
    };
    const r = await fetch(`${SB_URL}/rest/v1/room_blocks?on_conflict=id`, {
      method: "POST", headers: { ...SB_H, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(holdBody),
    });
    return { held: r.ok, needsOpsReview: !r.ok };
  } catch {
    return { held: false, needsOpsReview: true, reason: "hold_write_exception" };
  }
}
async function grantModel2Service(hotelId: string, grantedBy: string): Promise<void> {
  if (!hotelId) return;
  try {
    await fetch(`${SB_URL}/rest/v1/hotel_services?on_conflict=hotel_id,service_key`, {
      method: "POST", headers: { ...SB_H, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ id: genId("svc"), hotel_id: hotelId, service_key: "circle_model2", status: "active", access_type: "free", granted_by: grantedBy, note: "Circle Model-2 inventory investor (basket)", updated_at: new Date().toISOString() }),
    });
  } catch { /* best-effort */ }
}

export async function POST(req: NextRequest) {
  const { userId, phone, email } = auth(req);
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const buyerIds = await resolveOwnerIdsCrossPool(userId, phone, email);
  if (!buyerIds.length) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const idsCsv = buyerIds.map((x) => encodeURIComponent(x)).join(",");

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const rzpOrderId = String(body?.razorpay_order_id || "").trim();
  const paymentId = String(body?.razorpay_payment_id || "").trim();
  const signature = String(body?.razorpay_signature || "").trim();
  if (!rzpOrderId || !paymentId || !signature) return NextResponse.json({ ok: false, error: "Missing payment fields" }, { status: 400 });

  // HMAC verify once for the whole basket.
  const origin = new URL(req.url).origin;
  let verified = false;
  try {
    const vr = await fetch(`${origin}/api/razorpay/verify`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ razorpay_order_id: rzpOrderId, razorpay_payment_id: paymentId, razorpay_signature: signature }),
    });
    verified = !!(await vr.json().catch(() => ({})))?.verified;
  } catch { return NextResponse.json({ ok: false, error: "Verification unreachable" }, { status: 502 }); }
  if (!verified) return NextResponse.json({ ok: false, error: "Payment signature mismatch" }, { status: 400 });

  const nowIso = new Date().toISOString();

  // Every pending trade on this order that belongs to the buyer.
  let trades: any[] = [];
  try {
    const tr = await fetch(`${SB_URL}/rest/v1/b2b_trades?razorpay_order_id=eq.${encodeURIComponent(rzpOrderId)}&buyer_user_id=in.(${idsCsv})&select=*`, { headers: SB_H });
    trades = tr.ok ? await tr.json().catch(() => []) : [];
  } catch { /* handled below */ }
  if (!Array.isArray(trades) || !trades.length) return NextResponse.json({ ok: false, error: "Couldn't confirm the basket — contact support." }, { status: 502 });

  let settled = 0;
  for (const t of trades) {
    // 1) mark completed (guarded + idempotent).
    let done = false;
    try {
      const r = await fetch(`${SB_URL}/rest/v1/b2b_trades?id=eq.${encodeURIComponent(String(t.id))}&status=eq.pending_payment&buyer_user_id=in.(${idsCsv})`, {
        method: "PATCH", headers: { ...SB_H, Prefer: "return=representation" },
        body: JSON.stringify({ status: "completed", razorpay_payment_id: paymentId, completed_at: nowIso, updated_at: nowIso }),
      });
      const rows = r.ok ? await r.json().catch(() => []) : [];
      done = Array.isArray(rows) && rows.length > 0;
    } catch { /* already processed */ }

    const buyerId = String(t.buyer_user_id);
    const sellerId = String(t.seller_user_id);
    const blockId = String(t.block_id);
    const source = String(t.source || "investor_block");

    // 2) ownership per source.
    if (source === "hotel_owner") {
      try {
        const br = await fetch(`${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(blockId)}&razorpay_order_id=eq.${encodeURIComponent(rzpOrderId)}&status=eq.pending_payment&investor_user_id=in.(${idsCsv})`, {
          method: "PATCH", headers: { ...SB_H, Prefer: "return=representation" },
          body: JSON.stringify({ status: "owned", razorpay_payment_id: paymentId, purchased_at: nowIso, updated_at: nowIso }),
        });
        let block = (br.ok ? await br.json().catch(() => []) : [])?.[0] || null;
        if (!block) {
          const gr = await fetch(`${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(blockId)}&status=eq.owned&investor_user_id=in.(${idsCsv})&select=*`, { headers: SB_H });
          block = (gr.ok ? await gr.json().catch(() => []) : [])?.[0] || null;
        }
        // v729/v734 — unit: stampUnitOwner + writeHold upsert (unchanged).
        // Classic: stampUnitOwner no-ops on empty id; writeHold ASSERTS the
        // pre-payment hold and returns needsOpsReview when it's missing.
        // Record the ops-review flag on the block metadata (best-effort).
        if (block) {
          await stampUnitOwner(block.unit_id ? String(block.unit_id) : "", buyerId, buyerIds);
          const holdResult = await writeHold(block);
          if (holdResult.needsOpsReview) {
            try {
              const meta = (block.metadata && typeof block.metadata === "object") ? block.metadata : {};
              await fetch(`${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(blockId)}`, {
                method: "PATCH", headers: { ...SB_H, Prefer: "return=minimal" },
                body: JSON.stringify({
                  metadata: {
                    ...meta,
                    holdLostAtVerify: true,
                    holdLostReason: holdResult.reason || "hold_missing",
                    needsOpsReview: true,
                    holdLostAt: nowIso,
                  },
                  updated_at: nowIso,
                }),
              });
            } catch { /* best-effort */ }
          }
        }
      } catch { /* already owned */ }
    } else {
      try {
        await fetch(`${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(blockId)}&investor_user_id=eq.${encodeURIComponent(sellerId)}`, {
          method: "PATCH", headers: { ...SB_H, Prefer: "return=minimal" }, body: JSON.stringify({ investor_user_id: buyerId, updated_at: nowIso }),
        });
      } catch { /* already transferred */ }
    }

    // 3) flip listing sold — ONLY for a fixed investor_block (its whole range is
    // gone). A hotel_owner listing is a RELEASED WINDOW that other buyers can
    // still buy other nights from, so it stays `listed` (v356).
    if (source !== "hotel_owner") {
      try {
        await fetch(`${SB_URL}/rest/v1/b2b_listings?id=eq.${encodeURIComponent(String(t.listing_id))}&status=eq.listed`, {
          method: "PATCH", headers: { ...SB_H, Prefer: "return=minimal" }, body: JSON.stringify({ status: "sold", updated_at: nowIso }),
        });
      } catch { /* already sold */ }
    }

    // 4) settlement (idempotent via uniq_settlement_kind_ref).
    try {
      await fetch(`${SB_URL}/rest/v1/settlement_ledger`, {
        method: "POST", headers: { ...SB_H, Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({
          id: genId("setl"), kind: "b2b_trade", ref_id: String(t.id), payee_user_id: sellerId,
          gross_amount: Number(t.buyer_pays) || Number(t.ask_total), platform_fee: Number(t.platform_fee),
          net_amount: Number(t.seller_net), payout_status: "owed",
          metadata: { blockId, listingId: String(t.listing_id), buyerId, basket: true, settledAt: nowIso },
        }),
      });
    } catch { /* best-effort */ }

    await grantModel2Service(String(t.hotel_id || ""), buyerId);
    if (done) settled++;
  }

  // v352 — activate any city-access rows paid for in this same basket order.
  let citiesUnlocked = 0;
  try {
    const cr = await fetch(
      `${SB_URL}/rest/v1/circle_city_access?razorpay_order_id=eq.${encodeURIComponent(rzpOrderId)}&status=eq.pending_payment&user_id=in.(${idsCsv})`,
      {
        method: "PATCH", headers: { ...SB_H, Prefer: "return=representation" },
        body: JSON.stringify({ status: "active", razorpay_payment_id: paymentId, activated_at: nowIso, updated_at: nowIso }),
      },
    );
    const rows = cr.ok ? await cr.json().catch(() => []) : [];
    citiesUnlocked = Array.isArray(rows) ? rows.length : 0;
  } catch { /* best-effort — the trade settlement already succeeded */ }

  return NextResponse.json({ ok: true, settled, total: trades.length, citiesUnlocked });
}
