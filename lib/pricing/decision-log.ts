// ════════════════════════════════════════════════════════════════
// v249.1 Phase 1 — AI Pricing decision logger.
//
// Captures the EPHEMERAL pricing context at bid time into
// `pricing_decisions` (see migrations/2026-05-31-v249.1-pricing-decisions.sql).
// The spine floor/live/flash/vacancy/competitor values that drove a decision
// are recomputed daily by the price-spine cron — so they're gone tomorrow
// unless snapshotted NOW. The OUTCOME (accepted/paid/revenue) is NOT stored
// here; it's read at Phase-2 training time by JOINing bids on bid_id.
//
// ⚠️ CONTRACT — this MUST be fire-and-forget and MUST NEVER throw, await-block,
// or otherwise affect the bid it's logging. A logging failure (table missing,
// network blip, bad row) is swallowed silently. The bid always wins.
// ════════════════════════════════════════════════════════════════

import { SB_URL, SB_H } from "@/lib/sb-server";

export interface PricingDecisionInput {
  bidId?: string | null;
  requestId?: string | null;
  hotelId: string;
  roomId: string;
  customerId?: string | null;
  flow?: string | null;
  checkIn?: string | null;        // ISO date (yyyy-mm-dd)
  numRooms?: number | null;

  bidAmount?: number | null;
  intentAmount?: number | null;

  staticFloor?: number | null;
  spineFloor?: number | null;
  spineLive?: number | null;
  spineFlash?: number | null;
  spineBase?: number | null;
  competitorMin?: number | null;
  vacancyRatio?: number | null;
  demandScore?: number | null;
  spineSource?: string | null;   // cache / computed / fallback / none

  bidderTier?: string | null;
  autopilotMode?: string | null;
  counterBand?: number | null;
  decidedAction?: string | null; // accept / counter / manual
  decidedStatus?: string | null; // PENDING / ACCEPTED / COUNTER
  counterAmount?: number | null;

  factors?: unknown;
  meta?: Record<string, unknown> | null;
}

const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const strOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

function pdId(): string {
  return `pd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Fire-and-forget. Returns a resolved promise immediately on the happy path
 * and swallows every error. Callers should NOT await it inside a hot path —
 * `void logPricingDecision(...)` is the intended usage.
 */
export async function logPricingDecision(input: PricingDecisionInput): Promise<void> {
  try {
    if (!input?.hotelId || !input?.roomId) return; // never log a malformed row

    const row = {
      id: pdId(),
      bid_id: strOrNull(input.bidId),
      request_id: strOrNull(input.requestId),
      hotel_id: input.hotelId,
      room_id: input.roomId,
      customer_id: strOrNull(input.customerId),
      flow: strOrNull(input.flow),
      check_in: strOrNull(input.checkIn),
      num_rooms: typeof input.numRooms === "number" && input.numRooms > 0
        ? Math.round(input.numRooms) : 1,
      bid_amount: numOrNull(input.bidAmount),
      intent_amount: numOrNull(input.intentAmount),
      static_floor: numOrNull(input.staticFloor),
      spine_floor: numOrNull(input.spineFloor),
      spine_live: numOrNull(input.spineLive),
      spine_flash: numOrNull(input.spineFlash),
      spine_base: numOrNull(input.spineBase),
      competitor_min: numOrNull(input.competitorMin),
      vacancy_ratio: numOrNull(input.vacancyRatio),
      demand_score: numOrNull(input.demandScore),
      spine_source: strOrNull(input.spineSource),
      bidder_tier: strOrNull(input.bidderTier),
      autopilot_mode: strOrNull(input.autopilotMode),
      counter_band: numOrNull(input.counterBand),
      decided_action: strOrNull(input.decidedAction),
      decided_status: strOrNull(input.decidedStatus),
      counter_amount: numOrNull(input.counterAmount),
      factors: Array.isArray(input.factors) ? input.factors : null,
      meta: input.meta && typeof input.meta === "object" ? input.meta : null,
    };

    // ignore-duplicates → a re-log on the same bid_id is a silent no-op
    // (the uniq partial index handles it); return=minimal keeps it cheap.
    await fetch(`${SB_URL}/rest/v1/pricing_decisions`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(row),
    }).catch(() => {});
  } catch {
    /* never throw — logging must never break a bid */
  }
}
