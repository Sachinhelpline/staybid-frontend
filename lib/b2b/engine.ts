// ════════════════════════════════════════════════════════════════════════
// v331 — Circle Phase D1: Model 4 B2B exchange engine (PURE, no fetch).
//
// Model 4 = intermediary commerce. An investor who OWNS inventory (a Model 3
// `inventory_blocks` row in `owned` status — bounded date-range goods) lists
// it on a B2B exchange; ANOTHER investor buys it at the seller's B2B ask.
// StayBid is the platform + takes a fee on the trade. B2B-only (no retail) →
// far from SEBI/CIS.
//
//   ask (B2B)     = the seller's own price for their owned goods. The seller
//                   sets this freely (it's their inventory) — unlike Model 3
//                   where the wholesale BUY is Spine-frozen (StayBid selling).
//   platform fee  = % StayBid takes on the trade (server-frozen, tamper-safe).
//   seller net    = ask − platform fee  (fee borne out of the seller's proceeds).
//   buyer pays    = ask total  (the buyer pays the ask; the fee is StayBid's cut
//                   of that, NOT an add-on the buyer sees separately).
//
// Shared by the listing endpoint, the (future D3) trade checkout, and the
// client UI so the numbers NEVER drift. No Supabase, no I/O.
// ════════════════════════════════════════════════════════════════════════

import { nightsBetween, markdownResalePerNight, daysUntil } from "@/lib/inventory/engine";

export const B2B_LISTING_STATUSES = [
  "draft", "listed", "sold", "cancelled", "withdrawn", "expired",
] as const;
export type B2bListingStatus = (typeof B2B_LISTING_STATUSES)[number];

// A block is "committed to a live B2B offer" while a listing is in one of these.
export const ACTIVE_B2B_LISTING_STATUSES: B2bListingStatus[] = ["draft", "listed"];
export const TERMINAL_B2B_LISTING_STATUSES: B2bListingStatus[] = [
  "sold", "cancelled", "withdrawn", "expired",
];

export const B2B_TRADE_STATUSES = [
  "pending_payment", "completed", "failed", "cancelled",
] as const;
export type B2bTradeStatus = (typeof B2B_TRADE_STATUSES)[number];

// ⚠️ FLAGGED DEFAULTS — B2B commission is DUAL-SIDED (v347). StayBid takes a cut
// from BOTH sides of an investor-to-investor trade: the buyer pays their fee ON
// TOP of the ask, the seller's fee is deducted from their proceeds. Both % are
// admin-controlled (lib/b2b/fee-config-store.ts → `b2b_fee_config`); these are
// only the fallbacks when the config table is unreachable. Frozen onto each
// listing at list time (tamper-safe) so a later admin change never re-prices a
// live listing.
export const B2B_BUYER_FEE_PCT_DEFAULT = 5;
export const B2B_SELLER_FEE_PCT_DEFAULT = 5;
// Legacy single-fee default — kept only so any un-migrated caller still resolves;
// superseded by the dual buyer/seller fee above.
export const B2B_FEE_PCT_DEFAULT = 8;

// Guardrails on an ask/night (bounds catch fat-finger / abuse).
export const MIN_B2B_ASK_PER_NIGHT = 1;
export const MAX_B2B_ASK_PER_NIGHT = 1_000_000;

// v349 — Model 2 is REGULATED: the B2B ask is NOT a free seller input, it's the
// Spine wholesale floor + an admin-controlled markup. v354 — the rule is now
// "list at DOUBLE the purchase price" (owner paid 1k/day → sell at 2k/day), so
// the default markup is 100% (= 2×). Admin-adjustable; this is the fallback.
export const B2B_REGULATED_MARKUP_PCT_DEFAULT = 100;

/**
 * The StayBid-regulated B2B ask/night = wholesale/night × (1 + markup%).
 * Bounded to the ask guardrails. Pure — the listing endpoint + the client
 * preview share it so the regulated price NEVER drifts.
 */
export function regulatedB2bAskPerNight(wholesalePerNight: number, markupPct: number): number {
  const w = Math.max(0, Math.round(Number(wholesalePerNight) || 0));
  const m = Number.isFinite(Number(markupPct)) && Number(markupPct) >= 0 ? Number(markupPct) : B2B_REGULATED_MARKUP_PCT_DEFAULT;
  const ask = Math.round(w * (1 + m / 100));
  return Math.min(MAX_B2B_ASK_PER_NIGHT, Math.max(MIN_B2B_ASK_PER_NIGHT, ask));
}

const round0 = (n: number) => Math.round(Number(n) || 0);
const clampPct = (p: any, fallback: number) => {
  const n = Number(p);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback;
};

/** True if a seller-set ask/night is within the allowed bounds. */
export function isValidAskPerNight(ask: any): boolean {
  const n = Number(ask);
  return Number.isFinite(n) && n >= MIN_B2B_ASK_PER_NIGHT && n <= MAX_B2B_ASK_PER_NIGHT;
}

