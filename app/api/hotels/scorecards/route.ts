// Batch scorecard read — GET /api/hotels/scorecards?ids=id1,id2,…
//
// Returns cached scorecards for many hotels in ONE Supabase query, keyed by
// hotelId, in the same shape the single-hotel route + <HotelScoreBadge> use.
// List surfaces (/trust, /hotels) fetch this once and pass each card to the
// badge as `initial`, so a 30-hotel page makes 1 request instead of 30.
//
// Read-only by design: NO per-hotel recompute here (that's the expensive part).
// Freshness is the cron's job + the single-hotel route's lazy recompute when a
// detail page is opened. A hotel with no cached row yet comes back as a clean
// "new/unrated" placeholder (the badge renders its NEW medal); the next cron
// sweep populates it.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H } from "@/lib/sb";

const MAX_IDS = 80;

function unrated(hotelId: string) {
  return {
    hotelId,
    city: null,
    overall: null,
    status: "unrated",
    badge: { emoji: "✨", label: "New on StayBid", color: "#C9A66B" },
    rank: { rank: null, total: 0, percentile: null },
    checkpoints: [],
    totals: { bookings: 0, stayFeedback: 0, complaints: 0 },
    computedAt: null,
  };
}

function shape(row: any) {
  return {
    hotelId: row.hotel_id,
    city: row.city ?? null,
    overall: row.overall === null ? null : Number(row.overall),
    status: row.status,
    badge: { emoji: row.badge_emoji, label: row.badge_label, color: row.badge_color },
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
  };
}

export async function GET(req: NextRequest) {
  const idsParam = req.nextUrl.searchParams.get("ids") || "";
  const ids = Array.from(
    new Set(idsParam.split(",").map((s) => s.trim()).filter(Boolean)),
  ).slice(0, MAX_IDS);

  if (ids.length === 0) {
    return NextResponse.json({ scorecards: {} });
  }

  let rows: any[] = [];
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/hotel_scores?hotel_id=in.(${ids
        .map((id) => encodeURIComponent(id))
        .join(",")})&select=*`,
      { headers: SB_H, cache: "no-store" },
    );
    rows = r.ok ? await r.json().catch(() => []) : [];
  } catch {
    rows = [];
  }

  const byId: Record<string, any> = {};
  for (const row of rows) byId[row.hotel_id] = shape(row);
  // Fill gaps with a clean placeholder so the caller always gets every id back.
  const scorecards: Record<string, any> = {};
  for (const id of ids) scorecards[id] = byId[id] || unrated(id);

  return NextResponse.json(
    { scorecards },
    {
      headers: {
        "Cache-Control": "public, max-age=120, stale-while-revalidate=600",
        // Vercel strips s-maxage from auto-dynamic routes; CDN-Cache-Control
        // is not stripped → repeat list loads serve from edge.
        "CDN-Cache-Control": "public, s-maxage=120, stale-while-revalidate=600",
        "Vercel-CDN-Cache-Control": "public, s-maxage=120, stale-while-revalidate=600",
      },
    },
  );
}
