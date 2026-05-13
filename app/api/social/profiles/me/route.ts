// GET / PATCH /api/social/profiles/me — the current user's social profile.
// GET: returns (or lazily creates) the row — "auto-creation on first
//      access" fallback that runs when the underlying auth handler
//      couldn't be modified to call SocialProfileService.createForUser
//      directly.
// PATCH (v110): updates avatar_url, display_name, and/or bio so they
//      survive logout / device-switch. Without this, profile photo +
//      display name lived only in localStorage and disappeared after
//      re-login — the bug the user flagged on /me's avatar.
import { NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { socialUserFromReq } from "@/lib/social/auth-helper";
import { ensureForUser, getProfileByUserId } from "@/lib/social/social-profile.service";

const WRITE_HEADERS = {
  apikey:        SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer:        "return=representation",
};

export async function GET(req: Request) {
  const user = socialUserFromReq(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Try existing profile first (fast path)
  const existing = await getProfileByUserId(user.id);
  if (existing) return NextResponse.json({ profile: existing });
  // Lazy create (PUBLIC type — promotion to CREATOR/HOTEL happens via
  // the dedicated triggers from those flows).
  const profile = await ensureForUser({
    id: user.id, email: user.email, phone: user.phone, name: user.name,
  });
  if (!profile) return NextResponse.json({ error: "Could not create profile" }, { status: 500 });
  return NextResponse.json({ profile, created: true });
}

export async function PATCH(req: Request) {
  const user = socialUserFromReq(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Make sure the profile exists (idempotent).
  const profile = await ensureForUser({
    id: user.id, email: user.email, phone: user.phone, name: user.name,
  });
  if (!profile) {
    return NextResponse.json({ error: "Could not resolve profile" }, { status: 500 });
  }

  // Whitelist of editable fields. Other social_profiles columns are
  // managed by the system (counts, verification, hotel/creator links).
  const patch: Record<string, any> = {};
  if (typeof body.avatar_url === "string")  patch.avatar_url   = body.avatar_url.slice(0, 1000) || null;
  if (typeof body.display_name === "string") {
    const n = body.display_name.trim().slice(0, 60);
    if (n) patch.display_name = n;
  }
  if (typeof body.bio === "string")         patch.bio          = body.bio.slice(0, 500) || null;
  if (typeof body.cover_url === "string")   patch.cover_url    = body.cover_url.slice(0, 1000) || null;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ profile, updated: false });
  }

  const r = await fetch(
    `${SB_URL}/rest/v1/social_profiles?id=eq.${encodeURIComponent(profile.id)}`,
    { method: "PATCH", headers: WRITE_HEADERS, body: JSON.stringify(patch) }
  );
  if (!r.ok) {
    return NextResponse.json(
      { error: "Could not update profile", detail: await r.text() },
      { status: 500 }
    );
  }
  const arr = await r.json().catch(() => []);
  const updated = Array.isArray(arr) && arr[0] ? arr[0] : profile;
  return NextResponse.json({ profile: updated, updated: true });
}
