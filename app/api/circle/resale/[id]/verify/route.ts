// v329 — Circle Phase C3: customer resale verify + SETTLEMENT.
//
// POST /api/circle/resale/[id]/verify
//   Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
//   HMAC-verifies (shared /api/razorpay/verify), then:
//     1) flips the block `listed → sold` (guarded status=eq.listed → anti-
//        double-sell + idempotent), stamping sold_at;
//     2) marks the `inventory_sales` row `paid` (matched on order + block +
//        buyer), stamping payment id + paid_at (settlement frozen at checkout);
//     3) leaves the pre-buy `room_blocks` HOLD in place — the room is now
//        legitimately occupied by the resale guest (note refreshed to "sold").
//   The resale total sits in StayBid's account; `investor_net` (payout_status
//   'owed') records what StayBid owes the investor — payout execution is C4.
//
// Auth: customer sb_token (must match the buyer on the sale row).

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H } from "@/lib/sb-server";
import { userFromReq } from "@/lib/sb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const blockId = String(id || "").trim();
  if (!blockId) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const user = userFromReq(req);
  if (!user?.id) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const rzpOrderId = String(body?.razorpay_order_id || "").trim();
  const paymentId = String(body?.razorpay_payment_id || "").trim();
  const signature = String(body?.razorpay_signature || "").trim();
  if (!rzpOrderId || !paymentId || !signature) {
    return NextResponse.json({ ok: false, error: "Missing payment fields" }, { status: 400 });
  }

  // HMAC verify.
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

  // 2) Mark the sale row paid — matched on order + block + buyer + pending.
  //    (Done first so even if the block-flip races, the ledger reflects payment.)
  let sale: any = null;
  try {
    const sr = await fetch(
      `${SB_URL}/rest/v1/inventory_sales?razorpay_order_id=eq.${encodeURIComponent(rzpOrderId)}` +
        `&block_id=eq.${encodeURIComponent(blockId)}` +
        `&buyer_user_id=eq.${encodeURIComponent(String(user.id))}&status=eq.pending_payment`,
      {
        method: "PATCH",
        headers: { ...SB_H, Prefer: "return=representation" },
        body: JSON.stringify({ status: "paid", razorpay_payment_id: paymentId, paid_at: nowIso, updated_at: nowIso }),
      },
    );
    const rows = sr.ok ? await sr.json().catch(() => []) : [];
    sale = Array.isArray(rows) ? rows[0] : null;
    if (!sale) {
      // Already processed (re-verify) — look up the paid row for the summary.
      const gr = await fetch(
        `${SB_URL}/rest/v1/inventory_sales?razorpay_order_id=eq.${encodeURIComponent(rzpOrderId)}` +
          `&block_id=eq.${encodeURIComponent(blockId)}&status=eq.paid&select=*`,
        { headers: SB_H },
      );
      sale = (gr.ok ? await gr.json().catch(() => []) : [])?.[0] || null;
    }
  } catch { /* fall through */ }

  // 1) Flip the block listed → sold (anti-double-sell; idempotent).
  let blockSold = false;
  try {
    const br = await fetch(
      `${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(blockId)}&status=eq.listed`,
      {
        method: "PATCH",
        headers: { ...SB_H, Prefer: "return=representation" },
        body: JSON.stringify({ status: "sold", sold_at: nowIso, updated_at: nowIso }),
      },
    );
    const rows = br.ok ? await br.json().catch(() => []) : [];
    blockSold = Array.isArray(rows) && rows.length > 0;
  } catch { /* block may already be sold on a re-verify */ }

  // 3) Refresh the pre-buy hold note so ops see it's now a paid resale guest.
  //    Best-effort — a hold hiccup must not fail a verified payment.
  try {
    await fetch(`${SB_URL}/rest/v1/room_blocks?id=eq.${encodeURIComponent(`invhold_${blockId}`)}`, {
      method: "PATCH",
      headers: { ...SB_H, Prefer: "return=minimal" },
      body: JSON.stringify({
        note: `StayBid Circle resale — sold${sale?.buyer_name ? ` to ${sale.buyer_name}` : ""}`,
      }),
    });
  } catch { /* optional */ }

  if (!sale && !blockSold) {
    return NextResponse.json({ ok: false, error: "Couldn't confirm reservation — contact support." }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    blockSold,
    sale: sale
      ? {
          id: sale.id,
          dateFrom: sale.date_from,
          dateTo: sale.date_to,
          nights: sale.nights,
          resaleTotal: Number(sale.resale_total),
        }
      : null,
  });
}
