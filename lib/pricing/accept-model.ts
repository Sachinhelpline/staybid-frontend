// ════════════════════════════════════════════════════════════════
// v249.2 Phase 2 — AI Pricing: accept-probability model (PURE).
//
// Turns Phase 1's decision+outcome data into a prediction: "at this price,
// on this date, how likely is the hotel to accept?" — the core signal a
// Phase-3 price optimizer needs (it maximizes price × accept-probability).
//
// This module is PURE — no DB, no fetch. It has two layers:
//   1. baselineAcceptProbability() — a cold-start curve from price-ratio +
//      vacancy. Works from day 1 with ZERO data. Mirrors the documented
//      customer-facing bidProb thresholds so the model never contradicts the
//      confidence chip the customer already sees.
//   2. blendAcceptProbability() — Bayesian shrinkage toward the baseline.
//      Few real samples → baseline dominates; many → observed rate dominates.
//      As `pricing_decisions ⨝ bids` accumulates, the estimate self-improves
//      without ever swinging wildly on a thin sample.
//
// NOTHING here changes a price. Phase 2 is shadow/read-only. Phase 3 wires
// the optimizer into the live price; Phase 4 retrains nightly.
// ════════════════════════════════════════════════════════════════

export interface AcceptEstimate {
  probability: number;   // 0..1 final blended estimate
  baseline: number;      // 0..1 cold-start curve value
  observed: number | null; // 0..1 empirical rate, or null when no samples
  sampleCount: number;   // how many real decisions backed `observed`
  source: "baseline" | "blended" | "observed";
}

// Prior strength for the Bayesian shrinkage. With K=20, you need ~20 real
// observations before the empirical rate carries half the weight. Keeps a
// 2-out-of-3 fluke from yanking the estimate around.
export const ACCEPT_PRIOR_STRENGTH = 20;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Cold-start accept-probability from the price ratio (intent / dynamic floor)
 * and optional vacancy (0 = sold out … 1 = empty). The ratio anchors the
 * curve; vacancy nudges it (an empty date is likelier to accept a soft bid;
 * a near-full date is choosier). Thresholds mirror the documented bidProb
 * curve so model + customer chip never disagree.
 */
export function baselineAcceptProbability(
  priceRatio: number,
  vacancyRatio?: number | null,
): number {
  const r = Number.isFinite(priceRatio) ? priceRatio : 0;
  let p: number;
  if (r >= 1.0) p = 0.95;
  else if (r >= 0.95) p = 0.80;
  else if (r >= 0.90) p = 0.55;
  else if (r >= 0.85) p = 0.35;
  else if (r >= 0.78) p = 0.15;
  else p = 0.05;

  // Vacancy nudge — modest, never flips the band. Empty (>0.6) lifts the odds
  // ~15%; tight (<0.15) trims ~15%. Mirrors the v249 Layer-2 occupancy intent.
  if (typeof vacancyRatio === "number" && Number.isFinite(vacancyRatio)) {
    if (vacancyRatio > 0.60) p *= 1.15;
    else if (vacancyRatio < 0.15) p *= 0.85;
  }
  return clamp01(p);
}

/**
 * Bayesian shrinkage of an observed accept-rate toward the baseline.
 *   blended = (baseline·K + observedRate·n) / (K + n)
 * n=0 → pure baseline. n≫K → ~observed. K is ACCEPT_PRIOR_STRENGTH.
 */
export function blendAcceptProbability(
  baseline: number,
  observedRate: number | null,
  sampleCount: number,
  priorStrength: number = ACCEPT_PRIOR_STRENGTH,
): AcceptEstimate {
  const base = clamp01(baseline);
  const n = Number.isFinite(sampleCount) && sampleCount > 0 ? Math.floor(sampleCount) : 0;
  if (n === 0 || observedRate == null || !Number.isFinite(observedRate)) {
    return { probability: base, baseline: base, observed: null, sampleCount: 0, source: "baseline" };
  }
  const obs = clamp01(observedRate);
  const blended = clamp01((base * priorStrength + obs * n) / (priorStrength + n));
  return {
    probability: blended,
    baseline: base,
    observed: obs,
    sampleCount: n,
    // "observed" once the sample dwarfs the prior; "blended" in between.
    source: n >= priorStrength * 4 ? "observed" : "blended",
  };
}

/** Convenience: ratio + vacancy + observed sample → full estimate. */
export function estimateAcceptProbability(args: {
  priceRatio: number;
  vacancyRatio?: number | null;
  observedRate?: number | null;
  sampleCount?: number;
}): AcceptEstimate {
  const base = baselineAcceptProbability(args.priceRatio, args.vacancyRatio);
  return blendAcceptProbability(base, args.observedRate ?? null, args.sampleCount ?? 0);
}
