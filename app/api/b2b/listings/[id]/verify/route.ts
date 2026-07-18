// v332 — Circle Phase D2: Model 4 B2B trade verify + OWNERSHIP TRANSFER + settlement.
//
// POST /api/b2b/listings/[id]/verify   (id = the b2b_listings.id)
//   Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
//   HMAC-verifies (shared /api/razorpay/verify), then:
//     1) marks the `b2b_trades` row `completed` (matched on order + listing +
//        buyer + status=eq.pending_payment → anti-tamper + idempotent; the
//        uniq_b2b_trade_listing_completed index keeps it one-per-listing);
//     2) TRANSFERS ownership — PATCH inventory_blocks.investor_user_id
//        seller → buyer, guarded on investor_user_id=eq.seller (so a re-verify
//        or race is a no-op). Only the COMMERCIAL right transfers; the physical
//        `hotel_room_units.owner_user_id` is untouched;
//     3) flips the listing `listed → sold` (guarded status=eq.listed);
//     4) writes a `settlement_ledger` row (kind='b2b_trade', payee=seller,
//        net=seller_net, payout_status='owed') — idempotent via the
//        uniq_settlement_kind_ref (kind, ref_id) index;
//     5) best-effort refreshes the pre-buy `room_blocks` hold note.
//   StayBid holds the ask total; `seller_net` (owed) records what StayBid owes
//   the seller — payout execution is D4.
//
// Auth: buyer partner Bearer JWT → cross-pool ids (must match the trade buyer).

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, decodeJwt, genId } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function auth(req: NextRequest): { userId?: string; phone?: string; email?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub, phone: p?.phone, email: p?.email };
}

// Best-effort grant of the circle_model4 marker service to the operated hotel
// for the exchange BUYER (they now hold the block's commercial right). Additive
// future-proof marker (mirrors M1's grantModel3Service); real dashboard access is
// the block's investor_user_id transfer + owner_user_id unit-stamp. Must never
// break verify — the trade is already completed by the time this runs.
async function grantModel4Service(hotelId: string, grantedBy: string): Promise<void> {
  if (!hotelId) return;
  try {
    await fetch(`${SB_URL}/rest/v1/hotel_services?on_conflict=hotel_id,service_key`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        id: genId("svc"),
        hotel_id: hotelId,
        service_key: "circle_model2",
        status: "active",
        access_type: "free",
        granted_by: grantedBy,
        note: "Circle Model-2 inventory investor (exchange)",
        updated_at: new Date().toISOString(),
      }),
    });
  } catch { /* best-effort */ }
}

