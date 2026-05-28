// POST   /api/social/profiles/follow/[userId] — follow a profile
// DELETE /api/social/profiles/follow/[userId] — unfollow
//
// `userId` here is the auth user_id of the followed user (NOT the
// social_profiles.id). We resolve to profile id internally so the
// follower-count trigger works and the FK is satisfied.
import { NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { socialUserFromReq } from "@/lib/social/auth-helper";
import { getProfileByUserId } from "@/lib/social/social-profile.service";

const HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function resolveProfileId(userIdOrUsername: string): Promise<string | null> {
  // Accept either an auth user id or a @username
  const isUsername = userIdOrUsername.startsWith("@");
  const filter = isUsername
    ? `username=eq.${encodeURIComponent(userIdOrUsername.slice(1))}`
    : `user_id=eq.${encodeURIComponent(userIdOrUsername)}`;
  const r = await fetch(`${SB_URL}/rest/v1/social_profiles?${filter}&select=id&limit=1`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    cache: "no-store",
  });
  if (!r.ok) return null;
  const arr = await r.json().catch(() => []);
  return Array.isArray(arr) && arr[0]?.id ? arr[0].id : null;
}

export async function POST(req: Request, props: { params: Promise<{ userId: string }> }) {
  const params = await props.params;
  const viewer = socialUserFromReq(req);
  if (!viewer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const target = decodeURIComponent(params.userId);
  const followedId = await resolveProfileId(target);
  if (!followedId) return NextResponse.json({ error: "Target profile not found" }, { status: 404 });
  // Make sure the viewer has a profile too (so following_count trigger updates).
  const viewerProfile = await getProfileByUserId(viewer.id);
  if (!viewerProfile) return NextResponse.json({ error: "Set up your profile first" }, { status: 400 });
  if (viewerProfile.id === followedId) return NextResponse.json({ error: "Cannot follow yourself" }, { status: 400 });

  const r = await fetch(`${SB_URL}/rest/v1/social_follows`, {
    method: "POST",
    headers: { ...HEADERS, Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify({ follower_user_id: viewer.id, followed_id: followedId }),
  });
  if (!r.ok && r.status !== 409) {
    return NextResponse.json({ error: "Could not follow", detail: await r.text() }, { status: 500 });
  }
  return NextResponse.json({ following: true });
}

export async function DELETE(req: Request, props: { params: Promise<{ userId: string }> }) {
  const params = await props.params;
  const viewer = socialUserFromReq(req);
  if (!viewer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const target = decodeURIComponent(params.userId);
  const followedId = await resolveProfileId(target);
  if (!followedId) return NextResponse.json({ error: "Target profile not found" }, { status: 404 });
  await fetch(
    `${SB_URL}/rest/v1/social_follows?follower_user_id=eq.${encodeURIComponent(viewer.id)}&followed_id=eq.${encodeURIComponent(followedId)}`,
    { method: "DELETE", headers: HEADERS }
  );
  return NextResponse.json({ following: false });
}
