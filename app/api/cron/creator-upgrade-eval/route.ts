// Cron endpoint — evaluates VERIFIED_GUEST + COMMUNITY_CONTRIBUTOR users
// against creator-promotion criteria. Two outcomes per qualifying user:
//
//   Type A (auto-promote) → INSERT influencers row status='active' +
//     PATCH social_profiles.user_type='CREATOR'. Eligibility criteria:
//       - posts_approved >= 5 in last 90 days
//       - posts_rejected == 0 (perfect-quality signal)
//       - total_views >= 5000 across approved posts
//
//   Type B (admin review) → INSERT influencers row status='pending' +
//     application_source='auto_eval'. Admin /admin/creators page already
//     shows pending applications; the new application_source column
//     distinguishes auto-eval candidates from form-applicants. Criteria:
//       - posts_approved >= 10 OR total_views >= 25000 OR follower_count >= 5000
//       - AND user does NOT meet Type A criteria
//
// Schedule (cron-job.org):
//   GET https://staybids.in/api/cron/creator-upgrade-eval?token=staybid-cron-dev
//   Frequency: weekly (Sundays 04:00 IST)
//
// Auth — matches the other crons.
//
// Existing /upgrade form-based creator applications stay untouched per
// Phase 0 §3.1 lock. First-to-fire wins — if a user has already submitted
// the form (influencers row exists), the cron is a no-op for them.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import {
  autoPromoteToCreator,
  flagForCreatorAdminReview,
  type CreatorEvalMetrics,
} from "@/lib/tier/promote";
import type { ContentTier } from "@/lib/tier/types";

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

// Tunable via env so we can ramp criteria up/down without redeploy.
const EVAL_WINDOW_DAYS = parseInt(
  process.env.CREATOR_EVAL_WINDOW_DAYS || "90",
  10
);
const AUTO_PROMOTE_MIN_POSTS = parseInt(
  process.env.CREATOR_AUTO_MIN_POSTS || "5",
  10
);
const AUTO_PROMOTE_MIN_VIEWS = parseInt(
  process.env.CREATOR_AUTO_MIN_VIEWS || "5000",
  10
);
const ADMIN_REVIEW_MIN_POSTS = parseInt(
  process.env.CREATOR_ADMIN_MIN_POSTS || "10",
  10
);
const ADMIN_REVIEW_MIN_VIEWS = parseInt(
  process.env.CREATOR_ADMIN_MIN_VIEWS || "25000",
  10
);
const ADMIN_REVIEW_MIN_FOLLOWERS = parseInt(
  process.env.CREATOR_ADMIN_MIN_FOLLOWERS || "5000",
  10
);

// Hard cap so a stuck cron doesn't try to drain hundreds at once.
const MAX_CANDIDATES_PER_RUN = 200;

type Aggregate = {
  profileId: string;
  userId: string;
  userType: ContentTier;
  followerCount: number;
  postsApproved: number;
  postsRejected: number;
  totalViews: number;
};

