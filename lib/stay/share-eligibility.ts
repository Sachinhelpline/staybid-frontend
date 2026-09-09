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
// re-verifies the strict media identity, exact booking ownership, the canonical
// confirmed-stay rule, the hotel binding, and the date window server-side. A
// forged bookingId/hotelId carried on a Share deep-link is rejected there.
//
// Mirrors the server window in lib/tier/eligibility.ts:
//   confirmed stay  AND  checkIn <= now  AND  checkOut >= now - 90d.
import { isBidConfirmedStay, isBookingConfirmedStay } from "@/lib/stay/confirmed-stay";
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
//   • a `bookings`-table row / server-projected paid-bid ("CONFIRMED",
//     _source:"booking"), or
//   • a client-side paid-bid projection (_source:"bid", carries message).
export type ShareRow = {
  id?: string | null;
  _source?: string | null;
  status?: string | null;
  message?: string | null;
  serverPaid?: { paidTotal?: number | null } | null;
  checkIn?: string | null;
  checkOut?: string | null;
  hotelId?: string | null;
  hotel?: { id?: string | null; name?: string | null } | null;
};

/**
 * Resolve the Share state for one My-Bookings row.
 *
 * A `_source:"bid"` row is judged through the canonical BID rule (needs a real
 * payment signal). Every other row carries a booking status that the server
 * already vetted (the paid-bid projection from /api/bookings/my emits only
 * CONFIRMED / CHECKED_IN / CHECKED_OUT after the confirmed-stay filter), so the
 * canonical BOOKING rule applies.
 */
export function resolveShareState(row: ShareRow, nowMs: number = Date.now()): ShareState {
  const hotelId = String(row?.hotelId || row?.hotel?.id || "");
  const bookingId = String(row?.id || "");
  const hotelName = row?.hotel?.name || undefined;

  const paidTotal = row?.serverPaid?.paidTotal ?? null;
  const confirmed =
    row?._source === "bid"
      ? isBidConfirmedStay({ status: row?.status, message: row?.message }, paidTotal)
      : isBookingConfirmedStay({ status: row?.status });

  if (!confirmed || !hotelId || !bookingId) return { state: "not_confirmed" };

  const checkInMs = parseDbTime(row?.checkIn ?? null);
  const checkOutMs = parseDbTime(row?.checkOut ?? null);
  const sinceMs = nowMs - SHARE_WINDOW_DAYS * 86_400_000;

  // Confirmed but the stay has not started yet → share from check-in.
  if (Number.isFinite(checkInMs) && checkInMs > nowMs) {
    return {
      state: "future",
      availableFrom: String(row?.checkIn),
      hotelId,
      bookingId,
      hotelName,
    };
  }

  // Confirmed but the 90-day sharing window has closed.
  if (Number.isFinite(checkOutMs) && checkOutMs < sinceMs) {
    return { state: "window_closed" };
  }

  // Started (or an ongoing stay, or dates unknown but server-confirmed) → now.
  return { state: "eligible", hotelId, bookingId, hotelName };
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
