// ============================================================================
// v374 — Model 3 LIVE mode engine (Phase 1). Server + client shared, PURE.
//
// The always-open live-bidding decision engine. An agent places a bulk bid at a
// per-room-per-night price (≥ the lot floor). The lot's autopilot mode decides
// whether the bid auto-accepts, waits for the owner, or is rejected below floor.
// Mirrors the customer reverse-auction autopilot (lib/autopilot.ts) but for a
// B2B bulk lot: there is no per-tier timer (the accept is instant vs pending),
// and hybrid keys off HOW FAR ABOVE FLOOR the bid is (agents have no customer
// bid-history tier), not a bidder-score tier.
//
// This engine backs BOTH the client preview ("this bid will auto-confirm" vs
// "the owner will review") AND the server decision, so preview == outcome.
// ============================================================================

export type LiveAutopilotMode = "auto" | "hybrid" | "manual";

export const LIVE_AUTOPILOT_LABEL: Record<LiveAutopilotMode, string> = {
  hybrid: "Smart",
  auto: "Instant (accepts at floor)",
  manual: "Manual",
};

export const LIVE_AUTOPILOT_DESC: Record<LiveAutopilotMode, string> = {
  hybrid: "Bids at or above the instant-lock price confirm instantly; at-floor bids wait for you to accept, counter, or decline. Recommended — agents bid up to lock scarce rooms.",
  auto: "⚠ Accepts ANY at-or-above-floor bid instantly — fastest sales but you take the lowest price. Opt in only if you want maximum liquidity over price.",
  manual: "Every bid waits for you to accept, counter, or decline. Full control over who gets your rooms.",
};

export type LiveBidDecision =
  | { kind: "accept"; by: "autopilot" }              // instantly confirmed (locked)
  | { kind: "pending"; belowFloor: boolean }         // waits for the owner (review/counter)
  | { kind: "reject"; reason: "too_low" };           // below the allowed minimum

/**
 * Decide what happens to a freshly placed LIVE bid. Mirrors the customer
 * negotiation panel: a below-floor bid is FORWARDED to the owner (never auto),
 * but only down to `floor × belowFloorMinRatio` — anything lower is rejected.
 *  - `perRoomPerNight`   — the agent's bid (per room, per night).
 *  - `floor`             — the lot's min_bid_per_room_night (owner-type floor).
 *  - `mode`              — the lot's autopilot mode.
 *  - `hybridAcceptRatio` — Smart mode instant-LOCKS a bid ≥ floor × ratio (default 1.15).
 *  - `belowFloorMinRatio`— agents may bid down to floor × this (owner-reviewed).
 */
export function evaluateLiveBid(opts: {
  perRoomPerNight: number;
  floor: number;
  mode: LiveAutopilotMode;
  hybridAcceptRatio?: number;
  belowFloorMinRatio?: number;
}): LiveBidDecision {
  const bid = Number(opts.perRoomPerNight) || 0;
  const floor = Number(opts.floor) || 0;
  const ratio = Number(opts.hybridAcceptRatio) >= 1 ? Number(opts.hybridAcceptRatio) : 1.15;
  const belowRatio = Number(opts.belowFloorMinRatio) >= 0.5 && Number(opts.belowFloorMinRatio) <= 1 ? Number(opts.belowFloorMinRatio) : 0.85;
  const lowerBound = Math.round(floor * belowRatio);

  if (!(floor > 0) || bid < lowerBound) return { kind: "reject", reason: "too_low" };

  // Below the floor but within the allowed range → forwarded to the owner (never
  // auto-accepted, in any mode) — the owner can accept, counter, or decline.
  if (bid < floor) return { kind: "pending", belowFloor: true };

  if (opts.mode === "manual") return { kind: "pending", belowFloor: false };
  if (opts.mode === "auto") return { kind: "accept", by: "autopilot" };

  // Smart (hybrid) — a bid comfortably above floor LOCKS instantly; at/above-floor
  // but below the instant-lock threshold waits for the owner.
  return bid >= Math.round(floor * ratio)
    ? { kind: "accept", by: "autopilot" }
    : { kind: "pending", belowFloor: false };
}

/** The at-floor→auto-accept threshold for a hybrid lot (for UI display). */
export function hybridAutoAcceptThreshold(floor: number, hybridAcceptRatio?: number): number {
  const f = Number(floor) || 0;
  const ratio = Number(hybridAcceptRatio) >= 1 ? Number(hybridAcceptRatio) : 1.1;
  return Math.round(f * ratio);
}

/** Pay-window deadline ISO for an accepted live bid. */
export function livePayDeadline(acceptedAtMs: number, payWindowHours: number): string {
  const hrs = Number(payWindowHours) > 0 ? Number(payWindowHours) : 24;
  return new Date(acceptedAtMs + hrs * 3_600_000).toISOString();
}

/** Is an accepted live bid still inside its pay window? (client + server) */
export function isLivePayWindowOpen(payDeadlineAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!payDeadlineAt) return false;
  const t = Date.parse(payDeadlineAt);
  return Number.isFinite(t) && now.getTime() < t;
}

/** Normalize any stored value to a valid autopilot mode (default hybrid). */
export function normalizeAutopilotMode(v: any): LiveAutopilotMode {
  return v === "auto" || v === "manual" || v === "hybrid" ? v : "hybrid";
}
