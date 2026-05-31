// ════════════════════════════════════════════════════════════════
// v249.3 Phase 3 — AI Pricing: expected-revenue price optimizer (PURE).
//
// THE YIELD AI. Given the rule-engine live price, the floor, the competitor
// cap and the date's vacancy, it sweeps candidate prices and picks the one
// that maximizes EXPECTED REVENUE = price × P(accept at that price). A small
// discount that sharply lifts accept-probability can beat a higher sticker;
// on a soft-accept curve a nudge up can capture more — the optimizer finds
// the argmax either way.
//
// ── BULLETPROOF GUARDS (so even a wrong model can't produce an absurd price):
//   1. Hard floor   — never below the negotiation floor.
//   2. Competitor   — never above the cheapest-competitor undercut cap
//                     (the platform's lowest-price promise stays intact).
//   3. Rule-anchor  — result stays within ±OPT_MAX_DELTA of the PROVEN
//                     rule-engine price, so the optimizer can only NUDGE,
//                     never wildly diverge from the demand model.
//   4. snap100      — ₹100 multiples, platform-wide.
//
// ── FLAG-GATED: optimizerEnabled() reads PRICING_OPTIMIZER_ENABLED. Default
//   OFF → the spine computes optimizedLive for observability but keeps the
//   rule price as livePrice (pricing byte-identical to v249.2). Flip the env
//   to "1" only after pricing_decisions has accumulated real outcomes.
//
// Pure — no DB, no fetch. The accept-probability fn is injectable so a future
// caller (Phase 4) can pass a data-blended estimator; defaults to the
// cold-start baseline curve from accept-model.
// ════════════════════════════════════════════════════════════════

import { baselineAcceptProbability } from "@/lib/pricing/accept-model";
import { snap100 } from "@/lib/price-snap";

// Optimizer result must stay within ±12% of the rule-engine price. The proven
// demand model is the anchor; the optimizer only fine-tunes around it.
export const OPT_MAX_DELTA = 0.12;
// Mirror of spine's COMPETITOR_UNDERCUT (kept local to avoid a spine↔optimizer
// import cycle — value is the platform's 5% lowest-price promise).
const COMPETITOR_UNDERCUT = 0.05;

export interface OptimizeResult {
  optimizedLive: number;        // the recommended price (snapped, guarded)
  ruleLive: number;             // the rule-engine price we anchored to
  expectedRevenueOpt: number;   // optimizedLive × P(accept)
  expectedRevenueRule: number;  // ruleLive × P(accept)
  acceptAtOpt: number;          // P(accept) at optimizedLive
  acceptAtRule: number;         // P(accept) at ruleLive
  deltaPct: number;             // (optimizedLive − ruleLive) / ruleLive, %
  candidatesEvaluated: number;
}

type AcceptProbFn = (price: number) => number;

/** True only when PRICING_OPTIMIZER_ENABLED === "1". Default OFF. */
export function optimizerEnabled(): boolean {
  return process.env.PRICING_OPTIMIZER_ENABLED === "1";
}

/**
 * Pick the expected-revenue-maximizing price within the guard band.
 * `acceptProb` defaults to the baseline curve (price → P via price/floor +
 * vacancy). Inject a blended estimator in Phase 4 once data is rich.
 */
export function optimizePrice(args: {
  floor: number;
  ruleLive: number;
  competitorMin?: number | null;
  vacancyRatio?: number | null;
  acceptProb?: AcceptProbFn;
}): OptimizeResult {
  const floor = Math.max(0, Number(args.floor) || 0);
  const ruleLive = Math.max(floor, Number(args.ruleLive) || floor);
  const vac = typeof args.vacancyRatio === "number" ? args.vacancyRatio : null;

  const accept: AcceptProbFn =
    args.acceptProb ||
    ((price: number) =>
      baselineAcceptProbability(floor > 0 ? price / floor : 0, vac));

  const acceptAtRule = accept(ruleLive);
  const ruleResult: OptimizeResult = {
    optimizedLive: snap100(ruleLive),
    ruleLive: snap100(ruleLive),
    expectedRevenueOpt: snap100(ruleLive) * acceptAtRule,
    expectedRevenueRule: snap100(ruleLive) * acceptAtRule,
    acceptAtOpt: acceptAtRule,
    acceptAtRule,
    deltaPct: 0,
    candidatesEvaluated: 1,
  };
  if (!(floor > 0) || !(ruleLive > 0)) return ruleResult;

  // Guard band: ±OPT_MAX_DELTA around the rule price, clamped to [floor, cap].
  let lower = Math.max(floor, ruleLive * (1 - OPT_MAX_DELTA));
  let upper = ruleLive * (1 + OPT_MAX_DELTA);
  const comp = Number(args.competitorMin) > 0 ? Number(args.competitorMin) : null;
  if (comp) upper = Math.min(upper, comp * (1 - COMPETITOR_UNDERCUT));
  upper = Math.max(upper, lower); // never invert
  if (upper - lower < 1) return ruleResult; // no room → keep rule price

  // Sweep ₹100 candidates; pick max expected revenue. Tie → closest to rule.
  let best = snap100(ruleLive);
  let bestER = best * accept(best);
  let n = 0;
  const start = snap100(lower);
  const end = snap100(upper);
  for (let p = start; p <= end + 1; p += 100) {
    const cand = snap100(p);
    if (cand < floor) continue;
    const er = cand * accept(cand);
    n += 1;
    if (
      er > bestER + 1 ||
      (Math.abs(er - bestER) <= 1 && Math.abs(cand - ruleLive) < Math.abs(best - ruleLive))
    ) {
      best = cand;
      bestER = er;
    }
  }

  // Final clamp — belt and braces.
  best = snap100(Math.min(Math.max(best, floor), comp ? comp * (1 - COMPETITOR_UNDERCUT) : best));
  const acceptAtOpt = accept(best);
  return {
    optimizedLive: best,
    ruleLive: snap100(ruleLive),
    expectedRevenueOpt: best * acceptAtOpt,
    expectedRevenueRule: snap100(ruleLive) * acceptAtRule,
    acceptAtOpt,
    acceptAtRule,
    deltaPct: ruleLive > 0 ? Number((((best - ruleLive) / ruleLive) * 100).toFixed(1)) : 0,
    candidatesEvaluated: n,
  };
}
