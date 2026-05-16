// POST /api/complaints/submit
//   Customer-side complaint creation. Writes to the `complaints` table
//   that /admin/complaints has been reading since Session 1 of the
//   admin-panel build. Until v98, that admin page was always empty —
//   only `vp_complaints` (video evidence) had a customer surface.
//
// Body: { type, subject, description, priority?, bookingId?, hotelId?,
//         bidId?, paymentId? }
// Auth: Bearer sb_token (customer JWT)
import { NextResponse } from "next/server";
import { SB_URL, SB_H, userFromReq } from "@/lib/sb";
import { ensureUser } from "@/lib/sb-server";
import { purgeVerificationVideos } from "@/lib/verify/cleanup";

// v127.1 — 14-day resolution window for stay-feedback complaints carrying
// evidence video. Cron escalates rows past this deadline that are still
// status='open'.
const RESOLUTION_WINDOW_DAYS = Number(process.env.SB_RESOLUTION_WINDOW_DAYS || 14);

const VALID_TYPES = new Set(["bid", "booking", "payment", "service", "refund", "video", "general", "other", "stay_feedback"]);
const VALID_PRIORITY = new Set(["low", "medium", "high"]);
const VALID_SMILEY = new Set(["positive", "neutral", "negative"]);
const FEEDBACK_KEYS = ["roomMatch", "staff", "hygiene", "food", "staffResponse"] as const;

// v127 — Normalise the smiley payload coming from /verification's
// "Rate your stay" composer. Returns a sanitised object or null if the
// payload is missing / malformed. Refusing the row entirely on bad shape
// would be hostile — admins prefer "complaint with partial feedback" over
// "no complaint at all because one key was misspelled".
function normaliseFeedback(raw: any): Record<string, any> | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, any> = {};
  let hasAny = false;
  for (const k of FEEDBACK_KEYS) {
    const v = raw[k];
    if (typeof v === "string" && VALID_SMILEY.has(v)) {
      out[k] = v;
      hasAny = true;
    }
  }
  if (!hasAny) return null;
  // Optional metadata the composer can pass through
  if (typeof raw.note === "string") out.note = raw.note.trim().slice(0, 1000);
  if (Array.isArray(raw.evidenceVideoUrls)) {
    out.evidenceVideoUrls = raw.evidenceVideoUrls
      .filter((s: any) => typeof s === "string")
      .slice(0, 8);
  }
  out.submittedAt = new Date().toISOString();
  return out;
}

