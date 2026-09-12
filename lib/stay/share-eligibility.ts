// ═══════════════════════════════════════════════════════════════════════════
// Share-eligibility resolver (SEC-00B) — DISPLAY authority only.
// ═══════════════════════════════════════════════════════════════════════════
// Decides which Share CTA to show for a My-Bookings row, so the customer sees
// the truth: "Share now" only when a confirmed stay has ACTUALLY started and is
// still in the 90-day window; "Share from check-in" for a confirmed-but-future
// stay; nothing verified-looking when the row is not a confirmed stay.
//
// This is a CLIENT-SIDE convenience for honest copy + routing. It is NEVER the
// authority: the upload path (/api/social/posts/verified-guest) independently
// re-verifies the strict media identity, exact booking ownership, the protected
// verified_stay_evidence, the hotel binding, and the date window server-side. A
// forged bookingId/hotelId carried on a Share deep-link is rejected there.
//
// SEC-00B trust boundary: the "Share now" (eligible) state is gated ONLY on the
// server-computed `_shareEligible` flag, which /api/bookings/my derives from the
// protected verified_stay_evidence table — NOT from the forgeable bids/bookings
// status. "Share from check-in" is a soft display-only hint for an upcoming
// confirmed reservation (it triggers NO upload, so it never needs authority).
import { isBookingConfirmedStay } from "@/lib/stay/confirmed-stay";
import { parseDbTime } from "@/lib/bid-expiry";

export const SHARE_WINDOW_DAYS = 90;

export type ShareState =
  | { state: "eligible"; hotelId: string; bookingId: string; hotelName?: string }
  | {
      state: "future";
      availableFrom: string;
      hotelId: string;
      bookingId: string;
      hotelName?: string;
    }
  | { state: "window_closed" }
  | { state: "not_confirmed" };

// A merged My-Bookings row. Either:
//   • a real `bookings`-table row (trustworthy direct booking), or
//   • a bid — a client-side paid-bid projection (_source:"bid") OR the
//     server projection from /api/bookings/my (_projectedFromBid:true, carrying
//     the REAL bid status on _bidStatus while `status` shows "CONFIRMED").
export type ShareRow = {
  id?: string | null;
  _source?: string | null;
  _projectedFromBid?: boolean | null;
  _bidStatus?: string | null;
  status?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  hotelId?: string | null;
  hotel?: { id?: string | null; name?: string | null } | null;
  /**
   * Server-computed by /api/bookings/my from the protected verified_stay_evidence
   * table. The ONLY signal that grants a real "Share now" CTA. Never trust the
   * forgeable bids/bookings status for this.
   */
  _shareEligible?: boolean | null;
};

/**
 * Resolve the Share state for one My-Bookings row.
 *
 * SEC-00B: the "eligible" (Share now) state is granted ONLY by the
 * server-computed `_shareEligible` flag (backed by protected
 * verified_stay_evidence). "future" is a display-only nudge for an upcoming
 * confirmed reservation (no upload happens from it, so it needs no authority).
 * Everything else shows no verified-share CTA.
 */
export function resolveShareState(row: ShareRow, nowMs: number = Date.now()): ShareState {
  const hotelId = String(row?.hotelId || row?.hotel?.id || "");
  const bookingId = String(row?.id || "");
  const hotelName = row?.hotel?.name || undefined;

  // AUTHORITY-ALIGNED: a real Share CTA only when the server proved evidence.
  if (row?._shareEligible === true && hotelId && bookingId) {
    return { state: "eligible", hotelId, bookingId, hotelName };
  }

  // Display-only "future" hint: an upcoming, non-cancelled confirmed reservation.
  // (No authority: this state never uploads — it only shows "Share from
  // check-in". The row's status/date here are display fields, not a security
  // signal.) A cancelled booking is excluded via isBookingConfirmedStay.
  const isBid = row?._source === "bid" || row?._projectedFromBid === true;
  const notCancelled = isBid ? true : isBookingConfirmedStay({ status: row?.status });
  const checkInMs = parseDbTime(row?.checkIn ?? null);
  if (
    notCancelled &&
    hotelId &&
    bookingId &&
    Number.isFinite(checkInMs) &&
    checkInMs > nowMs
  ) {
    return {
      state: "future",
      availableFrom: String(row?.checkIn),
      hotelId,
      bookingId,
      hotelName,
    };
  }

  return { state: "not_confirmed" };
}

export type BannerShareState =
  | { kind: "eligible"; hotelId: string; bookingId: string; hotelName?: string }
  | { kind: "eligible_many" }
  | { kind: "future"; availableFrom: string }
  | { kind: "none" };

/**
 * Reduce a whole My-Bookings list to the single truthful state the top-of-list
 * Inspiration banner should advertise:
 *   • exactly 1 eligible-now stay  → bind that stay directly ("Share now").
 *   • more than 1 eligible-now      → "Share now" opens the picker.
 *   • none now but ≥1 future        → "Share from check-in · <earliest date>".
 *   • otherwise                     → no verified-share CTA.
 */
export function resolveBannerShareState(
  rows: ShareRow[],
  nowMs: number = Date.now()
): BannerShareState {
  const states = (rows || []).map((r) => resolveShareState(r, nowMs));
  const eligible = states.filter(
    (s): s is Extract<ShareState, { state: "eligible" }> => s.state === "eligible"
  );
  if (eligible.length === 1) {
    return {
      kind: "eligible",
      hotelId: eligible[0].hotelId,
      bookingId: eligible[0].bookingId,
      hotelName: eligible[0].hotelName,
    };
  }
  if (eligible.length > 1) return { kind: "eligible_many" };

  const futures = states.filter(
    (s): s is Extract<ShareState, { state: "future" }> => s.state === "future"
  );
  if (futures.length) {
    // Earliest upcoming check-in.
    let earliest = futures[0].availableFrom;
    let earliestMs = parseDbTime(earliest);
    for (const f of futures) {
      const ms = parseDbTime(f.availableFrom);
      if (Number.isFinite(ms) && (!Number.isFinite(earliestMs) || ms < earliestMs)) {
        earliest = f.availableFrom;
        earliestMs = ms;
      }
    }
    return { kind: "future", availableFrom: earliest };
  }

  return { kind: "none" };
}
