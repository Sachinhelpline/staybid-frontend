// v349 — Circle Model 2: regulated B2B price preview.
//
//   GET /api/b2b/regulated-quote?roomId&from&to
//     → the StayBid-regulated ask (Spine wholesale × admin markup) + the buyer/
//       seller split for a hotel-owner supply listing, so the seller sees the
//       exact price BEFORE they list. Same engine the listing endpoint uses →
//       preview == listed price. Auth: partner Bearer (a valid token; the price
//       itself isn't ownership-sensitive).

import { NextRequest, NextResponse } from "next/server";
import { decodeJwt } from "@/lib/sb-server";
import { b2bTradeSplit, resaleAskPerNight } from "@/lib/b2b/engine";
import { resolveB2bFeeConfig, clampOwnerMultiplier } from "@/lib/b2b/fee-config-store";
import { quoteInventoryBlock } from "@/lib/inventory/quote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !decodeJwt(token)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const roomId = (sp.get("roomId") || "").trim();
  const from = (sp.get("from") || "").slice(0, 10);
  const to = (sp.get("to") || "").slice(0, 10);
  if (!roomId || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from >= to) {
    return NextResponse.json({ error: "roomId, from, to (from < to) required" }, { status: 400 });
  }

  const quote = await quoteInventoryBlock({ roomId, from, to });
  if (!quote || quote.buyTotal <= 0) {
    return NextResponse.json({ error: "Couldn't price these nights right now." }, { status: 422 });
  }

  // v355 — preview the resale price = own price/night × multiplier, so the
  // seller sees the exact listed price BEFORE listing (preview == listed price).
  const fee = await resolveB2bFeeConfig();
  const ownPerNight = quote.avgBuyPerNight;
  // v725 — owner-chosen multiplier clamped into the admin band; absent → global default.
  const rawMult = sp.get("mult");
  const multiplier = (rawMult === null || rawMult === "")
    ? fee.resaleMultiplier
    : clampOwnerMultiplier(rawMult, fee);
  const askPerNight = resaleAskPerNight(ownPerNight, multiplier);
  const split = b2bTradeSplit({
    askPerNight,
    nights: quote.nights,
    buyerFeePct: fee.buyerFeePct,
    sellerFeePct: fee.sellerFeePct,
    buyTotal: quote.buyTotal,
  });

  return NextResponse.json({
    ok: true,
    regulatedMarkupPct: fee.regulatedMarkupPct,
    resaleMultiplier: multiplier,
    resaleMultiplierMin: fee.resaleMultiplierMin,
    resaleMultiplierMax: fee.resaleMultiplierMax,
    resaleMultiplierDefault: fee.resaleMultiplier,
    ownPerNight,
    askPerNight: split.askPerNight,
    askTotal: split.askTotal,
    nights: split.nights,
    buyTotal: split.buyTotal,
    split,
  });
}
