// ════════════════════════════════════════════════════════════════════════
// v327 — Circle Phase C1: Model 3 inventory-block engine (PURE, no fetch).
//
// Model 3 commerce math, shared by the quote endpoint, the (future C2) purchase
// checkout, and the client UI so the numbers NEVER drift. No Supabase, no I/O.
//
//   wholesale (buy)  = Pricing-Spine FLOOR per night — what StayBid charges the
//                      investor to lock the room-nights.
//   retail   (resale)= investor-set price the customer eventually pays.
//   platform fee     = % StayBid takes on the resale at settlement (C3).
//   investor net     = resale − platform fee − buy cost  (their margin).
//
// Unsold risk is the investor's (commerce) — that's why buy is paid upfront.
// ════════════════════════════════════════════════════════════════════════

export const INVENTORY_STATUSES = [
  "draft", "quoted", "pending_payment", "owned",
  "listed", "sold", "expired", "cancelled", "refunded",
] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

// A block is "live inventory the investor is committed to" once money has moved.
export const ACTIVE_INVENTORY_STATUSES: InventoryStatus[] = [
  "pending_payment", "owned", "listed", "sold",
];
// Terminal / no-longer-holding states.
export const TERMINAL_INVENTORY_STATUSES: InventoryStatus[] = [
  "expired", "cancelled", "refunded",
];

// ⚠️ FLAGGED DEFAULT — platform resale fee %. Model 3's StayBid margin on the
// resale. Sensible default until Sachin wires it to `service_pricing` (the same
// admin-editable fee infra the host wizard + subscriptions use). Kept in ONE
// place so a future change is a single edit.
export const PLATFORM_RESALE_FEE_PCT_DEFAULT = 12;

// Max nights an investor can pre-buy in one block (guards the per-night Spine
// loop + keeps a block a bounded commerce unit; multi-block for longer ranges).
export const MAX_BLOCK_NIGHTS = 90;

/** Whole-day night count between two ISO dates (checkout exclusive). ≥ 0. */
export function nightsBetween(from: string, to: string): number {
  const a = Date.parse(`${String(from).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(to).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

const round0 = (n: number) => Math.round(Number(n) || 0);
const clampPct = (p: any) => {
  const n = Number(p);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : PLATFORM_RESALE_FEE_PCT_DEFAULT;
};

export interface BlockQuoteInput {
  buyPerNight: number[];               // Spine floor per night (wholesale)
  suggestedResalePerNight: number[];   // Spine live per night (retail suggestion)
  feePct?: number;                     // defaults to PLATFORM_RESALE_FEE_PCT_DEFAULT
}

export interface BlockQuote {
  nights: number;
  buyTotal: number;                    // Σ wholesale — what the investor pays now
  avgBuyPerNight: number;
  suggestedResaleTotal: number;        // Σ retail suggestion
  avgResalePerNight: number;
  feePct: number;
  estFeeOnSuggested: number;           // StayBid fee if sold at the suggestion
  estInvestorNetOnSuggested: number;   // resale − fee − buy  (their margin)
}

/** Build a pre-buy quote from per-night Spine arrays. Pure. */
export function computeBlockQuote(input: BlockQuoteInput): BlockQuote {
  const buy = (input.buyPerNight || []).map((n) => Math.max(0, Number(n) || 0));
  const sell = (input.suggestedResalePerNight || []).map((n) => Math.max(0, Number(n) || 0));
  const nights = Math.max(buy.length, sell.length);
  const feePct = clampPct(input.feePct);

  const buyTotal = round0(buy.reduce((s, n) => s + n, 0));
  const suggestedResaleTotal = round0(sell.reduce((s, n) => s + n, 0));
  const estFeeOnSuggested = round0((suggestedResaleTotal * feePct) / 100);
  const estInvestorNetOnSuggested = round0(suggestedResaleTotal - estFeeOnSuggested - buyTotal);

  return {
    nights,
    buyTotal,
    avgBuyPerNight: nights ? round0(buyTotal / nights) : 0,
    suggestedResaleTotal,
    avgResalePerNight: nights ? round0(suggestedResaleTotal / nights) : 0,
    feePct,
    estFeeOnSuggested,
    estInvestorNetOnSuggested,
  };
}

/** Margin the investor keeps if they sell `nights` at a chosen resale/night. Pure. */
export function resaleMargin(args: {
  resalePerNight: number;
  buyPerNight: number;
  nights: number;
  feePct?: number;
}): { resaleTotal: number; feeTotal: number; buyTotal: number; investorNet: number; feePct: number } {
  const feePct = clampPct(args.feePct);
  const nights = Math.max(0, Math.floor(Number(args.nights) || 0));
  const resaleTotal = round0(Math.max(0, Number(args.resalePerNight) || 0) * nights);
  const buyTotal = round0(Math.max(0, Number(args.buyPerNight) || 0) * nights);
  const feeTotal = round0((resaleTotal * feePct) / 100);
  return { resaleTotal, feeTotal, buyTotal, investorNet: round0(resaleTotal - feeTotal - buyTotal), feePct };
}
