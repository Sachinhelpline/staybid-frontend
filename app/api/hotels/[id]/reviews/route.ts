// v128.2 — Public reviews + stay-feedback drill-down for the scorecard modal.
//
// GET /api/hotels/:id/reviews
//
// Returns BOTH:
//   1. star_reviews[]      — feedback_tracking rows (1-5 star + comment)
//   2. stay_feedback[]     — complaints with feedbackType=stay_feedback
//                            (smiley grid + 5-checkpoint snapshot)
//
// Anonymisation contract (privacy):
//   - NO customer name, phone, email
//   - NO complaint description / personal note
//   - Comments DO surface (those ARE the public review text), but the
//     server still passes them through sanitizeText() to scrub
//     accidental contact-info leaks (phone/email/handle).
//   - Each row gets a stable but anonymous "guest tag" derived from the
//     customer id hash → e.g. "Guest #A4F" so the same person's two
//     reviews look like the same person, without revealing identity.
//
// Cached server-side via sb-cache (60s) since the rows update only when
// a customer submits new feedback.

import { NextResponse } from "next/server";
import { SB_URL, SB_H } from "@/lib/sb";
import { sbCached } from "@/lib/sb-cache";
import { sanitizeText } from "@/lib/sanitize-text";

const SMILEY_KEYS = ["roomMatch", "staff", "hygiene", "food", "staffResponse"] as const;

async function sb(path: string): Promise<any[]> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: SB_H,
    cache: "no-store",
  });
  return r.ok ? r.json().catch(() => []) : [];
}

/**
 * Stable hash → 3-char base36 tag. Same customerId always maps to same
 * tag, but a different customer can't be reverse-engineered from it.
 */
function guestTag(customerId: string | null | undefined): string {
  if (!customerId) return "GST";
  let h = 5381;
  for (let i = 0; i < customerId.length; i++) {
    h = ((h << 5) + h) + customerId.charCodeAt(i);
    h |= 0; // 32-bit
  }
  return "G" + Math.abs(h).toString(36).slice(0, 3).toUpperCase();
}

function safeComment(s: any): string | null {
  if (!s || typeof s !== "string") return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  // sanitizeText scrubs phone / email / URLs / WhatsApp / "DM me"
  return sanitizeText(trimmed).clean.slice(0, 1200);
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const hotelId = params.id;
  if (!hotelId) return NextResponse.json({ error: "hotelId required" }, { status: 400 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") || 50), 100);

  try {
    const payload = await sbCached(
      `hotel-reviews:${hotelId}:${limit}`,
      async () => {
        const [starRowsRaw, sfRowsRaw] = await Promise.all([
          sb(
            `feedback_tracking?hotel_id=eq.${encodeURIComponent(hotelId)}` +
              `&submitted=eq.true` +
              `&rating=not.is.null` +
              `&select=id,booking_id,customer_id,rating,comments,created_at,timestamp` +
              `&order=created_at.desc&limit=${limit}`,
          ),
          sb(
            `complaints?hotelId=eq.${encodeURIComponent(hotelId)}` +
              `&feedbackType=eq.stay_feedback` +
              `&select=id,customerId,feedback,feedbackAutoFilled,createdAt` +
              `&order=createdAt.desc&limit=${limit}`,
          ),
        ]);

        const starReviews = (starRowsRaw as any[]).map((r) => ({
          id: r.id,
          guestTag: guestTag(r.customer_id),
          rating: Math.max(1, Math.min(5, Number(r.rating) || 0)),
          comment: safeComment(r.comments),
          createdAt: r.created_at || r.timestamp,
        }));

        const stayFeedback = (sfRowsRaw as any[])
          .map((r) => {
            const f = r.feedback || {};
            const snapshot: Record<string, "positive" | "neutral" | "negative"> = {};
            for (const k of SMILEY_KEYS) {
              const v = f[k];
              if (v === "positive" || v === "neutral" || v === "negative") {
                snapshot[k] = v;
              }
            }
            const checkpoints = Object.keys(snapshot).length;
            if (checkpoints === 0) return null;
            return {
              id: r.id,
              guestTag: guestTag(r.customerId),
              autoFilled: !!r.feedbackAutoFilled,
              snapshot,
              createdAt: r.createdAt,
              // intentionally NO note, NO description, NO videos exposed
            };
          })
          .filter(Boolean);

        // Aggregate stats — useful for the drill-down header.
        const avgStars = starReviews.length
          ? +(starReviews.reduce((a: number, b: any) => a + b.rating, 0) /
              starReviews.length).toFixed(2)
          : null;
        const starHistogram = [0, 0, 0, 0, 0];
        starReviews.forEach((r: any) => {
          starHistogram[Math.min(4, Math.max(0, r.rating - 1))]++;
        });

        const sfPositive = stayFeedback.reduce((acc: number, r: any) => {
          const vals = Object.values(r.snapshot);
          return acc + vals.filter((v) => v === "positive").length;
        }, 0);
        const sfNegative = stayFeedback.reduce((acc: number, r: any) => {
          const vals = Object.values(r.snapshot);
          return acc + vals.filter((v) => v === "negative").length;
        }, 0);
        const sfTotal = stayFeedback.reduce((acc: number, r: any) => {
          return acc + Object.keys(r.snapshot).length;
        }, 0);
        const sfPctPositive = sfTotal > 0
          ? Math.round((sfPositive / sfTotal) * 100)
          : null;

        return {
          hotelId,
          starReviews,
          stayFeedback,
          stats: {
            starCount: starReviews.length,
            avgStars,
            starHistogram,
            stayFeedbackCount: stayFeedback.length,
            stayFeedbackPctPositive: sfPctPositive,
            stayFeedbackNegativeCount: sfNegative,
          },
        };
      },
      60_000,
    );

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=180",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        hotelId,
        starReviews: [],
        stayFeedback: [],
        stats: {
          starCount: 0,
          avgStars: null,
          starHistogram: [0, 0, 0, 0, 0],
          stayFeedbackCount: 0,
          stayFeedbackPctPositive: null,
          stayFeedbackNegativeCount: 0,
        },
        error: e?.message || "reviews load failed",
      },
      { status: 200 },
    );
  }
}
