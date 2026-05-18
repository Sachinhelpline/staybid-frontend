// v128 — Hotel Performance Scorecard endpoint.
//
// GET /api/hotels/:id/scorecard
//
// Returns the cached scorecard + live rank-within-city for the hotel.
// If the cache row is older than 30 minutes, recompute opportunistically
// (cron is the primary refresh path; this is the safety net).
//
// Response shape:
//   {
//     hotelId, city,
//     overall, status, badge: { emoji, label, color },
//     rank: { rank, total, percentile },
//     checkpoints: CheckpointResult[],   // 10 entries with weight + earned + evidence
//     totals: { bookings, stayFeedback, complaints },
//     computedAt
//   }
//
// Cached at the HTTP layer (5min, swr=30min) AND server-side (sb-cache).
// Personalisation runs per request only for the per-user "are you in
// this hotel's top-rated tier" badge (future addition).

import { NextResponse } from "next/server";
import { SB_URL, SB_H } from "@/lib/sb";
import { sbCached } from "@/lib/sb-cache";
import { computeHotelScore, rankWithinCity } from "@/lib/hotel-score";
import { loadHotelScoreInputs } from "@/lib/hotel-score-data";

const REFRESH_AFTER_MS = 30 * 60_000; // 30 minutes
// v131.6 — when the cached row already has a valid score (non-null, > 0),
// honour it for up to 24h before recomputing. This prevents the engine's
// "no source data → unrated" branch from wiping out demo/seeded scorecards
// every 30 minutes. Hotels with NULL/zero cached score still recompute
// aggressively so they can pick up real data as it lands.
const HONOR_GOOD_SCORE_MS = 24 * 60 * 60_000; // 24 hours

async function sb(path: string): Promise<any[]> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: SB_H,
    cache: "no-store",
  });
  return r.ok ? r.json().catch(() => []) : [];
}

async function readCached(hotelId: string): Promise<any | null> {
  const rows = await sb(
    `hotel_scores?hotel_id=eq.${encodeURIComponent(hotelId)}&select=*&limit=1`,
  );
  return rows[0] || null;
}

