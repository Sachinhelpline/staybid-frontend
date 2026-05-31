// ════════════════════════════════════════════════════════════════
// v249.2 Phase 2 — AI Pricing: accept-probability estimate (READ-ONLY).
//
// GET /api/pricing/accept-estimate?roomId=…&date=YYYY-MM-DD&price=…
//
// Resolves the live spine floor + vacancy for (room, date), computes the
// price ratio, blends the cold-start baseline curve with the empirical
// accept-rate observed in Phase-1 `pricing_decisions ⨝ bids`, and returns
// the estimate. Room-scope stats first; falls back to hotel-scope when the
// room has no samples in the ratio's band yet.
//
// SHADOW / READ-ONLY: this endpoint changes NO price and writes NOTHING. It
// exists so Phase 3 (the optimizer) + admin insights can consume the model
// without any customer-facing behavior change in Phase 2.
// ════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { resolveSpinePrices } from "@/lib/pricing/read-spine";
import { loadAcceptStats, observedForRatio } from "@/lib/pricing/outcomes";
import { loadLearnedStatsWithFallback, learnedModelEnabled } from "@/lib/pricing/model-store";
import { baselineAcceptProbability, blendAcceptProbability } from "@/lib/pricing/accept-model";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const roomId = sp.get("roomId") || "";
    if (!roomId) {
      return NextResponse.json({ error: "roomId required" }, { status: 400 });
    }
    const date = sp.get("date") || new Date().toISOString().slice(0, 10);
    const priceParam = sp.get("price");

    // Resolve the spine for this room+date (fail-open → baseline still works).
    let floor = 0;
    let vacancy: number | null = null;
    let live = 0;
    let source = "none";
    try {
      const spine = await resolveSpinePrices([roomId], date);
      const row = spine[roomId];
      if (row) {
        floor = Number(row.bidFloor) || 0;
        live = Number(row.livePrice) || 0;
        vacancy = typeof row.vacancyRatio === "number" ? row.vacancyRatio : null;
        source = row.source || "computed";
      }
    } catch { /* fail-open */ }

    // Price to evaluate: explicit ?price, else the live price, else the floor.
    const price = priceParam != null && Number.isFinite(Number(priceParam))
      ? Number(priceParam)
      : (live || floor);
    const ratio = floor > 0 && price > 0 ? price / floor : 0;

    // Observed empirical rate — room scope first, hotel scope as fallback.
    let hotelId = sp.get("hotelId") || "";
    if (!hotelId) {
      // Cheap hotel lookup only if needed for the fallback.
      hotelId = "";
    }
    // Phase 4: when the learned model is on (PRICING_MODEL_LEARNED=1), prefer
    // the nightly-trained pricing_model_params (room→hotel→city→global) over
    // the Phase-2 live scan. Default OFF → live scan, byte-identical.
    if (learnedModelEnabled()) {
      const learned = await loadLearnedStatsWithFallback({ roomId, hotelId: hotelId || null });
      const lo = observedForRatio(learned.stats, ratio);
      if (lo.sampleCount > 0) {
        const baselineL = baselineAcceptProbability(ratio, vacancy);
        const estL = blendAcceptProbability(baselineL, lo.rate, lo.sampleCount);
        return NextResponse.json({
          roomId, date, floor, livePrice: live, price,
          ratio: Number(ratio.toFixed(4)), vacancyRatio: vacancy, spineSource: source,
          statsScope: `learned:${learned.usedScope}`,
          estimate: estL,
        });
      }
    }

    const roomStats = await loadAcceptStats({ roomId });
    let observed = observedForRatio(roomStats, ratio);
    let statsScope = "room";
    if (observed.sampleCount === 0 && (hotelId || roomStats.scope === "room")) {
      // Fall back to hotel-scope if we can resolve the hotel.
      if (hotelId) {
        const hotelStats = await loadAcceptStats({ hotelId });
        const ho = observedForRatio(hotelStats, ratio);
        if (ho.sampleCount > 0) { observed = ho; statsScope = "hotel"; }
        else statsScope = "none";
      } else {
        statsScope = "none";
      }
    }

    const baseline = baselineAcceptProbability(ratio, vacancy);
    const est = blendAcceptProbability(baseline, observed.rate, observed.sampleCount);

    return NextResponse.json({
      roomId,
      date,
      floor,
      livePrice: live,
      price,
      ratio: Number(ratio.toFixed(4)),
      vacancyRatio: vacancy,
      spineSource: source,
      statsScope,
      estimate: est, // { probability, baseline, observed, sampleCount, source }
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "estimate failed" }, { status: 500 });
  }
}
