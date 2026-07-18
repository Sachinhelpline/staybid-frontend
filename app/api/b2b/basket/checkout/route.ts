// v350 — Circle Model 2: MULTI-SELECT BASKET checkout (multi-city bundle).
//
// POST /api/b2b/basket/checkout   { listingIds: string[] }
//   Buys several live B2B listings in ONE payment. Loads each listing, gates
//   every distinct city on the buyer's access, freezes each split from the
//   listing's regulated ask + frozen fees, reserves inventory (hotel_owner →
//   assignFreeUnit + a fresh pending block; investor_block → integrity check),
//   creates ONE Razorpay order for the SUM of buyerPays, and writes N
//   pending b2b_trades all tagged with that order id. The sibling basket verify
//   settles them all on the single payment.
//
// Reuses the SAME engines as the single checkout so preview == charge. Blocks
// are minted BEFORE the next item's assign so two basket items never grab the
// same unit. Auth: customer sb_token → cross-pool ids.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_H_REPRESENT, decodeJwt, genId } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { b2bTradeSplit } from "@/lib/b2b/engine";
import { resolveActiveCities, cityAccessId, normalizeCity } from "@/lib/circle/city-access";
import { resolveB2bFeeConfig } from "@/lib/b2b/fee-config-store";
import { assignFreeUnit } from "@/lib/inventory/assign";
import { quoteInventoryBlock } from "@/lib/inventory/quote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLIC_KEY_ID = "rzp_live_SfFAsbYjbHfztd";
const MAX_BASKET = 20;
const todayISO = () => new Date().toISOString().slice(0, 10);

function auth(req: NextRequest): { userId?: string; phone?: string; email?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub, phone: p?.phone, email: p?.email };
}

