// ════════════════════════════════════════════════════════════════
// v165 Phase A — Unified Pricing Spine.
//
// ONE function that turns a hotel's raw inputs into every price the
// platform needs for a given (room, date):
//
//   livePrice   → the customer-facing dynamic rate (hotel page)
//   bidFloor    → the /bid auction + negotiation floor
//   flashPrice  → the flash-deal price
//
// Hotel only ever provides 3 numbers: a market/reference rate (mrp),
// a negotiation floor (floorPrice) and a flash floor (flashFloorPrice).
// Everything else is derived here.
//
// THE PLATFORM PROMISE — baked in as a hard rule: when a competitor
// (OTA) price is known, livePrice is forced strictly below it. Flash
// and bid prices sit below livePrice in turn, so a StayBid price is
// always the lowest available anywhere.
//
// This module is PURE — no DB, no fetch, no side effects. The cron
// (`/api/cron/price-spine`) gathers the inputs and persists the output
// into `room_date_price`. Nothing reads that table yet (Phase A is
// additive); Phase C wires the hotel page / /bid / flash to it.
// ════════════════════════════════════════════════════════════════

import { calculateDynamicPrice, type PricingEngineOverrides } from "@/lib/ai-pricing";
import { snap100 } from "@/lib/price-snap";
import { optimizePrice, optimizerEnabled } from "@/lib/pricing/optimizer";

export interface SpineInput {
  /** rooms.floorPrice — hotel's negotiation floor (won't sell below). */
  floorPrice: number;
  /** rooms.mrp — hotel's market / reference rate. */
  mrp: number;
  /** rooms.flashFloorPrice — flash-deal floor. */
  flashFloorPrice?: number | null;
  /** City name (must match lib/ai-pricing CITY_DEMAND keys). */
  city: string;
  /** Stay date — ISO string or yyyy-mm-dd. */
  date: string;
  /** 0 = empty, 1 = sold out for this date. Drives yield surge/discount. */
  vacancyRatio?: number | null;
  /** Cheapest scraped competitor (OTA) price for this room, if known. */
  competitorMin?: number | null;
  /**
   * v720 — OPTIONAL admin-tuned pricing-engine config. When absent, every
   * constant (undercut 5%, flash 20%, clamp, the 9 factors) stays at its
   * hardcoded default → byte-identical to the pre-v720 spine. The server
   * writers (cron price-spine + read-spine) load it once and pass it here.
   */
  engineCfg?: (PricingEngineOverrides & {
    undercutPct?: number;      // OTA undercut (default 5)
    flashDiscountPct?: number; // flash discount off live (default 20)
    capLiveAtMrp?: boolean;    // Gap-6 opt-in: never let live exceed MRP
  }) | null;
}

export interface SpinePrice {
  baseRate: number;          // reference/market rate
  livePrice: number;         // customer-facing dynamic price
  bidFloor: number;          // /bid auction + negotiation floor
  flashPrice: number;        // flash-deal price
  flashFloor: number;        // flash-deal floor
  competitorMin: number | null;
  vacancyRatio: number | null;
  demandScore: number;       // 0..100
  factors: string[];         // human-readable "why" list
  // ── v249.3 Phase 3 — AI yield optimizer (observability + flag-gated apply).
  //   optimizedLive  → expected-revenue-maximizing price within the guard
  //                    band. ALWAYS computed (so the shadow API + admin can
  //                    compare rule-vs-optimized without flipping live).
  //   optimizerApplied → true ONLY when PRICING_OPTIMIZER_ENABLED=1, in which
  //                    case livePrice === optimizedLive. Default OFF → these
  //                    are observability-only and livePrice stays the rule
  //                    price (byte-identical to v249.2).
  optimizedLive?: number;
  optimizerApplied?: boolean;
}

// Live price is forced at least this far below the cheapest competitor.
export const COMPETITOR_UNDERCUT = 0.05; // 5%
// Flash deal discount off the live price.
export const FLASH_DISCOUNT = 0.20;      // 20%

/**
 * Compute every spine price for one room on one date. Pure + deterministic
 * within the hour (calculateDynamicPrice is hour-seeded).
 */
