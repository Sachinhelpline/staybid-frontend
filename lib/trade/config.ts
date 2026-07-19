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
  livePayWindowHours: number;    // LIVE mode: agent's pay window after an accept
  liveDefaultAutopilot: string;  // LIVE mode: default autopilot pre-selected in the owner form
  liveHybridAcceptRatio: number; // LIVE hybrid: auto-accept a bid ≥ floor × this ratio
  wholesaleDiscountPct: number;  // property-owner discount off the reference price
  floorMode: string;             // 'dynamic' (Spine ADR-linked) | 'static' (floorPrice-linked)
  minFloorFraction: number;      // hard anchor: floor never below retail floorPrice × this
  belowFloorMinRatio: number;    // agents may bid down to floor × this (owner-reviewed); below = rejected
}

export const AUCTION_CONFIG_DEFAULT: AuctionConfig = {
  buyerPremiumPct: 5,
  sellerFeePct: 5,
  depositPct: 10,
  windowOpenDay: 24,
  payWindowHours: 48,
  minBidFloorMode: "spine",
  circleFloorMultiplier: 1.2, // Circle-owner floor = purchase cost × 1.20 (cover + 20% profit)
  livePayWindowHours: 24,     // accept → 24h to pay from the agent dashboard
  liveDefaultAutopilot: "hybrid",
  liveHybridAcceptRatio: 1.15, // Smart instant-lock: a bid ≥ floor × 1.15 locks instantly (at-floor → owner review)
  wholesaleDiscountPct: 20,   // property-owner wholesale discount off the reference price
  floorMode: "dynamic",       // Spine ADR-linked floor by default (tracks live demand)
  minFloorFraction: 0.6,      // dynamic floor never below retail floorPrice × 0.6
  belowFloorMinRatio: 0.85,   // a below-floor bid is allowed down to floor × 0.85 (owner reviews)
};

// Discounts are bounded 0–40% (never gut the owner's price); returns fallback otherwise.
const clampDiscount = (v: any, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 40 ? n : fallback;
};
// Anchor fraction bounded 0.4–1.0 (never let the dynamic floor collapse the owner's price).
const clampFraction = (v: any, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0.4 && n <= 1 ? n : fallback;
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
          livePayWindowHours: clampInt(row.live_pay_window_hours, AUCTION_CONFIG_DEFAULT.livePayWindowHours, 1, 336),
          liveDefaultAutopilot: (row.live_default_autopilot === "auto" || row.live_default_autopilot === "manual" || row.live_default_autopilot === "hybrid") ? row.live_default_autopilot : "hybrid",
          liveHybridAcceptRatio: clampMult(row.live_hybrid_accept_ratio, AUCTION_CONFIG_DEFAULT.liveHybridAcceptRatio),
          wholesaleDiscountPct: clampDiscount(row.wholesale_discount_pct, AUCTION_CONFIG_DEFAULT.wholesaleDiscountPct),
          floorMode: row.floor_mode === "static" ? "static" : "dynamic",
          minFloorFraction: clampFraction(row.min_floor_fraction, AUCTION_CONFIG_DEFAULT.minFloorFraction),
          belowFloorMinRatio: (() => { const n = Number(row.below_floor_min_ratio); return Number.isFinite(n) && n >= 0.5 && n <= 1 ? n : AUCTION_CONFIG_DEFAULT.belowFloorMinRatio; })(),
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
