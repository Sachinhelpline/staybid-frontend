// ════════════════════════════════════════════════════════════════
// v249.2 Phase 2 — AI Pricing: outcome aggregation (server-only).
//
// Reads Phase-1 `pricing_decisions` and JOINs each to its `bids` row (by
// bid_id, in memory — there are no FK constraints in this DB, so PostgREST
// embeds aren't available; the codebase pattern since v96 is two reads + an
// in-memory join). Classifies each decision as accepted / not, buckets by
// price-ratio band, and returns the empirical accept-rate + sample count per
// band. The pure accept-model then shrinks the baseline toward these.
//
// Read-only. sb-cached (10 min). NEVER throws — a stats failure falls back to
// "no observed data" so the caller cleanly uses the baseline curve.
// ════════════════════════════════════════════════════════════════

import { SB_URL, SB_H } from "@/lib/sb-server";
import { sbCached } from "@/lib/sb-cache";

// A decision "succeeded" iff the hotel said yes — i.e. the bid reached an
// accepted/confirmed state. PENDING/COUNTER/EXPIRED/REJECTED/CANCELLED are
// non-accepts. (Paid/revenue weighting is a Phase-3 refinement.)
const ACCEPTED_STATUSES = new Set([
  "ACCEPTED", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT",
]);

// Price-ratio bands — edges mirror the baseline curve so observed buckets
// line up with the cold-start thresholds.
export type RatioBand = "<0.78" | "0.78-0.85" | "0.85-0.90" | "0.90-0.95" | "0.95-1.0" | ">=1.0";

export function ratioBandFor(ratio: number): RatioBand {
  const r = Number.isFinite(ratio) ? ratio : 0;
  if (r >= 1.0) return ">=1.0";
  if (r >= 0.95) return "0.95-1.0";
  if (r >= 0.90) return "0.90-0.95";
  if (r >= 0.85) return "0.85-0.90";
  if (r >= 0.78) return "0.78-0.85";
  return "<0.78";
}

export interface BandStat { n: number; accepts: number; rate: number }
export interface AcceptStats {
  scope: "room" | "hotel" | "none";
  totalN: number;
  bands: Record<string, BandStat>;
}

const TTL_OUTCOMES_MS = 10 * 60 * 1000;
const MAX_DECISIONS = 2000; // cap the scan; ample for any single room/hotel

const idList = (ids: string[]) =>
  ids.map((s) => `"${String(s).replace(/"/g, "")}"`).join(",");

async function sbGet(path: string): Promise<any[]> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_H });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

/**
 * Empirical accept-rate per price-ratio band for a room (or hotel) over the
 * last `sinceDays`. Returns `{ scope: "none", totalN: 0 }` when there's no
 * data yet — the caller then relies on the baseline curve.
 */
export async function loadAcceptStats(args: {
  roomId?: string | null;
  hotelId?: string | null;
  sinceDays?: number;
}): Promise<AcceptStats> {
  const sinceDays = args.sinceDays && args.sinceDays > 0 ? args.sinceDays : 90;
  const scope: "room" | "hotel" | "none" = args.roomId ? "room" : args.hotelId ? "hotel" : "none";
  if (scope === "none") return { scope: "none", totalN: 0, bands: {} };

  const filterCol = scope === "room" ? "room_id" : "hotel_id";
  const filterVal = scope === "room" ? args.roomId! : args.hotelId!;
  const sinceISO = new Date(Date.now() - sinceDays * 86400_000).toISOString();
  const cacheKey = `accept-stats:${scope}:${filterVal}:${sinceDays}`;

  return sbCached<AcceptStats>(cacheKey, async () => {
    try {
      const decisions = await sbGet(
        `pricing_decisions?${filterCol}=eq.${encodeURIComponent(filterVal)}` +
        `&bid_id=not.is.null&created_at=gte.${encodeURIComponent(sinceISO)}` +
        `&select=bid_id,spine_floor,static_floor,intent_amount,bid_amount` +
        `&order=created_at.desc&limit=${MAX_DECISIONS}`,
      );
      if (decisions.length === 0) return { scope, totalN: 0, bands: {} };

      // Side-load the bid outcomes by id (in-memory join — no FK embeds).
      const bidIds = Array.from(
        new Set(decisions.map((d: any) => d.bid_id).filter(Boolean)),
      ) as string[];
      const statusById: Record<string, string> = {};
      // Chunk the id-in list so a huge room doesn't blow the URL length.
      const CHUNK = 300;
      for (let i = 0; i < bidIds.length; i += CHUNK) {
        const chunk = bidIds.slice(i, i + CHUNK);
        const rows = await sbGet(`bids?id=in.(${idList(chunk)})&select=id,status`);
        for (const b of rows) statusById[b.id] = String(b.status || "");
      }

      const bands: Record<string, BandStat> = {};
      let totalN = 0;
      for (const d of decisions) {
        const status = statusById[d.bid_id];
        if (!status) continue; // bid row missing → skip (can't classify)
        const floor = Number(d.spine_floor) || Number(d.static_floor) || 0;
        const intent = Number(d.intent_amount) || Number(d.bid_amount) || 0;
        if (!(floor > 0) || !(intent > 0)) continue;
        const band = ratioBandFor(intent / floor);
        const accepted = ACCEPTED_STATUSES.has(status) ? 1 : 0;
        const cur = bands[band] || { n: 0, accepts: 0, rate: 0 };
        cur.n += 1;
        cur.accepts += accepted;
        cur.rate = cur.accepts / cur.n;
        bands[band] = cur;
        totalN += 1;
      }
      return { scope, totalN, bands };
    } catch {
      return { scope, totalN: 0, bands: {} };
    }
  }, TTL_OUTCOMES_MS);
}

/** Observed accept-rate + sample count for a ratio, from a loaded stats set. */
export function observedForRatio(
  stats: AcceptStats,
  ratio: number,
): { rate: number | null; sampleCount: number } {
  const band = stats.bands[ratioBandFor(ratio)];
  if (!band || band.n === 0) return { rate: null, sampleCount: 0 };
  return { rate: band.rate, sampleCount: band.n };
}
