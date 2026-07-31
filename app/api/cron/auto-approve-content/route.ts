// Cron endpoint — auto-approves content that the hotel partner hasn't
// acted on within 24h.
//
// Sweeps social_posts WHERE moderation_status='PENDING_HOTEL_APPROVAL'
//                       AND created_at < NOW() - INTERVAL '24 hours'
// Flips to moderation_status='AUTO_APPROVED', stamps auto_approved_at,
// queues an in-app notification to the author.
//
// Schedule (cron-job.org — Vercel cron 2-slot full):
//   GET https://staybids.in/api/cron/auto-approve-content?token=<CRON_SECRET>
//   Frequency: every 1 hour
//
// Auth — matches /api/cron/expire-holds pattern:
//   1) ?token=<CRON_TOKEN> query param
//   2) Authorization: Bearer <CRON_SECRET> (Vercel native)
import { NextRequest, NextResponse } from "next/server";
import { cronAuthGuard } from "@/lib/cron/auth";
import { SB_URL, SB_KEY } from "@/lib/sb";

const HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const READ_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };


// How old does a PENDING_HOTEL_APPROVAL post need to be before we
// auto-approve it? Configurable so we can tune from 24h → 48h later
// without a redeploy.
const AUTO_APPROVE_AFTER_MS =
  parseInt(process.env.AUTO_APPROVE_AFTER_HOURS || "24", 10) * 3_600_000;

// Hard cap so a stuck cron doesn't try to drain thousands at once.
const MAX_PER_RUN = 200;

async function sweep(): Promise<{
  scanned: number;
  approved: number;
  errors: string[];
}> {
  const cutoff = new Date(Date.now() - AUTO_APPROVE_AFTER_MS).toISOString();

  // Fetch pending posts older than cutoff
  const r = await fetch(
    `${SB_URL}/rest/v1/social_posts` +
      `?moderation_status=eq.PENDING_HOTEL_APPROVAL` +
      `&created_at=lt.${encodeURIComponent(cutoff)}` +
      `&select=id,author_id,hotel_id,created_at` +
      `&order=created_at.asc&limit=${MAX_PER_RUN}`,
    { headers: READ_HEADERS, cache: "no-store" }
  );
  if (!r.ok) {
    return {
      scanned: 0,
      approved: 0,
      errors: [`Lookup failed: ${r.status} ${await r.text()}`],
    };
  }
  const rows = (await r.json().catch(() => [])) as any[];
  if (!rows.length) return { scanned: 0, approved: 0, errors: [] };

  const now = new Date().toISOString();
  let approved = 0;
  const errors: string[] = [];

  // Bulk UPDATE per row — keep simple + auditable. PostgREST doesn't
  // do conditional bulk updates with per-row sentinel values cleanly.
  for (const post of rows) {
    try {
      const upd = await fetch(
        `${SB_URL}/rest/v1/social_posts?id=eq.${encodeURIComponent(post.id)}&moderation_status=eq.PENDING_HOTEL_APPROVAL`,
        {
          method: "PATCH",
          headers: HEADERS,
          body: JSON.stringify({
            moderation_status: "AUTO_APPROVED",
            auto_approved_at: now,
          }),
        }
      );
      if (!upd.ok) {
        errors.push(
          `Post ${post.id}: PATCH ${upd.status} ${await upd.text().catch(() => "")}`
        );
        continue;
      }
      approved += 1;

      // Notify the author (in_app channel; Phase 6 Railway paste handles
      // SMS/WhatsApp/email drainage of additional channels).
      try {
        // social_posts.author_id → social_profiles.id → social_profiles.user_id
        const apr = await fetch(
          `${SB_URL}/rest/v1/social_profiles?id=eq.${encodeURIComponent(post.author_id)}&select=user_id&limit=1`,
          { headers: READ_HEADERS, cache: "no-store" }
        );
        const auth = ((await apr.json().catch(() => [])) as any[])[0];
        if (auth?.user_id) {
          await fetch(`${SB_URL}/rest/v1/notification_queue`, {
            method: "POST",
            headers: HEADERS,
            body: JSON.stringify([
              {
                user_id: auth.user_id,
                channel: "in_app",
                template: "content_approved",
                payload: {
                  post_id: post.id,
                  hotel_id: post.hotel_id,
                  auto: true,
                  reason: "Hotel did not respond within 24 hours",
                },
                status: "pending",
              },
            ]),
          });
        }
      } catch (e: any) {
        errors.push(`Post ${post.id}: notify failed ${e?.message || e}`);
      }
    } catch (e: any) {
      errors.push(`Post ${post.id}: ${e?.message || String(e)}`);
    }
  }

  return { scanned: rows.length, approved, errors };
}

export async function GET(req: NextRequest) {
  {
    const authFail = cronAuthGuard(req);
    if (authFail) return authFail;
  }
  const started = Date.now();
  const result = await sweep();
  return NextResponse.json({
    ok: true,
    duration_ms: Date.now() - started,
    auto_approve_after_hours: AUTO_APPROVE_AFTER_MS / 3_600_000,
    ...result,
  });
}

export async function POST(req: NextRequest) {
  // Same body; allows manual admin triggers from /admin/content if desired.
  return GET(req);
}
