// STAY-LIFECYCLE-OPS-01 — booking-detail status label with LIFECYCLE precedence.
// Pure + dependency-free (shared by the partner UI; testable in isolation).
//
// The authoritative lifecycle state (bids.status as advanced by the hardened
// partner check-in/check-out) ALWAYS wins over date-derived labels. A CHECKED_OUT
// stay must never read "Upcoming" merely because its scheduled dates are in the
// future (an early checkout), and a CHECKED_IN stay is in-house whatever the
// calendar says. Date-derived Arriving / Departing / Upcoming labels apply ONLY
// where no lifecycle state supersedes them.
export type StatusTone = "success" | "warning" | "info" | "accent" | "neutral" | "danger";

export type BookingDetailStatus = {
  label: string;
  tone: StatusTone;
  /** which authority produced the label */
  source: "lifecycle" | "date";
};

const TERMINAL: Record<string, string> = {
  CANCELLED: "Cancelled",
  REJECTED: "Declined",
  DECLINED: "Declined",
  EXPIRED: "Expired",
};

function dateISO(v: unknown): string {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
}

export function bookingDetailStatus(input: {
  status?: string | null;
  checkIn?: unknown;
  checkOut?: unknown;
  todayISO: string;
}): BookingDetailStatus {
  const st = String(input.status ?? "").trim().toUpperCase();
  // ── lifecycle precedence ────────────────────────────────────────────────
  if (st === "CHECKED_OUT") return { label: "Checked Out", tone: "neutral", source: "lifecycle" };
  if (st === "CHECKED_IN") return { label: "In-house · Checked In", tone: "info", source: "lifecycle" };
  if (TERMINAL[st]) return { label: TERMINAL[st], tone: "danger", source: "lifecycle" };
  if (st === "PENDING" || st === "COUNTER") return { label: st === "COUNTER" ? "Counter Pending" : "Bid Pending", tone: "warning", source: "lifecycle" };
  // ── date-derived (only for a confirmed, not-yet-checked-in reservation) ─
  const ci = dateISO(input.checkIn), co = dateISO(input.checkOut), today = input.todayISO;
  if (ci && ci === today) return { label: "Arriving Today", tone: "success", source: "date" };
  if (co && co === today) return { label: "Departing Today · Not Checked In", tone: "warning", source: "date" };
  if (ci && co && ci < today && today < co) return { label: "Expected In-house · Not Checked In", tone: "warning", source: "date" };
  if (ci && ci > today) return { label: "Upcoming", tone: "accent", source: "date" };
  if (co && co < today) return { label: "Stay Dates Passed · No Check-out Recorded", tone: "neutral", source: "date" };
  return { label: "Confirmed", tone: "success", source: "date" };
}
