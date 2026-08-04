// ============================================================================
// v720 — Admin-tunable pricing-engine config resolver (server-only).
//
// Reads the admin-edited `pricing_engine_config` singleton and resolves EVERY
// knob field-by-field, falling back to the hardcoded engine defaults
// (PRICING_ENGINE_HARDCODED in lib/ai-pricing.ts + COMPETITOR_UNDERCUT /
// FLASH_DISCOUNT in lib/pricing/spine.ts) whenever a value is missing or
// invalid. Cached per-Lambda for 60s. Same pattern as
// lib/b2b/fee-config-store.ts.
//
// The AI formula is NOT changed by this — it only supplies the "digits" the
// formula multiplies. The resolved object is passed into computeRoomDatePrice
// (via SpineInput.engineCfg) by the authoritative server writers (the cron
// price-spine + read-spine). Client-side fallbacks never call this and pass no
// cfg, so they stay byte-identical to the pre-v720 engine.
//
// Fail-open: table missing / unreachable / any error → hardcoded defaults keep
// pricing working exactly as before (never throws, never blocks a price).
// ============================================================================

import { SB_URL, SB_READ } from "@/lib/sb";
import { PRICING_ENGINE_HARDCODED, type PricingEngineOverrides } from "@/lib/ai-pricing";
import { COMPETITOR_UNDERCUT, FLASH_DISCOUNT } from "@/lib/pricing/spine";

export const PRICING_ENGINE_CONFIG_ID = "default";

// The fully-resolved config — assignable to SpineInput.engineCfg. Every field
// present (no nulls) so the engine reads a concrete number for each knob.
export interface PricingEngineConfig extends PricingEngineOverrides {
  seasonMults: number[];
  dowMults: number[];
  occupancyMults: number[];
  leadMults: number[];
  eventMults: number[];
  cityDemand: Record<string, number>;
  monsoonMult: number;
  schoolMult: number;
  longWeekendMult: number;
  longWeekendHolidayMult: number;
  microAmplitudePct: number;
  clampMin: number;
  clampMax: number;
  // spine-level knobs
  undercutPct: number;      // OTA undercut % (default 5)
  flashDiscountPct: number; // flash discount % off live (default 20)
  capLiveAtMrp: boolean;    // Gap-6 opt-in
  // v722 Gap-1 — dynamic customer bid floor
  custFloorMode: "static" | "dynamic"; // default 'static' (unchanged behaviour)
  custFloorMaxWinDiscountPct: number;  // how far below live the win-floor sits (default 25)
  custFloorMinFraction: number;        // hard lower bound = floorPrice × this (default 1.0)
  // v723 Gap-3 — customer below-floor forwarded offers. 1.0 = OFF (today's hard
  // reject at floor). < 1.0 lets a guest OFFER down to floor × this ratio; the
  // real offer is stored + forwarded PENDING (never auto-accepted) for the owner.
  custBelowFloorRatio: number;         // default 1.0 (off)
  // v724 Gap-2 — AI yield optimizer. false = rule price (default). true applies
  // the expected-revenue-max nudge (±12% guarded). Env PRICING_OPTIMIZER_ENABLED
  // also forces it on.
  yieldOptimizerEnabled: boolean;
}

// Hardcoded defaults, assembled once from the engine's own constants.
export const PRICING_ENGINE_DEFAULTS: PricingEngineConfig = {
  seasonMults: PRICING_ENGINE_HARDCODED.seasonMults.slice(),
  dowMults: PRICING_ENGINE_HARDCODED.dowMults.slice(),
  occupancyMults: PRICING_ENGINE_HARDCODED.occupancyMults.slice(),
  leadMults: PRICING_ENGINE_HARDCODED.leadMults.slice(),
  eventMults: PRICING_ENGINE_HARDCODED.eventMults.slice(),
  cityDemand: { ...PRICING_ENGINE_HARDCODED.cityDemand },
  monsoonMult: PRICING_ENGINE_HARDCODED.monsoonMult,
  schoolMult: PRICING_ENGINE_HARDCODED.schoolMult,
  longWeekendMult: PRICING_ENGINE_HARDCODED.longWeekendMult,
  longWeekendHolidayMult: PRICING_ENGINE_HARDCODED.longWeekendHolidayMult,
  microAmplitudePct: PRICING_ENGINE_HARDCODED.microAmplitudePct,
  clampMin: PRICING_ENGINE_HARDCODED.clampMin,
  clampMax: PRICING_ENGINE_HARDCODED.clampMax,
  undercutPct: COMPETITOR_UNDERCUT * 100,
  flashDiscountPct: FLASH_DISCOUNT * 100,
  capLiveAtMrp: false,
  custFloorMode: "static",
  custFloorMaxWinDiscountPct: 25,
  custFloorMinFraction: 1.0,
  custBelowFloorRatio: 1.0,
  yieldOptimizerEnabled: false,
};