export interface B2bTradeSplitInput {
  askPerNight: number;    // seller's B2B ask/night
  nights: number;
  buyerFeePct?: number;   // defaults to B2B_BUYER_FEE_PCT_DEFAULT
  sellerFeePct?: number;  // defaults to B2B_SELLER_FEE_PCT_DEFAULT
  feePct?: number;        // LEGACY — used as sellerFeePct if the dual ones are absent
  buyTotal?: number;      // seller's own cost snapshot (for margin display only)
}

export interface B2bTradeSplit {
  nights: number;
  askPerNight: number;
  askTotal: number;        // the seller's ask (Σ ask/night) — the trade base
  buyerFeePct: number;
  sellerFeePct: number;
  buyerFee: number;        // buyer's commission, added ON TOP of the ask
  sellerFee: number;       // seller's commission, deducted from the ask
  buyerPays: number;       // askTotal + buyerFee  ← what the buyer is charged
  platformFeePct: number;  // buyerFeePct + sellerFeePct (total — display/legacy)
  platformFee: number;     // buyerFee + sellerFee (StayBid's total cut)
  sellerNet: number;       // askTotal − sellerFee (what the seller receives)
  buyTotal: number;        // seller's cost snapshot
  sellerMargin: number;    // sellerNet − buyTotal (seller's profit vs their cost)
}

/**
 * The money split for a B2B trade — DUAL-SIDED commission (v347). Pure — the
 * listing endpoint (freezes both fee %), the checkout (freezes
 * buyerPays/sellerNet/fees), verify (settlement), and the client preview ALL
 * call this so preview == charge == settlement.
 *
 * Convention: the seller sets the ask. The BUYER is charged askTotal + buyerFee;
 * the SELLER receives askTotal − sellerFee; StayBid keeps buyerFee + sellerFee.
 */
export function b2bTradeSplit(input: B2bTradeSplitInput): B2bTradeSplit {
  const sellerFeePct = clampPct(
    input.sellerFeePct ?? input.feePct ?? B2B_SELLER_FEE_PCT_DEFAULT,
    B2B_SELLER_FEE_PCT_DEFAULT,
  );
  const buyerFeePct = clampPct(input.buyerFeePct ?? B2B_BUYER_FEE_PCT_DEFAULT, B2B_BUYER_FEE_PCT_DEFAULT);
  const nights = Math.max(0, Math.floor(Number(input.nights) || 0));
  const askPerNight = Math.max(0, round0(input.askPerNight));
  const askTotal = round0(askPerNight * nights);
  const sellerFee = round0((askTotal * sellerFeePct) / 100);
  const buyerFee = round0((askTotal * buyerFeePct) / 100);
  const sellerNet = round0(askTotal - sellerFee);
  const buyerPays = round0(askTotal + buyerFee);
  const buyTotal = Math.max(0, round0(input.buyTotal || 0));
  return {
    nights,
    askPerNight,
    askTotal,
    buyerFeePct,
    sellerFeePct,
    buyerFee,
    sellerFee,
    buyerPays,
    platformFeePct: round0(buyerFeePct + sellerFeePct),
    platformFee: round0(buyerFee + sellerFee),
    sellerNet,
    buyTotal,
    sellerMargin: round0(sellerNet - buyTotal),
  };
}

// ════════════════════════════════════════════════════════════════════════
// v334 — Circle Phase D4: dynamic auto-markdown on LISTED B2B listings.
//
// A B2B listing is inter-investor wholesale; as its stay's check-in nears an
// unsold listing loses value, so the lifecycle cron marks the seller's ask
// DOWN in the same tiers as Model-3 resale (`markdownResalePerNight`), computed
// from a FROZEN original (`metadata.listAskPerNight`, stamped on the first
// markdown) so re-running is idempotent + NON-compounding, and NEVER below the
// seller's own per-night cost (`buy_total / nights` — they'd rather hold than
// sell at a loss). Pure — the cron + client share it.
//
// Same tier table + floor discipline as C4; the only B2B twist is the buy floor
// is derived from the listing's `buy_total` (a whole-block snapshot) ÷ nights,
// because a B2B listing stores the aggregate cost, not a per-night array.
// ════════════════════════════════════════════════════════════════════════

/**
 * Marked-down ask/night for a B2B listing from the FROZEN original, floored at
 * the seller's per-night buy cost. Idempotent + non-compounding: always
 * recomputes from `originalAskPerNight`, never from the already-marked price.
 */
export function markdownB2bAskPerNight(args: {
  originalAskPerNight: number;
  buyTotal: number;
  nights: number;
  daysOut: number;
}): { perNight: number; pct: number } {
  const nights = Math.max(1, Math.floor(Number(args.nights) || 1));
  const buyPerNight = Math.max(0, round0(Number(args.buyTotal) || 0) / nights);
  return markdownResalePerNight({
    originalPerNight: args.originalAskPerNight,
    buyPerNight,
    daysOut: args.daysOut,
  });
}

/** Re-export so callers building a B2B listing don't also import the inventory engine. */
export { nightsBetween, daysUntil };
