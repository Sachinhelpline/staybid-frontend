// GET /api/me/tier
// Returns the signed-in user's content-tier state. Drives the frontend
// Create-FAB gate (Phase 4): the gate reads {canUpload, reason, ...} and
// either opens CreateSheet directly (canUpload) or routes the user to the
// upgrade-choice screen.
//
// UNIFIED SINGLE-FLOW UPLOAD (v540): everyone posts through the SAME reel-app
// composer + /api/social/posts. Who may reach it is decided here, keyed on the
// caller's FULL identity set (cross-pool) so a person who is a customer under
// one identity row and an owner / admin / creator under another is recognised
// no matter which identity the current session happens to use:
//   • ADMIN            — any bridged row has role admin / super_admin
//   • Hotel owner      — any bridged row has role HOTEL_OWNER, OR owns a hotel
//   • CREATOR / HOTEL  — social_profiles.user_type (existing)
//   • Verified Guest   — an eligible booking (existing)
// This is ADDITIVE — it only EXPANDS who can upload, never restricts. A pure
// customer with no booking still lands on the upgrade sheet. The caller's own
// profile/tier is never force-flipped (their customer/creator identity is
// preserved — zero clash for multi-role accounts).
import { NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { socialUserFromReq } from "@/lib/social/auth-helper";
import { ensureForUser } from "@/lib/social/social-profile.service";
import { resolveUserIds } from "@/lib/sb-server";
import {
  listEligibleBookings,
  countActiveLocationVerifications,
} from "@/lib/tier/eligibility";
import type { ContentTier, MyTierResponse } from "@/lib/tier/types";

const READ_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
const WRITE_HEADERS = { ...READ_HEADERS, "Content-Type": "application/json" };

const LOCATION_OTP_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_LOCATION_OTP === "1";

// ── Self-healing identity link ──────────────────────────────────────────────
// The bridge between a person's identity rows (resolveUserIds) can only work if
// at least one shared key — email or phone — is stored on the rows. Firebase /
// Google rows are created with `email = null` and `phone = unknown_<uid>`
// placeholders, so a multi-role user (customer under a Firebase id, owner /
// admin under a phone-OTP id) can't be bridged. Whenever a session's token DOES
// carry a real email / phone, backfill the caller's own row (null / empty /
// `unknown_` placeholder ONLY — never clobber a real value). This permanently
// links their identities so every future request resolves the full set — no
// per-user manual patch. Best-effort; never blocks the response.
async function backfillIdentity(user: {
  id: string;
  email?: string;
  phone?: string;
}): Promise<void> {
  const email = String(user.email || "").trim();
  const phone = String(user.phone || "").trim();
  const emailOk = /@/.test(email);
  const phoneOk =
    phone.replace(/\D/g, "").length >= 10 && !/^unknown_/i.test(phone);
  if (!emailOk && !phoneOk) return;

  let cur: any = null;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/users?id=eq.${encodeURIComponent(user.id)}&select=email,phone&limit=1`,
      { headers: READ_HEADERS, cache: "no-store" }
    );
    if (r.ok) {
      const rows = (await r.json().catch(() => [])) as any[];
      cur = Array.isArray(rows) ? rows[0] : null;
    }
  } catch {
    return;
  }
  if (!cur) return;

  const patch: Record<string, string> = {};
  const curEmail = String(cur.email || "").trim();
  const curPhone = String(cur.phone || "").trim();
  if (emailOk && !curEmail) patch.email = email;
  if (phoneOk && (!curPhone || /^unknown_/i.test(curPhone))) patch.phone = phone;
  if (!Object.keys(patch).length) return;

  try {
    await fetch(`${SB_URL}/rest/v1/users?id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      headers: WRITE_HEADERS,
      body: JSON.stringify(patch),
    });
  } catch {
    /* best-effort — a heal failure never blocks the tier read */
  }
}

