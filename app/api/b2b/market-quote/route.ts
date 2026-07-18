// v356 — Circle Model 2: market quote + availability for a released room-night.
//
//   GET /api/b2b/market-quote?listingId=…[&from=YYYY-MM-DD&to=YYYY-MM-DD]
//     → everything the "trading-style" room tour needs:
//        • window        the owner-released availability window [from,to)
//        • blocked[]      ISO dates inside the window that are NOT free (so the
//                         calendar can grey them out)
//        • ownPerNight / multiplier / buyPerNight   your entry price (own × mult)
//        • market {adr, low, high}   the room's REAL guest/retail selling price
//                         (Spine live_price) over the range — so a buyer sees
//                         resale-profit potential like checking a stock's price
//        • selection      when from/to are given: nights, subtotal, buyerFee,
//                         buyerPays, marketValue, marketUpside (per-night + total)
//
// Auth: customer sb_token (a valid token; the numbers aren't ownership-sensitive).
// Pure-read — no writes. The buy itself re-computes server-side at checkout.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, decodeJwt } from "@/lib/sb-server";
import { resolveSpinePrices } from "@/lib/pricing/read-spine";
import { getOccupations, occupationsToDateSet, enumerateDates } from "@/lib/availability";
import { b2bTradeSplit, resaleAskPerNight } from "@/lib/b2b/engine";
import { resolveB2bFeeConfig } from "@/lib/b2b/fee-config-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const todayISO = () => iso(new Date());
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const clampMult = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 20 ? n : 2;
};

/** min/avg/max of the room's guest-facing live price over [from,to). */
async function marketRange(roomId: string, from: string, to: string) {
  const dates = enumerateDates(from, to);
  if (!dates.length) return null;
  const price: Record<string, number> = {};
  // one range read of the Spine cache
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/room_date_price?room_id=eq.${encodeURIComponent(roomId)}&date=gte.${from}&date=lt.${to}&select=date,live_price`,
      { headers: SB_H, cache: "no-store" },
    );
    (r.ok ? await r.json().catch(() => []) : []).forEach((x: any) => {
      const d = String(x.date).slice(0, 10); const p = Math.round(Number(x.live_price) || 0);
      if (p > 0) price[d] = p;
    });
  } catch { /* fall through to compute */ }
  // fill gaps from the Spine engine (bounded so a wide window can't stall)
  const missing = dates.filter((d) => !price[d]).slice(0, 45);
  for (const d of missing) {
    try {
      const sp = await resolveSpinePrices([roomId], d);
      const p = Math.round(Number(sp?.[roomId]?.livePrice) || 0);
      if (p > 0) price[d] = p;
    } catch { /* skip this night */ }
  }
  const vals = dates.map((d) => price[d]).filter((v) => v > 0);
  if (!vals.length) return null;
  const low = Math.min(...vals);
  const high = Math.max(...vals);
  const adr = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  return { low, high, adr, samples: vals.length };
}

export async function GET(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !decodeJwt(token)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const listingId = (sp.get("listingId") || "").trim();
  if (!listingId) return NextResponse.json({ error: "listingId required" }, { status: 400 });

  // Load the listing (the released window + frozen own-price basis).
  let listing: any = null;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/b2b_listings?id=eq.${encodeURIComponent(listingId)}&select=*`, { headers: SB_H });
    listing = (r.ok ? await r.json().catch(() => []) : [])?.[0] || null;
  } catch { /* handled */ }
  if (!listing || String(listing.status) !== "listed") {
    return NextResponse.json({ error: "This room is no longer available." }, { status: 404 });
  }

  const roomId = String(listing.room_id);
  const hotelId = String(listing.hotel_id);
  const windowFrom = String(listing.date_from).slice(0, 10);
  const windowTo = String(listing.date_to).slice(0, 10);
  const ownPerNight = Math.round(Number(listing.own_per_night) || (Number(listing.buy_total) / Math.max(1, Number(listing.nights)))) || 0;
  const multiplier = clampMult(listing.price_multiplier);
  const buyPerNight = resaleAskPerNight(ownPerNight, multiplier);
  const feeCfg = await resolveB2bFeeConfig();
  const buyerFeePct = Number(listing.buyer_fee_pct) || feeCfg.buyerFeePct;
  const sellerFeePct = Number(listing.seller_fee_pct) || feeCfg.sellerFeePct;

  // Blocked dates inside the window (so the calendar greys them out). The
  // effective free window starts no earlier than tomorrow.
  const effFrom = windowFrom > todayISO() ? windowFrom : iso(new Date(Date.now() + 86400000));
  let blocked: string[] = [];
  try {
    const occs = await getOccupations({ hotelId, roomId, from: effFrom, to: windowTo });
    blocked = Array.from(occupationsToDateSet(occs, roomId)).sort();
  } catch { blocked = []; }

  // Market range: over the picked range if given, else a 30-night sample from
  // the start of the free window (bounded so the tour loads fast).
  const hasSel = isDate(sp.get("from") || "") && isDate(sp.get("to") || "");
  let selFrom = hasSel ? (sp.get("from") as string) : effFrom;
  let selTo = hasSel ? (sp.get("to") as string) : iso(new Date(new Date(effFrom).getTime() + 30 * 86400000));
  // clamp to the window
  if (selFrom < effFrom) selFrom = effFrom;
  if (selTo > windowTo) selTo = windowTo;

  const market = await marketRange(roomId, selFrom, selTo > selFrom ? selTo : windowTo);

  const out: any = {
    ok: true,
    listingId,
    room: listing.metadata?.room || null,
    title: listing.metadata?.title || null,
    city: listing.metadata?.city || null,
    window: { from: windowFrom, to: windowTo, effectiveFrom: effFrom },
    blocked,
    ownPerNight,
    multiplier,
    buyPerNight,
    market, // { adr, low, high } guest/retail selling price, or null
  };

  // Priced selection when the buyer has chosen dates.
  if (hasSel && selTo > selFrom) {
    const nights = enumerateDates(selFrom, selTo).length;
    const split = b2bTradeSplit({ askPerNight: buyPerNight, nights, buyerFeePct, sellerFeePct, buyTotal: ownPerNight * nights });
    const marketValue = market ? market.adr * nights : 0;
    out.selection = {
      from: selFrom, to: selTo, nights,
      buyPerNight, subtotal: split.askTotal, buyerFee: split.buyerFee, buyerPays: split.buyerPays,
      marketValuePerNight: market?.adr || 0,
      marketValue,
      marketUpside: marketValue > 0 ? Math.max(0, marketValue - split.askTotal) : 0,
    };
  }

  return NextResponse.json(out);
}
