// v127.1 — Stay-feedback lifecycle cron.
//
// Runs 3 sweeps on every invocation:
//
//   SWEEP 1 — Auto-default-positive
//     Find bids past their feedback deadline (checkOut + 48h) that have
//     no complaint row yet → create an auto-positive feedback complaint
//     + queue a customer notification.
//
//   SWEEP 2 — Verification-video purge
//     Find auto-filled OR submitted feedback rows where the hotel's
//     verification video hasn't been cleaned yet → purge from Storage +
//     vp_videos. The smiley initials in complaints.feedback stay.
//
//   SWEEP 3 — Resolved-complaint evidence purge
//     Find complaints with status='resolved'/'rejected' that still carry
//     evidence-video URLs → purge those files immediately. Per user spec:
//     no extra grace — moment a complaint is resolved, video deletes.
//
//   SWEEP 4 — Resolution-deadline escalation
//     Find complaints with evidence video whose resolutionDeadlineAt has
//     passed and are still 'open' → flip to 'escalated'. Admin must touch
//     them; the evidence video stays for the escalation review.
//
// Auth: same pattern as /api/cron/expire-holds (?token=... OR Bearer
// cron-secret OR x-admin-token).
//
// Run hourly on cron-job.org (~3-8s typical runtime). Idempotent — each
// sweep's WHERE clause excludes rows already handled.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { purgeVerificationVideos, purgeEvidenceVideos } from "@/lib/verify/cleanup";

const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

// 12 hours after checkOut → feedback deadline. Adjust via env var.
const FEEDBACK_WINDOW_HOURS = Number(process.env.SB_FEEDBACK_WINDOW_HOURS || 12);
// 48 hours → resolution deadline for complaints carrying evidence video.
const RESOLUTION_WINDOW_HOURS = Number(process.env.SB_RESOLUTION_WINDOW_HOURS || 48);

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