export async function POST(req: Request) {
  try {
    const u = userFromReq(req);
    if (!u?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const type = VALID_TYPES.has(body.type) ? body.type : "general";
    const priority = VALID_PRIORITY.has(body.priority) ? body.priority : "low";

    // v127 — Stay-feedback submissions don't carry a free-text description
    // (the composer is smiley-only). Allow an empty description on that
    // type and synthesise a human-readable one from the smiley payload so
    // /admin/complaints' existing description column stays populated.
    const feedback = normaliseFeedback(body.feedback);
    const feedbackType = type === "stay_feedback" ? "stay_feedback" : null;

    const subject = typeof body.subject === "string" ? body.subject.trim().slice(0, 180) : "";
    let description = typeof body.description === "string" ? body.description.trim().slice(0, 4000) : "";

    if (!description && type === "stay_feedback" && feedback) {
      const negCount = FEEDBACK_KEYS.filter((k) => feedback[k] === "negative").length;
      const neutralCount = FEEDBACK_KEYS.filter((k) => feedback[k] === "neutral").length;
      description = negCount > 0
        ? `Stay feedback: ${negCount} negative checkpoint${negCount > 1 ? "s" : ""}${neutralCount ? `, ${neutralCount} neutral` : ""}.`
        : `Stay feedback: all checkpoints positive${neutralCount ? ` (${neutralCount} neutral)` : ""}.`;
    }
    if (!description) {
      return NextResponse.json({ error: "Description required" }, { status: 400 });
    }

    const row: Record<string, any> = {
      customerId: u.id,
      customerPhone: u.phone || null,
      type,
      priority,
      subject: subject || null,
      description,
      status: "open",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    // v106.1 — defensive id routing. The customer-side composer collapses
    // bookings + accepted bids into one dropdown (because /api/bookings/my
    // returns bids-as-bookings in this codebase — public.bookings has 0
    // rows in prod, every "booking" the customer sees is actually a row
    // from public.bids). So `body.bookingId` may actually be a bid id
    // (prefix "bid_"). complaints.bookingId has a strict FK to
    // public.bookings(id) — inserting "bid_xxx" there returns 23503 and
    // produces the visible "Failed to save complaint" error.
    //
    // Fix: classify by id prefix server-side AND verify presence in the
    // bookings table before keeping it as bookingId. Mis-routed ids fall
    // back to bidId which has no FK in this schema (soft reference only).
    const rawBookingId = body.bookingId ? String(body.bookingId).trim() : "";
    const rawBidId     = body.bidId     ? String(body.bidId).trim()     : "";

    if (rawBookingId) {
      const looksLikeBid = /^bid[_-]/i.test(rawBookingId);
      if (looksLikeBid) {
        // Route to bidId, skip bookings FK entirely.
        if (!rawBidId) row.bidId = rawBookingId;
      } else {
        // Validate against bookings table before trusting the FK.
        try {
          const check = await fetch(
            `${SB_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(rawBookingId)}&select=id&limit=1`,
            { headers: SB_H },
          );
          const found = await check.json().catch(() => []);
          if (Array.isArray(found) && found.length > 0) {
            row.bookingId = rawBookingId;
          } else {
            // Booking id doesn't exist in bookings table — store as bid
            // reference (most likely scenario in this codebase) so the
            // complaint isn't lost just because the FK target was wrong.
            if (!rawBidId) row.bidId = rawBookingId;
          }
        } catch {
          if (!rawBidId) row.bidId = rawBookingId;
        }
      }
    }
    if (rawBidId) row.bidId = rawBidId;
    if (body.hotelId)   row.hotelId   = String(body.hotelId);
    if (body.paymentId) row.paymentId = String(body.paymentId);

    // v127 — Stay-feedback payload.
    if (feedback) row.feedback = feedback;
    if (feedbackType) row.feedbackType = feedbackType;
    if (body.verificationRequestId) row.verificationRequestId = String(body.verificationRequestId);
    if (body.evidenceVideoId)       row.evidenceVideoId       = String(body.evidenceVideoId);

    // Auto-bump priority to "high" when 2+ checkpoints are negative so
    // admin sees these surface above generic complaints in the queue.
    if (feedback && priority === "low") {
      const negCount = FEEDBACK_KEYS.filter((k) => feedback[k] === "negative").length;
      if (negCount >= 2) row.priority = "high";
      else if (negCount === 1) row.priority = "medium";
    }

    // v127.1 — If this stay_feedback row carries evidence video, stamp a
    // resolution deadline so the lifecycle cron can auto-escalate stale
    // open complaints. Hard-no-video positive feedback gets no deadline.
    const hasEvidence = !!(
      (feedback && Array.isArray(feedback.evidenceVideoUrls) && feedback.evidenceVideoUrls.length > 0) ||
      body.evidenceVideoId
    );
    if (type === "stay_feedback" && hasEvidence) {
      row.resolutionDeadlineAt = new Date(Date.now() + RESOLUTION_WINDOW_DAYS * 86400_000).toISOString();
    }

    // v105.1 — complaints.customerId has a FK constraint pointing at
    // public.users.id. Firebase Google-sign-in customers may not have a
    // mirrored users row (the /api/auth/social-login backend route was
    // never deployed — see CLAUDE.md), so the FK fails for them and the
    // insert errors out with code 23503 "Key is not present in table users".
    // ensureUser() upserts the users row first (resolution=merge-duplicates),
    // so subsequent customers get a placeholder row + the complaint
    // submission succeeds. Idempotent — safe to call every time.
    await ensureUser(u.id, u.phone, (u as any).name);

    const res = await fetch(`${SB_URL}/rest/v1/complaints?select=*`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json({ error: "Failed to save complaint", detail }, { status: 500 });
    }
    const created = (await res.json().catch(() => []))[0];

    // Best-effort queue an admin notification (notification_queue is read
    // by the existing notification worker; failure is non-fatal).
    fetch(`${SB_URL}/rest/v1/notification_queue`, {
      method: "POST",
      headers: SB_H,
      body: JSON.stringify({
        kind: "complaint_new",
        target: "admin",
        priority: priority === "high" ? "high" : "normal",
        payload: { complaintId: created?.id, type, subject, fromUserId: u.id },
        status: "pending",
      }),
    }).catch(() => {});

    // v127.1 — The moment the customer submits stay feedback, purge the
    // hotel's verification video for that booking. Per user spec only the
    // smiley initials persist; the video has served its purpose.
    // Fire-and-forget — Storage failures don't roll back the complaint.
    if (type === "stay_feedback" && created?.verificationRequestId) {
      const reqId = created.verificationRequestId;
      const complaintId = created.id;
      (async () => {
        try {
          await purgeVerificationVideos(reqId);
          await fetch(`${SB_URL}/rest/v1/complaints?id=eq.${encodeURIComponent(complaintId)}`, {
            method: "PATCH",
            headers: { ...SB_H, "Content-Type": "application/json" },
            body: JSON.stringify({ videoCleanedAt: new Date().toISOString() }),
          });
        } catch {}
      })();
    }

    return NextResponse.json({ ok: true, complaint: created });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "submit failed" }, { status: 500 });
  }
}
