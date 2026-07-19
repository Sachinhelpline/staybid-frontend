// ════════════════════════════════════════════════════════════════════════
// v335 — Circle Phase E: Model-1 "expected income" legal language.
//
// SINGLE SOURCE OF TRUTH for every income / return / payout disclosure across
// the StayCircle (Model 1 income-share) + Model 3 resale surfaces. The ledger
// is already actual-performance-based; this locks the COPY so no surface ever
// drifts into a promise.
//
// THE RULE (blueprint §"Legal framing"): NEVER "guaranteed / assured / fixed
// / risk-free" returns. ALWAYS "expected / based on actual bookings /
// indicative projection / not guaranteed".
//
// Import these constants instead of writing disclosure strings inline — a
// hardcoded "guaranteed monthly inflow" is exactly the phrase that must never
// exist (it did, in PartnerCircleTab, until v335).
// ════════════════════════════════════════════════════════════════════════

/** Full income-share (Model 1) disclosure. Footer / info-panel length. */
export const CIRCLE_INCOME_DISCLOSURE =
  "Income figures are indicative projections based on actual bookings and property performance — expected, never guaranteed, assured or fixed. Payouts reflect real revenue only.";

/** Short inline qualifier to append after any income / ROI number. */
export const CIRCLE_INCOME_SHORT =
  "Expected — based on actual bookings, not guaranteed.";

/**
 * Model 3 pre-buy commerce risk note. Pre-buying room-nights to resell is a
 * goods trade, not an investment scheme — but the investor bears the
 * unsold-inventory risk, and that must be stated plainly.
 */
export const CIRCLE_RESALE_RISK_NOTE =
  "You're buying room-nights to resell — unsold-inventory risk is yours. StayBid maximises sell-through (dynamic discount, OTA push, B2B exchange, optional buyback); resale income is expected, not guaranteed.";

/** Canonical short label for the paid-out ledger (never "returns"). */
export const CIRCLE_PAYOUTS_LABEL = "Monthly Payouts";

/**
 * v345 — Model 4 B2B exchange note. Selling/reselling room-nights to another
 * partner is a bounded-goods trade (SEBI/CIS distance), never a security. State
 * the sell-through risk plainly and keep the "expected, not guaranteed" framing.
 */
export const CIRCLE_B2B_RESALE_NOTE =
  "The B2B exchange lets partners trade room-nights with each other — a goods trade, not an investment. Sell-through and resale income are expected based on demand, never guaranteed; unsold-inventory risk stays with the holder.";

// v361 — Model 3 travel-agent auction. A wholesale room-night trade, not an
// investment. Winning is not guaranteed; only cleared (won) bids are allotted.
export const CIRCLE_AUCTION_NOTE =
  "A wholesale room-night auction for travel agents — a goods trade, not an investment. The EMD deposit is refundable if you don't win; only cleared (highest-bid) rooms are allotted. Resale to your own guests is your business — sell-through is never guaranteed.";
