// v128 — Admin/cron bulk recompute of hotel scorecards.
//
// POST /api/admin/hotel-scores/recompute        → recompute ALL hotels
// POST /api/admin/hotel-scores/recompute?hotelId=X → recompute single
// POST /api/admin/hotel-scores/recompute?city=Y  → recompute city
//
// Auth: x-admin-token (adm_*) OR Bearer cron-secret OR ?token=CRON_TOKEN.
// Same pattern as /api/cron/feedback-lifecycle.
//
// Runs sequentially per hotel to keep memory flat. After computing each
// scorecard, rewrites the rank for every hotel in that city in one pass
// (sorted by overall score DESC) so ranks stay consistent across the
// whole city snapshot.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H } from "@/lib/sb";
import { computeHotelScore } from "@/lib/hotel-score";
import { loadHotelScoreInputs } from "@/lib/hotel-score-data";
import { logAdminAction, adminFromReq } from "@/lib/admin/audit";

async function authorized(req: NextRequest): Promise<boolean> {
  const { searchParams } = new URL(req.url);
  const qToken = searchParams.get("token");
  const expectedToken = process.env.CRON_TOKEN || "staybid-cron-dev";
  if (qToken && qToken === expectedToken) return true;
  const cronAuth = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && cronAuth === `Bearer ${cronSecret}`) return true;
  const adminTok = req.headers.get("x-admin-token");
  if (adminTok && adminTok.startsWith("adm_")) return true;
  return false;
}

async function sb(path: string): Promise<any[]> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: SB_H,
    cache: "no-store",
  });
  return r.ok ? r.json().catch(() => []) : [];
}

async function listHotels(filter: { hotelId?: string; city?: string }): Promise<any[]> {
  if (filter.hotelId) {
    return sb(
      `hotels?id=eq.${encodeURIComponent(filter.hotelId)}&select=id,name,city,state&limit=1`,
    );
  }
  if (filter.city) {
    return sb(
      `hotels?city=eq.${encodeURIComponent(filter.city)}&select=id,name,city,state&limit=500`,
    );
  }
  return sb(`hotels?select=id,name,city,state&limit=1000`);
}

async function upsertScore(card: any, hotelMeta: any) {
  const body = {
    hotel_id: card.hotelId,
    city: hotelMeta?.city || null,
    state: hotelMeta?.state || null,
    overall: card.overall,
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
  await fetch(`${SB_URL}/rest/v1/hotel_scores?on_conflict=hotel_id`, {
    method: "POST",
    headers: { ...SB_H, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(body),
  }).catch(() => {});
}

async function snapshotHistory(card: any, rank: number | null, total: number) {
  await fetch(`${SB_URL}/rest/v1/hotel_score_history`, {
    method: "POST",
    headers: { ...SB_H, "Content-Type": "application/json" },
    body: JSON.stringify({
      hotel_id: card.hotelId,
      overall: card.overall,
      rank_in_city: rank,
      total_in_city: total,
      checkpoints: card.checkpoints,
      snapshot_at: new Date().toISOString(),
    }),
  }).catch(() => {});
}

async function rerankCity(city: string) {
  if (!city) return;
  const rows = await sb(
    `hotel_scores?city=eq.${encodeURIComponent(city)}` +
      `&select=hotel_id,overall&order=overall.desc.nullslast`,
  );
  const rated = (rows as any[]).filter((r) => r.overall !== null);
  const total = rated.length;
  for (let i = 0; i < rated.length; i++) {
    const rank = i + 1;
    const overall = Number(rated[i].overall);
    const percentile =
      total > 1 ? +(((total - rank) / (total - 1)) * 100).toFixed(1) : 100;
    await fetch(
      `${SB_URL}/rest/v1/hotel_scores?hotel_id=eq.${encodeURIComponent(
        rated[i].hotel_id,
      )}`,
      {
        method: "PATCH",
        headers: { ...SB_H, Prefer: "return=minimal" },
        body: JSON.stringify({
          rank_in_city: rank,
          total_in_city: total,
          percentile_city: percentile,
          updated_at: new Date().toISOString(),
        }),
      },
    ).catch(() => {});
    void overall; // unused but explicit
  }
}

async function run(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const hotelId = searchParams.get("hotelId") || undefined;
  const city = searchParams.get("city") || undefined;
  const snapshot = searchParams.get("snapshot") === "1";

  const started = Date.now();
  const hotels = await listHotels({ hotelId, city });
  const stats = {
    hotelsProcessed: 0,
    citiesReranked: 0,
    historyRowsWritten: 0,
    errors: [] as string[],
  };

  const touchedCities = new Set<string>();
  for (const h of hotels) {
    try {
      const inputs = await loadHotelScoreInputs(h.id);
      const card = computeHotelScore(inputs);
      await upsertScore(card, h);
      stats.hotelsProcessed++;
      if (h.city) touchedCities.add(h.city);
      if (snapshot) {
        await snapshotHistory(card, null, 0); // ranks fill in after rerank
        stats.historyRowsWritten++;
      }
    } catch (e: any) {
      stats.errors.push(`${h.id}:${e?.message || e}`);
    }
  }

  // Rerank every touched city in a second pass.
  // Array.from() to avoid `for..of MapIterator` tsconfig downlevelIteration error.
  const cityList = Array.from(touchedCities);
  for (let i = 0; i < cityList.length; i++) {
    const c = cityList[i];
    try {
      await rerankCity(c);
      stats.citiesReranked++;
    } catch (e: any) {
      stats.errors.push(`rerank:${c}:${e?.message || e}`);
    }
  }

  // Cap history table at 90 days to keep the trend sparkline lean.
  if (snapshot) {
    const cutoff = new Date(Date.now() - 90 * 86400_000).toISOString();
    await fetch(
      `${SB_URL}/rest/v1/hotel_score_history?snapshot_at=lt.${encodeURIComponent(
        cutoff,
      )}`,
      {
        method: "DELETE",
        headers: { ...SB_H, Prefer: "return=minimal" },
      },
    ).catch(() => {});
  }

  return { ok: true, ms: Date.now() - started, ...stats };
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await run(req);

  // Best-effort audit log (only when triggered by a human admin token).
  try {
    const admin = adminFromReq(req as any);
    if (admin) {
      const { searchParams } = new URL(req.url);
      logAdminAction({
        admin,
        action: "hotel_scores.recompute",
        targetType: "hotel_scores",
        targetId: searchParams.get("hotelId") || searchParams.get("city") || "all",
        details: result,
      });
    }
  } catch {}

  return NextResponse.json(result);
}