// ── M4 hotel_owner supply helpers (mirror the M1 marketplace verify) ──────────
// Stamp the assigned physical unit to the buyer — only if still unowned OR
// already the buyer's (idempotent + race-safe). Never takes a co-investor's unit.
async function stampUnitOwner(unitId: string, buyerPrimary: string, buyerIds: string[]): Promise<boolean> {
  if (!unitId) return false;
  try {
    const idsCsv = buyerIds.map((x) => encodeURIComponent(x)).join(",");
    const res = await fetch(
      `${SB_URL}/rest/v1/hotel_room_units?id=eq.${encodeURIComponent(unitId)}` +
        `&or=(owner_user_id.is.null,owner_user_id.in.(${idsCsv}))`,
      {
        method: "PATCH",
        headers: { ...SB_H, Prefer: "return=minimal" },
        body: JSON.stringify({ owner_user_id: buyerPrimary }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

// Write (or refresh) the room-nights HOLD so availability subtracts them.
// Deterministic invhold_<blockId> id → idempotent on re-verify. Best-effort:
// a hold hiccup must NOT fail a succeeded payment.
async function writeHold(block: any): Promise<boolean> {
  try {
    let unitNumber: string | null = block?.metadata?.roomNumber || null;
    if (!unitNumber && block?.unit_id) {
      try {
        const ur = await fetch(
          `${SB_URL}/rest/v1/hotel_room_units?id=eq.${encodeURIComponent(String(block.unit_id))}&select=roomNumber`,
          { headers: SB_H },
        );
        unitNumber = (await ur.json().catch(() => []))?.[0]?.roomNumber || null;
      } catch { /* optional */ }
    }
    const res = await fetch(`${SB_URL}/rest/v1/room_blocks?on_conflict=id`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        id: `invhold_${block.id}`,
        hotelId: String(block.hotel_id),
        roomId: String(block.room_id),
        fromDate: String(block.date_from),
        toDate: String(block.date_to),
        source: "inventory",
        assignedUnitId: String(block.unit_id),
        assignedUnitNumber: unitNumber,
        note: "StayBid Circle B2B pre-buy hold",
        createdBy: String(block.investor_user_id),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const listingId = String(id || "").trim();
  if (!listingId) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

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
  if (!rzpOrderId || !paymentId || !signature) {
    return NextResponse.json({ ok: false, error: "Missing payment fields" }, { status: 400 });
  }

  // HMAC verify the payment.
  const origin = new URL(req.url).origin;
  let verified = false;
  try {
    const vr = await fetch(`${origin}/api/razorpay/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ razorpay_order_id: rzpOrderId, razorpay_payment_id: paymentId, razorpay_signature: signature }),
    });
    verified = !!(await vr.json().catch(() => ({})))?.verified;
  } catch {
    return NextResponse.json({ ok: false, error: "Verification unreachable" }, { status: 502 });
  }
  if (!verified) return NextResponse.json({ ok: false, error: "Payment signature mismatch" }, { status: 400 });

  const nowIso = new Date().toISOString();

  // 1) Mark the trade completed — matched on order + listing + buyer + pending.
  //    Done first so even if the transfer races, the ledger reflects payment.
  let trade: any = null;
  try {
    const tr = await fetch(
      `${SB_URL}/rest/v1/b2b_trades?razorpay_order_id=eq.${encodeURIComponent(rzpOrderId)}` +
        `&listing_id=eq.${encodeURIComponent(listingId)}` +
        `&buyer_user_id=in.(${idsCsv})&status=eq.pending_payment`,
      {
        method: "PATCH",
        headers: { ...SB_H, Prefer: "return=representation" },
        body: JSON.stringify({ status: "completed", razorpay_payment_id: paymentId, completed_at: nowIso, updated_at: nowIso }),
      },
    );
    const rows = tr.ok ? await tr.json().catch(() => []) : [];
    trade = Array.isArray(rows) ? rows[0] : null;
    if (!trade) {
      // Already processed (re-verify) — look up the completed row for the summary.
      const gr = await fetch(
        `${SB_URL}/rest/v1/b2b_trades?razorpay_order_id=eq.${encodeURIComponent(rzpOrderId)}` +
          `&listing_id=eq.${encodeURIComponent(listingId)}&status=eq.completed&select=*`,
        { headers: SB_H },
      );
      trade = (gr.ok ? await gr.json().catch(() => []) : [])?.[0] || null;
    }
  } catch { /* fall through */ }

  if (!trade) {
    return NextResponse.json({ ok: false, error: "Couldn't confirm the trade — contact support." }, { status: 502 });
  }

  const buyerId = String(trade.buyer_user_id);
  const sellerId = String(trade.seller_user_id);
  const blockId = String(trade.block_id);
  const source = String(trade.source || "investor_block");

  // 2) OWNERSHIP — branch on the trade source.
  //    • investor_block: transfer the seller's owned block commercial right →
  //      buyer (guarded on the seller id so a re-verify/race is a no-op). Only
  //      the commercial right moves; the physical unit owner is untouched.
  //    • hotel_owner (M4): the buyer's OWN fresh block was minted pending at
  //      checkout; flip it pending_payment → owned (4-key idempotent), STAMP the
  //      assigned unit owner = buyer, and write the inventory hold — exactly the
  //      M1 marketplace verify. There is no seller block to move.
  let transferred = false;
  let stamped = false;
  let held = false;
  if (source === "hotel_owner") {
    try {
      const br = await fetch(
        `${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(blockId)}` +
          `&razorpay_order_id=eq.${encodeURIComponent(rzpOrderId)}` +
          `&status=eq.pending_payment&investor_user_id=in.(${idsCsv})`,
        {
          method: "PATCH",
          headers: { ...SB_H, Prefer: "return=representation" },
          body: JSON.stringify({
            status: "owned",
            razorpay_payment_id: paymentId,
            purchased_at: nowIso,
            updated_at: nowIso,
          }),
        },
      );
      const rows = br.ok ? await br.json().catch(() => []) : [];
      let block = Array.isArray(rows) ? rows[0] : null;
      if (block) {
        transferred = true;
      } else {
        // Already flipped on a re-verify — re-fetch the owned block for stamp/hold.
        const gr = await fetch(
          `${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(blockId)}` +
            `&status=eq.owned&investor_user_id=in.(${idsCsv})&select=*`,
          { headers: SB_H },
        );
        block = (gr.ok ? await gr.json().catch(() => []) : [])?.[0] || null;
      }
      if (block) {
        stamped = await stampUnitOwner(String(block.unit_id), buyerId, buyerIds);
        held = await writeHold(block);
      }
    } catch { /* block may already be owned on a re-verify */ }
  } else {
    try {
      const br = await fetch(
        `${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(blockId)}` +
          `&investor_user_id=eq.${encodeURIComponent(sellerId)}`,
        {
          method: "PATCH",
          headers: { ...SB_H, Prefer: "return=representation" },
          body: JSON.stringify({ investor_user_id: buyerId, updated_at: nowIso }),
        },
      );
      const rows = br.ok ? await br.json().catch(() => []) : [];
      transferred = Array.isArray(rows) && rows.length > 0;
    } catch { /* block may already be transferred on a re-verify */ }
  }

  // 3) Flip the listing listed → sold (guarded; idempotent on re-verify).
  try {
    await fetch(
      `${SB_URL}/rest/v1/b2b_listings?id=eq.${encodeURIComponent(listingId)}&status=eq.listed`,
      {
        method: "PATCH",
        headers: { ...SB_H, Prefer: "return=minimal" },
        body: JSON.stringify({ status: "sold", updated_at: nowIso }),
      },
    );
  } catch { /* listing may already be sold on a re-verify */ }

  // 4) Settlement ledger — StayBid owes the seller their net. Idempotent via
  //    the uniq_settlement_kind_ref (kind, ref_id) index.
  try {
    await fetch(`${SB_URL}/rest/v1/settlement_ledger`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({
        id: genId("setl"),
        kind: "b2b_trade",
        ref_id: String(trade.id),
        payee_user_id: sellerId,
        // Gross = what StayBid actually collected from the buyer (ask + buyer
        // fee). platform_fee = buyer + seller fee. Seller is owed seller_net.
        gross_amount: Number(trade.buyer_pays) || Number(trade.ask_total),
        platform_fee: Number(trade.platform_fee),
        net_amount: Number(trade.seller_net),
        payout_status: "owed",
        metadata: { blockId, listingId, buyerId, settledAt: nowIso },
      }),
    });
  } catch { /* best-effort — the trade row already records the obligation */ }

  // 4b) Grant the circle_model4 marker service to the buyer's operated hotel
  //     (fires for both fresh-completed + re-verify, since both converge here).
  await grantModel4Service(String(trade.hotel_id || ""), buyerId);

  // 5) investor_block: refresh the transferred block's existing hold note so ops
  //    see the new owner (best-effort). hotel_owner already wrote a fresh hold
  //    (writeHold above) — nothing to relabel.
  if (source !== "hotel_owner") {
    try {
      await fetch(`${SB_URL}/rest/v1/room_blocks?id=eq.${encodeURIComponent(`invhold_${blockId}`)}`, {
        method: "PATCH",
        headers: { ...SB_H, Prefer: "return=minimal" },
        body: JSON.stringify({ note: "StayBid Circle pre-buy hold · traded (new owner)", createdBy: buyerId }),
      });
    } catch { /* optional */ }
  }

  // 6) v352 — activate any city-access row paid for on this same order (lifetime).
  try {
    await fetch(
      `${SB_URL}/rest/v1/circle_city_access?razorpay_order_id=eq.${encodeURIComponent(rzpOrderId)}&status=eq.pending_payment&user_id=in.(${idsCsv})`,
      {
        method: "PATCH", headers: { ...SB_H, Prefer: "return=minimal" },
        body: JSON.stringify({ status: "active", razorpay_payment_id: paymentId, activated_at: nowIso, updated_at: nowIso }),
      },
    );
  } catch { /* best-effort — the trade already settled */ }

  return NextResponse.json({
    ok: true,
    transferred,
    stamped,
    held,
    trade: {
      id: trade.id,
      dateFrom: trade.date_from,
      dateTo: trade.date_to,
      nights: trade.nights,
      askTotal: Number(trade.ask_total),
      sellerNet: Number(trade.seller_net),
    },
  });
}
