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

// ─────────────────────────────────────────────────────────────────────────
// v248 — Auto-counter (Hybrid Autopilot extension).
//
// A below-floor Negotiate bid clamps amount→floor and stashes the guest's
// REAL desired price in the message token ("Guest's preferred price: ₹X").
// Pre-v248 these sat in PENDING until a partner manually acted. Autopilot
// now auto-COUNTERS near-floor below-floor bids at the floor price (v248):
//   • margin-safe — counter is ALWAYS the floor (the minimum acceptable
//     price); never below it, so the pricing-spine guarantee holds. No new
//     schema / "second floor" needed.
//   • mode + tier gated EXACTLY like auto-accept (auto: yes · hybrid:
//     PREMIUM/STRONG only · manual: never · LOWBALL history: never).
//   • band-gated — only "close" misses counter; deep lowballs stay manual so
//     the partner keeps control over genuinely low offers.
//
// The customer responds via the SAME existing COUNTER surface (/my-bids
// 60-min countdown + counter-accept / counter-reject) — zero new client UI.
// ─────────────────────────────────────────────────────────────────────────

/** intent/floor at or above this still counters; below it → manual review. */
export const AUTO_COUNTER_BAND_MIN = 0.85;
/** COUNTER countdown window (matches the /my-bids COUNTER card UX). */
export const AUTO_COUNTER_WINDOW_MS = 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────
// v249 Layer 2 — Occupancy modulation.
//
// The auto-counter band widens or shuts based on the pricing-spine's
// `vacancyRatio` for the bid's check-in date (0 = sold out … 1 = empty):
//   • EMPTY  (vacancy > 60%) → band 0.78 — chase deeper below-floor offers to
//                              FILL the room. Counter still lands AT floor, so
//                              margin is never breached; we just say "yes,
//                              let's talk" to bids we'd normally ignore.
//   • NORMAL (15-60%)        → band 0.85 — the default near-floor window.
//   • TIGHT  (vacancy < 15%) → band 1.00 — NO auto-counter. The room is nearly
//                              gone ("bik hi raha hai, discount kyun") so
//                              below-floor offers stay manual. Accept stays
//                              strict (ratio ≥ 1) regardless — only the counter
//                              window closes, never the accept path.
// The counter amount is ALWAYS the dynamic floor (Layer 1) — occupancy tunes
// WHO gets a counter, never the price, so the spine guarantee holds.
// ─────────────────────────────────────────────────────────────────────────

/** Vacancy-tuned auto-counter band. Falls back to the static band when
 *  vacancyRatio is unknown (spine unreachable). vacancyRatio: 0=full…1=empty. */
export function counterBandForVacancy(
  vacancyRatio: number | null | undefined,
): number {
  if (typeof vacancyRatio !== "number" || !Number.isFinite(vacancyRatio)) {
    return AUTO_COUNTER_BAND_MIN; // unknown occupancy → default behaviour.
  }
  if (vacancyRatio > 0.60) return 0.78; // empty → widen, fill the room.
  if (vacancyRatio < 0.15) return 1.0;  // nearly full → no auto-counter.
  return AUTO_COUNTER_BAND_MIN;         // normal demand → default band.
}

export type AutoAction =
  | { kind: "accept"; autoAcceptMs: number }
  | { kind: "counter"; counterAmount: number; windowMs: number }
  | { kind: "manual" };

/**
 * Unified, mode-aware decision for a freshly placed bid.
 *  - `intent` is the guest's REAL desired per-night price (below floor for a
 *    counter candidate; equals the bid amount otherwise).
 *  - `floor`  is the room bid_floor — both the auto-accept threshold AND the
 *    margin-safe counter price.
 */
export function resolveAutoAction(opts: {
  intent: number;
  floor: number;
  tier: BidderTier;
  baseMs: number;
  mode: AutopilotMode;
  /** v249 Layer 2 — vacancy-tuned counter band (default AUTO_COUNTER_BAND_MIN).
   *  band 1.0 shuts the auto-counter window entirely (nearly-full date). */
  counterBandMin?: number;
}): AutoAction {
  const { intent, floor, tier, baseMs, mode } = opts;
  const counterBandMin = opts.counterBandMin ?? AUTO_COUNTER_BAND_MIN;
  if (mode === "manual") return { kind: "manual" };
  if (!(floor > 0) || !(intent > 0)) return { kind: "manual" };

  const ratio = intent / floor;

  // At/above floor → auto-accept (mode + tier gated, existing rule). Occupancy
  // never relaxes the accept threshold — a tight date stays strict (ratio ≥ 1).
  if (ratio >= 1) {
    const ms = resolveAutoAcceptMs(tier, baseMs, mode);
    return Number.isFinite(ms)
      ? { kind: "accept", autoAcceptMs: ms }
      : { kind: "manual" };
  }

  // Near-floor below-floor → auto-counter AT FLOOR. Reuse resolveAutoAcceptMs
  // purely as the eligibility gate (finite = this mode+tier would automate),
  // so LOWBALL history + hybrid-low-tier correctly fall through to manual.
  // v249 Layer 2: the band is occupancy-tuned (empty → 0.78 wider, tight →
  // 1.0 which closes this window since a below-floor ratio is always < 1).
  if (ratio >= counterBandMin) {
    const eligible = Number.isFinite(resolveAutoAcceptMs(tier, baseMs, mode));
    return eligible
      ? { kind: "counter", counterAmount: floor, windowMs: AUTO_COUNTER_WINDOW_MS }
      : { kind: "manual" };
  }

  // Lowball — leave it for the partner.
  return { kind: "manual" };
}

/** Parse the guest's real desired price out of a below-floor bid message. */
export function extractPreferredPrice(message?: string | null): number | null {
  if (!message) return null;
  const m = String(message).match(/preferred price[:\s]*₹?\s*(\d+(?:\.\d+)?)/i);
  return m ? parseFloat(m[1]) : null;
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
