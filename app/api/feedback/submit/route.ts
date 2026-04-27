import { NextResponse } from "next/server";
import { sbInsert, sbSelect, sbUpdate, SB } from "@/lib/onboard/supabase-admin";

const STAYPOINTS_PER_FEEDBACK = 100;

function decodeJwt(t: string): any {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"), "base64").toString()); }
  catch { return null; }
}

// POST /api/feedback/submit
//   { bookingId, rating?, comments? }
// Customer submits feedback. Side-effects:
//   1. feedback_tracking.submitted = true + timestamp + rating + comments
//   2. video_lifecycle.status → 'deleted_after_feedback' (videos pruned by cron)
//   3. StayPoints credited (legacy notifications row + log)
//   4. lock further complaint via vp_complaints? (handled by reading lifecycle status)
export async function POST(req: Request) {
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const payload = decodeJwt(token);
    if (!payload?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { bookingId, rating, comments } = await req.json();
    if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });

    const lifecycle = (await sbSelect<any>("video_lifecycle", `booking_id=eq.${bookingId}&limit=1`))[0];
    if (lifecycle && lifecycle.status !== "active") {
      return NextResponse.json({ error: "Feedback window has closed" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const fb = (await sbSelect<any>("feedback_tracking", `booking_id=eq.${bookingId}&limit=1`))[0];
    if (fb) {
      await sbUpdate("feedback_tracking", `booking_id=eq.${bookingId}`, {
        submitted: true, timestamp: now,
        rating: rating ?? null, comments: comments ?? null,
        staypoints_credited: STAYPOINTS_PER_FEEDBACK,
      });
    } else {
      await sbInsert("feedback_tracking", {
        booking_id: bookingId, customer_id: payload.id,
        submitted: true, timestamp: now,
        rating: rating ?? null, comments: comments ?? null,
        staypoints_credited: STAYPOINTS_PER_FEEDBACK,
      });
    }

    if (lifecycle) {
      await sbUpdate("video_lifecycle", `booking_id=eq.${bookingId}`, {
        status: "deleted_after_feedback", updated_at: now,
      });
    }

    // Confirmation notification + StayPoints credit (best-effort)
    try {
      await sbInsert("notifications", {
        userId: payload.id, type: "feedback_thanks",
        title: "Thanks for your feedback! 🎉",
        body: `${STAYPOINTS_PER_FEEDBACK} StayPoints credited.`,
      });
    } catch {}

    return NextResponse.json({ ok: true, staypoints: STAYPOINTS_PER_FEEDBACK });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "submit failed" }, { status: 500 });
  }
}

// GET /api/feedback/submit?bookingId=...   — current state for the customer page
export async function GET(req: Request) {
  try {
    const bookingId = new URL(req.url).searchParams.get("bookingId");
    if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });
    const [fb, lc] = await Promise.all([
      sbSelect<any>("feedback_tracking", `booking_id=eq.${bookingId}&limit=1`),
      sbSelect<any>("video_lifecycle",   `booking_id=eq.${bookingId}&limit=1`),
    ]);
    return NextResponse.json({ feedback: fb[0] || null, lifecycle: lc[0] || null });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "fetch failed" }, { status: 500 });
  }
}
