// Cron endpoint — credits StayBid wallet rewards when a verified-user
// post crosses a view-count milestone.
//
// Milestones (Phase 0 §3.1 locked tiers):
//   1,000 views  → ₹50  wallet credit (source 'view_milestone_1k')
//   10,000 views → ₹200 wallet credit (source 'view_milestone_10k')
//
// Idempotency: wallet_credit_history's UNIQUE partial index on
//   (user_id, source_type, source_id) WHERE source_id IS NOT NULL
// makes re-runs of this cron a no-op. We construct source_id as
//   `${post_id}:${milestone_key}` so each (post, milestone) pair can
// credit AT MOST ONCE per user across all time.
//
// Schedule (cron-job.org):
//   GET https://staybids.in/api/cron/view-milestone-rewards?token=staybid-cron-dev
//   Frequency: every 1 day
//
// Auth — matches the other crons.
//
// Reward is paid to the AUTHOR (post.author_id → social_profiles.user_id),
// not the viewer. Posts with verification_method='hotel' or 'creator'
// are skipped — existing creator commission system pays those.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";

const HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const READ_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

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

type Milestone = { key: string; threshold: number; reward_inr: number };

const MILESTONES: Milestone[] = [
  { key: "view_milestone_1k", threshold: 1_000, reward_inr: 50 },
  { key: "view_milestone_10k", threshold: 10_000, reward_inr: 200 },
];

// Only credit posts authored via the tier-system paths. Existing creator
// commission engine handles 'creator' uploads; 'hotel' uploads are
// promotional and don't earn user rewards.
const REWARDABLE_METHODS = new Set(["booking", "location_otp"]);

const MAX_PER_RUN = 200;

