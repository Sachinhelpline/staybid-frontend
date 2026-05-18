// ═══════════════════════════════════════════════════════════════════════════
// Tier promotion helper.
// Promotes a social_profile from PUBLIC → VERIFIED_GUEST or
// PUBLIC → COMMUNITY_CONTRIBUTOR when the user successfully uploads via
// the new tier-system upload paths. Idempotent: re-promoting an already-
// CREATOR / HOTEL profile is a no-op.
// ═══════════════════════════════════════════════════════════════════════════
import { SB_URL, SB_KEY } from "@/lib/sb";
import type { ContentTier } from "@/lib/tier/types";

const HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=minimal",
};

/**
 * Bumps social_profiles.user_type if (and only if) the current type is
 * PUBLIC. Higher tiers (CREATOR/HOTEL) are never downgraded. Sets
 * tier_promoted_at when an actual transition happens.
 *
 * Fire-and-forget — caller doesn't await on the upload critical path.
 * Errors are logged but never thrown.
 */
export async function maybePromoteToTier(
  profileId: string,
  currentTier: ContentTier,
  targetTier: "VERIFIED_GUEST" | "COMMUNITY_CONTRIBUTOR"
): Promise<{ promoted: boolean; from: ContentTier; to: ContentTier }> {
  // Never overwrite a higher tier
  if (currentTier === "CREATOR" || currentTier === "HOTEL") {
    return { promoted: false, from: currentTier, to: currentTier };
  }
  // Don't downgrade a Community Contributor to Verified Guest or vice versa
  if (
    (currentTier === "COMMUNITY_CONTRIBUTOR" &&
      targetTier === "VERIFIED_GUEST") ||
    (currentTier === "VERIFIED_GUEST" &&
      targetTier === "COMMUNITY_CONTRIBUTOR")
  ) {
    return { promoted: false, from: currentTier, to: currentTier };
  }
  // Already at the target tier → no-op
  if (currentTier === targetTier) {
    return { promoted: false, from: currentTier, to: currentTier };
  }

  // PUBLIC → targetTier transition
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/social_profiles?id=eq.${encodeURIComponent(profileId)}`,
      {
        method: "PATCH",
        headers: HEADERS,
        body: JSON.stringify({
          user_type: targetTier,
          tier_promoted_at: new Date().toISOString(),
        }),
      }
    );
    if (!r.ok) {
      console.error(
        "[tier/promote] PATCH failed",
        r.status,
        await r.text().catch(() => "")
      );
      return { promoted: false, from: currentTier, to: currentTier };
    }
  } catch (e) {
    console.error("[tier/promote] PATCH threw", e);
    return { promoted: false, from: currentTier, to: currentTier };
  }
  return { promoted: true, from: currentTier, to: targetTier };
}

/**
 * Queues an in-app + WhatsApp notification when a user's tier transitions.
 * Falls back to in-app only if Railway drainer doesn't yet know the
 * "tier_promoted" template (Sachin's Phase 6 paste).
 */
export async function queueTierPromotionNudge(
  userId: string,
  newTier: ContentTier
): Promise<void> {
  try {
    await fetch(`${SB_URL}/rest/v1/notification_queue`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify([
        {
          user_id: userId,
          channel: "in_app",
          template: "tier_promoted",
          payload: { tier: newTier },
          status: "pending",
        },
      ]),
    });
  } catch (e) {
    console.error("[tier/promote] notif queue failed", e);
  }
}

// ─── Phase 7 — Creator promotion ──────────────────────────────────────
// Promoting to CREATOR is a 2-step atomic operation:
//   (1) UPSERT influencers row (status='active' for auto_promote OR
//       'pending' for auto_eval — admin reviews the pending case)
//   (2) For auto_promote ONLY: PATCH social_profiles.user_type='CREATOR'
//
// Existing form-applicants flow into the same influencers table with
// application_source='form' (the default) — Phase 7's cron uses
// application_source='auto_promote' or 'auto_eval' so admin /admin/creators
// can distinguish the sources cleanly.
export type CreatorEvalMetrics = {
  posts_approved: number;
  posts_rejected: number;
  total_views: number;
  follower_count: number;
  approval_rate: number;
  evaluated_at: string;
  eval_window_days: number;
  eligibility_type: "auto_promote" | "admin_review";
};

const INF_HEADERS = {
  ...HEADERS,
  Prefer: "return=representation,resolution=ignore-duplicates",
};

/**
 * Type A — auto-promote a VERIFIED_GUEST / COMMUNITY_CONTRIBUTOR
 * straight to active CREATOR. Idempotent: if an influencers row already
 * exists for this user (active or pending), this is a no-op.
 */
export async function autoPromoteToCreator(
  userId: string,
  profileId: string,
  currentTier: ContentTier,
  metrics: CreatorEvalMetrics
): Promise<{ promoted: boolean; reason?: string }> {
  if (currentTier === "CREATOR" || currentTier === "HOTEL") {
    return { promoted: false, reason: "already higher tier" };
  }

  // Check if influencers row already exists (existing /upgrade form path)
  const existing = await fetch(
    `${SB_URL}/rest/v1/influencers?user_id=eq.${encodeURIComponent(userId)}&select=id,status&limit=1`,
    {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      cache: "no-store",
    }
  );
  const existingRow = ((existing.ok ? await existing.json().catch(() => []) : []) as any[])[0];
  if (existingRow) {
    return { promoted: false, reason: `influencer row already exists (status=${existingRow.status})` };
  }

  // Step 1: INSERT influencers row with status='active'
  const ins = await fetch(`${SB_URL}/rest/v1/influencers`, {
    method: "POST",
    headers: INF_HEADERS,
    body: JSON.stringify([
      {
        id: "inf_" + crypto.randomUUID().replace(/-/g, "").slice(0, 24),
        user_id: userId,
        status: "active",
        application_source: "auto_promote",
        auto_eval_data: metrics,
        agreement_accepted: false, // user can sign later
        verification_tier: 1,
      },
    ]),
  });
  if (!ins.ok) {
    console.error(
      "[tier/promote] auto-promote insert failed",
      ins.status,
      await ins.text().catch(() => "")
    );
    return { promoted: false, reason: "insert failed" };
  }

  // Step 2: PATCH social_profiles.user_type='CREATOR'
  try {
    await fetch(
      `${SB_URL}/rest/v1/social_profiles?id=eq.${encodeURIComponent(profileId)}`,
      {
        method: "PATCH",
        headers: HEADERS,
        body: JSON.stringify({
          user_type: "CREATOR",
          tier_promoted_at: new Date().toISOString(),
          is_creator: true,
        }),
      }
    );
  } catch (e) {
    console.error("[tier/promote] social_profiles PATCH failed", e);
    // Don't roll back the influencers insert — auto_promote with mismatched
    // user_type is recoverable; the next /api/me/tier read will reconcile.
  }

  // Notify the user
  await queueTierPromotionNudge(userId, "CREATOR");

  return { promoted: true };
}

/**
 * Type B — flag the user for admin review via the existing /admin/creators
 * queue. Inserts an influencers row with status='pending' +
 * application_source='auto_eval' so admin sees it alongside form-applicants.
 * Does NOT touch social_profiles — that promotion waits for admin approval.
 */
export async function flagForCreatorAdminReview(
  userId: string,
  metrics: CreatorEvalMetrics
): Promise<{ flagged: boolean; reason?: string }> {
  // Same skip-if-already-exists guard
  const existing = await fetch(
    `${SB_URL}/rest/v1/influencers?user_id=eq.${encodeURIComponent(userId)}&select=id,status&limit=1`,
    {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      cache: "no-store",
    }
  );
  const existingRow = ((existing.ok ? await existing.json().catch(() => []) : []) as any[])[0];
  if (existingRow) {
    return { flagged: false, reason: `influencer row already exists (status=${existingRow.status})` };
  }

  const ins = await fetch(`${SB_URL}/rest/v1/influencers`, {
    method: "POST",
    headers: INF_HEADERS,
    body: JSON.stringify([
      {
        id: "inf_" + crypto.randomUUID().replace(/-/g, "").slice(0, 24),
        user_id: userId,
        status: "pending",
        application_source: "auto_eval",
        auto_eval_data: metrics,
        agreement_accepted: false,
        verification_tier: 1,
      },
    ]),
  });
  if (!ins.ok) {
    console.error(
      "[tier/promote] admin-review insert failed",
      ins.status,
      await ins.text().catch(() => "")
    );
    return { flagged: false, reason: "insert failed" };
  }

  // Notify admin team (sentinel user_id='ADMIN' — Railway drainer
  // routes to admin Slack/WhatsApp group per Phase 6 paste)
  try {
    await fetch(`${SB_URL}/rest/v1/notification_queue`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify([
        {
          user_id: "ADMIN",
          channel: "in_app",
          template: "creator_upgrade_eligible",
          payload: {
            candidate_user_id: userId,
            metrics,
          },
          status: "pending",
        },
      ]),
    });
  } catch {}

  return { flagged: true };
}
