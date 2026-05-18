// ═══════════════════════════════════════════════════════════════════════════
// Shared TypeScript types for the 2-Tier System.
// ═══════════════════════════════════════════════════════════════════════════
// Tier dimension lives in two places in this codebase (Phase 0 finding):
//   - lib/tier.ts             — customer LOYALTY tier (silver/gold/platinum)
//   - lib/tier-store.tsx      — ACCOUNT-ROLE tier (PUBLIC/CREATOR/HOTEL/etc)
// The new content-tier values land on social_profiles.user_type (the existing
// social_user_type ENUM that Phase 1 extended).

/**
 * The 6-value content tier set as it lives on social_profiles.user_type
 * after Phase 1. ADMIN is NOT in the enum — derived at read-time from
 * users.role per Phase 0 §3.1.
 */
export type ContentTier =
  | "PUBLIC"
  | "VERIFIED_GUEST"
  | "COMMUNITY_CONTRIBUTOR"
  | "CREATOR"
  | "HOTEL"
  | "ADMIN"; // derived from users.role, never stored in social_user_type

export type VerificationMethod =
  | "booking"        // Verified Guest — booking-tied
  | "location_otp"   // Community Contributor — on-site OTP
  | "creator"        // Existing creator path (untouched)
  | "hotel";         // Hotel-account upload (untouched)

export type ModerationStatus =
  | "PENDING_HOTEL_APPROVAL"
  | "PENDING_ADMIN_REVIEW"
  | "APPROVED"
  | "AUTO_APPROVED"
  | "REJECTED"
  | "FLAGGED"
  | "DELETED";

export type LocationVerificationStatus =
  | "OTP_SENT"
  | "VERIFIED"
  | "CONSUMED"
  | "EXPIRED"
  | "FAILED";

export type NudgeType =
  | "post_stay_share"
  | "view_milestone"
  | "first_post_completion";

export type AdminReviewDecision = "approve" | "reject";

/**
 * What the customer's GET /api/me/tier endpoint surfaces. The frontend
 * Create-FAB gate (Phase 4) reads this to decide whether to open the
 * CreateSheet directly or the upgrade-choice screen.
 */
export type MyTierResponse = {
  tier: ContentTier;
  canUpload: boolean;
  reason: string; // human-readable hint for the upgrade screen ("Book a stay…" etc.)
  eligibleBookingsCount: number;
  hasActiveLocationVerification: boolean;
  promotedAt: string | null; // ISO timestamp or null
  /**
   * v132.12-style feature flag for Phase 3 location-OTP. Default false
   * (NEXT_PUBLIC_ENABLE_LOCATION_OTP env var not set). When false, the
   * upgrade-choice UI hides / disables the Community Contributor card.
   * Flip env var to "1" once Railway dispatcher is pasted and an OTP
   * delivery plan (MSG91 / WhatsApp Business) is active.
   */
  locationOtpEnabled: boolean;
};
