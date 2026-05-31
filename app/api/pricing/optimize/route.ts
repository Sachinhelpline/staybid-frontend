// ════════════════════════════════════════════════════════════════
// v249.3 Phase 3 — AI Pricing: yield optimizer shadow compare (READ-ONLY).
//
// GET /api/pricing/optimize?roomId=…&date=YYYY-MM-DD[&hotelId=…]
//
// Resolves the live spine floor / rule-live / competitor / vacancy for
// (room, date), runs the expected-revenue optimizer, and returns the
// rule-vs-optimized comparison + the per-room observed accept stats that
// would feed a data-blended estimate. Optionally blends the baseline
// accept curve with empirical room/hotel data (Phase 2) so the shadow
// numbers reflect what the optimizer WOULD pick once the flag flips.
//
// SHADOW / READ-ONLY: changes NO price, writes NOTHING. Surfaces the
// optimizer's recommendation so admin / Phase 4 can compare against the
// rule engine before flipping PRICING_OPTIMIZER_ENABLED=1.
// ════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { resolveSpinePrices } from "@/lib/pricing/read-spine";
import { optimizePrice, optimizerEnabled, OPT_MAX_DELTA } from "@/lib/pricing/optimizer";
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
    const hotelId = sp.get("hotelId") || "";

    // Resolve the spine for this room+date (fail-open).
    let floor = 0;
    let ruleLive = 0;
    let comp: number | null = null;
    let vacancy: number | null = null;
    let source = "none";
    try {
      const spine = await resolveSpinePrices([roomId], date);
      const row = spine[roomId];
      if (row) {
        floor = Number(row.bidFloor) || 0;
        ruleLive = Number(row.livePrice) || 0;
        comp = typeof row.competitorMin === "number" ? row.competitorMin : null;
        vacancy = typeof row.vacancyRatio === "number" ? row.vacancyRatio : null;
        source = row.source || "computed";
      }
    } catch { /* fail-open */ }

    if (!(floor > 0) || !(ruleLive > 0)) {
      return NextResponse.json(
        { error: "no spine price for this room/date", roomId, date },
        { status: 404 },
      );
    }

    // ── Data-blended accept estimator. Phase 4: when the learned model is
    //    enabled (PRICING_MODEL_LEARNED=1), prefer the nightly-trained
    //    pricing_model_params (room→hotel→city→global fallback). Otherwise
    //    Phase 2's live per-request scan. Both fall back to the cold-start
    //    baseline curve when there's no observed data yet. ──
    let stats = await loadAcceptStats({ roomId });
    let statsScope = "room";
    if (learnedModelEnabled()) {
      const learned = await loadLearnedStatsWithFallback({ roomId, hotelId: hotelId || null });
      if (learned.stats.totalN > 0) {
        stats = learned.stats;
        statsScope = `learned:${learned.usedScope}`;
      }
    }
    if (statsScope === "room" && stats.totalN === 0 && hotelId) {
      stats = await loadAcceptStats({ hotelId });
      statsScope = stats.totalN > 0 ? "hotel" : "none";
    } else if (statsScope === "room" && stats.totalN === 0) {
      statsScope = "none";
    }

    const acceptProb = (price: number): number => {
      const ratio = floor > 0 ? price / floor : 0;
      const baseline = baselineAcceptProbability(ratio, vacancy);
      const obs = observedForRatio(stats, ratio);
      return blendAcceptProbability(baseline, obs.rate, obs.sampleCount).probability;
    };

    // ── Run the optimizer with the (possibly data-blended) estimator. ──
    const result = optimizePrice({
      floor,
      ruleLive,
      competitorMin: comp,
      vacancyRatio: vacancy,
      acceptProb,
    });

    const revLiftPct =
      result.expectedRevenueRule > 0
        ? Number(
            (((result.expectedRevenueOpt - result.expectedRevenueRule) /
              result.expectedRevenueRule) *
              100).toFixed(1),
          )
        : 0;

    return NextResponse.json({
      roomId,
      date,
      spineSource: source,
      floor,
      ruleLive,
      competitorMin: comp,
      vacancyRatio: vacancy,
      statsScope,
      observedSamples: stats.totalN,
      optimizerEnabled: optimizerEnabled(),
      maxDeltaPct: OPT_MAX_DELTA * 100,
      result, // OptimizeResult — optimizedLive, expected revenues, accepts, deltaPct, candidatesEvaluated
      revenueLiftPct: revLiftPct,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "optimize failed" }, { status: 500 });
  }
}
