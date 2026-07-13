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

  // 2) TRANSFER ownership — seller → buyer. Guarded on the seller id so a
  //    re-verify / race is a no-op (0 rows). Only the block's commercial right
  //    moves; the physical unit's owner_user_id is untouched.
  let transferred = false;
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
        gross_amount: Number(trade.ask_total),
        platform_fee: Number(trade.platform_fee),
        net_amount: Number(trade.seller_net),
        payout_status: "owed",
        metadata: { blockId, listingId, buyerId, settledAt: nowIso },
      }),
    });
  } catch { /* best-effort — the trade row already records the obligation */ }

  // 5) Refresh the pre-buy hold note so ops see the new owner (best-effort).
  try {
    await fetch(`${SB_URL}/rest/v1/room_blocks?id=eq.${encodeURIComponent(`invhold_${blockId}`)}`, {
      method: "PATCH",
      headers: { ...SB_H, Prefer: "return=minimal" },
      body: JSON.stringify({ note: "StayBid Circle pre-buy hold · traded (new owner)", createdBy: buyerId }),
    });
  } catch { /* optional */ }

  return NextResponse.json({
    ok: true,
    transferred,
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
