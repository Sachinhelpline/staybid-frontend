// v329 — Circle Phase C3: customer buys a LISTED resale block (checkout).
//
// POST /api/circle/resale/[id]/checkout   { buyerName? }
//   Customer auth (sb_token). Loads a `listed`, future-dated block, computes the
//   resale total SERVER-SIDE (resale/night × nights — client NEVER sets ₹),
//   creates a Razorpay order for it, and writes an `inventory_sales` row
//   (`pending_payment`) freezing the settlement split (fee + investor net) via
//   the shared engine. The block stays `listed` until verify flips it `sold`
//   (guarded, so only the first paid customer wins). Verify is the sibling route.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_H_REPRESENT, genId } from "@/lib/sb-server";
import { userFromReq } from "@/lib/sb";
import { resaleMargin } from "@/lib/inventory/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { razorpayKeyId } from "@/lib/razorpay-server";

// Public checkout key id — server env only (hotfix v621.2, RAZORPAY_KEY_ID);
// the POST fails closed with payment_config_missing when absent/malformed.
const PUBLIC_KEY_ID = razorpayKeyId();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!PUBLIC_KEY_ID) return NextResponse.json({ error: "payment_config_missing" }, { status: 503 });
  const { id } = await ctx.params;
  const blockId = String(id || "").trim();
  if (!blockId) return NextResponse.json({ error: "id required" }, { status: 400 });

  const user = userFromReq(req);
  if (!user?.id) return NextResponse.json({ error: "Please sign in to reserve this stay." }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const buyerName = String(body?.buyerName || "").slice(0, 80).trim() || null;

  // Load the block — must be listed, priced, future-dated.
  let block: any = null;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(blockId)}&select=*`,
      { headers: SB_H },
    );
    const rows = r.ok ? await r.json().catch(() => []) : [];
    block = Array.isArray(rows) ? rows[0] : null;
  } catch { /* handled below */ }

  if (!block) return NextResponse.json({ error: "This offer is no longer available." }, { status: 404 });
  if (String(block.status) !== "listed") {
    return NextResponse.json({ error: "This stay was just reserved by someone else." }, { status: 409 });
  }
  const today = new Date().toISOString().slice(0, 10);
  if (String(block.date_to) <= today) {
    return NextResponse.json({ error: "These nights have already passed." }, { status: 409 });
  }

  const nights = Number(block.nights) || 0;
  const perNight = Math.round(Number(block.resale_price_per_night) || 0);
  if (nights <= 0 || perNight <= 0) {
    return NextResponse.json({ error: "This offer isn't priced correctly — try another." }, { status: 422 });
  }
  const feePct = Number(block.platform_fee_pct);
  const buyPerNight = Number(block.buy_price_per_night) || 0;
  const split = resaleMargin({ resalePerNight: perNight, buyPerNight, nights, feePct });
  const resaleTotal = split.resaleTotal;
  if (resaleTotal <= 0) {
    return NextResponse.json({ error: "This offer isn't priced correctly — try another." }, { status: 422 });
  }

  // Razorpay order for the resale total (amount in rupees; route → paise).
  const origin = new URL(req.url).origin;
  let rzp: any = null;
  try {
    const orderRes = await fetch(`${origin}/api/razorpay/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: resaleTotal,
        receipt: `cres_${blockId}`.slice(0, 40),
        notes: { kind: "circle_resale", blockId, buyerId: String(user.id) },
      }),
    });
    rzp = await orderRes.json().catch(() => ({}));
    if (!orderRes.ok || !rzp?.id) {
      return NextResponse.json(
        { error: rzp?.error || "Could not start payment.", detail: rzp?.code || null },
        { status: 502 },
      );
    }
  } catch {
    return NextResponse.json({ error: "Payment gateway unreachable." }, { status: 502 });
  }

  // Write the settlement ledger row (pending). Frozen split; matched on
  // razorpay_order_id at verify time.
  const saleId = genId("invs");
  try {
    const res = await fetch(`${SB_URL}/rest/v1/inventory_sales`, {
      method: "POST",
      headers: SB_H_REPRESENT,
      body: JSON.stringify({
        id: saleId,
        block_id: blockId,
        hotel_id: String(block.hotel_id),
        unit_id: String(block.unit_id),
        room_id: String(block.room_id),
        investor_user_id: String(block.investor_user_id),
        buyer_user_id: String(user.id),
        buyer_name: buyerName,
        buyer_phone: user.phone ? String(user.phone) : null,
        date_from: String(block.date_from),
        date_to: String(block.date_to),
        nights,
        resale_per_night: perNight,
        resale_total: resaleTotal,
        buy_total: split.buyTotal,
        platform_fee_pct: split.feePct,
        platform_fee: split.feeTotal,
        investor_net: split.investorNet,
        razorpay_order_id: rzp.id,
        status: "pending_payment",
        payout_status: "owed",
        metadata: { checkoutAt: new Date().toISOString() },
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: "Could not start reservation.", detail: err.slice(0, 160) }, { status: 500 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Checkout failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    keyId: PUBLIC_KEY_ID,
    order: { id: rzp.id, amount: rzp.amount, currency: rzp.currency || "INR" },
    saleId,
    resaleTotal,
  });
}
