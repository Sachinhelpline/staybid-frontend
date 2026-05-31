// ════════════════════════════════════════════════════════════════
// v249.4 Phase 4 — AI Pricing: learned-model store (server-only).
//
// The nightly trainer (/api/cron/pricing-model-train) aggregates every
// pricing_decision ⨝ bids outcome into empirical accept-rates per
// (scope, scope_id, ratio_band) and writes them to `pricing_model_params`.
// THIS module is the read + write surface for that table:
//
//   loadLearnedStats({roomId|hotelId|city|global})  → AcceptStats
//       (same shape Phase 2's loadAcceptStats returns, so it drops
//        straight into observedForRatio + blendAcceptProbability)
//   upsertModelParams(rows)                          → trainer write path
//
// The accept-estimate + optimize routes consult loadLearnedStats ONLY when
// PRICING_MODEL_LEARNED=1 (default OFF). Until then the table fills nightly
// for observability but no live read path uses it — byte-identical pricing.
//
// NEVER throws — a stats failure returns "no data" so the caller cleanly
// falls back to the Phase-2 baseline curve.
// ════════════════════════════════════════════════════════════════

import { SB_URL, SB_H, SB_H_REPRESENT } from "@/lib/sb-server";
import { sbCached } from "@/lib/sb-cache";
import type { AcceptStats, BandStat } from "@/lib/pricing/outcomes";

export type ModelScope = "room" | "hotel" | "city" | "global";

/** True only when PRICING_MODEL_LEARNED === "1". Default OFF. */
export function learnedModelEnabled(): boolean {
  return process.env.PRICING_MODEL_LEARNED === "1";
}

const TTL_MODEL_MS = 10 * 60 * 1000; // learned params change once/night — 10min cache is ample

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
 * Learned empirical accept-rate per ratio-band for one scope, read from the
 * nightly-trained `pricing_model_params` table. Returns `{scope:"none"}` when
 * there's no trained row yet so the caller falls back to the baseline curve.
 */
export async function loadLearnedStats(args: {
  scope: ModelScope;
  scopeId: string;
}): Promise<AcceptStats> {
  const scope = args.scope;
  const scopeId = String(args.scopeId || "");
  if (!scopeId) return { scope: "none", totalN: 0, bands: {} };

  const cacheKey = `learned-stats:${scope}:${scopeId}`;
  return sbCached<AcceptStats>(cacheKey, async () => {
    try {
      const rows = await sbGet(
        `pricing_model_params?scope=eq.${encodeURIComponent(scope)}` +
        `&scope_id=eq.${encodeURIComponent(scopeId)}` +
        `&select=ratio_band,n,accepts,observed_rate`,
      );
      if (rows.length === 0) {
        return { scope: "none", totalN: 0, bands: {} };
      }
      const bands: Record<string, BandStat> = {};
      let totalN = 0;
      for (const r of rows) {
        const n = Number(r.n) || 0;
        const accepts = Number(r.accepts) || 0;
        const rate = typeof r.observed_rate === "number"
          ? r.observed_rate
          : (n > 0 ? accepts / n : 0);
        bands[String(r.ratio_band)] = { n, accepts, rate };
        totalN += n;
      }
      // Map "global"/"city" onto the AcceptStats scope union ("room"|"hotel"|
      // "none") — only the totalN + bands matter to observedForRatio, so any
      // non-"none" label is fine. Use "hotel" as the generic non-none marker.
      const mapped: AcceptStats["scope"] = scope === "room" ? "room" : "hotel";
      return { scope: totalN > 0 ? mapped : "none", totalN, bands };
    } catch {
      return { scope: "none", totalN: 0, bands: {} };
    }
  }, TTL_MODEL_MS);
}

/**
 * Resolve learned stats with the scope-fallback ladder room → hotel → city →
 * global. Returns the first scope that has a sample in the requested band's
 * neighbourhood (totalN > 0). Pure-additive read used by the optimize +
 * accept-estimate routes when PRICING_MODEL_LEARNED=1.
 */
export async function loadLearnedStatsWithFallback(args: {
  roomId?: string | null;
  hotelId?: string | null;
  city?: string | null;
}): Promise<{ stats: AcceptStats; usedScope: ModelScope | "none" }> {
  const ladder: Array<[ModelScope, string | null | undefined]> = [
    ["room", args.roomId],
    ["hotel", args.hotelId],
    ["city", args.city],
    ["global", "GLOBAL"],
  ];
  for (const [scope, id] of ladder) {
    if (!id) continue;
    const stats = await loadLearnedStats({ scope, scopeId: String(id) });
    if (stats.totalN > 0) return { stats, usedScope: scope };
  }
  return { stats: { scope: "none", totalN: 0, bands: {} }, usedScope: "none" };
}

export interface ModelParamRow {
  scope: ModelScope;
  scopeId: string;
  ratioBand: string;
  n: number;
  accepts: number;
}

function pmId(scope: string, scopeId: string, band: string): string {
  // Deterministic id so the trainer upsert is idempotent on re-run within a
  // night (the unique index is on (scope, scope_id, ratio_band) anyway, but a
  // stable PK keeps the row count flat instead of accumulating dead ids).
  const safe = `${scope}|${scopeId}|${band}`.replace(/[^a-zA-Z0-9|_.-]/g, "_").slice(0, 90);
  return `pmp_${safe}`;
}

/**
 * Bulk upsert learned params (trainer write path). Uses PostgREST
 * on_conflict=scope,scope_id,ratio_band + merge-duplicates so re-running the
 * trainer overwrites the prior night's row in place. NEVER throws.
 */
export async function upsertModelParams(rows: ModelParamRow[]): Promise<number> {
  if (!rows.length) return 0;
  const now = new Date().toISOString();
  const payload = rows.map((r) => ({
    id: pmId(r.scope, r.scopeId, r.ratioBand),
    scope: r.scope,
    scope_id: r.scopeId,
    ratio_band: r.ratioBand,
    n: r.n,
    accepts: r.accepts,
    observed_rate: r.n > 0 ? r.accepts / r.n : 0,
    updated_at: now,
  }));
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/pricing_model_params?on_conflict=scope,scope_id,ratio_band`,
      {
        method: "POST",
        headers: { ...SB_H_REPRESENT, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(payload),
      },
    );
    return r.ok ? payload.length : 0;
  } catch {
    return 0;
  }
}