async function sweep(): Promise<{
  candidates_scanned: number;
  auto_promoted: number;
  flagged_for_admin: number;
  skipped_already_in_influencers: number;
  skipped_below_threshold: number;
  errors: string[];
}> {
  const errors: string[] = [];
  const since = new Date(
    Date.now() - EVAL_WINDOW_DAYS * 86_400_000
  ).toISOString();

  // Step 1 — find VERIFIED_GUEST / COMMUNITY_CONTRIBUTOR profiles
  const profilesRes = await fetch(
    `${SB_URL}/rest/v1/social_profiles` +
      `?user_type=in.(VERIFIED_GUEST,COMMUNITY_CONTRIBUTOR)` +
      `&select=id,user_id,user_type,follower_count` +
      `&limit=${MAX_CANDIDATES_PER_RUN}`,
    { headers: READ_HEADERS, cache: "no-store" }
  );
  if (!profilesRes.ok) {
    return {
      candidates_scanned: 0,
      auto_promoted: 0,
      flagged_for_admin: 0,
      skipped_already_in_influencers: 0,
      skipped_below_threshold: 0,
      errors: [`Profile fetch ${profilesRes.status}: ${await profilesRes.text().catch(() => "")}`],
    };
  }
  const profiles = (await profilesRes.json().catch(() => [])) as any[];
  if (!profiles.length) {
    return {
      candidates_scanned: 0,
      auto_promoted: 0,
      flagged_for_admin: 0,
      skipped_already_in_influencers: 0,
      skipped_below_threshold: 0,
      errors: [],
    };
  }

  const profileIds = profiles.map((p) => p.id);

  // Step 2 — aggregate post metrics for these profiles. We need:
  //   approved count, rejected count, sum(view_count) on approved posts
  // PostgREST doesn't aggregate; pull rows + reduce app-side.
  const inAuthors = profileIds.map(encodeURIComponent).join(",");

  const [approvedRes, rejectedRes] = await Promise.all([
    fetch(
      `${SB_URL}/rest/v1/social_posts` +
        `?author_id=in.(${inAuthors})` +
        `&moderation_status=in.(APPROVED,AUTO_APPROVED)` +
        `&created_at=gte.${encodeURIComponent(since)}` +
        `&select=author_id,view_count,created_at` +
        `&limit=10000`,
      { headers: READ_HEADERS, cache: "no-store" }
    ),
    fetch(
      `${SB_URL}/rest/v1/social_posts` +
        `?author_id=in.(${inAuthors})` +
        `&moderation_status=eq.REJECTED` +
        `&created_at=gte.${encodeURIComponent(since)}` +
        `&select=author_id&limit=10000`,
      { headers: READ_HEADERS, cache: "no-store" }
    ),
  ]);

  const approvedRows = (approvedRes.ok ? await approvedRes.json().catch(() => []) : []) as any[];
  const rejectedRows = (rejectedRes.ok ? await rejectedRes.json().catch(() => []) : []) as any[];

  // Build per-profile aggregates
  const agg = new Map<string, Aggregate>();
  for (const p of profiles) {
    agg.set(p.id, {
      profileId: p.id,
      userId: p.user_id,
      userType: p.user_type as ContentTier,
      followerCount: Number(p.follower_count || 0),
      postsApproved: 0,
      postsRejected: 0,
      totalViews: 0,
    });
  }
  for (const r of approvedRows) {
    const a = agg.get(r.author_id);
    if (!a) continue;
    a.postsApproved += 1;
    a.totalViews += Number(r.view_count || 0);
  }
  for (const r of rejectedRows) {
    const a = agg.get(r.author_id);
    if (!a) continue;
    a.postsRejected += 1;
  }

  // Step 3 — filter out users already in influencers (any status)
  const candidateUserIds = Array.from(agg.values()).map((a) => a.userId);
  const inUserIds = candidateUserIds.map(encodeURIComponent).join(",");
  const existingRes = candidateUserIds.length
    ? await fetch(
        `${SB_URL}/rest/v1/influencers?user_id=in.(${inUserIds})&select=user_id`,
        { headers: READ_HEADERS, cache: "no-store" }
      )
    : null;
  const existingUsers = new Set<string>();
  if (existingRes?.ok) {
    const rows = (await existingRes.json().catch(() => [])) as any[];
    rows.forEach((r: any) => existingUsers.add(r.user_id));
  }

  // Step 4 — categorize + execute
  let autoPromoted = 0;
  let flagged = 0;
  let skippedExisting = 0;
  let skippedBelow = 0;

  for (const a of Array.from(agg.values())) {
    if (existingUsers.has(a.userId)) {
      skippedExisting += 1;
      continue;
    }

    const approvalRate =
      a.postsApproved + a.postsRejected === 0
        ? 1
        : a.postsApproved / (a.postsApproved + a.postsRejected);

    const meetsTypeA =
      a.postsApproved >= AUTO_PROMOTE_MIN_POSTS &&
      a.postsRejected === 0 &&
      a.totalViews >= AUTO_PROMOTE_MIN_VIEWS;

    const meetsTypeB =
      !meetsTypeA &&
      (a.postsApproved >= ADMIN_REVIEW_MIN_POSTS ||
        a.totalViews >= ADMIN_REVIEW_MIN_VIEWS ||
        a.followerCount >= ADMIN_REVIEW_MIN_FOLLOWERS);

    if (!meetsTypeA && !meetsTypeB) {
      skippedBelow += 1;
      continue;
    }

    const metrics: CreatorEvalMetrics = {
      posts_approved: a.postsApproved,
      posts_rejected: a.postsRejected,
      total_views: a.totalViews,
      follower_count: a.followerCount,
      approval_rate: Number(approvalRate.toFixed(3)),
      evaluated_at: new Date().toISOString(),
      eval_window_days: EVAL_WINDOW_DAYS,
      eligibility_type: meetsTypeA ? "auto_promote" : "admin_review",
    };

    try {
      if (meetsTypeA) {
        const r = await autoPromoteToCreator(
          a.userId,
          a.profileId,
          a.userType,
          metrics
        );
        if (r.promoted) autoPromoted += 1;
        else if (r.reason) errors.push(`Type A skip ${a.userId}: ${r.reason}`);
      } else {
        const r = await flagForCreatorAdminReview(a.userId, metrics);
        if (r.flagged) flagged += 1;
        else if (r.reason) errors.push(`Type B skip ${a.userId}: ${r.reason}`);
      }
    } catch (e: any) {
      errors.push(`Profile ${a.profileId}: ${e?.message || String(e)}`);
    }
  }

  return {
    candidates_scanned: profiles.length,
    auto_promoted: autoPromoted,
    flagged_for_admin: flagged,
    skipped_already_in_influencers: skippedExisting,
    skipped_below_threshold: skippedBelow,
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
    criteria: {
      eval_window_days: EVAL_WINDOW_DAYS,
      auto_promote: {
        min_posts: AUTO_PROMOTE_MIN_POSTS,
        min_views: AUTO_PROMOTE_MIN_VIEWS,
        rejected_posts_max: 0,
      },
      admin_review: {
        min_posts: ADMIN_REVIEW_MIN_POSTS,
        min_views: ADMIN_REVIEW_MIN_VIEWS,
        min_followers: ADMIN_REVIEW_MIN_FOLLOWERS,
      },
    },
    ...result,
  });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