async function sweep(): Promise<{
  posts_scanned: number;
  rewards_credited: number;
  skipped_already_credited: number;
  skipped_low_views: number;
  total_credited_inr: number;
  errors: string[];
}> {
  const errors: string[] = [];

  // Step 1: pull APPROVED/AUTO_APPROVED posts whose view_count crossed
  // the lowest milestone. PostgREST can't OR-filter across columns
  // with the `or=()` syntax neatly when mixing `eq` + `gte`, so we
  // fetch the candidate set and filter app-side.
  const lowestThreshold = MILESTONES[0].threshold;
  const candidatesRes = await fetch(
    `${SB_URL}/rest/v1/social_posts` +
      `?view_count=gte.${lowestThreshold}` +
      `&moderation_status=in.(APPROVED,AUTO_APPROVED)` +
      `&select=id,author_id,view_count,verification_method,hotel_id` +
      `&order=view_count.desc&limit=${MAX_PER_RUN}`,
    { headers: READ_HEADERS, cache: "no-store" }
  );
  if (!candidatesRes.ok) {
    return {
      posts_scanned: 0,
      rewards_credited: 0,
      skipped_already_credited: 0,
      skipped_low_views: 0,
      total_credited_inr: 0,
      errors: [`Candidate fetch ${candidatesRes.status}: ${await candidatesRes.text().catch(() => "")}`],
    };
  }
  const candidates = (await candidatesRes.json().catch(() => [])) as any[];

  let rewardsCredited = 0;
  let alreadyCredited = 0;
  let totalCreditedInr = 0;

  // Build a lookup of author_id → user_id (social_profiles.id → social_profiles.user_id)
  const authorIds = Array.from(
    new Set(candidates.map((p) => p.author_id).filter(Boolean))
  );
  const userIdByAuthor = new Map<string, string>();
  if (authorIds.length) {
    const apr = await fetch(
      `${SB_URL}/rest/v1/social_profiles?id=in.(${authorIds.map(encodeURIComponent).join(",")})&select=id,user_id`,
      { headers: READ_HEADERS, cache: "no-store" }
    );
    if (apr.ok) {
      const rows = (await apr.json().catch(() => [])) as any[];
      rows.forEach((r: any) => {
        if (r.id && r.user_id) userIdByAuthor.set(r.id, r.user_id);
      });
    }
  }

  for (const post of candidates) {
    // Skip non-rewardable methods (creator + hotel uploads)
    if (!post.verification_method || !REWARDABLE_METHODS.has(post.verification_method)) {
      continue;
    }
    const userId = userIdByAuthor.get(post.author_id);
    if (!userId) continue;

    // For each milestone this post qualifies for, attempt to credit.
    // Idempotency unique index drops duplicates silently when we use
    // Prefer: resolution=ignore-duplicates.
    for (const m of MILESTONES) {
      if (post.view_count < m.threshold) continue;
      const sourceId = `${post.id}:${m.key}`;
      try {
        const ins = await fetch(`${SB_URL}/rest/v1/wallet_credit_history`, {
          method: "POST",
          headers: {
            ...HEADERS,
            Prefer: "return=representation,resolution=ignore-duplicates",
          },
          body: JSON.stringify([
            {
              user_id: userId,
              delta_inr: m.reward_inr,
              type: "CREDIT",
              reason: `${m.threshold.toLocaleString("en-IN")} views earned a StayBid reward`,
              source_type: "view_milestone",
              source_id: sourceId,
            },
          ]),
        });
        if (!ins.ok) {
          errors.push(
            `Credit ${userId}/${m.key}: ${ins.status} ${await ins.text().catch(() => "")}`
          );
          continue;
        }
        const arr = (await ins.json().catch(() => [])) as any[];
        if (!arr[0]) {
          // Duplicate — already credited for this (post, milestone)
          alreadyCredited += 1;
          continue;
        }

        // Update the wallet_credits aggregate (denormalized balance).
        // Get current balance then PATCH. The wallet_credit_history
        // ledger is the source of truth; this aggregate is a cache.
        const balRes = await fetch(
          `${SB_URL}/rest/v1/wallet_credits?user_id=eq.${encodeURIComponent(userId)}&select=user_id,balance_inr,lifetime_credited&limit=1`,
          { headers: READ_HEADERS, cache: "no-store" }
        );
        const balRow = ((balRes.ok ? await balRes.json().catch(() => []) : []) as any[])[0];
        if (balRow) {
          await fetch(
            `${SB_URL}/rest/v1/wallet_credits?user_id=eq.${encodeURIComponent(userId)}`,
            {
              method: "PATCH",
              headers: HEADERS,
              body: JSON.stringify({
                balance_inr: Number(balRow.balance_inr || 0) + m.reward_inr,
                lifetime_credited: Number(balRow.lifetime_credited || 0) + m.reward_inr,
              }),
            }
          );
        } else {
          // First-ever credit for this user — INSERT the aggregate row.
          await fetch(`${SB_URL}/rest/v1/wallet_credits`, {
            method: "POST",
            headers: HEADERS,
            body: JSON.stringify({
              user_id: userId,
              balance_inr: m.reward_inr,
              lifetime_credited: m.reward_inr,
              lifetime_debited: 0,
            }),
          });
        }

        // Record the reward in inspiration_nudges for analytics
        await fetch(`${SB_URL}/rest/v1/inspiration_nudges`, {
          method: "POST",
          headers: { ...HEADERS, Prefer: "return=minimal,resolution=ignore-duplicates" },
          body: JSON.stringify([
            {
              user_id: userId,
              hotel_id: post.hotel_id,
              nudge_type: "view_milestone",
              status: "REWARDED",
              reward_kind: m.key,
              reward_amount_inr: m.reward_inr,
              reward_credited_at: new Date().toISOString(),
              reference_post_id: post.id,
              metadata: {
                threshold: m.threshold,
                view_count_at_credit: post.view_count,
              },
            },
          ]),
        });

        // Queue user-facing notification
        await fetch(`${SB_URL}/rest/v1/notification_queue`, {
          method: "POST",
          headers: HEADERS,
          body: JSON.stringify([
            {
              user_id: userId,
              channel: "in_app",
              template: "view_milestone_reward",
              payload: {
                post_id: post.id,
                threshold: m.threshold,
                reward_inr: m.reward_inr,
              },
              status: "pending",
            },
          ]),
        });

        rewardsCredited += 1;
        totalCreditedInr += m.reward_inr;
      } catch (e: any) {
        errors.push(`Credit ${userId}/${m.key}: ${e?.message || String(e)}`);
      }
    }
  }

  return {
    posts_scanned: candidates.length,
    rewards_credited: rewardsCredited,
    skipped_already_credited: alreadyCredited,
    skipped_low_views: 0,
    total_credited_inr: totalCreditedInr,
    errors,
  };
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const result = await sweep();
  return NextResponse.json({
    ok: true,
    duration_ms: Date.now() - started,
    milestones: MILESTONES,
    ...result,
  });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
