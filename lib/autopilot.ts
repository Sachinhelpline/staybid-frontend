// ─────────────────────────────────────────────────────────────────────────
// lib/autopilot.ts — Hybrid AI Autopilot resolver (v130, Option 2).
//
// Each hotel picks an autopilot mode (stored in hotels.autopilot_mode, see
// migrations/2026-05-17-hotel-autopilot-mode.sql):
//
//   • 'auto'   (DEFAULT) — every tier-eligible bid auto-accepts on its
//                          tier-based schedule (PREMIUM 30s … CAUTIOUS 20min).
//   • 'hybrid'           — only PREMIUM + STRONG auto-accept. NORMAL +
//                          CAUTIOUS get NULL auto_accept_at (manual review).
//                          Sales-heavy partners pick this so high-quality
//                          bidders confirm instantly but everything else
//                          still lands in their inbox.
//   • 'manual'           — no bid auto-accepts. Every bid is manual review.
//                          Boutique partners (~6 rooms or fewer) pick this.
//
// The lookup degrades to 'auto' if the column doesn't exist yet (pre-
// migration) OR the API is unreachable. Production never blocks a bid on
// an autopilot mode lookup failure.
//
// IMPORTANT: applies to FUTURE bids placed after the mode change. Bids
// already in PENDING with auto_accept_at set keep their original
// schedule (the v70 cron RPC is unchanged — zero risk to existing flows).
// ─────────────────────────────────────────────────────────────────────────

import type { BidderTier } from "./bidder-score";

export type AutopilotMode = "auto" | "hybrid" | "manual";

export const AUTOPILOT_MODE_LABEL: Record<AutopilotMode, string> = {
  auto:   "Full Autopilot",
  hybrid: "Hybrid (premium-only)",
  manual: "Manual Review",
};

export const AUTOPILOT_MODE_DESC: Record<AutopilotMode, string> = {
  auto:   "The hotel confirms every tier-eligible bid automatically on its scheduled timer. Best for high-volume hotels — partner can still override any bid before it auto-confirms.",
  hybrid: "Only PREMIUM and STRONG bidders auto-confirm. NORMAL, CAUTIOUS, and LOWBALL bids wait for the partner. Balanced default for mid-size hotels.",
  manual: "Every bid waits for the partner to accept, counter, or decline. Best for boutique hotels that want personal control over every guest.",
};

/** Apply hotel autopilot mode to a tier-based auto-accept window. */
export function resolveAutoAcceptMs(
  tier: BidderTier,
  baseMs: number,
  mode: AutopilotMode,
): number {
  // LOWBALL never auto-accepts in any mode.
  if (!Number.isFinite(baseMs)) return Infinity;
  if (mode === "manual") return Infinity;
  if (mode === "hybrid") {
    // Hybrid mode: only PREMIUM + STRONG auto-accept.
    if (tier === "PREMIUM" || tier === "STRONG") return baseMs;
    return Infinity;
  }
  // 'auto' — pass through.
  return baseMs;
}

/** Browser-safe lookup. Caches the mode for 60s per hotel to keep the
 *  bid-submit hot path snappy. Falls back to 'auto' on any failure. */
const memo = new Map<string, { mode: AutopilotMode; at: number }>();
const MODE_TTL_MS = 60_000;

export async function getAutopilotMode(hotelId: string): Promise<AutopilotMode> {
  if (!hotelId) return "auto";
  if (typeof window === "undefined") return "auto"; // SSR-safe.
  const cached = memo.get(hotelId);
  if (cached && Date.now() - cached.at < MODE_TTL_MS) return cached.mode;
  try {
    const r = await fetch(`/api/hotels/${encodeURIComponent(hotelId)}/autopilot`, {
      cache: "no-store",
    });
    if (!r.ok) throw new Error("non-ok");
    const data = await r.json().catch(() => ({} as any));
    const mode = (data?.mode as AutopilotMode) || "auto";
    if (mode === "auto" || mode === "hybrid" || mode === "manual") {
      memo.set(hotelId, { mode, at: Date.now() });
      return mode;
    }
  } catch {
    // Network failure / column missing / RLS — fall through to 'auto'.
  }
  memo.set(hotelId, { mode: "auto", at: Date.now() });
  return "auto";
}

/** Invalidate the cached mode for a hotel after a partner change. */
export function invalidateAutopilotCache(hotelId?: string) {
  if (!hotelId) { memo.clear(); return; }
  memo.delete(hotelId);
}
