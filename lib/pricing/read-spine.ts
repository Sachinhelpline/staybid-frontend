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

// One place that turns a `room_date_price` cache row into a ResolvedSpinePrice,
// shared by the single-date and the date-range reader so they stay identical.
function mapCacheRow(c: any): ResolvedSpinePrice {
  return {
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
    for (const c of cached) out[c.room_id] = mapCacheRow(c);
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

/**
 * v750 (PRICE-CONSISTENCY-01) — resolve spine prices for a set of rooms across
 * MANY dates in ONE pass. Returns a map keyed by date → { [roomId]: price }.
 *
 * This is the batched sibling of `resolveSpinePrices`. It exists so the hotel
 * detail calendar can show the SAME canonical spine `livePrice` on every day
 * cell that the room cards show — WITHOUT firing one HTTP/DB round-trip per day
 * (a request storm). It reads the whole `room_date_price` window in a single
 * `date=in.(…)` query and reuses the exact same `computeRoomDatePrice` engine
 * (NO second pricing formula) for any (room,date) the cron has not filled yet.
 * Missing (room,date) pairs are simply absent — the caller renders them neutral
 * (never a fabricated price).
 */
export async function resolveSpinePricesRange(
  roomIds: string[],
  dates: string[],
): Promise<Record<string, Record<string, ResolvedSpinePrice>>> {
  const out: Record<string, Record<string, ResolvedSpinePrice>> = {};
  const ids = Array.from(new Set(roomIds.filter(Boolean)));
  const days = Array.from(
    new Set(
      (dates || [])
        .map((d) => String(d || "").slice(0, 10))
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    ),
  );
  if (ids.length === 0 || days.length === 0) return out;
  for (const d of days) out[d] = {};

  // ── 1. Cache hits — ONE query for every (room, date) in the window. ──
  try {
    const cached = await sbSelect<any>(
      "room_date_price",
      `room_id=in.(${idList(ids)})&date=in.(${idList(days)})&select=*`,
    );
    for (const c of cached) {
      const day = String(c.date || "").slice(0, 10);
      if (!out[day]) continue;
      out[day][c.room_id] = mapCacheRow(c);
    }
  } catch { /* cache miss is non-fatal — fall through to compute */ }

  // ── 2. Compute-fallback (pure, no extra DB per date) for anything the
  //    cron has not filled. Room/city/competitor inputs are loaded ONCE and
  //    the SAME computeRoomDatePrice engine is reused per (room, date). ──
  const missing: Array<{ id: string; day: string }> = [];
  for (const day of days) {
    for (const id of ids) {
      if (!out[day][id]) missing.push({ id, day });
    }
  }
  if (missing.length) {
    try {
      const missingIds = Array.from(new Set(missing.map((m) => m.id)));
      const rooms = await sbSelect<any>(
        "rooms",
        `id=in.(${idList(missingIds)})&select=id,hotelId,floorPrice,mrp,flashFloorPrice`,
      );
      const roomById: Record<string, any> = {};
      for (const r of rooms) roomById[r.id] = r;
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
        `room_id=in.(${idList(missingIds)})&select=room_id,competitor_min`,
      ).catch(() => []);
      for (const c of compRows) {
        const v = Number(c.competitor_min);
        if (v > 0) compOf[c.room_id] = v;
      }
      const engineCfg = await resolveEngineConfig().catch(() => undefined);
      for (const m of missing) {
        const r = roomById[m.id];
        if (!r) continue;
        const sp = computeRoomDatePrice({
          floorPrice: Number(r.floorPrice) || 0,
          mrp: Number(r.mrp) || 0,
          flashFloorPrice: Number(r.flashFloorPrice) || 0,
          city: cityOf[r.hotelId] || "",
          date: m.day,
          competitorMin: compOf[r.id] ?? null,
          engineCfg,
        });
        out[m.day][m.id] = { roomId: r.id, ...sp, source: "computed" };
      }
    } catch { /* compute fallback failed — caller handles absent (room,date) */ }
  }

  return out;
}
