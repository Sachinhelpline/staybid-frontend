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
  auto: "Full Autopilot",
  hybrid: "Hybrid (strong bids auto-confirm)",
  manual: "Manual Review",
};

export const LIVE_AUTOPILOT_DESC: Record<LiveAutopilotMode, string> = {
  auto: "Every bid at or above your floor confirms automatically. Fastest way to move inventory — you can still manage allotments afterward.",
  hybrid: "Bids comfortably above your floor confirm automatically; at-floor bids wait for you to accept, counter, or decline. Balanced default.",
  manual: "Every bid waits for you to accept, counter, or decline. Full control over who gets your rooms.",
};

export type LiveBidDecision =
  | { kind: "accept"; by: "autopilot" }        // instantly confirmed
  | { kind: "pending" }                         // waits for the owner (manual/hybrid-at-floor)
  | { kind: "reject"; reason: "below_floor" };  // below the lot floor (guarded at submit too)

/**
 * Decide what happens to a freshly placed LIVE bid.
 *  - `perRoomPerNight` — the agent's bid (per room, per night).
 *  - `floor`           — the lot's min_bid_per_room_night (owner-type floor).
 *  - `mode`            — the lot's autopilot mode.
 *  - `hybridAcceptRatio` — hybrid auto-accepts a bid ≥ floor × ratio (default 1.10).
 */
export function evaluateLiveBid(opts: {
  perRoomPerNight: number;
  floor: number;
  mode: LiveAutopilotMode;
  hybridAcceptRatio?: number;
}): LiveBidDecision {
  const bid = Number(opts.perRoomPerNight) || 0;
  const floor = Number(opts.floor) || 0;
  const ratio = Number(opts.hybridAcceptRatio) >= 1 ? Number(opts.hybridAcceptRatio) : 1.1;

  // Below floor is never allowed on a live lot (the submit route enforces this
  // too; here it degrades to a reject decision so the preview is honest).
  if (!(floor > 0) || bid < floor) return { kind: "reject", reason: "below_floor" };

  if (opts.mode === "manual") return { kind: "pending" };
  if (opts.mode === "auto") return { kind: "accept", by: "autopilot" };

  // hybrid — comfortably above floor auto-confirms; at-floor waits for the owner.
  return bid >= Math.round(floor * ratio)
    ? { kind: "accept", by: "autopilot" }
    : { kind: "pending" };
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