async function upsertScore(card: any, cityRank: any, hotelMeta: any, existing: any) {
  // v133.1 — Downgrade protection. If recompute returned null (no source
  // data) but the existing cached row had a valid score, REFUSE the upsert.
  // This protects every cached score (seeded OR real) from being silently
  // wiped by an empty-source-data recompute pass. Combined with the
  // is_seeded check in the GET handler, this is layer 2 of 3 defenses
  // against the v131.6 wipe pattern.
  if ((card.overall == null) && existing && existing.overall != null) {
    return; // skip — don't downgrade a good score to "unrated"
  }
  const body: any = {
    hotel_id: card.hotelId,
    city: hotelMeta?.city || null,
    state: hotelMeta?.state || null,
    overall: card.overall,
    rank_in_city: cityRank.rank,
    total_in_city: cityRank.total,
    percentile_city: cityRank.percentile,
    status: card.status,
    badge_emoji: card.badge.emoji,
    badge_label: card.badge.label,
    badge_color: card.badge.color,
    checkpoints: card.checkpoints,
    total_bookings: card.totalBookings,
    total_stay_feedback: card.totalStayFeedback,
    total_complaints: card.totalComplaints,
    computed_at: card.computedAt,
    updated_at: new Date().toISOString(),
  };
  // v133.1 — Always preserve the is_seeded flag when present on the row.
  // Without explicitly carrying it through, the merge-duplicates upsert
  // would reset it to the column default (FALSE), unsealing protected
  // synthetic rows.
  if (existing && existing.is_seeded === true) body.is_seeded = true;
  // PostgREST upsert on conflict
  await fetch(`${SB_URL}/rest/v1/hotel_scores?on_conflict=hotel_id`, {
    method: "POST",
    headers: { ...SB_H, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(body),
  }).catch(() => {});
}

async function recompute(hotelId: string, hotelMeta: any, cached: any) {
  // v133.1 — Layer 3 defense: synthetic seeded rows are NEVER recomputed.
  // The cached row is returned as-is; live source data never gets a chance
  // to overwrite seeded demo values. Admin can manually flip is_seeded=FALSE
  // on a row to opt into recompute when real activity arrives.
  if (cached && cached.is_seeded === true) {
    return {
      card: {
        hotelId,
        overall: cached.overall === null ? null : Number(cached.overall),
        status: cached.status,
        badge: {
          emoji: cached.badge_emoji,
          label: cached.badge_label,
          color: cached.badge_color,
        },
        checkpoints: cached.checkpoints || [],
        totalBookings: cached.total_bookings || 0,
        totalStayFeedback: cached.total_stay_feedback || 0,
        totalComplaints: cached.total_complaints || 0,
        computedAt: cached.computed_at,
      },
      cityRank: {
        rank: cached.rank_in_city,
        total: cached.total_in_city,
        percentile:
          cached.percentile_city === null ? null : Number(cached.percentile_city),
      },
    };
  }

  const inputs = await loadHotelScoreInputs(hotelId);
  const card = computeHotelScore(inputs);

  // Rank within city: pull every other hotel in the same city + their
  // cached overall scores. Hotels with no cached row are skipped from
  // the rank pool (they get included next cron sweep).
  let cityRank = { rank: null as number | null, total: 0, percentile: null as number | null };
  if (hotelMeta?.city) {
    const cityHotels = await sb(
      `hotels?city=eq.${encodeURIComponent(hotelMeta.city)}&select=id&limit=500`,
    );
    const cityHotelIds = (cityHotels as any[]).map((h) => h.id);
    if (cityHotelIds.length) {
      const cityScores = await sb(
        `hotel_scores?hotel_id=in.(${cityHotelIds
          .map((id: string) => encodeURIComponent(id))
          .join(",")})&select=hotel_id,overall`,
      );
      const scoresForRank: Array<{ hotelId: string; overall: number | null }> = [
        ...(cityScores as any[]).map((s) => ({
          hotelId: s.hotel_id,
          overall: s.overall === null ? null : Number(s.overall),
        })),
        // Inject this hotel's just-computed overall (overrides if it was in DB)
        { hotelId: card.hotelId, overall: card.overall },
      ];
      // Dedupe by hotelId, latest wins
      const dedup = new Map<string, { hotelId: string; overall: number | null }>();
      for (const s of scoresForRank) dedup.set(s.hotelId, s);
      cityRank = rankWithinCity(Array.from(dedup.values()), card.hotelId);
    }
  }

  await upsertScore(card, cityRank, hotelMeta, cached);
  return { card, cityRank };
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const hotelId = params.id;
  if (!hotelId) {
    return NextResponse.json({ error: "hotelId required" }, { status: 400 });
  }

  try {
    // Pull hotel meta (city/state) — cached via sb-cache
    const hotelRows: any[] = await sbCached(
      `hotel-meta:${hotelId}`,
      () =>
        sb(
          `hotels?id=eq.${encodeURIComponent(hotelId)}&select=id,name,city,state&limit=1`,
        ),
      60_000,
    );
    const hotelMeta = hotelRows[0] || null;
    if (!hotelMeta) {
      return NextResponse.json({ error: "Hotel not found" }, { status: 404 });
    }

    let row = await readCached(hotelId);
    let fresh = false;
    const age = row ? Date.now() - new Date(row.computed_at).getTime() : Infinity;
    // v131.6 — protect good cached scores from being wiped by no-data
    // recompute. If the cached row has a valid score, honour it for 24h.
    const hasGoodScore = row && row.overall != null && Number(row.overall) > 0;
    // v133.1 — Layer 1 defense: seeded rows skip the age check entirely.
    // The recompute() function ALSO bails out for is_seeded rows (layer 3),
    // but short-circuiting here avoids even the unnecessary network round-trip
    // to loadHotelScoreInputs. The whole 24h-honor window pattern from v131.6
    // is now obsolete for seeded rows — they live forever until explicitly
    // unsealed via SQL: UPDATE hotel_scores SET is_seeded=false WHERE …
    const isSeeded = row && row.is_seeded === true;
    const effectiveTTL = isSeeded
      ? Number.MAX_SAFE_INTEGER
      : (hasGoodScore ? HONOR_GOOD_SCORE_MS : REFRESH_AFTER_MS);
    if (!row || age > effectiveTTL) {
      const out = await recompute(hotelId, hotelMeta, row);
      row = {
        hotel_id: hotelId,
        city: hotelMeta.city,
        state: hotelMeta.state,
        overall: out.card.overall,
        rank_in_city: out.cityRank.rank,
        total_in_city: out.cityRank.total,
        percentile_city: out.cityRank.percentile,
        status: out.card.status,
        badge_emoji: out.card.badge.emoji,
        badge_label: out.card.badge.label,
        badge_color: out.card.badge.color,
        checkpoints: out.card.checkpoints,
        total_bookings: out.card.totalBookings,
        total_stay_feedback: out.card.totalStayFeedback,
        total_complaints: out.card.totalComplaints,
        computed_at: out.card.computedAt,
      };
      fresh = true;
    }

    return NextResponse.json(
      {
        hotelId,
        city: row.city,
        state: row.state,
        overall: row.overall === null ? null : Number(row.overall),
        status: row.status,
        badge: {
          emoji: row.badge_emoji,
          label: row.badge_label,
          color: row.badge_color,
        },
        rank: {
          rank: row.rank_in_city,
          total: row.total_in_city,
          percentile: row.percentile_city === null ? null : Number(row.percentile_city),
        },
        checkpoints: row.checkpoints || [],
        totals: {
          bookings: row.total_bookings || 0,
          stayFeedback: row.total_stay_feedback || 0,
          complaints: row.total_complaints || 0,
        },
        computedAt: row.computed_at,
        fresh,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=120, stale-while-revalidate=600",
          // v131.7 — Vercel strips s-maxage from auto-dynamic routes.
          // CDN-Cache-Control is NOT stripped → 90%+ of repeat scorecard
          // fetches now serve from edge in <30ms.
          "CDN-Cache-Control": "public, s-maxage=120, stale-while-revalidate=600",
          "Vercel-CDN-Cache-Control": "public, s-maxage=120, stale-while-revalidate=600",
        },
      },
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        hotelId,
        overall: null,
        status: "unrated",
        badge: { emoji: "✨", label: "New on StayBid", color: "#C9A66B" },
        rank: { rank: null, total: 0, percentile: null },
        checkpoints: [],
        totals: { bookings: 0, stayFeedback: 0, complaints: 0 },
        computedAt: new Date().toISOString(),
        error: e?.message || "scorecard failed",
      },
      { status: 200 },
    );
  }
}
