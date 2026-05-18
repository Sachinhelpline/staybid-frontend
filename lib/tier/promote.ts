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