export function computeRoomDatePrice(inp: SpineInput): SpinePrice {
  const floor = Math.max(0, Number(inp.floorPrice) || 0);
  // Reference rate — never below the floor. Falls back to floor×1.6 if a
  // hotel never set an mrp.
  const baseRate = Math.max(floor, Number(inp.mrp) || floor * 1.6);

  // ── Demand model — calendar (season / day-of-week / festival / lead
  //    time), city baseline, and live vacancy yield. baseFloor anchors
  //    the multiplier; a missing floor falls back to ₹1000 so the engine
  //    still runs. ───────────────────────────────────────────────────
  const vac = typeof inp.vacancyRatio === "number" && Number.isFinite(inp.vacancyRatio)
    ? Math.max(0, Math.min(1, inp.vacancyRatio))
    : undefined;
  const cfg = inp.engineCfg || undefined;
  const dyn = calculateDynamicPrice(floor || 1000, inp.date, inp.city, vac, cfg);

  let live = Math.max(floor, dyn.price);
  const factors = [...dyn.factors];

  // ── THE PROMISE — always strictly below the cheapest competitor. ────
  // Undercut % is admin-tunable; default 5% (COMPETITOR_UNDERCUT).
  const undercut = (typeof cfg?.undercutPct === "number" && Number.isFinite(cfg.undercutPct))
    ? Math.max(0, Math.min(1, cfg.undercutPct / 100))
    : COMPETITOR_UNDERCUT;
  const comp = Number(inp.competitorMin) > 0 ? Number(inp.competitorMin) : null;
  if (comp) {
    const cap = comp * (1 - undercut);
    if (live > cap) {
      live = cap;
      factors.unshift("Beats every competitor");
    }
  }

  // v720 Gap-6 (opt-in) — never let the live price exceed the MRP/rack rate.
  // OFF by default so existing behaviour is unchanged; admin turns it on.
  if (cfg?.capLiveAtMrp && baseRate > 0 && live > baseRate) {
    live = baseRate;
    factors.unshift("Capped at rack rate");
  }

  // Never below the negotiation floor — hard lower bound.
  live = snap100(Math.max(live, floor));

  // ── v249.3 Phase 3 — YIELD OPTIMIZER. Compute the expected-revenue-
  //    maximizing price within a guarded band (floor + competitor cap +
  //    ±12% rule-anchor + snap100). ALWAYS computed for observability.
  //    Applied to `live` ONLY when PRICING_OPTIMIZER_ENABLED=1 — default
  //    OFF keeps livePrice byte-identical to v249.2. Computed BEFORE the
  //    flash price so flash derives from the (possibly optimized) live.
  const opt = optimizePrice({
    floor,
    ruleLive: live,
    competitorMin: comp,
    vacancyRatio: vac ?? null,
  });
  const optimizerApplied = optimizerEnabled();
  if (optimizerApplied) {
    live = opt.optimizedLive;
    factors.push("AI yield optimized");
  }

  // ── Flash price — a clear discount under the live price, never below
  //    the flash floor. ────────────────────────────────────────────────
  const flashFloor = snap100(Math.max(floor, Number(inp.flashFloorPrice) || floor));
  // Flash discount off the live price is admin-tunable; default 20% (FLASH_DISCOUNT).
  const flashDisc = (typeof cfg?.flashDiscountPct === "number" && Number.isFinite(cfg.flashDiscountPct))
    ? Math.max(0, Math.min(1, cfg.flashDiscountPct / 100))
    : FLASH_DISCOUNT;
  let flash = snap100(live * (1 - flashDisc));
  if (flash < flashFloor) flash = flashFloor;
  if (flash > live) flash = live;

  return {
    baseRate: snap100(baseRate),
    livePrice: live,
    bidFloor: snap100(floor),
    flashPrice: flash,
    flashFloor,
    competitorMin: comp,
    vacancyRatio: vac ?? null,
    demandScore: dyn.demandScore,
    factors,
    optimizedLive: opt.optimizedLive,
    optimizerApplied,
  };
}
