// ═══════════════════════════════════════════════════════════════════════════
// Canonical confirmed-stay authority (SEC-00B).
// ═══════════════════════════════════════════════════════════════════════════
// The SINGLE source of truth for "is this row a genuinely confirmed stay?".
// Every surface that treats a row as a real reservation OR as Verified-Guest
// proof MUST decide through here so they can never drift:
//   • GET /api/bookings/my        — bid → "CONFIRMED" booking projection
//   • lib/tier/eligibility.ts     — Verified-Guest picker + upload gate + count
//   • lib/stay/share-eligibility  — the customer Share CTA truthfulness (client)
//
// A merely-ACCEPTED-but-unpaid bid, or a stale/expired unpaid ACCEPTED bid, is
// NOT a confirmed stay and grants NO Verified-Guest proof. Terminal states
// (EXPIRED / CANCELLED / DECLINED / REJECTED) never qualify.
//
// ── Lifecycle facts (verified against the live routes, 2026-09-09) ──────────
//   • A paid bid is NOT a new `bookings` row and NOT a status change — it stays
//     status=ACCEPTED and is marked paid by TWO best-effort, independently
//     written markers that CAN diverge:
//        (1) `bids.message` contains "Razorpay:" / "razorpay_payment_id"
//            (POST /api/bids/[id]/pay) — the UI proxy (lib/bid-expiry.isBidPaid).
//        (2) a `bid_paid_amounts` row with `paid_total > 0`
//            (POST /api/bid/paid) — the SERVER-trusted signal the orphan-expiry
//            RPC `mark_orphaned_accepted_bids()` trusts to NEVER expire a real
//            reservation (migrations/2026-05-27-v239-widen-orphan-accepted-sweep).
//     We UNION both, so a legitimately-paid stay whose one marker failed to
//     write is never wrongly excluded (never weaker than either alone).
//   • Pay-at-hotel / Hold is still a real Razorpay DEPOSIT (carries the
//     "Razorpay:" stamp + a `| pay-at-hotel` metadata token) — there is NO
//     zero-payment confirm path, so requiring a paid signal excludes nothing
//     legitimate.
//   • CHECKED_IN / CHECKED_OUT = the guest physically stayed (partner-set); the
//     stay happened, so it is confirmed regardless of the payment marker.
//   • Terminal EXPIRED/CANCELLED/DECLINED/REJECTED → never confirmed.
//
// Pure + dependency-light (only the shared bid paid-marker helper) so it runs
// unchanged on the server (route handlers) AND the client (Share CTAs).
import { isBidPaid } from "@/lib/bid-expiry";

/** `bookings.status` values that represent a real, confirmed reservation. */
export const BOOKING_CONFIRMED_STATUSES = [
  "CONFIRMED",
  "CHECKED_IN",
  "CHECKED_OUT",
] as const;

/**
 * Bid statuses that mean the guest has physically progressed into the stay.
 * These are confirmed regardless of the payment marker (the stay happened).
 */
export const BID_PROGRESSED_STATUSES = ["CHECKED_IN", "CHECKED_OUT"] as const;

/** Dead states — never a confirmed stay, on either table. */
export const TERMINAL_STATUSES = [
  "EXPIRED",
  "CANCELLED",
  "DECLINED",
  "REJECTED",
] as const;

export type ConfirmedBidLike = {
  status?: string | null;
  message?: string | null;
};

function up(s: unknown): string {
  return String(s ?? "").trim().toUpperCase();
}

/**
 * Is a BID genuinely PAID? Unions the two independently-written signals so a
 * best-effort divergence (one marker missing) never wrongly excludes a real
 * paid reservation:
 *   • the message "Razorpay:" / "razorpay_payment_id" marker (lib/bid-expiry), and
 *   • a `bid_paid_amounts` row with paid_total > 0 (server-trusted; pass it in
 *     from the caller's side-load — omit when unavailable).
 *
 * This NEVER weakens the payment rule: a bid with no message marker AND no
 * positive ledger amount is not paid.
 */
export function isBidPaidConfirmed(
  bid: ConfirmedBidLike,
  paidTotal?: number | null
): boolean {
  const messagePaid = isBidPaid({ message: bid?.message ?? null });
  const ledgerPaid =
    typeof paidTotal === "number" &&
    Number.isFinite(paidTotal) &&
    paidTotal > 0;
  return messagePaid || ledgerPaid;
}

/**
 * Is a BID row a confirmed stay?
 *   • CHECKED_IN / CHECKED_OUT           → yes (the guest physically stayed).
 *   • ACCEPTED + a real payment signal    → yes (paid deposit / full pay).
 *   • bare / stale / expired ACCEPTED     → NO (unpaid — not a reservation).
 *   • PENDING / COUNTER / anything else   → NO.
 *   • terminal EXPIRED/CANCELLED/…        → NO.
 *
 * `paidTotal` is the row's `bid_paid_amounts.paid_total` when the caller has
 * side-loaded it; omit it to rely on the message marker alone.
 */
export function isBidConfirmedStay(
  bid: ConfirmedBidLike,
  paidTotal?: number | null
): boolean {
  const st = up(bid?.status);
  if (!st) return false;
  if ((TERMINAL_STATUSES as readonly string[]).includes(st)) return false;
  if ((BID_PROGRESSED_STATUSES as readonly string[]).includes(st)) return true;
  if (st === "ACCEPTED") return isBidPaidConfirmed(bid, paidTotal);
  return false;
}

/**
 * Is a `bookings`-table row a confirmed stay? CONFIRMED / CHECKED_IN /
 * CHECKED_OUT qualify; CANCELLED / PENDING / anything else do not.
 */
export function isBookingConfirmedStay(booking: {
  status?: string | null;
}): boolean {
  return (BOOKING_CONFIRMED_STATUSES as readonly string[]).includes(
    up(booking?.status)
  );
}
