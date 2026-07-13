// ─────────────────────────────────────────────────────────────────────────
// lib/autopilot-server.ts — server-side (tamper-proof) autopilot helpers.
//
// The browser-side lib/autopilot.ts getAutopilotMode() is a client fetch;
// this is the direct-Supabase equivalent for API routes, plus a full
// bidder-score loader. Both fail SAFE ('auto' mode, NEW score) so a lookup
// error never blocks a bid. Used by /api/bids/place (the /bid instant path)
// + /api/bids/[id]/schedule-accept (the hotel-page deferred path) so neither
// trusts a client-supplied tier / mode.
// ─────────────────────────────────────────────────────────────────────────

import { sbSelect } from "./sb-server";
import { computeBidderScore, type BidderScore } from "./bidder-score";
import type { AutopilotMode } from "./autopilot";

/** Read the hotel's autopilot mode straight from Supabase. Defaults to
 *  'auto' if the column is missing / unreachable (lib/autopilot parity). */
export async function loadAutopilotMode(hotelId: string): Promise<AutopilotMode> {
  if (!hotelId) return "auto";
  try {
    const rows = await sbSelect(
      `hotels?id=eq.${encodeURIComponent(hotelId)}&select=autopilot_mode&limit=1`,
    );
    const m = String(rows[0]?.autopilot_mode || "auto");
    if (m === "auto" || m === "hybrid" || m === "manual") return m;
  } catch { /* column missing / unreachable → 'auto' */ }
  return "auto";
}

/**
 * Circle multi-investor blueprint — Phase A: per-unit-aware autopilot mode.
 *
 * On a StayBid-operated hotel each physical room (`hotel_room_units`) can be
 * owned by a DIFFERENT investor. Each investor may set their OWN room's
 * `hotel_room_units.autopilot_mode` (see /api/partner/circle-units). A NULL there
 * means "inherit the hotel-level `hotels.autopilot_mode`" — every existing unit
 * today, zero regression. So one investor's mode never changes another owner's
 * rooms, and the classic single-owner hotel is untouched (its bids carry no
 * assignedUnitId, so this always falls straight through to the hotel-level mode).
 *
 * Fails SAFE at every layer: a bad/missing unit lookup falls back to the
 * hotel-level mode, which itself falls back to 'auto'. A bid is NEVER blocked by
 * an autopilot lookup.
 *
 * @param unitId  the specific owned unit the bid is assigned to (bids.assignedUnitId),
 *                or null/undefined for a classic category bid → hotel-level mode.
 */
export async function loadEffectiveAutopilotMode(
  hotelId: string,
  unitId?: string | null,
): Promise<AutopilotMode> {
  if (unitId) {
    try {
      const rows = await sbSelect(
        `hotel_room_units?id=eq.${encodeURIComponent(unitId)}&select=autopilot_mode&limit=1`,
      );
      const m = String(rows[0]?.autopilot_mode || "");
      if (m === "auto" || m === "hybrid" || m === "manual") return m;
      // NULL / missing override → inherit the hotel-level mode below.
    } catch { /* column missing / unreachable → hotel-level mode below */ }
  }
  return loadAutopilotMode(hotelId);
}

/** Compute the customer's bidder score from their last 10 bids (DB-backed,
 *  same query shape the place route already uses). NEW-tier fallback on any
 *  error or empty history so the caller always gets a usable score. */
export async function loadServerScore(customerId: string): Promise<BidderScore> {
  try {
    const hist = await sbSelect(
      `bids?customerId=eq.${encodeURIComponent(customerId)}&select=amount,message,roomId&order=%22createdAt%22.desc&limit=10`,
    );
    if (!hist.length) return computeBidderScore([]);
    const roomIds = Array.from(
      new Set(hist.map((b: any) => b.roomId).filter(Boolean)),
    );
    const rooms = roomIds.length
      ? await sbSelect(`rooms?id=in.(${roomIds.join(",")})&select=id,floorPrice`)
      : [];
    const floorById = new Map(
      rooms.map((r: any) => [r.id, Number(r.floorPrice || 0)]),
    );
    const items = hist.map((b: any) => ({
      amount: Number(b.amount),
      message: b.message,
      floorPrice: floorById.get(b.roomId),
    }));
    return computeBidderScore(items);
  } catch {
    return computeBidderScore([]); // NEW fallback
  }
}
