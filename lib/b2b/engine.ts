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

import { nightsBetween } from "@/lib/inventory/engine";

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

// ⚠️ FLAGGED DEFAULT — B2B platform fee %. StayBid's cut on an investor-to-
// investor trade. Lower than the 12% consumer resale fee (`inventory_blocks`)
// because it's wholesale B2B, not retail. Sensible default until Sachin wires
// it to `service_pricing` (the same admin-editable fee infra the host wizard +
// subscriptions use). Kept in ONE place so a future change is a single edit.
export const B2B_FEE_PCT_DEFAULT = 8;

// Guardrails on a seller-set ask (the seller prices their own goods freely,
// but the value is still bounded to catch fat-finger / abuse).
export const MIN_B2B_ASK_PER_NIGHT = 1;
export const MAX_B2B_ASK_PER_NIGHT = 1_000_000;

const round0 = (n: number) => Math.round(Number(n) || 0);
const clampPct = (p: any) => {
  const n = Number(p);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : B2B_FEE_PCT_DEFAULT;
};

/** True if a seller-set ask/night is within the allowed bounds. */
export function isValidAskPerNight(ask: any): boolean {
  const n = Number(ask);
  return Number.isFinite(n) && n >= MIN_B2B_ASK_PER_NIGHT && n <= MAX_B2B_ASK_PER_NIGHT;
}

export interface B2bTradeSplitInput {
  askPerNight: number;   // seller's B2B ask/night
  nights: number;
  feePct?: number;       // defaults to B2B_FEE_PCT_DEFAULT
  buyTotal?: number;     // seller's own cost snapshot (for margin display only)
}

export interface B2bTradeSplit {
  nights: number;
  askPerNight: number;
  askTotal: number;        // what the buyer pays (Σ ask)
  platformFeePct: number;
  platformFee: number;     // StayBid's cut (out of the ask)
  sellerNet: number;       // askTotal − platformFee (what the seller receives)
  buyTotal: number;        // seller's cost snapshot
  sellerMargin: number;    // sellerNet − buyTotal (seller's profit vs their cost)
}

/**
 * The money split for a B2B trade. Pure — the listing endpoint (to freeze the
 * fee %), the D3 checkout (to freeze buyerPays/sellerNet/platformFee), and the
 * client preview ALL call this so preview == charge == settlement.
 *
 * Convention: buyer pays the ask total; the platform fee is StayBid's cut OUT
 * of that total; the seller receives the remainder (ask − fee).
 */
export function b2bTradeSplit(input: B2bTradeSplitInput): B2bTradeSplit {
  const feePct = clampPct(input.feePct);
  const nights = Math.max(0, Math.floor(Number(input.nights) || 0));
  const askPerNight = Math.max(0, round0(input.askPerNight));
  const askTotal = round0(askPerNight * nights);
  const platformFee = round0((askTotal * feePct) / 100);
  const sellerNet = round0(askTotal - platformFee);
  const buyTotal = Math.max(0, round0(input.buyTotal || 0));
  return {
    nights,
    askPerNight,
    askTotal,
    platformFeePct: feePct,
    platformFee,
    sellerNet,
    buyTotal,
    sellerMargin: round0(sellerNet - buyTotal),
  };
}

/** Re-export so callers building a B2B listing don't also import the inventory engine. */
export { nightsBetween };
