// ── Bid expiry rule (v177) ─────────────────────────────────────────────
// Filter at READ-time across customer (/my-bids), hotel-partner (Bid Inbox)
// and admin (/admin/bookings) so stale bids don't accumulate in any of the
// three views. Rules per status:
//
//   • PAID ACCEPTED / CHECKED_IN / CHECKED_OUT → never expire from these
//     surfaces (they're confirmed bookings).
//   • PENDING with `auto_accept_at` (above-floor scheduled)   → expire 15 min
//     after the scheduled accept time. The cron / trigger-accept route
//     usually flips the row to ACCEPTED before this; the grace covers any
//     missed crons.
//   • PENDING without `auto_accept_at`   → expire when the bid's stamped
//     `expiresAt` passes. The /place endpoint sets it to 1 h for /bid
//     (reverse auction) and 3 h for Negotiate (single hotel). Falls back
//     to the same per-flow rule derived from the message pattern when
//     `expiresAt` is missing on legacy rows.
//   • COUNTER → expire 60 min after the hotel posted the counter. Customer
//     either accepts or declines in that window or the offer dies.
//   • ACCEPTED & not paid → expire 15 min after acceptance (the existing
//     acceptance window; backend status doesn't auto-flip, this UI rule
//     hides the stale row).
//   • REJECTED → expire 30 min after the decline so customer can see the
//     outcome briefly, then it drops off.
//   • Hard midnight cutoff (IST): ANY bid past the next IST 00:00 after
//     its creation is treated as stale, regardless of status it's stuck
//     in. End-of-day reset for everyone.
//
// Filtering is purely client-side / view-layer; the row stays in the DB.
// A future cron can hard-archive, but UI filter gives instant relief.

export interface BidLike {
  id?: string;
  status?: string;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  acceptedAt?: string | Date | null;
  auto_accept_at?: string | Date | null;
  expiresAt?: string | Date | null;
  message?: string | null;
  hotelMessage?: string | null;
  dealId?: string | null;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const IST_OFFSET_MS = (5 * 60 + 30) * MIN;

// Bid was paid (Razorpay token written to the message field by all booking
// flows). Paid ACCEPTED rows are real bookings — never expire them here.
export function isBidPaid(b: BidLike): boolean {
  const m = String(b?.message || "");
  return m.includes("Razorpay:") || m.includes("razorpay_payment_id");
}

// Returns the Unix-ms timestamp of the next IST midnight strictly AFTER
// the given moment. Bids created at 11:55 PM IST expire at 00:00 IST a
// few minutes later; bids created at 12:05 AM IST live the full day.
function nextIstMidnightAfter(d: Date): number {
  // Shift the moment into "IST clock" by adding the offset so that
  // UTC year/month/date == IST year/month/date.
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const day = ist.getUTCDate();
  // The next IST 00:00 in real (UTC) ms = UTC midnight of (y, m, day+1)
  // minus the IST offset.
  return Date.UTC(y, m, day + 1, 0, 0, 0) - IST_OFFSET_MS;
}

export function isBidExpired(b: BidLike | null | undefined, nowMs: number = Date.now()): boolean {
  if (!b) return false;

  const paid = isBidPaid(b);

  // Confirmed bookings + in-flight stays never drop off these views.
  if (b.status === "ACCEPTED" && paid) return false;
  if (b.status === "CONFIRMED" && paid) return false;
  if (b.status === "CHECKED_IN" || b.status === "CHECKED_OUT") return false;

  const created = b.createdAt ? new Date(b.createdAt) : null;
  if (!created || Number.isNaN(created.getTime())) return false;

  // Hard end-of-day cutoff (IST). Past today's midnight relative to
  // creation → stale regardless of status.
  if (nowMs >= nextIstMidnightAfter(created)) return true;

  // Per-status short windows.
  if (b.status === "REJECTED") {
    const decided = b.updatedAt ? new Date(b.updatedAt).getTime() : created.getTime();
    return nowMs > decided + 30 * MIN;
  }
  if (b.status === "ACCEPTED" && !paid) {
    const accepted = b.acceptedAt ? new Date(b.acceptedAt).getTime()
                   : b.updatedAt  ? new Date(b.updatedAt).getTime()
                   : created.getTime();
    return nowMs > accepted + 15 * MIN;
  }
  if (b.status === "COUNTER") {
    const countered = b.updatedAt ? new Date(b.updatedAt).getTime() : created.getTime();
    return nowMs > countered + 60 * MIN;
  }
  if (b.status === "PENDING" && b.auto_accept_at) {
    const acc = new Date(b.auto_accept_at).getTime();
    if (!Number.isNaN(acc)) return nowMs > acc + 15 * MIN;
  }
  if (b.status === "PENDING") {
    // Per-flow expiry: the backend stamps expiresAt at place-time
    //   • /bid (reverse auction) → 1h
    //   • Negotiate (single hotel) → 3h
    // Fall back to a 1h-or-3h derivation from the message pattern when
    // expiresAt is missing (legacy rows), then a 6h hard cap. Hotels that
    // haven't acted by the window are unlikely to.
    if (b.expiresAt) {
      const exp = new Date(b.expiresAt).getTime();
      if (!Number.isNaN(exp)) return nowMs > exp;
    }
    const msg = String(b.message || "");
    const isPlaceFlow = /\bGuest bid\b/i.test(msg) || /max ₹/i.test(msg);
    const ageMs = nowMs - created.getTime();
    return ageMs > (isPlaceFlow ? 1 * HOUR : 3 * HOUR);
  }

  return false;
}

// Convenience: filter helper used by customer / partner / admin views.
export function filterActiveBids<T extends BidLike>(bids: T[], nowMs: number = Date.now()): T[] {
  return bids.filter((b) => !isBidExpired(b, nowMs));
}
