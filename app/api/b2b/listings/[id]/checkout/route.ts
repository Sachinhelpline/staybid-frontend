// v332 — Circle Phase D2: Model 4 B2B exchange TRADE checkout.
//
// POST /api/b2b/listings/[id]/checkout   (id = the b2b_listings.id)
//   Buyer auth (partner Bearer JWT → cross-pool ids). Loads a `listed` B2B
//   listing + its still-seller-owned `owned` block, rejects buying your own
//   listing, re-computes the trade split SERVER-SIDE via the shared engine
//   (client NEVER sets ₹), creates a Razorpay order for the ask total, and
//   writes a `b2b_trades` row (`pending_payment`) freezing the split
//   (platform fee + seller net). Verify (→ ownership transfer + settlement) is
//   the sibling route. The listing stays `listed` until verify flips it `sold`
//   (guarded, so only the first paid buyer wins).
//
// Buyer becomes the new `investor_user_id` of the block — they buy the
// COMMERCIAL RIGHT over the date-range, not the physical unit. B2B-only.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_H_REPRESENT, decodeJwt, genId } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { b2bTradeSplit } from "@/lib/b2b/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public LIVE key id (safe in client code) — same source as every checkout.
const PUBLIC_KEY_ID = "rzp_live_SfFAsbYjbHfztd";

function auth(req: NextRequest): { userId?: string; phone?: string; email?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub, phone: p?.phone, email: p?.email };
}

const todayISO = () => new Date().toISOString().slice(0, 10);

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const listingId = String(id || "").trim();
  if (!listingId) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { userId, phone, email } = auth(req);
  if (!userId) return NextResponse.json({ error: "Please sign in to buy on the exchange." }, { status: 401 });

  const buyerIds = await resolveOwnerIdsCrossPool(userId, phone, email);
  if (!buyerIds.length) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const isBuyer = (v: any) => buyerIds.map(String).includes(String(v));

  // Load the listing — must be live on the exchange.
  let listing: any = null;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/b2b_listings?id=eq.${encodeURIComponent(listingId)}&select=*`,
      { headers: SB_H },
    );
    const rows = r.ok ? await r.json().catch(() => []) : [];
    listing = Array.isArray(rows) ? rows[0] : null;
  } catch { /* handled below */ }

  if (!listing) return NextResponse.json({ error: "This exchange offer is no longer available." }, { status: 404 });
  if (String(listing.status) !== "listed") {
    return NextResponse.json({ error: "This block was just traded by someone else." }, { status: 409 });
  }
  // Can't buy your own listing.
  if (isBuyer(listing.seller_user_id)) {
    return NextResponse.json({ error: "This is your own listing — withdraw it instead." }, { status: 409 });
  }
  // Can't buy a block whose dates have already passed.
  if (String(listing.date_to).slice(0, 10) <= todayISO()) {
    return NextResponse.json({ error: "These nights have already passed." }, { status: 409 });
  }

  // Integrity: the underlying block must STILL be owned by the seller. If the
  // seller resold/expired/refunded it since listing, the listing is stale.
  let block: any = null;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(String(listing.block_id))}&select=id,investor_user_id,status`,
      { headers: SB_H },
    );
    const rows = r.ok ? await r.json().catch(() => []) : [];
    block = Array.isArray(rows) ? rows[0] : null;
  } catch { /* handled below */ }

  if (!block || String(block.status) !== "owned" ||
      String(block.investor_user_id) !== String(listing.seller_user_id)) {
    return NextResponse.json({ error: "This block is no longer available to trade." }, { status: 409 });
  }

  // Re-compute the split SERVER-SIDE — the buyer pays the seller's ask; the
  // platform fee % was frozen at list time (tamper-safe).
  const split = b2bTradeSplit({
    askPerNight: Number(listing.ask_per_night),
    nights: Number(listing.nights),
    feePct: Number(listing.platform_fee_pct),
    buyTotal: Number(listing.buy_total),
  });
  if (split.askTotal <= 0) {
    return NextResponse.json({ error: "This offer isn't priced correctly — try another." }, { status: 422 });
  }

  // Razorpay order for the ask total (amount in rupees; route → paise).
  const origin = new URL(req.url).origin;
  let rzp: any = null;
  try {
    const orderRes = await fetch(`${origin}/api/razorpay/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: split.askTotal,
        receipt: `cb2b_${listingId}`.slice(0, 40),
        notes: { kind: "circle_b2b", listingId, blockId: String(listing.block_id), buyerId: String(userId) },
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

  // Write the trade row (pending). Frozen split; matched on razorpay_order_id
  // at verify time. Buyer id = the caller's PRIMARY jwt id (the block will be
  // transferred to it; their cross-pool set always includes it).
  const tradeId = genId("b2bt");
  try {
    const res = await fetch(`${SB_URL}/rest/v1/b2b_trades`, {
      method: "POST",
      headers: SB_H_REPRESENT,
      body: JSON.stringify({
        id: tradeId,
        listing_id: listingId,
        block_id: String(listing.block_id),
        seller_user_id: String(listing.seller_user_id),
        buyer_user_id: String(userId),
        hotel_id: String(listing.hotel_id),
        unit_id: String(listing.unit_id),
        room_id: String(listing.room_id),
        date_from: String(listing.date_from),
        date_to: String(listing.date_to),
        nights: split.nights,
        ask_total: split.askTotal,
        platform_fee_pct: split.platformFeePct,
        platform_fee: split.platformFee,
        seller_net: split.sellerNet,
        razorpay_order_id: rzp.id,
        status: "pending_payment",
        metadata: { checkoutAt: new Date().toISOString(), buyPhone: phone || null },
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: "Could not start the trade.", detail: err.slice(0, 160) }, { status: 500 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Checkout failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    keyId: PUBLIC_KEY_ID,
    order: { id: rzp.id, amount: rzp.amount, currency: rzp.currency || "INR" },
    tradeId,
    askTotal: split.askTotal,
  });
}
