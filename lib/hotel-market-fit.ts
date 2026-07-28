// ── Market-Fit map + City→Zone→National cohort rank (v549) ────────────────
// Server-only. Builds, for the WHOLE live catalogue in one cached pass, a
// deterministic market-fit score + cohort rank per hotel — so every property
// (current AND future) shows a real score + rank instead of "awaiting score",
// with no per-hotel seed and no schema change.
//
// Score source per hotel:
//   • a REAL operational score (from hotel_scores) when the property actually
//     has data (bookings > 0, or an admin-seeded row) — the existing engine wins;
//   • else the intrinsic MARKET-FIT score (computeMarketFitScore) from the
//     property's own signals (guest rating, popularity, class, listing).
//
// Rank = smallest cohort with ≥ 2 properties:
//   1. the hotel's CITY   (≥2 → "#N in {City}")   ← the original relative rank,
//      which auto-activates the moment a city gets its 2nd property;
//   2. else its ZONE      (LAUNCH_ZONES, "#N in {Zone}");
//   3. else NATIONAL      (rank hidden, tier shown; percentile kept).
//
// Cached 60s via sbCached so a 30-badge page costs ~2 bounded Supabase reads.
import { sbCached } from "@/lib/sb-cache";
import { SB_URL, SB_H } from "@/lib/sb";
import {
  computeMarketFitScore,
  badgeForScore,
  statusForScore,
  type HotelScorecard,
  type MarketFitInputs,
} from "@/lib/hotel-score";
import { LAUNCH_ZONES, zoneForCity, isLaunchCurationOn, LAUNCH_HOTEL_IDS } from "@/lib/launch/curation";

export type CohortRank = {
  rank: number | null;
  total: number;
  percentile: number | null;
  scope: "city" | "zone" | "national";
  scopeLabel: string;
};

export type MarketFitEntry = {
  hotelId: string;
  city: string | null;
  overall: number;
  status: HotelScorecard["status"];
  badge: HotelScorecard["badge"];
  rank: CohortRank;
  marketFit: boolean;          // true → score is intrinsic (no operational data)
  attrs: MarketFitInputs;      // to rebuild the drill-down card checkpoints
};

async function sbGet(path: string): Promise<any[]> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_H, cache: "no-store" });
    return r.ok ? await r.json().catch(() => []) : [];
  } catch {
    return [];
  }
}

function attrsOf(h: any): MarketFitInputs {
  return {
    hotelId: String(h.id),
    starRating: h.star_rating ?? h.starRating ?? null,
    avgRating: h.avgRating ?? h.avg_rating ?? null,
    totalReviews: h.totalReviews ?? h.total_reviews ?? null,
    imagesCount: Array.isArray(h.images) ? h.images.length : 0,
    amenitiesCount: Array.isArray(h.amenities) ? h.amenities.length : 0,
    hasDescription: !!(h.description && String(h.description).trim().length > 20),
  };
}

