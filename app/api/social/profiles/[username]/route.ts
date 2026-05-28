// GET /api/social/profiles/[username] — public profile lookup.
// Returns the SocialProfile + a lightweight "is_following" boolean
// for the current viewer (when authenticated).
import { NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { socialUserFromReq } from "@/lib/social/auth-helper";
import { getProfileByUsername } from "@/lib/social/social-profile.service";
import { HOTEL_CARD_COLS } from "@/lib/sb-columns";

const READ_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

export async function GET(req: Request, props: { params: Promise<{ username: string }> }) {
  const params = await props.params;
  const username = decodeURIComponent(params.username || "").replace(/^@/, "");
  if (!username) return NextResponse.json({ error: "Username required" }, { status: 400 });

  const profile = await getProfileByUsername(username);
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const viewer = socialUserFromReq(req);
  let isFollowing = false;
  if (viewer) {
    const r = await fetch(
      `${SB_URL}/rest/v1/social_follows?follower_user_id=eq.${encodeURIComponent(viewer.id)}&followed_id=eq.${encodeURIComponent(profile.id)}&select=followed_id&limit=1`,
      { headers: READ_HEADERS, cache: "no-store" }
    );
    if (r.ok) {
      const arr = await r.json().catch(() => []);
      isFollowing = Array.isArray(arr) && arr.length > 0;
    }
  }

  // Side-load hotel data when this profile is a hotel
  let hotel: any = null;
  if (profile.user_type === "HOTEL" && profile.hotel_id) {
    const r = await fetch(
      `${SB_URL}/rest/v1/hotels?id=eq.${encodeURIComponent(profile.hotel_id)}&select=${HOTEL_CARD_COLS}&limit=1`,
      { headers: READ_HEADERS, cache: "no-store" }
    );
    if (r.ok) {
      const arr = await r.json().catch(() => []);
      hotel = Array.isArray(arr) && arr[0] ? arr[0] : null;
    }
  }

  return NextResponse.json({ profile, isFollowing, hotel });
}