async function runLifecycle() {
  const now = new Date();
  const deadlineCutoff = new Date(now.getTime() - FEEDBACK_WINDOW_HOURS * 3600_000).toISOString();
  const stats = {
    autoFilled: 0,
    verificationVideosPurged: 0,
    evidenceVideosPurged: 0,
    escalated: 0,
    storageObjectsDeleted: 0,
    errors: [] as string[],
  };

  // ───────────────────────────────────────────────────────────
  // SWEEP 1 — Auto-default-positive feedback
  // ───────────────────────────────────────────────────────────
  // Find ACCEPTED bids whose checkOut date is older than the deadline cutoff.
  // checkOut lives on bid_requests (joined via requestId on bids), so we fetch
  // bid_requests then map. Limit 200 per run so a backlog clears gracefully.
  try {
    const reqsRes = await fetch(
      `${SB_URL}/rest/v1/bid_requests?checkOut=lt.${encodeURIComponent(deadlineCutoff.slice(0, 10))}&select=id,checkOut&limit=500`,
      { headers: SB_H, cache: "no-store" },
    );
    const pastReqs: any[] = reqsRes.ok ? await reqsRes.json().catch(() => []) : [];
    if (pastReqs.length) {
      const reqIds = pastReqs.map((r) => r.id);
      // ACCEPTED bids tied to these past requests
      const bidsRes = await fetch(
        `${SB_URL}/rest/v1/bids?requestId=in.(${reqIds.map(encodeURIComponent).join(",")})&status=eq.ACCEPTED&select=id,customerId,hotelId,requestId&limit=500`,
        { headers: SB_H, cache: "no-store" },
      );
      const bids: any[] = bidsRes.ok ? await bidsRes.json().catch(() => []) : [];
      if (bids.length) {
        // Skip bids that already have a stay_feedback complaint row.
        const bidIds = bids.map((b) => b.id);
        const existingRes = await fetch(
          `${SB_URL}/rest/v1/complaints?bidId=in.(${bidIds.map(encodeURIComponent).join(",")})&feedbackType=eq.stay_feedback&select=bidId`,
          { headers: SB_H, cache: "no-store" },
        );
        const existing: any[] = existingRes.ok ? await existingRes.json().catch(() => []) : [];
        const taken = new Set(existing.map((c) => c.bidId).filter(Boolean));
        const todo = bids.filter((b) => !taken.has(b.id));

        // Also look up the vp_request per bid so we can clean up the hotel
        // verification video right after creating the auto-positive row.
        const bookingIds = todo.map((b) => b.id);
        const vpReqsRes = bookingIds.length
          ? await fetch(
              `${SB_URL}/rest/v1/vp_requests?booking_id=in.(${bookingIds.map(encodeURIComponent).join(",")})&select=id,booking_id`,
              { headers: SB_H, cache: "no-store" },
            )
          : null;
        const vpReqs: any[] = vpReqsRes && vpReqsRes.ok ? await vpReqsRes.json().catch(() => []) : [];
        const vpReqByBooking: Record<string, string> = {};
        for (const v of vpReqs) if (!vpReqByBooking[v.booking_id]) vpReqByBooking[v.booking_id] = v.id;

        for (const b of todo) {
          const verifReqId = vpReqByBooking[b.id] || null;
          // Auto-positive feedback row.
          const row = {
            customerId: b.customerId,
            hotelId: b.hotelId,
            bidId: b.id,
            type: "stay_feedback",
            feedbackType: "stay_feedback",
            priority: "low",
            status: "open",
            subject: null,
            description: "Auto-marked positive — customer did not submit feedback within the 12-hour window.",
            feedback: {
              roomMatch:    "positive",
              staff:        "positive",
              hygiene:      "positive",
              food:         "positive",
              staffResponse:"positive",
              submittedAt:  new Date().toISOString(),
              autoFilled:   true,
            },
            feedbackAutoFilled: true,
            verificationRequestId: verifReqId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          const ins = await fetch(`${SB_URL}/rest/v1/complaints?select=id`, {
            method: "POST",
            headers: { ...SB_H, "Content-Type": "application/json", Prefer: "return=representation" },
            body: JSON.stringify(row),
          });
          if (ins.ok) {
            stats.autoFilled++;
            // Queue customer notification + purge the hotel verification video.
            await fetch(`${SB_URL}/rest/v1/notification_queue`, {
              method: "POST",
              headers: { ...SB_H, "Content-Type": "application/json" },
              body: JSON.stringify({
                kind: "feedback_auto_positive",
                target: b.customerId,
                priority: "low",
                status: "pending",
                payload: {
                  bidId: b.id,
                  hotelId: b.hotelId,
                  message: "We marked your recent stay as positive since you didn't submit feedback within the 12-hour window. If anything was wrong, you can still raise a complaint anytime.",
                },
              }),
            }).catch(() => {});
            if (verifReqId) {
              try {
                const purged = await purgeVerificationVideos(verifReqId);
                stats.verificationVideosPurged++;
                stats.storageObjectsDeleted += purged.storageDeleted;
              } catch (e: any) { stats.errors.push(`purgeVerif:${verifReqId}:${e?.message || e}`); }
            }
          }
        }
      }
    }
  } catch (e: any) {
    stats.errors.push(`sweep1:${e?.message || e}`);
  }

  // ───────────────────────────────────────────────────────────
  // SWEEP 2 — Purge verification videos for SUBMITTED feedback
  // ───────────────────────────────────────────────────────────
  // Customer DID submit feedback (auto-fill OR manual) but the hotel
  // verification video for that booking is still on disk. Per user spec
  // it should be gone the moment feedback lands — but we run this as a
  // catch-up sweep in case the original submit handler couldn't reach
  // Storage at submit time.
  try {
    const rowsRes = await fetch(
      `${SB_URL}/rest/v1/complaints?feedbackType=eq.stay_feedback&videoCleanedAt=is.null&verificationRequestId=not.is.null&select=id,verificationRequestId&limit=100`,
      { headers: SB_H, cache: "no-store" },
    );
    const rows: any[] = rowsRes.ok ? await rowsRes.json().catch(() => []) : [];
    for (const r of rows) {
      try {
        const purged = await purgeVerificationVideos(r.verificationRequestId);
        stats.storageObjectsDeleted += purged.storageDeleted;
        await fetch(`${SB_URL}/rest/v1/complaints?id=eq.${encodeURIComponent(r.id)}`, {
          method: "PATCH",
          headers: { ...SB_H, "Content-Type": "application/json" },
          body: JSON.stringify({ videoCleanedAt: new Date().toISOString() }),
        });
      } catch (e: any) {
        stats.errors.push(`sweep2:${r.id}:${e?.message || e}`);
      }
    }
  } catch (e: any) {
    stats.errors.push(`sweep2-list:${e?.message || e}`);
  }

  // ───────────────────────────────────────────────────────────
  // SWEEP 3 — Purge evidence videos on resolved complaints
  // ───────────────────────────────────────────────────────────
  try {
    const rowsRes = await fetch(
      `${SB_URL}/rest/v1/complaints?feedbackType=eq.stay_feedback&status=in.(resolved,rejected)&videoCleanedAt=is.null&select=id,feedback,evidenceVideoId&limit=100`,
      { headers: SB_H, cache: "no-store" },
    );
    const rows: any[] = rowsRes.ok ? await rowsRes.json().catch(() => []) : [];
    for (const r of rows) {
      const hasEvidence = (Array.isArray(r.feedback?.evidenceVideoUrls) && r.feedback.evidenceVideoUrls.length > 0) || !!r.evidenceVideoId;
      if (!hasEvidence) {
        // Nothing to purge but still mark cleaned to skip on next run.
        await fetch(`${SB_URL}/rest/v1/complaints?id=eq.${encodeURIComponent(r.id)}`, {
          method: "PATCH", headers: { ...SB_H, "Content-Type": "application/json" },
          body: JSON.stringify({ videoCleanedAt: new Date().toISOString() }),
        });
        continue;
      }
      try {
        const purged = await purgeEvidenceVideos({ id: r.id, feedback: r.feedback, evidenceVideoId: r.evidenceVideoId });
        stats.evidenceVideosPurged++;
        stats.storageObjectsDeleted += purged.storageDeleted;
      } catch (e: any) {
        stats.errors.push(`sweep3:${r.id}:${e?.message || e}`);
      }
    }
  } catch (e: any) {
    stats.errors.push(`sweep3-list:${e?.message || e}`);
  }

  // ───────────────────────────────────────────────────────────
  // SWEEP 4 — Escalate stale open complaints with evidence video
  // ───────────────────────────────────────────────────────────
  try {
    const escalateBefore = new Date(now.getTime() - RESOLUTION_WINDOW_HOURS * 3600_000).toISOString();
    const rowsRes = await fetch(
      `${SB_URL}/rest/v1/complaints?feedbackType=eq.stay_feedback&status=eq.open&evidenceVideoId=not.is.null&createdAt=lt.${encodeURIComponent(escalateBefore)}&select=id&limit=100`,
      { headers: SB_H, cache: "no-store" },
    );
    const rows: any[] = rowsRes.ok ? await rowsRes.json().catch(() => []) : [];
    for (const r of rows) {
      const upd = await fetch(`${SB_URL}/rest/v1/complaints?id=eq.${encodeURIComponent(r.id)}`, {
        method: "PATCH",
        headers: { ...SB_H, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "escalated", updatedAt: new Date().toISOString() }),
      });
      if (upd.ok) {
        stats.escalated++;
        // Tap admin via notification_queue
        fetch(`${SB_URL}/rest/v1/notification_queue`, {
          method: "POST",
          headers: { ...SB_H, "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "complaint_escalated",
            target: "admin",
            priority: "high",
            status: "pending",
            payload: { complaintId: r.id, reason: `Unresolved past ${RESOLUTION_WINDOW_HOURS}-hour deadline` },
          }),
        }).catch(() => {});
      }
    }
  } catch (e: any) {
    stats.errors.push(`sweep4:${e?.message || e}`);
  }

  return stats;
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }

async function handle(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const stats = await runLifecycle();
  return NextResponse.json({ ok: true, ms: Date.now() - started, ...stats });
}
