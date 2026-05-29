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

// v241.26 — Parse a Postgres timestamp as UTC.
// `bids.createdAt` / `bids.expiresAt` are `timestamp without time zone`
// columns; PostgREST returns them WITHOUT a timezone marker, e.g.
// "2026-05-29T10:30:00.149". `new Date()` then parses that as LOCAL time —
// on an IST device (+5:30) that's 5.5h behind the real UTC instant, so a
// freshly-ACCEPTED bid reads as expired the moment it's placed and every Pay
// CTA / countdown / lock chip shows "expired". The server (Vercel, UTC)
// parsed the same string correctly, so client and server silently disagreed
// — the deepest layer of the recurring "expired immediately" bug. Normalise:
// a tz-less string is UTC wall-clock → append 'Z'. Strings that already carry
// a tz (auto_accept_at is `timestamptz` → "...+00:00"; any JS toISOString
// value → "...Z") pass through untouched.
export function parseDbTime(v: string | Date | null | undefined): number {
  if (v == null) return NaN;
  if (v instanceof Date) return v.getTime();
  let s = String(v).trim();
  if (!s) return NaN;
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasTz) s = s.replace(" ", "T") + "Z";
  return new Date(s).getTime();
}

// v241.22 — Single source of truth for the ACCEPTED-unpaid payment
// window. Bumped 15 → 30 min per Sachin's call (more humane on slow
// networks / multi-app payment flows). Used by:
//   • Server isBidStale (/api/bids/place conflict check)
//   • Accept routes' expiresAt stamp (accept, counter-accept,
//     trigger-accept, partner accept fallback)
//   • Client isBidExpired (this file, ACCEPTED branch)
//   • /my-bids liveBids ACCEPTED fallback
//   • AcceptedBidTimer component default windowMin
//   • New isBidPayWindowOpen helper (Pay CTA gating)
// Per-hotel override via admin /admin/hold-config still works — these
// are just the default constants when no override is configured.
export const ACCEPTED_UNPAID_WINDOW_MIN = 30;
export const ACCEPTED_UNPAID_WINDOW_MS  = ACCEPTED_UNPAID_WINDOW_MIN * MIN;

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

  const createdMs = parseDbTime(b.createdAt);
  if (Number.isNaN(createdMs)) return false;

  // v241.17 — IST-midnight cutoff REMOVED. It had NO counterpart in the
  // server's conflict check (`isBidStale` in /api/bids/place/route.ts),
  // so a bid placed at 11 PM IST was "expired" client-side at 00:00 IST
  // while the server still treated it as active → conflict fires on
  // re-launch BUT /my-bids + hotel page show 0. That desync is the
  // recurring "Place Bid (0) but active-bid conflict" bug. The
  // per-status `expiresAt` windows below are now the SOLE authority and
  // exactly mirror the server. (This is the v232 trap that v234 already
  // removed from /my-bids `liveBids`; this removes it from the shared
  // helper too so hotel page + admin + partner inbox all converge.)

  // Per-status short windows.
  if (b.status === "REJECTED") {
    const decided = b.updatedAt ? parseDbTime(b.updatedAt) : createdMs;
    return nowMs > decided + 30 * MIN;
  }
  if (b.status === "ACCEPTED" && !paid) {
    // v241.17 — `expiresAt` is the single source of truth, matching the
    // server's isBidStale. The bids table has NO acceptedAt/updatedAt
    // columns (verified via information_schema 2026-05-27), so the old
    // `acceptedAt → updatedAt → createdAt + 15min` chain ALWAYS fell back
    // to createdAt — wrong for any bid accepted later than it was placed
    // (every partner-accepted bid). The accept routes now stamp
    // expiresAt = acceptTime + 15min (v241.17), so this window is correct
    // AND consistent with the conflict check. Legacy rows without
    // expiresAt fall back to the createdAt chain.
    if (b.expiresAt) {
      const exp = parseDbTime(b.expiresAt);
      if (!Number.isNaN(exp)) return nowMs > exp;
    }
    const accepted = b.acceptedAt ? parseDbTime(b.acceptedAt)
                   : b.updatedAt  ? parseDbTime(b.updatedAt)
                   : createdMs;
    return nowMs > accepted + ACCEPTED_UNPAID_WINDOW_MS;
  }
  if (b.status === "COUNTER") {
    const countered = b.updatedAt ? parseDbTime(b.updatedAt) : createdMs;
    return nowMs > countered + 60 * MIN;
  }
  if (b.status === "PENDING" && b.auto_accept_at) {
    const acc = parseDbTime(b.auto_accept_at);
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
      const exp = parseDbTime(b.expiresAt);
      if (!Number.isNaN(exp)) return nowMs > exp;
    }
    const msg = String(b.message || "");
    const isPlaceFlow = /\bGuest bid\b/i.test(msg) || /max ₹/i.test(msg);
    const ageMs = nowMs - createdMs;
    return ageMs > (isPlaceFlow ? 1 * HOUR : 3 * HOUR);
  }

  return false;
}

