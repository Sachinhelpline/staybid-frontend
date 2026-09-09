// ═══════════════════════════════════════════════════════════════════════════
// Canonical confirmed-stay authority (SEC-00B).
// ═══════════════════════════════════════════════════════════════════════════
// The SINGLE source of truth for "is this row a genuinely confirmed stay?".
//
// ⚠️ TWO DISTINCT AUTHORITIES — do not confuse them:
//
//   • isBidVerifiedStay(bid)          — the SECURITY authority. The ONLY thing
//     allowed to grant a bid Verified-Guest content proof (AUTO_APPROVE). A bid
//     qualifies ONLY when CHECKED_IN / CHECKED_OUT (a partner-set, authenticated
//     transition — the guest physically stayed). It NEVER trusts a payment
//     marker (see the fail-closed note below).
//
//   • isBidConfirmedStayForDisplay(bid, paidTotal) — a DISPLAY-ONLY convenience
//     for the customer's own "My Bookings" list. NOT a security authority. It
//     may treat a "paid" bid as a confirmed booking, but the "paid" signals it
//     reads are FORGEABLE (see below), so it must NEVER gate Verified-Guest
//     upload, AUTO_APPROVE, or any authorization decision.
//
// ── Why the payment markers are NOT a security authority (SEC-00B fail-closed)─
// A paid bid is NOT a new `bookings` row and NOT a status change — it stays
// ACCEPTED and is "marked paid" by two signals, BOTH of which an authenticated
// customer can forge:
//   (1) `bids.message` "Razorpay:" / "razorpay_payment_id" — stamped by
//       POST /api/bids/[id]/pay, which accepts ANY client-supplied
//       `razorpay_payment_id` and DOES NOT verify the Razorpay
//       order/payment/signature server-side (it only assumes the client already
//       called /api/razorpay/verify). A bid owner can stamp an arbitrary marker.
//   (2) `bid_paid_amounts.paid_total` — written by POST /api/bid/paid, which is
//       UNAUTHENTICATED and accepts an arbitrary `paidTotal` in the body.
// /api/razorpay/verify does perform the real HMAC, but it returns a boolean and
// binds nothing (no order↔payment↔bid↔customer↔amount), and the recording routes
// don't enforce a cryptographic binding to a verified payment. Establishing a
// trustworthy paid-bid authority would need a write-time server-side Razorpay
// re-verification bound to the bid/customer/amount AND a forge-proof persisted
// record — i.e. a DB migration / larger payment-system redesign. Per SEC-00B
// requirement F we therefore FAIL CLOSED: the payment markers are NOT used as
// Verified-Guest security proof. Only already-strong proof (CHECKED_IN/
// CHECKED_OUT, and the trustworthy direct-booking authority below) grants it,
// until a later approved payment-hardening package exists.
//
// Pure + dependency-light so it runs unchanged on the server AND the client.
import { isBidPaid } from "@/lib/bid-expiry";

/** `bookings.status` values that represent a real, confirmed reservation. */
export const BOOKING_CONFIRMED_STATUSES = [
  "CONFIRMED",
  "CHECKED_IN",
  "CHECKED_OUT",
] as const;

/**
 * Bid statuses that are STRONG proof of a real stay: the guest physically
 * progressed into it via an authenticated partner transition. These are the
 * ONLY bid statuses that grant Verified-Guest authority.
 */
export const BID_VERIFIED_STATUSES = ["CHECKED_IN", "CHECKED_OUT"] as const;

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
 * ⚠️ DISPLAY-ONLY, FORGEABLE — never an authorization signal.
 *
 * "Does this bid look paid?" per the two forgeable markers (message marker OR a
 * `bid_paid_amounts.paid_total > 0` the caller side-loaded). Kept ONLY so the
 * customer's own My-Bookings view doesn't show a truly-unpaid ACCEPTED bid as a
 * booking. Forging a marker only fools the forger's own display; it can never
 * grant Verified-Guest proof, because eligibility ignores this entirely.
 */
export function isBidLooselyPaidForDisplay(
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
 * SECURITY AUTHORITY. Is a BID strong proof of a real stay for Verified-Guest
 * content? ONLY CHECKED_IN / CHECKED_OUT qualify (authenticated partner
 * transition). ACCEPTED — paid marker or not — does NOT qualify (fail closed:
 * the paid markers are forgeable). Terminal / PENDING / COUNTER never qualify.
 */
export function isBidVerifiedStay(bid: ConfirmedBidLike): boolean {
  return (BID_VERIFIED_STATUSES as readonly string[]).includes(up(bid?.status));
}

/**
 * ⚠️ DISPLAY-ONLY — never an authorization signal. Used ONLY by GET
 * /api/bookings/my to decide whether to show an accepted bid as a confirmed
 * booking in the customer's own list:
 *   • CHECKED_IN / CHECKED_OUT           → show.
 *   • ACCEPTED + a (forgeable) paid marker → show.
 *   • bare / stale / unpaid ACCEPTED      → hide (the pre-SEC-00B display bug).
 *   • terminal / PENDING / COUNTER        → hide.
 * For any Verified-Guest / upload / authorization decision use isBidVerifiedStay.
 */
export function isBidConfirmedStayForDisplay(
  bid: ConfirmedBidLike,
  paidTotal?: number | null
): boolean {
  const st = up(bid?.status);
  if (!st) return false;
  if ((TERMINAL_STATUSES as readonly string[]).includes(st)) return false;
  if ((BID_VERIFIED_STATUSES as readonly string[]).includes(st)) return true;
  if (st === "ACCEPTED") return isBidLooselyPaidForDisplay(bid, paidTotal);
  return false;
}

/**
 * Is a `bookings`-table row a confirmed stay? CONFIRMED / CHECKED_IN /
 * CHECKED_OUT qualify; CANCELLED / PENDING / anything else do not. Bookings
 * rows are the trustworthy direct-booking authority (Railway-authored
 * reservations), per the SEC-00B contract.
 */
export function isBookingConfirmedStay(booking: {
  status?: string | null;
}): boolean {
  return (BOOKING_CONFIRMED_STATUSES as readonly string[]).includes(
    up(booking?.status)
  );
}