export async function POST(req: NextRequest) {
  const { userId, phone, email } = auth(req);
  if (!userId) return NextResponse.json({ error: "Please sign in to buy." }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const listingIds: string[] = Array.from(new Set(
    (Array.isArray(body?.listingIds) ? body.listingIds : []).map((x: any) => String(x)).filter((x: string) => !!x),
  ));
  if (!listingIds.length) return NextResponse.json({ error: "Your basket is empty." }, { status: 400 });
  if (listingIds.length > MAX_BASKET) return NextResponse.json({ error: `At most ${MAX_BASKET} listings per basket.` }, { status: 400 });

  const buyerIds = await resolveOwnerIdsCrossPool(userId, phone, email);
  if (!buyerIds.length) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const isBuyer = (v: any) => buyerIds.map(String).includes(String(v));

  // Load every requested listing.
  let listings: any[] = [];
  try {
    const idsCsv = listingIds.map((x) => encodeURIComponent(x)).join(",");
    const r = await fetch(`${SB_URL}/rest/v1/b2b_listings?id=in.(${idsCsv})&select=*`, { headers: SB_H });
    listings = r.ok ? await r.json().catch(() => []) : [];
  } catch { /* handled below */ }
  if (!Array.isArray(listings) || listings.length !== listingIds.length) {
    return NextResponse.json({ error: "Some offers are no longer available — refresh your basket." }, { status: 409 });
  }

  // Validate each + gate distinct cities on the buyer's access.
  const hotelIds = Array.from(new Set(listings.map((l) => String(l.hotel_id)).filter(Boolean)));
  const cityByHotel: Record<string, string> = {};
  try {
    const h = await fetch(`${SB_URL}/rest/v1/hotels?id=in.(${hotelIds.map((x) => encodeURIComponent(x)).join(",")})&select=id,city`, { headers: SB_H });
    (await h.json().catch(() => [])).forEach((x: any) => { cityByHotel[String(x.id)] = normalizeCity(x.city); });
  } catch { /* handled by the gate below (fails closed on a missing city) */ }

  for (const l of listings) {
    if (String(l.status) !== "listed") return NextResponse.json({ error: "One of these was just traded — refresh." }, { status: 409 });
    if (isBuyer(l.seller_user_id)) return NextResponse.json({ error: "Your basket includes your own listing." }, { status: 409 });
    if (String(l.date_to).slice(0, 10) <= todayISO()) return NextResponse.json({ error: "One of these has already passed." }, { status: 409 });
  }
  // v352 — NO pre-activation gate. City-access fees are ADDED to the total for
  // whichever basket cities the buyer hasn't unlocked yet (one-time, lifetime);
  // those accesses activate on verify with the same payment.
  const cities = Array.from(new Set(hotelIds.map((h) => cityByHotel[h]).filter(Boolean)));
  const activeCities = await resolveActiveCities(buyerIds);
  const newCities = cities.filter((c) => !activeCities.has(c));
  const feeCfg = await resolveB2bFeeConfig();
  const cityFeeEach = feeCfg.cityAccessPrice;
  const cityFeeTotal = newCities.length * cityFeeEach;

  // Reserve inventory + freeze each split. Blocks minted interleaved so the next
  // item's assign sees them. On any failure the minted pending blocks expire.
  type Item = { listing: any; split: any; unitId: string | null; blockId: string | null; source: string; newBlockId: string | null };
  const items: Item[] = [];
  for (const listing of listings) {
    const isHotelOwner = String(listing.source) === "hotel_owner";
    const split = b2bTradeSplit({
      askPerNight: Number(listing.ask_per_night),
      nights: Number(listing.nights),
      buyerFeePct: Number(listing.buyer_fee_pct),
      sellerFeePct: Number(listing.seller_fee_pct),
      buyTotal: Number(listing.buy_total),
    });
    if (split.buyerPays <= 0) return NextResponse.json({ error: "One offer isn't priced correctly." }, { status: 422 });

    const lFrom = String(listing.date_from).slice(0, 10);
    const lTo = String(listing.date_to).slice(0, 10);

    if (!isHotelOwner) {
      // investor_block — the seller must still own the block.
      let block: any = null;
      try {
        const r = await fetch(`${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(String(listing.block_id))}&select=id,investor_user_id,status`, { headers: SB_H });
        block = (r.ok ? await r.json().catch(() => []) : [])?.[0] || null;
      } catch { /* handled below */ }
      if (!block || String(block.status) !== "owned" || String(block.investor_user_id) !== String(listing.seller_user_id)) {
        return NextResponse.json({ error: "One block is no longer available to trade." }, { status: 409 });
      }
      items.push({ listing, split, unitId: listing.unit_id ? String(listing.unit_id) : null, blockId: String(listing.block_id), source: "investor_block", newBlockId: null });
      continue;
    }

    // hotel_owner — assign a free unit + mint a fresh pending block NOW.
    const freeUnit = await assignFreeUnit({ hotelId: String(listing.hotel_id), roomId: String(listing.room_id), from: lFrom, to: lTo, buyerIds });
    if (!freeUnit) return NextResponse.json({ error: "One offer sold out — refresh your basket." }, { status: 409 });
    const quote = await quoteInventoryBlock({ roomId: String(listing.room_id), from: lFrom, to: lTo });
    const buyTotal = quote && quote.buyTotal > 0 ? quote.buyTotal : Number(split.buyTotal) || 0;
    const perNight = split.nights > 0 ? Math.round(buyTotal / split.nights) : buyTotal;
    const newBlockId = genId("inv");
    try {
      const res = await fetch(`${SB_URL}/rest/v1/inventory_blocks`, {
        method: "POST",
        headers: SB_H_REPRESENT,
        body: JSON.stringify({
          id: newBlockId, investor_user_id: String(userId), hotel_id: String(listing.hotel_id),
          unit_id: freeUnit.unitId, room_id: String(listing.room_id), date_from: lFrom, date_to: lTo,
          nights: split.nights, buy_price_per_night: perNight, buy_total: buyTotal,
          resale_price_per_night: quote?.avgResalePerNight || 0, platform_fee_pct: split.platformFeePct,
          status: "pending_payment", metadata: { source: "circle_b2b_basket", listingId: String(listing.id), roomNumber: freeUnit.roomNumber, checkoutAt: new Date().toISOString() },
          updated_at: new Date().toISOString(),
        }),
      });
      const rows = res.ok ? await res.json().catch(() => []) : [];
      if (!Array.isArray(rows) || !rows.length) return NextResponse.json({ error: "Could not reserve one room." }, { status: 500 });
    } catch { return NextResponse.json({ error: "Checkout failed" }, { status: 500 }); }

    // self-excluding overlap re-guard
    try {
      const clashRes = await fetch(
        `${SB_URL}/rest/v1/inventory_blocks?unit_id=eq.${encodeURIComponent(freeUnit.unitId)}&id=neq.${encodeURIComponent(newBlockId)}` +
          `&status=not.in.(expired,cancelled,refunded)&date_from=lt.${lTo}&date_to=gt.${lFrom}&select=id&limit=1`,
        { headers: SB_H },
      );
      const clash = clashRes.ok ? await clashRes.json().catch(() => []) : [];
      if (Array.isArray(clash) && clash.length) {
        await fetch(`${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(newBlockId)}&status=eq.pending_payment`, { method: "DELETE", headers: SB_H }).catch(() => {});
        return NextResponse.json({ error: "One room was just taken — refresh." }, { status: 409 });
      }
    } catch { /* non-fatal */ }

    items.push({ listing, split, unitId: freeUnit.unitId, blockId: newBlockId, source: "hotel_owner", newBlockId });
  }

  const invTotal = items.reduce((s, it) => s + Number(it.split.buyerPays || 0), 0);
  const total = invTotal + cityFeeTotal;
  if (total <= 0) return NextResponse.json({ error: "Basket total is empty." }, { status: 422 });

  // ONE Razorpay order for the whole basket.
  const origin = new URL(req.url).origin;
  let rzp: any = null;
  try {
    const orderRes = await fetch(`${origin}/api/razorpay/order`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: total, receipt: `bskt_${String(userId)}`.slice(0, 40), notes: { kind: "circle_b2b_basket", count: String(items.length), buyerId: String(userId) } }),
    });
    rzp = await orderRes.json().catch(() => ({}));
    if (!orderRes.ok || !rzp?.id) return NextResponse.json({ error: rzp?.error || "Could not start payment." }, { status: 502 });
  } catch { return NextResponse.json({ error: "Payment gateway unreachable." }, { status: 502 }); }

  // v352 — pending city-access rows for the new cities in this basket (activated
  // on verify with the same payment). Deterministic id → re-tries reuse the row.
  for (const c of newCities) {
    await fetch(`${SB_URL}/rest/v1/circle_city_access?on_conflict=id`, {
      method: "POST", headers: { ...SB_H, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        id: cityAccessId(String(userId), c), user_id: String(userId), city: c,
        status: "pending_payment", amount: cityFeeEach, razorpay_order_id: rzp.id,
        updated_at: new Date().toISOString(),
      }),
    }).catch(() => {});
  }

  // Stamp the order onto the minted blocks + write all pending trades.
  const out: any[] = [];
  for (const it of items) {
    if (it.source === "hotel_owner" && it.newBlockId) {
      await fetch(`${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(it.newBlockId)}`, {
        method: "PATCH", headers: { ...SB_H, Prefer: "return=minimal" },
        body: JSON.stringify({ razorpay_order_id: rzp.id, updated_at: new Date().toISOString() }),
      }).catch(() => {});
    }
    const tradeId = genId("b2bt");
    try {
      const res = await fetch(`${SB_URL}/rest/v1/b2b_trades`, {
        method: "POST", headers: SB_H_REPRESENT,
        body: JSON.stringify({
          id: tradeId, listing_id: String(it.listing.id), block_id: it.blockId,
          seller_user_id: String(it.listing.seller_user_id), buyer_user_id: String(userId),
          hotel_id: String(it.listing.hotel_id), unit_id: it.unitId, room_id: String(it.listing.room_id),
          date_from: String(it.listing.date_from).slice(0, 10), date_to: String(it.listing.date_to).slice(0, 10),
          nights: it.split.nights, ask_total: it.split.askTotal,
          platform_fee_pct: it.split.platformFeePct, platform_fee: it.split.platformFee,
          buyer_fee_pct: it.split.buyerFeePct, seller_fee_pct: it.split.sellerFeePct,
          buyer_fee: it.split.buyerFee, seller_fee: it.split.sellerFee, buyer_pays: it.split.buyerPays,
          seller_net: it.split.sellerNet, razorpay_order_id: rzp.id, status: "pending_payment",
          source: it.source, metadata: { basket: true, checkoutAt: new Date().toISOString() },
        }),
      });
      if (!res.ok) { const err = await res.text(); return NextResponse.json({ error: "Could not start one trade.", detail: err.slice(0, 160) }, { status: 500 }); }
    } catch (e: any) { return NextResponse.json({ error: e?.message || "Checkout failed" }, { status: 500 }); }
    out.push({ listingId: String(it.listing.id), tradeId, buyerPays: it.split.buyerPays });
  }

  return NextResponse.json({
    ok: true, keyId: PUBLIC_KEY_ID,
    order: { id: rzp.id, amount: rzp.amount, currency: rzp.currency || "INR" },
    total, inventoryTotal: invTotal, cityFeeTotal, newCities, items: out,
  });
}
