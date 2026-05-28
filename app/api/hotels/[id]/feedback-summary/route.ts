// v127.1 — Public aggregated stay-feedback summary per hotel.
//
// GET /api/hotels/:id/feedback-summary
//
// Returns smiley distribution across all stay_feedback complaints for
// this hotel. ONLY the smiley initials are read — evidence-video URLs
// + customer notes are stripped from the response per user spec:
// "bas reh jayege feedback inetials jo ki smiley ke rup main diye gye
// hai jo dushre sabhi customers ko show hongey".
//
// Shape:
//   {
//     hotelId, totalReviews,
//     score:      0..100  // weighted overall score (positive=100, neutral=50, negative=0)
//     percentPositive,    // 0..100
//     checkpoints: {
//       roomMatch: { positive, neutral, negative, total, percentPositive },
//       staff: ..., hygiene: ..., food: ..., staffResponse: ...
//     },
//     recent: [{ submittedAt, autoFilled, snapshot: {roomMatch:'positive',...} }]
//     // recent.snapshot carries ONLY smiley keys — no note, no urls.
//   }
//
// Cached on the server side via sb-cache 60s — same TTL pattern as the
// rest of the v93 cache lane.

import { NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";
import { sbCached } from "@/lib/sb-cache";

const FEEDBACK_KEYS = ["roomMatch", "staff", "hygiene", "food", "staffResponse"] as const;
type Sentiment = "positive" | "neutral" | "negative";

function isSentiment(v: any): v is Sentiment {
  return v === "positive" || v === "neutral" || v === "negative";
}

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const hotelId = params.id;
  if (!hotelId) return NextResponse.json({ error: "hotelId required" }, { status: 400 });

  try {
    const rows: any[] = await sbCached(`hotel-feedback:${hotelId}`, async () => {
      // Pull stay_feedback complaints for this hotel. Only the columns
      // we actually expose publicly — never the raw description, note,
      // or admin-only fields.
      const r = await fetch(
        `${SB_URL}/rest/v1/complaints?hotelId=eq.${encodeURIComponent(hotelId)}&feedbackType=eq.stay_feedback&select=feedback,feedbackAutoFilled,createdAt&order=createdAt.desc&limit=500`,
        { headers: SB_READ, cache: "no-store" },
      );
      return r.ok ? await r.json().catch(() => []) : [];
    }, 60_000);

    const buckets: Record<string, { positive: number; neutral: number; negative: number }> = {};
    for (const k of FEEDBACK_KEYS) buckets[k] = { positive: 0, neutral: 0, negative: 0 };

    let weighted = 0;
    let weightedDenom = 0;
    let totalPositiveAcrossAll = 0;
    let totalScoredAcrossAll = 0;

    const recent: any[] = [];
    for (const row of rows) {
      const f = row?.feedback;
      if (!f || typeof f !== "object") continue;
      const snapshot: Record<string, Sentiment> = {};
      for (const k of FEEDBACK_KEYS) {
        const v = f[k];
        if (!isSentiment(v)) continue;
        buckets[k][v]++;
        snapshot[k] = v;
        totalScoredAcrossAll++;
        if (v === "positive") {
          weighted += 100; totalPositiveAcrossAll++;
        } else if (v === "neutral") {
          weighted += 50;
        } // negative contributes 0
        weightedDenom += 100;
      }
      if (recent.length < 12 && Object.keys(snapshot).length === FEEDBACK_KEYS.length) {
        recent.push({
          submittedAt: row.createdAt,
          autoFilled: !!row.feedbackAutoFilled,
          snapshot,
        });
      }
    }

    const score = weightedDenom > 0 ? Math.round((weighted / weightedDenom) * 100) : null;
    const percentPositive = totalScoredAcrossAll > 0
      ? Math.round((totalPositiveAcrossAll / totalScoredAcrossAll) * 100)
      : null;

    const checkpoints: Record<string, any> = {};
    for (const k of FEEDBACK_KEYS) {
      const b = buckets[k];
      const total = b.positive + b.neutral + b.negative;
      checkpoints[k] = {
        ...b,
        total,
        percentPositive: total > 0 ? Math.round((b.positive / total) * 100) : null,
      };
    }

    return NextResponse.json({
      hotelId,
      totalReviews: rows.length,
      score,
      percentPositive,
      checkpoints,
      recent,
    }, {
      headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" },
    });
  } catch (e: any) {
    return NextResponse.json({
      hotelId,
      totalReviews: 0,
      score: null,
      percentPositive: null,
      checkpoints: {},
      recent: [],
      error: e?.message || "summary failed",
    }, { status: 200 });
  }
}
