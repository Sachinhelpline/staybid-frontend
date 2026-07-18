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
import { B2B_BUYER_FEE_PCT_DEFAULT, B2B_SELLER_FEE_PCT_DEFAULT } from "./engine";

export const B2B_FEE_CONFIG_ID = "default";

export const CITY_ACCESS_PRICE_DEFAULT = 999;

export interface B2bFeeConfig {
  buyerFeePct: number;
  sellerFeePct: number;
  cityAccessPrice: number;   // ₹ one-time per city (v348)
}

const DEFAULT: B2bFeeConfig = {
  buyerFeePct: B2B_BUYER_FEE_PCT_DEFAULT,
  sellerFeePct: B2B_SELLER_FEE_PCT_DEFAULT,
  cityAccessPrice: CITY_ACCESS_PRICE_DEFAULT,
};

const clampPct = (v: any, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback;
};
const clampMoney = (v: any, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 10_000_000 ? n : fallback;
};

let _cache: { at: number; cfg: B2bFeeConfig } | null = null;
const TTL_MS = 60_000;

export async function resolveB2bFeeConfig(): Promise<B2bFeeConfig> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.cfg;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/b2b_fee_config?id=eq.${B2B_FEE_CONFIG_ID}&select=buyer_fee_pct,seller_fee_pct,city_access_price`,
      { headers: SB_READ, cache: "no-store" },
    );
    if (r.ok) {
      const rows = await r.json().catch(() => []);
      const row = Array.isArray(rows) ? rows[0] : null;
      const cfg: B2bFeeConfig = {
        buyerFeePct: clampPct(row?.buyer_fee_pct, DEFAULT.buyerFeePct),
        sellerFeePct: clampPct(row?.seller_fee_pct, DEFAULT.sellerFeePct),
        cityAccessPrice: clampMoney(row?.city_access_price, DEFAULT.cityAccessPrice),
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