// ── validators ───────────────────────────────────────────────────────────────
// A single multiplier: sane band 0.05–5 (a factor should never zero-out or 10×).
const okMult = (v: any): boolean => Number.isFinite(Number(v)) && Number(v) >= 0.05 && Number(v) <= 5;
// Resolve a numeric array of an EXACT length; any bad element → whole fallback.
function arr(v: any, len: number, fallback: number[]): number[] {
  if (!Array.isArray(v) || v.length !== len) return fallback.slice();
  const out = v.map((x) => Number(x));
  return out.every(okMult) ? out : fallback.slice();
}
// A bounded scalar in [lo, hi].
function num(v: any, lo: number, hi: number, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : fallback;
}
// City-demand override map: keep only sane numeric entries; merge over defaults.
function cityMap(v: any, fallback: Record<string, number>): Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ...fallback };
  const merged: Record<string, number> = { ...fallback };
  for (const k of Object.keys(v)) {
    if (okMult(v[k])) merged[k] = Number(v[k]);
  }
  return merged;
}

let _cache: { at: number; cfg: PricingEngineConfig } | null = null;
const TTL_MS = 60_000;

export async function resolveEngineConfig(): Promise<PricingEngineConfig> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.cfg;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/pricing_engine_config?id=eq.${PRICING_ENGINE_CONFIG_ID}&select=*`,
      { headers: SB_READ, cache: "no-store" },
    );
    if (r.ok) {
      const rows = await r.json().catch(() => []);
      const row = Array.isArray(rows) ? rows[0] : null;
      if (row) {
        const D = PRICING_ENGINE_DEFAULTS;
        const cfg: PricingEngineConfig = {
          seasonMults: arr(row.season_mults, 12, D.seasonMults),
          dowMults: arr(row.dow_mults, 7, D.dowMults),
          occupancyMults: arr(row.occupancy_mults, 5, D.occupancyMults),
          leadMults: arr(row.lead_mults, 6, D.leadMults),
          eventMults: arr(row.event_mults, D.eventMults.length, D.eventMults),
          cityDemand: cityMap(row.city_demand, D.cityDemand),
          monsoonMult: num(row.monsoon_mult, 0.3, 1.5, D.monsoonMult),
          schoolMult: num(row.school_mult, 0.5, 3, D.schoolMult),
          longWeekendMult: num(row.long_weekend_mult, 0.5, 3, D.longWeekendMult),
          longWeekendHolidayMult: num(row.long_weekend_holiday_mult, 0.5, 3, D.longWeekendHolidayMult),
          microAmplitudePct: num(row.micro_amplitude_pct, 0, 20, D.microAmplitudePct),
          clampMin: num(row.clamp_min, 0.2, 1, D.clampMin),
          clampMax: num(row.clamp_max, 1, 5, D.clampMax),
          undercutPct: num(row.undercut_pct, 0, 50, D.undercutPct),
          flashDiscountPct: num(row.flash_discount_pct, 0, 90, D.flashDiscountPct),
          capLiveAtMrp: row.cap_live_at_mrp === true || row.cap_live_at_mrp === "true",
          custFloorMode: row.cust_floor_mode === "dynamic" ? "dynamic" : "static",
          custFloorMaxWinDiscountPct: num(row.cust_floor_max_win_discount_pct, 0, 90, D.custFloorMaxWinDiscountPct),
          custFloorMinFraction: num(row.cust_floor_min_fraction, 0.4, 1, D.custFloorMinFraction),
          custBelowFloorRatio: num(row.cust_below_floor_ratio, 0.5, 1, D.custBelowFloorRatio),
          yieldOptimizerEnabled: row.yield_optimizer_enabled === true || row.yield_optimizer_enabled === "true",
        };
        // Guard: a clamp band must stay ordered.
        if (cfg.clampMin >= cfg.clampMax) { cfg.clampMin = D.clampMin; cfg.clampMax = D.clampMax; }
        _cache = { at: Date.now(), cfg };
        return cfg;
      }
    }
  } catch {
    /* fall through to defaults */
  }
  // Table missing / no row / unreachable → hardcoded defaults keep pricing working.
  const cfg = { ...PRICING_ENGINE_DEFAULTS };
  _cache = { at: Date.now(), cfg };
  return cfg;
}

// Call after an admin write so the next resolve reflects the change immediately.
export function invalidateEngineConfigCache(): void {
  _cache = null;
}
