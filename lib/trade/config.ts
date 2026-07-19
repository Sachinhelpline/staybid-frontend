// ============================================================================
// v361 — Model 3 (travel-agent monthly auction): admin config resolver.
// Server-only. Reads the `auction_config` singleton and clamps every field,
// falling back to safe defaults. Cached per-Lambda for 60s. Same pattern as
// lib/b2b/fee-config-store.
//
// These values are read at BID time and FROZEN onto the bid/award rows
// (tamper-safe) — a later admin change only affects new bids/awards.
// ============================================================================
import { SB_URL, SB_READ } from "@/lib/sb";

export const AUCTION_CONFIG_ID = "default";

export interface AuctionConfig {
  buyerPremiumPct: number;  // added on top of the winning bid (agent pays)
  sellerFeePct: number;     // deducted from the owner's net
  depositPct: number;       // EMD = depositPct% of the bid total
  windowOpenDay: number;    // day of the PREVIOUS month the auction opens
  payWindowHours: number;   // winner's balance-pay window after clearing
  minBidFloorMode: string;  // 'spine' = Spine bidFloor is the hard floor
  circleFloorMultiplier: number; // Model-3 floor × for host_circle lots (protects Model-2)
}

export const AUCTION_CONFIG_DEFAULT: AuctionConfig = {
  buyerPremiumPct: 5,
  sellerFeePct: 5,
  depositPct: 10,
  windowOpenDay: 24,
  payWindowHours: 48,
  minBidFloorMode: "spine",
  circleFloorMultiplier: 1.2, // Circle-owner floor = purchase cost × 1.20 (cover + 20% profit)
};

const clampMult = (v: any, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 20 ? n : fallback;
};

const clampPct = (v: any, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback;
};
const clampInt = (v: any, fallback: number, lo: number, hi: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= lo && n <= hi ? n : fallback;
};

let _cache: { at: number; cfg: AuctionConfig } | null = null;
const TTL_MS = 60_000;

export async function resolveAuctionConfig(): Promise<AuctionConfig> {
  const now = Date.now();
  if (_cache && now - _cache.at < TTL_MS) return _cache.cfg;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/auction_config?id=eq.${AUCTION_CONFIG_ID}&select=*&limit=1`,
      { headers: SB_READ, cache: "no-store" },
    );
    if (r.ok) {
      const [row] = await r.json();
      if (row) {
        const cfg: AuctionConfig = {
          buyerPremiumPct: clampPct(row.buyer_premium_pct, AUCTION_CONFIG_DEFAULT.buyerPremiumPct),
          sellerFeePct: clampPct(row.seller_fee_pct, AUCTION_CONFIG_DEFAULT.sellerFeePct),
          depositPct: clampPct(row.deposit_pct, AUCTION_CONFIG_DEFAULT.depositPct),
          windowOpenDay: clampInt(row.window_open_day, AUCTION_CONFIG_DEFAULT.windowOpenDay, 1, 28),
          payWindowHours: clampInt(row.pay_window_hours, AUCTION_CONFIG_DEFAULT.payWindowHours, 1, 336),
          minBidFloorMode: typeof row.min_bid_floor_mode === "string" ? row.min_bid_floor_mode : "spine",
          circleFloorMultiplier: clampMult(row.circle_floor_multiplier, AUCTION_CONFIG_DEFAULT.circleFloorMultiplier),
        };
        _cache = { at: now, cfg };
        return cfg;
      }
    }
  } catch { /* fall through to defaults */ }
  _cache = { at: now, cfg: AUCTION_CONFIG_DEFAULT };
  return AUCTION_CONFIG_DEFAULT;
}

export function invalidateAuctionConfigCache() {
  _cache = null;
}