export async function GET(req: Request) {
  const user = socialUserFromReq(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Identity signals: the session token may not carry email/phone (a Firebase
  // Google row is created with email=null + a phone placeholder), so accept
  // x-email / x-phone hint headers from the client (which always has sb_user)
  // as a fallback — mirrors partnerHotelScope. These only WIDEN the identity
  // bridge; they can never impersonate (resolveUserIds still only matches rows
  // that actually share the email/phone).
  const hdrEmail = (req.headers.get("x-email") || "").trim();
  const hdrPhone = (req.headers.get("x-phone") || "").trim();
  const effEmail =
    user.email && /@/.test(user.email) ? user.email : hdrEmail || undefined;
  const effPhone = user.phone || hdrPhone || undefined;

  const profile = await ensureForUser({
    id: user.id,
    email: effEmail,
    phone: effPhone,
    name: user.name,
  });

  // Self-heal the caller's own row from the available email/phone, then resolve
  // the FULL identity set (cross-pool). Order matters: the backfill fills a
  // missing email/phone so resolveUserIds (which reads the caller's row + walks
  // email / phone axes) can bridge to the owner/admin twin on this very request.
  await backfillIdentity({ id: user.id, email: effEmail, phone: effPhone }).catch(
    () => {}
  );

  let ids: string[] = [user.id];
  try {
    const resolved = await resolveUserIds(user.id, effPhone, effEmail);
    if (Array.isArray(resolved) && resolved.length) ids = resolved;
  } catch {
    /* fall back to the single id — never block the read */
  }
  const inList = ids.map(encodeURIComponent).join(",");

  // Cross-pool role probe (was single-id) — collect every role across ALL of
  // the caller's identities so an admin / owner twin is never missed.
  let isAdmin = false;
  let isOwnerRole = false;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/users?id=in.(${inList})&select=role`,
      { headers: READ_HEADERS, cache: "no-store" }
    );
    if (r.ok) {
      const rows = (await r.json().catch(() => [])) as any[];
      for (const u of Array.isArray(rows) ? rows : []) {
        const rl = String(u?.role || "").toLowerCase();
        if (rl === "admin" || rl === "super_admin") isAdmin = true;
        if (rl === "hotel_owner") isOwnerRole = true;
      }
    }
  } catch {
    /* fail open */
  }

  // Owns a hotel? Covers owners whose `role` column isn't HOTEL_OWNER (e.g.
  // onboarded / provisioned owners). Cross-pool by hotels.ownerId.
  let ownsHotel = false;
  if (!isOwnerRole) {
    try {
      const r = await fetch(
        `${SB_URL}/rest/v1/hotels?ownerId=in.(${inList})&select=id&limit=1`,
        { headers: READ_HEADERS, cache: "no-store" }
      );
      if (r.ok) {
        const rows = (await r.json().catch(() => [])) as any[];
        ownsHotel = Array.isArray(rows) && rows.length > 0;
      }
    } catch {
      /* fail open */
    }
  }
  const isOwner = isOwnerRole || ownsHotel;

  let tier: ContentTier = (profile?.user_type as ContentTier) || "PUBLIC";
  if (isAdmin) tier = "ADMIN";

  // When location-OTP is disabled, skip the count query entirely.
  const [eligible, activeLocCount] = await Promise.all([
    listEligibleBookings(user.id, user.phone),
    LOCATION_OTP_ENABLED
      ? countActiveLocationVerifications(user.id)
      : Promise.resolve(0),
  ]);

  // Capability decision tree — ADDITIVE (expands, never restricts).
  let canUpload = false;
  let reason = "";
  if (tier !== "PUBLIC") {
    // ADMIN / CREATOR / HOTEL / VERIFIED_GUEST / COMMUNITY_CONTRIBUTOR profile
    canUpload = true;
    reason = "ok";
  } else if (isOwner) {
    // Registered hotel owner (by role or by owning a hotel) — posts as
    // themselves from the same composer, no booking required.
    canUpload = true;
    reason = "hotel_owner";
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
      : "needs_booking_only";
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