// Convenience: filter helper used by partner / admin "operator" views
// (Bid Inbox, admin ledger). Strict — drops bids the moment they exit
// their per-status payment / response window.
export function filterActiveBids<T extends BidLike>(bids: T[], nowMs: number = Date.now()): T[] {
  return bids.filter((b) => !isBidExpired(b, nowMs));
}

// v241.20 — Customer-view filter. Same per-status windows PLUS a 24-hour
// FRESH_GRACE that keeps EVERY bid the customer placed today visible
// regardless of expiresAt math. Pre-v241.20 the customer-facing surfaces
// were split between /my-bids (had a 30-min inline FRESH_GRACE, then
// 24h in v241.19) and /hotels/[id] + /bookings (used strict
// filterActiveBids → bids vanished from the hotel page after 15-min
// ACCEPTED-unpaid window, hiding the lock/upgrade CTAs the customer
// still wanted to see).
//
// Single source of truth from v241.20: every CUSTOMER-FACING surface
// calls this; every OPERATOR-FACING surface (partner inbox, admin
// ledger) keeps filterActiveBids so stale bids drop off their to-do
// list correctly. Per-card UI (Pay Now CTA, lock chip, upgrade chip)
// is still responsible for gracefully degrading when the bid is past
// its acutal payment window — visibility ≠ actionability.
// v241.20 — Exported so /my-bids and any other customer-view surface
// can derive the SAME freshness window without redeclaring the
// constant. Single source of truth eliminates the drift that produced
// the v241.19 / v241.20 mismatch (/my-bids had 24h, hotel page had
// 15min). Bumping this value here updates every customer surface.
export const USER_VIEW_FRESH_GRACE_MS = 24 * 60 * 60 * 1000;
export function filterUserVisibleBids<T extends BidLike>(bids: T[], nowMs: number = Date.now()): T[] {
  return bids.filter((b) => {
    // Fresh: created in the last 24h → ALWAYS visible.
    if (b?.createdAt) {
      const created = parseDbTime(b.createdAt);
      if (!Number.isNaN(created) && nowMs - created < USER_VIEW_FRESH_GRACE_MS) return true;
    }
    // Otherwise, fall back to the strict per-status window.
    return !isBidExpired(b, nowMs);
  });
}

// v241.22 — "Can the customer still pay this bid?" — used to gate
// every Pay Now CTA on customer surfaces. Distinct from "visible":
// /hotels/[id] + /my-bids show today's bids (filterUserVisibleBids)
// but the Pay button should only render when the pay window is
// actually open server-side. Mirrors the server's payment-route
// rejection so the customer never taps a button that would 400.
//
// Returns true ONLY for ACCEPTED-unpaid bids within their expiresAt
// window (expiresAt is stamped at acceptance time per v241.17).
// Returns false for paid bids, PENDING (no pay-now CTA), expired
// bids, or anything else.
export function isBidPayWindowOpen(b: BidLike | null | undefined, nowMs: number = Date.now()): boolean {
  if (!b) return false;
  if (b.status !== "ACCEPTED") return false;
  if (isBidPaid(b)) return false;
  // expiresAt is the canonical "window closes at" (v241.17 single
  // source of truth, written by every accept route).
  if (b.expiresAt) {
    const exp = parseDbTime(b.expiresAt);
    if (!Number.isNaN(exp)) return nowMs <= exp;
  }
  // Fallback for legacy rows without expiresAt: acceptedAt + window.
  const acc = b.acceptedAt ? parseDbTime(b.acceptedAt)
            : b.updatedAt  ? parseDbTime(b.updatedAt)
            : b.createdAt  ? parseDbTime(b.createdAt)
            : 0;
  return acc > 0 && !Number.isNaN(acc) && nowMs <= acc + ACCEPTED_UNPAID_WINDOW_MS;
}
