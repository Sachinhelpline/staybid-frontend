// ============================================================================
// v347 — Circle Model 2: B2B dual-fee config resolver (server-only).
//
// Reads the admin-edited `b2b_fee_config` singleton (buyer_fee_pct +
// seller_fee_pct) and clamps each to [0,100], falling back to the engine
// defaults (5% / 5%). Cached per-Lambda for 60s. Same pattern as
// lib/circle/revenue-config-store.
//
// These % are frozen ONTO each listing at list time (tamper-safe) — this
// resolver is read at LIST time, not at checkout. A later admin change only
// affects listings created after it.
// ============================================================================

import { SB_URL, SB_READ } from "@/lib/sb";
import {
  B2B_BUYER_FEE_PCT_DEFAULT, B2B_SELLER_FEE_PCT_DEFAULT, B2B_REGULATED_MARKUP_PCT_DEFAULT,
  B2B_RESALE_MULTIPLIER_DEFAULT,
} from "./engine";

export const B2B_FEE_CONFIG_ID = "default";

export const CITY_ACCESS_PRICE_DEFAULT = 999;

// v725 — the OWNER may pick their own resale multiplier, but ONLY inside this
// admin-set band (keeps Model-2 "regulated": bounded, not free pricing).
export const RESALE_MULT_MIN_DEFAULT = 1.5;
export const RESALE_MULT_MAX_DEFAULT = 3;

export interface B2bFeeConfig {
  buyerFeePct: number;
  sellerFeePct: number;
  cityAccessPrice: number;      // ₹ one-time per city (v348)
  regulatedMarkupPct: number;   // LEGACY markup form of the resale price (v349)
  resaleMultiplier: number;     // v355 — sell price = ownPerNight × this (default 2× = double)
  resaleMultiplierMin: number;  // v725 — owner-choice band lower bound
  resaleMultiplierMax: number;  // v725 — owner-choice band upper bound
}

const DEFAULT: B2bFeeConfig = {
  buyerFeePct: B2B_BUYER_FEE_PCT_DEFAULT,
  sellerFeePct: B2B_SELLER_FEE_PCT_DEFAULT,
  cityAccessPrice: CITY_ACCESS_PRICE_DEFAULT,
  regulatedMarkupPct: B2B_REGULATED_MARKUP_PCT_DEFAULT,
  resaleMultiplier: B2B_RESALE_MULTIPLIER_DEFAULT,
  resaleMultiplierMin: RESALE_MULT_MIN_DEFAULT,
  resaleMultiplierMax: RESALE_MULT_MAX_DEFAULT,
};

/**
 * v725 — clamp an owner-supplied multiplier into the admin band. Returns the
 * global default (not a bound) when the input is absent/invalid, so an untouched
 * listing keeps today's exact price.
 */
export function clampOwnerMultiplier(raw: any, cfg: B2bFeeConfig): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return cfg.resaleMultiplier;
  const lo = Math.min(cfg.resaleMultiplierMin, cfg.resaleMultiplierMax);
  const hi = Math.max(cfg.resaleMultiplierMin, cfg.resaleMultiplierMax);
  return Math.min(hi, Math.max(lo, n));
}

const clampPct = (v: any, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback;
};
const clampMoney = (v: any, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 10_000_000 ? n : fallback;
};
// Markup % may exceed 100 (a 2× regulated price = 100%). Bound generously.
const clampPctWide = (v: any, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? n : fallback;
};
// Multiplier: 1× (list at cost) up to 20×.
const clampMult = (v: any, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 20 ? n : fallback;
};

let _cache: { at: number; cfg: B2bFeeConfig } | null = null;
const TTL_MS = 60_000;

export async function resolveB2bFeeConfig(): Promise<B2bFeeConfig> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.cfg;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/b2b_fee_config?id=eq.${B2B_FEE_CONFIG_ID}&select=buyer_fee_pct,seller_fee_pct,city_access_price,regulated_markup_pct,resale_multiplier,resale_multiplier_min,resale_multiplier_max`,
      { headers: SB_READ, cache: "no-store" },
    );
    if (r.ok) {
      const rows = await r.json().catch(() => []);
      const row = Array.isArray(rows) ? rows[0] : null;
      const cfg: B2bFeeConfig = {
        buyerFeePct: clampPct(row?.buyer_fee_pct, DEFAULT.buyerFeePct),
        sellerFeePct: clampPct(row?.seller_fee_pct, DEFAULT.sellerFeePct),
        cityAccessPrice: clampMoney(row?.city_access_price, DEFAULT.cityAccessPrice),
        regulatedMarkupPct: clampPctWide(row?.regulated_markup_pct, DEFAULT.regulatedMarkupPct),
        // Prefer the explicit multiplier; fall back to deriving it from the
        // legacy markup % so an un-migrated row still resolves sensibly.
        resaleMultiplier: clampMult(
          row?.resale_multiplier,
          clampMult(1 + clampPctWide(row?.regulated_markup_pct, DEFAULT.regulatedMarkupPct) / 100, DEFAULT.resaleMultiplier),
        ),
        resaleMultiplierMin: clampMult(row?.resale_multiplier_min, DEFAULT.resaleMultiplierMin),
        resaleMultiplierMax: clampMult(row?.resale_multiplier_max, DEFAULT.resaleMultiplierMax),
      };
      _cache = { at: Date.now(), cfg };
      return cfg;
    }
  } catch {
    /* fall through to defaults */
  }
  // Table missing / unreachable → engine defaults keep trades working.
  return DEFAULT;
}

// Call after an admin write so the next resolve reflects the change immediately.
export function invalidateB2bFeeConfigCache(): void {
  _cache = null;
}
