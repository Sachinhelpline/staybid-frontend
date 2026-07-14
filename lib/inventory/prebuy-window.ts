// v341 — Circle Marketplace Phase M2: pre-buy inventory window check.
//
// A host-circle hotel can be given an OPTIONAL pre-buy window (set by ops via
// /admin/circle-supply). It bounds which CHECK-IN date (`date_from`) an M1
// pre-buy block may target:
//   * prebuy_window_start — earliest check-in (INCLUSIVE). NULL = no lower bound.
//   * prebuy_window_end   — EXCLUSIVE upper bound: check-in must be < this date.
//                            NULL = no upper bound.
// Both NULL = "always open" — the exact v339/v340 behaviour (zero regression).
//
// This is DECOUPLED from prebuy_enabled (the supply flag) + approval_status (the
// customer-feed gate). It only governs which nights an investor can pre-buy.

/** ISO YYYY-MM-DD, or null for an unset edge. */
export type WindowEdge = string | null | undefined;

const isoDate = (v: WindowEdge): string | null => {
  const s = String(v || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

/**
 * True when a check-in date falls inside the (possibly-unbounded) pre-buy window.
 * Lexicographic string compare is correct for fixed-width ISO dates.
 */
export function isCheckInWithinWindow(from: string, start: WindowEdge, end: WindowEdge): boolean {
  const s = isoDate(start);
  const e = isoDate(end);
  if (s && from < s) return false; // before the window opens
  if (e && from >= e) return false; // on/after the exclusive upper bound
  return true;
}

/** Human-readable reason for a rejected check-in (or null when in-window). */
export function windowRejectReason(from: string, start: WindowEdge, end: WindowEdge): string | null {
  const s = isoDate(start);
  const e = isoDate(end);
  if (s && from < s) return `Pre-buy for this property opens ${s}.`;
  if (e && from >= e) return `Pre-buy for this property is only open before ${e}.`;
  return null;
}
