// GET /api/me/tier
// Returns the signed-in user's content-tier state. Drives the frontend
// Create-FAB gate (Phase 4): the gate reads {canUpload, reason, ...} and
// either opens CreateSheet directly (any non-PUBLIC tier) or routes the
// PUBLIC user to the upgrade-choice screen.
//
// Auth: any signed-in user (customer JWT). Admins are detected via
// users.role and surfaced as ADMIN even though that value isn't in the
// social_user_type enum (Phase 0 §3.1 decision).
import { NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { socialUserFromReq } from "@/lib/social/auth-helper";
import { ensureForUser } from "@/lib/social/social-profile.service";
import {
  listEligibleBookings,
  countActiveLocationVerifications,
} from "@/lib/tier/eligibility";
import type { ContentTier, MyTierResponse } from "@/lib/tier/types";

const READ_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

// Phase 3 feature flag — mirrors the OTP routes. When OFF (default), the
// upgrade-choice UI in Phase 4 hides the Community Contributor card and
// the `reason` field below signals "verified_guest_only" instead of the
// hybrid "needs_booking_or_location_verify" hint.
const LOCATION_OTP_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_LOCATION_OTP === "1";

export async function GET(req: Request) {
  const user = socialUserFromReq(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Probe role for ADMIN detection (not in social_user_type enum).
  let role: string | null = null;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/users?id=eq.${encodeURIComponent(user.id)}&select=role&limit=1`,
      { headers: READ_HEADERS, cache: "no-store" }
    );
    if (r.ok) {
      const rows = (await r.json().catch(() => [])) as any[];
      role = rows[0]?.role || null;
    }
  } catch {}

  const profile = await ensureForUser({
    id: user.id,
    email: user.email,
    phone: user.phone,
    name: user.name,
  });

  let tier: ContentTier = (profile?.user_type as ContentTier) || "PUBLIC";
  if (role === "admin" || role === "super_admin") tier = "ADMIN";

  // When location-OTP is disabled, skip the count query entirely — even
  // if stale VERIFIED rows linger from a previous flag-on window, we
  // shouldn't surface them to the UI.
  const [eligible, activeLocCount] = await Promise.all([
    listEligibleBookings(user.id, user.phone),
    LOCATION_OTP_ENABLED
      ? countActiveLocationVerifications(user.id)
      : Promise.resolve(0),
  ]);

  // Capability decision tree
  let canUpload = false;
  let reason = "";
  if (tier !== "PUBLIC") {
    canUpload = true;
    reason = "ok";
  } else if (eligible.length > 0) {
    canUpload = true;
    reason = "verified_guest_eligible";
  } else if (LOCATION_OTP_ENABLED && activeLocCount > 0) {
    canUpload = true;
    reason = "community_contributor_eligible";
  } else {
    canUpload = false;
    reason = LOCATION_OTP_ENABLED
      ? "needs_booking_or_location_verify"
      : "needs_booking_only"; // Community Contributor card hidden in this state
  }

  const resp: MyTierResponse = {
    tier,
    canUpload,
    reason,
    eligibleBookingsCount: eligible.length,
    hasActiveLocationVerification: activeLocCount > 0,
    promotedAt: profile?.tier_promoted_at || null,
    locationOtpEnabled: LOCATION_OTP_ENABLED,
  };
  return NextResponse.json(resp);
}
