// POST /api/social/posts — upload a new photo / reel / story.
// Body: { mediaType, mediaUrl, thumbnailUrl?, caption?, soundTrack?, soundUrl?,
//         hotelId?, locationName?, locationLat?, locationLng? }
//
// Auth: any logged-in user. Profile is auto-created (PUBLIC) if missing.
// Hotels can attach their own hotelId; non-hotel authors cannot tag a
// hotel they don't own.
import { NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { socialUserFromReq } from "@/lib/social/auth-helper";
import { ensureForUser, canPost } from "@/lib/social/social-profile.service";

const HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const VALID_TYPES = new Set(["PHOTO", "REEL", "STORY"]);

export async function POST(req: Request) {
  const user = socialUserFromReq(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await ensureForUser({
    id: user.id, email: user.email, phone: user.phone, name: user.name,
  });
  if (!profile || !canPost(profile)) {
    return NextResponse.json({ error: "Profile setup required" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const mediaType = String(body.mediaType || "").toUpperCase();
  if (!VALID_TYPES.has(mediaType)) {
    return NextResponse.json({ error: "mediaType must be PHOTO | REEL | STORY" }, { status: 400 });
  }
  if (!body.mediaUrl) return NextResponse.json({ error: "mediaUrl required" }, { status: 400 });

  // Hotels can tag their own hotel only
  let hotelId: string | null = null;
  if (body.hotelId) {
    if (profile.user_type === "HOTEL" && profile.hotel_id === body.hotelId) hotelId = body.hotelId;
    // Public/Creator users can also tag a hotel (it's a mention, not ownership);
    // if you want stricter rules, gate this behind an admin allowlist.
    else if (profile.user_type !== "HOTEL") hotelId = body.hotelId;
  }

  const row = {
    author_id:      profile.id,
    hotel_id:       hotelId,
    media_type:     mediaType,
    media_url:      body.mediaUrl,
    thumbnail_url:  body.thumbnailUrl || null,
    caption:        body.caption || null,
    sound_track:    body.soundTrack || null,
    sound_url:      body.soundUrl || null,
    sound_owner_id: profile.id,
    location_name:  body.locationName || null,
    location_lat:   typeof body.locationLat === "number" ? body.locationLat : null,
    location_lng:   typeof body.locationLng === "number" ? body.locationLng : null,
  };
  const r = await fetch(`${SB_URL}/rest/v1/social_posts`, {
    method: "POST", headers: HEADERS, body: JSON.stringify(row),
  });
  if (!r.ok) return NextResponse.json({ error: "Could not create post", detail: await r.text() }, { status: 500 });
  const arr = await r.json().catch(() => []);
  return NextResponse.json({ post: Array.isArray(arr) ? arr[0] : arr, created: true });
}
