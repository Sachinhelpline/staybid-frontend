// GET /api/social/profiles/me — return (or lazily create) the current
// user's social profile. This is the "auto-creation on first access"
// fallback that runs when the underlying auth handler couldn't be
// modified to call SocialProfileService.createForUser directly.
import { NextResponse } from "next/server";
import { socialUserFromReq } from "@/lib/social/auth-helper";
import { ensureForUser, getProfileByUserId } from "@/lib/social/social-profile.service";

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
