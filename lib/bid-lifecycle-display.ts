// ════════════════════════════════════════════════════════════════
// BID-LIFECYCLE-UI-01 (v751) — customer-facing bid STATUS display registry.
//
// The customer /my-bids card used `STATUS_META[b.status] || STATUS_META.PENDING`,
// so ANY status without an explicit entry (CONFIRMED / CHECKED_IN / CHECKED_OUT,
// or any future/unknown value) rendered a FALSE "Pending" badge — the authoritative
// CHECKED_IN fixture visibly said "Pending" while the counts said 0 pending.
//
// This module is the ONE registry + resolver:
//   • BID_STATUS_META      — label + colours for every KNOWN status, including
//                            the lifecycle states CONFIRMED / CHECKED_IN /
//                            CHECKED_OUT (truthful, non-alarming styling).
//   • resolveBidStatusMeta — never falls back to PENDING. An unknown/future
//                            status resolves to a NEUTRAL, human-readable label
//                            (the raw status, humanized) — never a false Pending.
//
// Pure — no imports, no React, no DB. It only maps a status string → display.
// It NEVER changes the authoritative bid status value or reinterprets a state.
// ════════════════════════════════════════════════════════════════

export interface BidStatusMeta {
  label: string;
  color: string;
  soft: string;
}

// Canonical display registry. The PENDING/COUNTER/ACCEPTED/REJECTED/CANCELLED/
// EXPIRED entries are byte-identical to the former inline /my-bids STATUS_META;
// CONFIRMED / CHECKED_IN / CHECKED_OUT are the newly-truthful lifecycle states.
export const BID_STATUS_META: Record<string, BidStatusMeta> = {
  PENDING:     { label: "Pending",     color: "#5f7c98", soft: "rgba(106,133,160,0.14)" },
  COUNTER:     { label: "Countered",   color: "#C77B43", soft: "rgba(199,123,67,0.14)" },
  ACCEPTED:    { label: "Accepted",    color: "#7F9269", soft: "rgba(127,146,105,0.18)" },
  REJECTED:    { label: "Declined",    color: "#C77E6D", soft: "rgba(199,126,109,0.14)" },
  CANCELLED:   { label: "Cancelled",   color: "#8A8FA8", soft: "rgba(138,143,168,0.14)" },
  EXPIRED:     { label: "Expired",     color: "#8A8FA8", soft: "rgba(138,143,168,0.14)" },
  // ── Lifecycle states (v751) — truthful, calm colours (never "Pending"). ──
  CONFIRMED:   { label: "Confirmed",   color: "#5E8C6A", soft: "rgba(94,140,106,0.16)" },
  CHECKED_IN:  { label: "Checked in",  color: "#4F7CAC", soft: "rgba(79,124,172,0.16)" },
  CHECKED_OUT: { label: "Checked out", color: "#8A7CA8", soft: "rgba(138,124,168,0.16)" },
};

// Neutral styling for an unknown / future status — deliberately NOT the PENDING
// palette, so an unrecognized state can never masquerade as a live pending bid.
const NEUTRAL_META: BidStatusMeta = { label: "Status unavailable", color: "#8A8FA8", soft: "rgba(138,143,168,0.14)" };

/**
 * Humanize a raw status token into a readable label: "CHECKED_OUT" → "Checked out",
 * "SOMETHING_NEW" → "Something new". Used only for unknown statuses so the badge
 * shows the real (normalized) state instead of a fabricated "Pending".
 */
export function humanizeBidStatus(raw?: string | null): string {
  const s = String(raw || "").trim();
  if (!s) return NEUTRAL_META.label;
  const words = s.replace(/[_\s]+/g, " ").trim().toLowerCase();
  if (!words) return NEUTRAL_META.label;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Resolve a bid status to its display meta. KNOWN statuses use the canonical
 * registry; an unknown/future status resolves to a neutral, human-readable
 * badge — it MUST NEVER silently fall back to PENDING.
 */
export function resolveBidStatusMeta(status?: string | null): BidStatusMeta {
  const key = String(status || "").toUpperCase();
  const known = BID_STATUS_META[key];
  if (known) return known;
  return { ...NEUTRAL_META, label: humanizeBidStatus(status) };
}

/** Convenience: the display label for a status (never a false "Pending"). */
export function bidStatusLabel(status?: string | null): string {
  return resolveBidStatusMeta(status).label;
}
