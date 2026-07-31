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
import { resolveB2bFeeConfig } from "@/lib/b2b/fee-config-store";
import { hasCityAccess, normalizeCity, cityAccessId } from "@/lib/circle/city-access";
import { assignFreeUnit } from "@/lib/inventory/assign";
import { quoteInventoryBlock } from "@/lib/inventory/quote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public LIVE key id (safe in client code) — same source as every checkout.
import { checkoutKeyId } from "@/lib/razorpay-server";

// Public checkout key id — present ONLY when the COMPLETE server env pair
// (RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET) is configured (hotfix v621.2); the
// POST fails closed with payment_config_missing BEFORE any body parse / DB /
// order work when either half is absent or malformed.
const PUBLIC_KEY_ID = checkoutKeyId();

function auth(req: NextRequest): { userId?: string; phone?: string; email?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub, phone: p?.phone, email: p?.email };
}

const todayISO = () => new Date().toISOString().slice(0, 10);

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!PUBLIC_KEY_ID) return NextResponse.json({ error: "payment_config_missing" }, { status: 503 });
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

  // v352 — Model 2 city access: NO pre-activation block. If the buyer hasn't
  // unlocked the listing's city, the one-time access fee is ADDED to this
  // payment and the city activates on verify (lifetime). No blocking.
  let cityToUnlock = "";
  let cityFee = 0;
  try {
    const hr = await fetch(
      `${SB_URL}/rest/v1/hotels?id=eq.${encodeURIComponent(String(listing.hotel_id))}&select=city`,
      { headers: SB_H },
    );
    const city = normalizeCity(((hr.ok ? await hr.json().catch(() => []) : [])?.[0]?.city) || "");
    if (city && !(await hasCityAccess(buyerIds, city))) {
      const cfg = await resolveB2bFeeConfig();
      cityToUnlock = city;
      cityFee = cfg.cityAccessPrice;
    }
  } catch { /* fail open — never block a real buyer on a lookup hiccup */ }

  const isHotelOwner = String(listing.source) === "hotel_owner";

  // Integrity (investor_block path only): the underlying block must STILL be
  // owned by the seller. If the seller resold/expired/refunded it since listing,
  // the listing is stale. A hotel_owner listing has NO pre-bought block
  // (block_id is NULL) — a free unit + a fresh buyer block are minted below.
  if (!isHotelOwner) {
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
  }

  // Re-compute the split SERVER-SIDE from the listing's FROZEN dual fee % +
  // buy basis (tamper-safe). The buyer is charged ask + buyer fee; the seller
  // receives ask − seller fee; StayBid keeps both fees.
  const split = b2bTradeSplit({
    askPerNight: Number(listing.ask_per_night),
    nights: Number(listing.nights),
    buyerFeePct: Number(listing.buyer_fee_pct),
    sellerFeePct: Number(listing.seller_fee_pct),
    buyTotal: Number(listing.buy_total),
  });
  if (split.askTotal <= 0 || split.buyerPays <= 0) {
    return NextResponse.json({ error: "This offer isn't priced correctly — try another." }, { status: 422 });
  }

  // ── M4 hotel_owner SUPPLY: the buyer owns nothing yet, so auto-assign a free
  //    physical unit AND freeze the buyer's block cost basis at the Spine
  //    wholesale floor (the SAME basis an M1/M3 pre-buy records; a D2 transfer
  //    also keeps the original investor's basis — the ask flows to the seller
  //    via the trade + settlement ledger, not the block). investor_block keeps
  //    the listing's existing unit and transfers the block at verify.
  const lFrom = String(listing.date_from).slice(0, 10);
  const lTo = String(listing.date_to).slice(0, 10);
  let assignedUnitId: string | null = listing.unit_id ? String(listing.unit_id) : null;
  let buyerBlockBuyTotal = 0;
  let buyerBlockBuyPerNight = 0;
  let buyerBlockResalePerNight = 0;
  let buyerRoomNumber: string | null = null;
  if (isHotelOwner) {
    const freeUnit = await assignFreeUnit({
      hotelId: String(listing.hotel_id),
      roomId: String(listing.room_id),
      from: lFrom,
      to: lTo,
      buyerIds,
    });
    if (!freeUnit) {
      return NextResponse.json(
        { error: "No rooms free for these nights — try another offer." },
        { status: 409 },
      );
    }
    assignedUnitId = freeUnit.unitId;
    buyerRoomNumber = freeUnit.roomNumber;

    const quote = await quoteInventoryBlock({ roomId: String(listing.room_id), from: lFrom, to: lTo });
    buyerBlockBuyTotal = quote && quote.buyTotal > 0 ? quote.buyTotal : Number(split.buyTotal) || 0;
    buyerBlockBuyPerNight = split.nights > 0 ? Math.round(buyerBlockBuyTotal / split.nights) : buyerBlockBuyTotal;
    buyerBlockResalePerNight = quote?.avgResalePerNight || 0;
  }

  // Razorpay order for the BUYER CHARGE = ask + buyer fee (rupees; route → paise).
  const origin = new URL(req.url).origin;
  let rzp: any = null;
  try {
    const orderRes = await fetch(`${origin}/api/razorpay/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: split.buyerPays + cityFee,
        receipt: `cb2b_${listingId}`.slice(0, 40),
        notes: { kind: "circle_b2b", listingId, source: String(listing.source || "investor_block"), buyerId: String(userId), cityFee: String(cityFee) },
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

  // v352 — if this city needs unlocking, mint a pending city-access row on the
  // same order (activates on verify with this one payment; lifetime).
  if (cityToUnlock && cityFee > 0) {
    await fetch(`${SB_URL}/rest/v1/circle_city_access?on_conflict=id`, {
      method: "POST", headers: { ...SB_H, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        id: cityAccessId(String(userId), cityToUnlock), user_id: String(userId), city: cityToUnlock,
        status: "pending_payment", amount: cityFee, razorpay_order_id: rzp.id,
        updated_at: new Date().toISOString(),
      }),
    }).catch(() => {});
  }

  // ── M4 hotel_owner: mint a NEW buyer pending_payment inventory_block (the
  //    buyer owns nothing yet — mirror the M1 marketplace checkout), then a
  //    self-excluding overlap re-guard drops the orphan on a concurrent race.
  //    investor_block keeps the seller's existing block (transferred at verify).
  let tradeBlockId: string | null = isHotelOwner ? null : String(listing.block_id);
  if (isHotelOwner) {
    const newBlockId = genId("inv");
    try {
      const res = await fetch(`${SB_URL}/rest/v1/inventory_blocks`, {
        method: "POST",
        headers: SB_H_REPRESENT,
        body: JSON.stringify({
          id: newBlockId,
          investor_user_id: String(userId),
          hotel_id: String(listing.hotel_id),
          unit_id: assignedUnitId,
          room_id: String(listing.room_id),
          date_from: lFrom,
          date_to: lTo,
          nights: split.nights,
          buy_price_per_night: buyerBlockBuyPerNight,
          buy_total: buyerBlockBuyTotal,
          resale_price_per_night: buyerBlockResalePerNight,
          platform_fee_pct: split.platformFeePct,
          status: "pending_payment",
          razorpay_order_id: rzp.id,
          metadata: {
            source: "circle_b2b_hotel_owner",
            listingId,
            roomNumber: buyerRoomNumber,
            checkoutAt: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        }),
      });
      const rows = res.ok ? await res.json().catch(() => []) : [];
      if (!Array.isArray(rows) || !rows.length) {
        const err = await res.text().catch(() => "");
        return NextResponse.json({ error: "Could not start the trade.", detail: err.slice(0, 160) }, { status: 500 });
      }
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || "Checkout failed" }, { status: 500 });
    }

    // Self-excluding overlap re-guard — a DIFFERENT non-terminal block may have
    // grabbed the same unit/nights in the race window. Drop our orphan + 409.
    try {
      const clashRes = await fetch(
        `${SB_URL}/rest/v1/inventory_blocks?unit_id=eq.${encodeURIComponent(String(assignedUnitId))}` +
          `&id=neq.${encodeURIComponent(newBlockId)}` +
          `&status=not.in.(expired,cancelled,refunded)` +
          `&date_from=lt.${lTo}&date_to=gt.${lFrom}&select=id&limit=1`,
        { headers: SB_H },
      );
      const clash = clashRes.ok ? await clashRes.json().catch(() => []) : [];
      if (Array.isArray(clash) && clash.length) {
        await fetch(
          `${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(newBlockId)}&status=eq.pending_payment`,
          { method: "DELETE", headers: SB_H },
        ).catch(() => {});
        return NextResponse.json(
          { error: "These nights were just taken — try another offer." },
          { status: 409 },
        );
      }
    } catch { /* non-fatal — verify + hold write is the final integrity gate */ }

    tradeBlockId = newBlockId;
  }

  // Write the trade row (pending). Frozen split; matched on razorpay_order_id
  // at verify time. Buyer id = the caller's PRIMARY jwt id. block_id is the
  // seller's block (investor_block, transferred at verify) OR the fresh buyer
  // block just minted (hotel_owner). source carries the branch to verify.
  const tradeId = genId("b2bt");
  try {
    const res = await fetch(`${SB_URL}/rest/v1/b2b_trades`, {
      method: "POST",
      headers: SB_H_REPRESENT,
      body: JSON.stringify({
        id: tradeId,
        listing_id: listingId,
        block_id: tradeBlockId,
        seller_user_id: String(listing.seller_user_id),
        buyer_user_id: String(userId),
        hotel_id: String(listing.hotel_id),
        unit_id: assignedUnitId,
        room_id: String(listing.room_id),
        date_from: lFrom,
        date_to: lTo,
        nights: split.nights,
        ask_total: split.askTotal,
        platform_fee_pct: split.platformFeePct,   // total (buyer + seller)
        platform_fee: split.platformFee,          // buyerFee + sellerFee
        buyer_fee_pct: split.buyerFeePct,
        seller_fee_pct: split.sellerFeePct,
        buyer_fee: split.buyerFee,
        seller_fee: split.sellerFee,
        buyer_pays: split.buyerPays,              // what the buyer is charged
        seller_net: split.sellerNet,
        razorpay_order_id: rzp.id,
        status: "pending_payment",
        source: String(listing.source || "investor_block"),
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
    blockId: tradeBlockId,
    askTotal: split.askTotal,
    buyerPays: split.buyerPays,
    cityFee,
    cityToUnlock: cityToUnlock || null,
  });
}
