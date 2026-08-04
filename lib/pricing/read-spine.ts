// ════════════════════════════════════════════════════════════════
// v166 Phase C — Pricing-spine READER (single source of truth).
//
// `resolveSpinePrices()` is the ONE accessor every surface should use
// to get a room's price for a date. It:
//   1. reads the precomputed `room_date_price` cache (fast, consistent,
//      competitor-undercut + per-date vacancy already baked in), and
//   2. for any room/date the cron hasn't filled yet, computes the same
//      spine prices on-the-fly via `computeRoomDatePrice` — so a caller
//      ALWAYS gets a sensible answer, even before the cron has run.
//
// Server-only (uses the Supabase REST helper).
// ════════════════════════════════════════════════════════════════

import { sbSelect } from "@/lib/onboard/supabase-admin";
import { computeRoomDatePrice, type SpinePrice } from "./spine";
import { resolveEngineConfig } from "./engine-config-store";

export interface ResolvedSpinePrice extends SpinePrice {
  roomId: string;
  source: "cache" | "computed";
}

const idList = (ids: string[]) => ids.map((x) => encodeURIComponent(x)).join(",");

/**
 * Resolve spine prices for a set of rooms on one date.
 * Returns a map keyed by roomId. Missing rooms are simply absent.
 */
export async function resolveSpinePrices(
  roomIds: string[],
  date: string,
): Promise<Record<string, ResolvedSpinePrice>> {
  const out: Record<string, ResolvedSpinePrice> = {};
  const ids = Array.from(new Set(roomIds.filter(Boolean)));
  if (ids.length === 0) return out;
  const day = String(date || "").slice(0, 10) || new Date().toISOString().slice(0, 10);

  // ── 1. Cache hits from room_date_price ──────────────────────────
  try {
    const cached = await sbSelect<any>(
      "room_date_price",
      `room_id=in.(${idList(ids)})&date=eq.${day}&select=*`,
    );
    for (const c of cached) {
      out[c.room_id] = {
        roomId: c.room_id,
        baseRate: Number(c.base_rate) || 0,
        livePrice: Number(c.live_price) || 0,
        bidFloor: Number(c.bid_floor) || 0,
        flashPrice: Number(c.flash_price) || 0,
        flashFloor: Number(c.flash_floor) || 0,
        competitorMin: c.competitor_min != null ? Number(c.competitor_min) : null,
        vacancyRatio: c.vacancy_ratio != null ? Number(c.vacancy_ratio) : null,
        demandScore: Number(c.demand_score) || 0,
        factors: Array.isArray(c.factors) ? c.factors : [],
        source: "cache",
      };
    }
  } catch { /* cache miss is non-fatal — fall through to compute */ }

  // ── 2. Compute on-the-fly for anything the cron hasn't filled ───
  const missing = ids.filter((id) => !out[id]);
  if (missing.length) {
    try {
      const rooms = await sbSelect<any>(
        "rooms",
        `id=in.(${idList(missing)})&select=id,hotelId,floorPrice,mrp,flashFloorPrice`,
      );
      const hotelIds = Array.from(new Set(rooms.map((r: any) => r.hotelId).filter(Boolean)));
      const cityOf: Record<string, string> = {};
      if (hotelIds.length) {
        const hotels = await sbSelect<any>(
          "hotels",
          `id=in.(${idList(hotelIds)})&select=id,city`,
        ).catch(() => []);
        for (const h of hotels) cityOf[h.id] = h.city || "";
      }
      const compOf: Record<string, number> = {};
      const compRows = await sbSelect<any>(
        "room_pricing_config",
        `room_id=in.(${idList(missing)})&select=room_id,competitor_min`,
      ).catch(() => []);
      for (const c of compRows) {
        const v = Number(c.competitor_min);
        if (v > 0) compOf[c.room_id] = v;
      }
      // Admin-tuned engine config (fail-open) so on-the-fly computes match the
      // cron-written cache. Loaded once for the whole missing-set.
      const engineCfg = await resolveEngineConfig().catch(() => undefined);
      for (const r of rooms) {
        const sp = computeRoomDatePrice({
          floorPrice: Number(r.floorPrice) || 0,
          mrp: Number(r.mrp) || 0,
          flashFloorPrice: Number(r.flashFloorPrice) || 0,
          city: cityOf[r.hotelId] || "",
          date: day,
          competitorMin: compOf[r.id] ?? null,
          engineCfg,
        });
        out[r.id] = { roomId: r.id, ...sp, source: "computed" };
      }
    } catch { /* compute fallback failed — caller handles absent rooms */ }
  }

  return out;
}