/** Build (and 60s-cache) the whole-catalogue market-fit + cohort-rank map. */
export function computeMarketFitMap(): Promise<Record<string, MarketFitEntry>> {
  return sbCached<Record<string, MarketFitEntry>>(
    "market-fit-map:v1",
    async () => {
      // 1. Every customer-visible hotel + the intrinsic signals it already has.
      let hotels = await sbGet(
        "hotels?approval_status=eq.approved&select=id,city,star_rating,avgRating,totalReviews,images,amenities,description&limit=1000",
      );
      // Rank within EXACTLY the set the customer sees: during launch curation
      // the feed shows only the curated hotels, so the cohort must match (else a
      // hotel could read "#7 in Garhwal" while only 5 cards are shown).
      if (isLaunchCurationOn()) {
        hotels = hotels.filter((h) => LAUNCH_HOTEL_IDS.has(String(h.id)));
      }
      if (!hotels.length) return {};

      // 2. Any REAL operational score already cached (bookings>0 or admin-seeded).
      const ids = hotels.map((h) => encodeURIComponent(String(h.id)));
      const scoreRows =
        ids.length > 0
          ? await sbGet(
              `hotel_scores?hotel_id=in.(${ids.join(",")})&select=hotel_id,overall,total_bookings,is_seeded`,
            )
          : [];
      const realById = new Map<string, number>();
      for (const s of scoreRows) {
        const hasReal =
          (Number(s.total_bookings) || 0) > 0 || s.is_seeded === true;
        if (hasReal && s.overall != null) realById.set(String(s.hotel_id), Number(s.overall));
      }

      // 3. Resolve an effective overall per hotel (real wins, else market-fit).
      type Row = { id: string; city: string | null; cityKey: string; overall: number; marketFit: boolean; attrs: MarketFitInputs };
      const rows: Row[] = hotels.map((h) => {
        const id = String(h.id);
        const attrs = attrsOf(h);
        const real = realById.get(id);
        const overall = real != null ? real : computeMarketFitScore(attrs);
        return {
          id,
          city: h.city ?? null,
          cityKey: String(h.city || "").trim().toLowerCase(),
          overall,
          marketFit: real == null,
          attrs,
        };
      });

      // 4. Pools by city and by zone (for the cohort fallback).
      const byCity = new Map<string, Row[]>();
      for (const r of rows) {
        if (!r.cityKey) continue;
        (byCity.get(r.cityKey) || byCity.set(r.cityKey, []).get(r.cityKey)!).push(r);
      }
      const byZone = new Map<string, Row[]>();
      for (const r of rows) {
        const zid = zoneForCity(r.city);
        if (!zid) continue;
        (byZone.get(zid) || byZone.set(zid, []).get(zid)!).push(r);
      }

      // Deterministic ordering: overall desc, ties by id asc.
      const order = (a: Row, b: Row) => (b.overall - a.overall) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      const rankIn = (pool: Row[], id: string): { rank: number; total: number; percentile: number } => {
        const sorted = [...pool].sort(order);
        const idx = sorted.findIndex((x) => x.id === id);
        const rank = idx + 1;
        const total = sorted.length;
        const percentile = total > 1 ? +(((total - rank) / (total - 1)) * 100).toFixed(1) : 100;
        return { rank, total, percentile };
      };

      const out: Record<string, MarketFitEntry> = {};
      for (const r of rows) {
        let cohort: CohortRank;
        const cityPool = r.cityKey ? byCity.get(r.cityKey) || [] : [];
        if (cityPool.length >= 2) {
          const { rank, total, percentile } = rankIn(cityPool, r.id);
          cohort = { rank, total, percentile, scope: "city", scopeLabel: r.city || "your city" };
        } else {
          const zid = zoneForCity(r.city);
          const zone = zid ? LAUNCH_ZONES.find((z) => z.id === zid) : null;
          const zonePool = zid ? byZone.get(zid) || [] : [];
          if (zone && zonePool.length >= 2) {
            const { rank, total, percentile } = rankIn(zonePool, r.id);
            cohort = { rank, total, percentile, scope: "zone", scopeLabel: zone.label };
          } else {
            // National — rank number hidden (would look odd); keep percentile.
            const { total, percentile } = rankIn(rows, r.id);
            cohort = { rank: null, total, percentile, scope: "national", scopeLabel: "StayBid" };
          }
        }
        out[r.id] = {
          hotelId: r.id,
          city: r.city,
          overall: r.overall,
          status: statusForScore(r.overall),
          badge: badgeForScore(r.overall),
          rank: cohort,
          marketFit: r.marketFit,
          attrs: r.attrs,
        };
      }
      return out;
    },
    60_000,
  );
}

/** Single-hotel market-fit entry (falls back to a solo build if not approved
 *  / not in the cached catalogue map). */
export async function marketFitFor(hotelId: string): Promise<MarketFitEntry | null> {
  const map = await computeMarketFitMap();
  if (map[hotelId]) return map[hotelId];
  // Not in the approved catalogue map — build a solo entry from its own row.
  const rows = await sbGet(
    `hotels?id=eq.${encodeURIComponent(hotelId)}&select=id,city,star_rating,avgRating,totalReviews,images,amenities,description&limit=1`,
  );
  const h = rows[0];
  if (!h) return null;
  const attrs = attrsOf(h);
  const overall = computeMarketFitScore(attrs);
  return {
    hotelId,
    city: h.city ?? null,
    overall,
    status: statusForScore(overall),
    badge: badgeForScore(overall),
    rank: { rank: null, total: 0, percentile: null, scope: "national", scopeLabel: "StayBid" },
    marketFit: true,
    attrs,
  };
}
