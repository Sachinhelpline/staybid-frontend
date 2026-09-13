// ═══════════════════════════════════════════════════════════════════════════
// STAY-LIFECYCLE-OPS-01 — temporal stay-lifecycle authority (pure, shared).
// ═══════════════════════════════════════════════════════════════════════════
// Server-side, timezone-SAFE date rules for the partner check-in / check-out
// transitions. Pure + dependency-free so the SAME rule runs on the server
// (authoritative) and in the partner UI (mirror only — the server decides).
//
// TIMEZONE CONTRACT: StayBid operates in India; `hotels` carries no timezone
// column, and the whole codebase already keys day boundaries to IST
// (lib/bid-expiry.ts nextIstMidnightAfter). So the operational "today" is the
// IST calendar date, computed EXPLICITLY from the UTC instant — never from the
// server's or device's local clock (Vercel runs UTC; a device may be anywhere).
//
// RESERVATION DATES: `bid_requests.checkIn` / `checkOut` are `timestamp without
// time zone` columns holding the stay's calendar dates at midnight
// (e.g. "2026-09-18 00:00:00" / "2026-09-18T00:00:00"). Only the CALENDAR DATE is
// meaningful, so we extract the ISO date portion directly and never let a
// local-time reparse shift it across midnight.
//
// RULES (a NEW check-in — repeat/idempotent check-ins are handled upstream):
//   • today <  checkInDate  → "checkin_premature"      (fail closed — no early
//                              check-in before the reservation's first night)
//   • checkIn ≤ today < checkOut → allowed. This INCLUDES a late arrival on any
//                              later night of the stay (late check-in stays
//                              possible by design).
//   • today ≥ checkOutDate  → "checkin_window_closed"  (the stay range has
//                              ended; a check-in here would be for a stay that
//                              does not exist on this reservation)
//   • unresolvable dates    → "checkin_date_unavailable" (fail closed — the
//                              temporal rule cannot be evaluated)
//
// CHECK-OUT is NOT blocked by the scheduled date: a genuinely checked-in guest
// may leave early. Instead an early checkout (today < scheduled checkOutDate)
// is made EXPLICIT + AUDITABLE: the server requires an explicit confirmation and
// records it (see evaluateCheckOutTiming + the checkout route).
export const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** The IST calendar date (YYYY-MM-DD) for a UTC instant (default: now). */
export function istDateISO(nowMs: number = Date.now()): string {
  const shifted = new Date(nowMs + IST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Extract the reservation CALENDAR DATE (YYYY-MM-DD) from a stored stay date.
 * Accepts the PostgREST naive forms ("2026-09-18T00:00:00", "2026-09-18 00:00:00"),
 * a plain "2026-09-18", or an ISO instant with tz. The leading date portion is
 * authoritative for the naive forms (no local-time reparse). Returns null when
 * the value carries no recognisable date.
 */
export function reservationDateISO(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString().slice(0, 10) : null;
  const s = String(v).trim();
  if (!s) return null;
  const m = ISO_DATE.exec(s);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Add whole days to a YYYY-MM-DD date (calendar arithmetic in UTC, tz-safe). */
export function addDaysISO(dateISO: string, days: number): string {
  const m = ISO_DATE.exec(dateISO);
  if (!m) return dateISO;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days);
  return new Date(t).toISOString().slice(0, 10);
}

export type CheckInWindowResult =
  | { ok: true; checkInDate: string; checkOutDate: string | null; late: boolean }
  | {
      ok: false;
      reason: "checkin_date_unavailable" | "checkin_premature" | "checkin_window_closed";
      checkInDate: string | null;
      checkOutDate: string | null;
      today: string;
    };

/**
 * Decide whether a NEW check-in is temporally legitimate TODAY (IST). ISO date
 * strings compare lexicographically, so no Date objects are needed.
 */
export function evaluateCheckInWindow(input: {
  checkIn: unknown;
  checkOut: unknown;
  todayISO: string;
}): CheckInWindowResult {
  const checkInDate = reservationDateISO(input.checkIn);
  const checkOutDate = reservationDateISO(input.checkOut);
  const today = input.todayISO;
  if (!checkInDate) {
    return { ok: false, reason: "checkin_date_unavailable", checkInDate, checkOutDate, today };
  }
  if (today < checkInDate) {
    return { ok: false, reason: "checkin_premature", checkInDate, checkOutDate, today };
  }
  if (checkOutDate && today >= checkOutDate) {
    return { ok: false, reason: "checkin_window_closed", checkInDate, checkOutDate, today };
  }
  return { ok: true, checkInDate, checkOutDate, late: today > checkInDate };
}

export type CheckOutTiming = {
  /** true when today (IST) is BEFORE the scheduled check-out date. */
  early: boolean;
  scheduledCheckOut: string | null;
  today: string;
};

/**
 * Classify a check-out happening TODAY (IST) against the scheduled date. Never
 * blocks (a checked-in guest may leave early) — it only tells the route whether
 * the departure must be made EXPLICIT (confirmed + audited) as an early checkout.
 * An unresolvable scheduled date is treated as NOT early (nothing to compare).
 */
export function evaluateCheckOutTiming(input: { checkOut: unknown; todayISO: string }): CheckOutTiming {
  const scheduledCheckOut = reservationDateISO(input.checkOut);
  const today = input.todayISO;
  return {
    early: !!scheduledCheckOut && today < scheduledCheckOut,
    scheduledCheckOut,
    today,
  };
}
