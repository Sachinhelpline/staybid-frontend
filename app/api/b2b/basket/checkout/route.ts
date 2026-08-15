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
import { assignFreeUnit, reserveClassicAtomically } from "@/lib/inventory/assign";
import { enumerateDates } from "@/lib/availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { checkoutKeyId } from "@/lib/razorpay-server";

// Public checkout key id — present ONLY when the COMPLETE server env pair
// (RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET) is configured (hotfix v621.2); the
// POST fails closed with payment_config_missing BEFORE any body parse / DB /
// order work when either half is absent or malformed.
const PUBLIC_KEY_ID = checkoutKeyId();
const MAX_BASKET = 20;
const todayISO = () => new Date().toISOString().slice(0, 10);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

function auth(req: NextRequest): { userId?: string; phone?: string; email?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub, phone: p?.phone, email: p?.email };
}

// v356 — each basket line is a listing PLUS the nights the buyer picked from
// that room's released window. Back-compat: a bare `listingIds:[…]` array (no
// dates) buys each listing's full window as-is.
type Pick = { listingId: string; from?: string; to?: string };

export async function POST(req: NextRequest) {
  if (!PUBLIC_KEY_ID) return NextResponse.json({ error: "payment_config_missing" }, { status: 503 });
  const { userId, phone, email } = auth(req);
  if (!userId) return NextResponse.json({ error: "Please sign in to buy." }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  let picks: Pick[] = [];
  if (Array.isArray(body?.items) && body.items.length) {
    picks = body.items
      .map((x: any) => ({ listingId: String(x?.listingId || ""), from: String(x?.from || "").slice(0, 10), to: String(x?.to || "").slice(0, 10) }))
      .filter((p: Pick) => !!p.listingId);
  } else if (Array.isArray(body?.listingIds)) {
    picks = Array.from(new Set(body.listingIds.map((x: any) => String(x)).filter(Boolean))).map((id) => ({ listingId: id as string }));
  }
  if (!picks.length) return NextResponse.json({ error: "Your basket is empty." }, { status: 400 });
  if (picks.length > MAX_BASKET) return NextResponse.json({ error: `At most ${MAX_BASKET} rooms per basket.` }, { status: 400 });

  const buyerIds = await resolveOwnerIdsCrossPool(userId, phone, email);
  if (!buyerIds.length) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const isBuyer = (v: any) => buyerIds.map(String).includes(String(v));

  // Load every distinct listing referenced by the picks.
  const listingIds = Array.from(new Set(picks.map((p) => p.listingId)));
  let listingRows: any[] = [];
  try {
    const idsCsv = listingIds.map((x) => encodeURIComponent(x)).join(",");
    const r = await fetch(`${SB_URL}/rest/v1/b2b_listings?id=in.(${idsCsv})&select=*`, { headers: SB_H });
    listingRows = r.ok ? await r.json().catch(() => []) : [];
  } catch { /* handled below */ }
  const listingById: Record<string, any> = {};
  listingRows.forEach((l) => { listingById[String(l.id)] = l; });
  if (listingIds.some((id) => !listingById[id])) {
    return NextResponse.json({ error: "Some offers are no longer available — refresh your basket." }, { status: 409 });
  }
  const listings = listingRows;

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
  type Item = { listing: any; split: any; from: string; to: string; unitId: string | null; blockId: string | null; source: string; newBlockId: string | null };
  const items: Item[] = [];
  for (const pick of picks) {
    const listing = listingById[pick.listingId];
    const isHotelOwner = String(listing.source) === "hotel_owner";
    const winFrom = String(listing.date_from).slice(0, 10);
    const winTo = String(listing.date_to).slice(0, 10);

    // v356 — the nights the buyer picked from the released window (hotel_owner
    // only; an investor_block is sold as its whole fixed range). Clamp + validate.
    let useFrom = winFrom, useTo = winTo;
    if (isHotelOwner && pick.from && pick.to && isDate(pick.from) && isDate(pick.to)) {
      useFrom = pick.from < winFrom ? winFrom : pick.from;
      useTo = pick.to > winTo ? winTo : pick.to;
    }
    if (useFrom >= useTo) return NextResponse.json({ error: "Pick a valid check-in / check-out." }, { status: 400 });
    if (useTo <= todayISO()) return NextResponse.json({ error: "One of these dates has already passed." }, { status: 409 });
    const nights = enumerateDates(useFrom, useTo).length;
    if (nights < 1) return NextResponse.json({ error: "Pick at least one night." }, { status: 400 });

    // v356 — price the CHOSEN nights: own price/night × the frozen resale
    // multiplier (= the listing's per-night ask), × nights + the frozen fees.
    const ownPerNight = Math.round(Number(listing.own_per_night) || (Number(listing.buy_total) / Math.max(1, Number(listing.nights)))) || 0;
    const askPerNight = Math.round(Number(listing.ask_per_night)) || ownPerNight * (Number(listing.price_multiplier) || 2);
    const split = b2bTradeSplit({
      askPerNight,
      nights,
      buyerFeePct: Number(listing.buyer_fee_pct),
      sellerFeePct: Number(listing.seller_fee_pct),
      buyTotal: ownPerNight * nights,
    });
    if (split.buyerPays <= 0) return NextResponse.json({ error: "One offer isn't priced correctly." }, { status: 422 });

    if (!isHotelOwner) {
      // investor_block — the seller must still own the block (whole fixed range).
      let block: any = null;
      try {
        const r = await fetch(`${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(String(listing.block_id))}&select=id,investor_user_id,status`, { headers: SB_H });
        block = (r.ok ? await r.json().catch(() => []) : [])?.[0] || null;
      } catch { /* handled below */ }
      if (!block || String(block.status) !== "owned" || String(block.investor_user_id) !== String(listing.seller_user_id)) {
        return NextResponse.json({ error: "One block is no longer available to trade." }, { status: 409 });
      }
      items.push({ listing, split, from: useFrom, to: useTo, unitId: listing.unit_id ? String(listing.unit_id) : null, blockId: String(listing.block_id), source: "investor_block", newBlockId: null });
      continue;
    }

    // hotel_owner — assign a free unit for the CHOSEN nights + mint a fresh
    // pending buyer block over exactly those nights NOW. Branch on assignment:
    //   • unit found → existing race-safe INSERT + self-excluding overlap re-guard
    //   • classic (no active units) → v734 atomic RPC reserves capacity + writes
    //     invhold in ONE transaction under a per-room advisory lock
    const freeUnit = await assignFreeUnit({ hotelId: String(listing.hotel_id), roomId: String(listing.room_id), from: useFrom, to: useTo, buyerIds });
    let itemUnitId: string | null = null;
    let itemRoomNumber: string | null = null;
    const buyTotal = split.askTotal;
    const perNight = askPerNight;
    const newBlockId = genId("inv");

    if (freeUnit) {
      itemUnitId = freeUnit.unitId;
      itemRoomNumber = freeUnit.roomNumber;

      try {
        const res = await fetch(`${SB_URL}/rest/v1/inventory_blocks`, {
          method: "POST",
          headers: SB_H_REPRESENT,
          body: JSON.stringify({
            id: newBlockId, investor_user_id: String(userId), hotel_id: String(listing.hotel_id),
            unit_id: itemUnitId, room_id: String(listing.room_id), date_from: useFrom, date_to: useTo,
            nights, buy_price_per_night: perNight, buy_total: buyTotal,
            resale_price_per_night: 0, platform_fee_pct: split.platformFeePct,
            status: "pending_payment", metadata: { source: "circle_b2b_basket", listingId: String(listing.id), roomNumber: itemRoomNumber, checkoutAt: new Date().toISOString() },
            updated_at: new Date().toISOString(),
          }),
        });
        const rows = res.ok ? await res.json().catch(() => []) : [];
        if (!Array.isArray(rows) || !rows.length) return NextResponse.json({ error: "Could not reserve one room." }, { status: 500 });
      } catch { return NextResponse.json({ error: "Checkout failed" }, { status: 500 }); }

      // self-excluding overlap re-guard — a DIFFERENT non-terminal block may
      // have grabbed the same unit/nights in the race window. Drop the orphan + 409.
      try {
        const clashRes = await fetch(
          `${SB_URL}/rest/v1/inventory_blocks?unit_id=eq.${encodeURIComponent(itemUnitId)}&id=neq.${encodeURIComponent(newBlockId)}` +
            `&status=not.in.(expired,cancelled,refunded)&date_from=lt.${useTo}&date_to=gt.${useFrom}&select=id&limit=1`,
          { headers: SB_H },
        );
        const clash = clashRes.ok ? await clashRes.json().catch(() => []) : [];
        if (Array.isArray(clash) && clash.length) {
          await fetch(`${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(newBlockId)}&status=eq.pending_payment`, { method: "DELETE", headers: SB_H }).catch(() => {});
          return NextResponse.json({ error: "One room was just taken — refresh." }, { status: 409 });
        }
      } catch { /* non-fatal */ }
    } else {
      // CLASSIC branch (v734) — atomic RPC. Reserves capacity + writes the
      // invhold in one transaction under a per-room advisory lock. Two
      // concurrent classic buyers on the same room/nights can never both win.
      // razorpay_order_id is PATCHed on later (same loop below) once the ONE
      // basket order is minted; the RPC accepts null here.
      const rc = await reserveClassicAtomically({
        blockId: newBlockId,
        hotelId: String(listing.hotel_id),
        roomId: String(listing.room_id),
        investorUserId: String(userId),
        from: useFrom,
        to: useTo,
        buyPricePerNight: perNight,
        buyTotal,
        razorpayOrderId: null,
        metadata: {
          source: "circle_b2b_basket_classic",
          listingId: String(listing.id),
          resale_price_per_night: 0,
          platform_fee_pct: split.platformFeePct,
          checkoutAt: new Date().toISOString(),
        },
      });
      if (!rc.ok) {
        if (rc.code === "category_full" || rc.code === "no_capacity_signal") {
          return NextResponse.json({ error: "One room is booked on those nights — pick different dates." }, { status: 409 });
        }
        if (rc.code === "block_id_conflict" || rc.code === "hold_id_conflict" || rc.code === "not_classic") {
          return NextResponse.json({ error: "One room was just taken — refresh.", detail: rc.code }, { status: 409 });
        }
        return NextResponse.json({ error: "Could not reserve one room.", detail: rc.detail || rc.code }, { status: 500 });
      }
    }

    items.push({ listing, split, from: useFrom, to: useTo, unitId: itemUnitId, blockId: newBlockId, source: "hotel_owner", newBlockId });
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
          date_from: it.from, date_to: it.to,
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
