// ── Re-bid cooldown rule (v179) ────────────────────────────────────────
// Anti-friction guard: after a customer's bid on a hotel is PENDING,
// ACCEPTED or COUNTERED, they cannot place ANOTHER bid for the same
// hotel for 3 hours. Without this, customers retry at progressively
// lower amounts the second the first bid resolves — frustrating hotels
// and gaming the auction.
//
// Rule:
//   • Any non-expired bid on this hotel in {PENDING, ACCEPTED, COUNTER}
//     → cooldown active.
//   • Cooldown ends 3 h after the bid's latest activity (updatedAt →
//     acceptedAt → createdAt fallback) OR when the bid itself expires
//     (whichever fires first — filterActiveBids already drops the
//     dropped bid).
//   • REJECTED bids never trigger cooldown — customer must be able to
//     try a different angle immediately. The existing v177 expiry rule
//     drops REJECTED rows after 30 min anyway.
//
// Server-side enforcement isn't possible without Railway changes
// (placeBid hits Railway, not Next.js). This is a client-side gate +
// visible UX notice in /hotels/[id]. It's enforced wherever a bid
// handler runs, not just on the button click.

import { filterActiveBids, isBidPaid, type BidLike } from "./bid-expiry";

const COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3 hours

export type CooldownReason = "pending" | "counter" | "accepted_unpaid" | "accepted_paid";

export interface CooldownState {
  active: boolean;
  reason?: CooldownReason;
  retryAfterMs?: number;
  bid?: BidLike;
}

export function computeBidCooldown(hotelBids: BidLike[], nowMs: number = Date.now()): CooldownState {
  // Stale bids don't count — same filter the other surfaces use.
  const active = filterActiveBids(hotelBids, nowMs);
  if (active.length === 0) return { active: false };

  // Priority: a real booking-in-progress (ACCEPTED) beats a COUNTER
  // which beats a PENDING — so the messaging shows the most committed
  // state if the customer has somehow accumulated multiple.
  const accepted = active.find((b) => b.status === "ACCEPTED");
  const counter  = active.find((b) => b.status === "COUNTER");
  const pending  = active.find((b) => b.status === "PENDING");
  const target = accepted || counter || pending;
  if (!target) return { active: false };

  const t = target as any;
  const baseStr = t.updatedAt || t.acceptedAt || t.createdAt;
  const base = baseStr ? new Date(baseStr).getTime() : nowMs;
  if (Number.isNaN(base)) return { active: false };

  const retryAfterMs = base + COOLDOWN_MS - nowMs;
  if (retryAfterMs <= 0) return { active: false };

  const reason: CooldownReason =
    accepted ? (isBidPaid(accepted) ? "accepted_paid" : "accepted_unpaid") :
    counter  ? "counter" : "pending";

  return { active: true, reason, retryAfterMs, bid: target };
}

// Human-friendly reason copy for the banner / toast.
export function cooldownReasonLabel(reason: CooldownReason | undefined): { title: string; sub: string } {
  switch (reason) {
    case "accepted_paid":   return { title: "Booking already confirmed", sub: "You already have a confirmed booking for this hotel." };
    case "accepted_unpaid": return { title: "Active bid accepted — pay to confirm", sub: "Complete the payment for your accepted bid before placing a new one." };
    case "counter":         return { title: "Counter offer pending", sub: "Accept or decline the hotel's counter from My Bids first." };
    case "pending":         return { title: "Bid already in review", sub: "Hotel is still reviewing your last bid for this property." };
    default:                return { title: "Active bid on this hotel", sub: "Resolve your existing bid before placing a new one." };
  }
}

// Format a retry-after window as a compact "Xh Ym" string for UI.
export function formatCooldownRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 60_000)); // minutes
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
