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

  // v111 — bulletproof idempotency. Composer sends `clientPostId` once
  // per post() invocation; we de-dup at the DB by (author_id,
  // client_post_id). 1..N rapid POSTs return the same row, fixing the
  // recurring triple-upload bug for good. Fall back to a regular insert
  // when clientPostId is missing (legacy callers).
  //
  // ⚠️ v131.8 LOAD-BEARING — the entire reel dedup chain (this insert +
  // socialPostToItem._clientPostId forwarding in app/discover/page.tsx +
  // InstagramHotelFeed exact-match dedup) depends on this round-trip.
  // DO NOT remove client_post_id support without first auditing all 3
  // surfaces or duplicate reels reappear on home/discover/reels.
  const clientPostId: string | null =
    typeof body.clientPostId === "string" && body.clientPostId.trim()
      ? body.clientPostId.trim().slice(0, 64)
      : null;

  if (clientPostId) {
    // Fast path: return existing row if we've seen this client id before.
    const dedupRes = await fetch(
      `${SB_URL}/rest/v1/social_posts?author_id=eq.${encodeURIComponent(profile.id)}&client_post_id=eq.${encodeURIComponent(clientPostId)}&select=*&limit=1`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, cache: "no-store" }
    );
    if (dedupRes.ok) {
      const existing = await dedupRes.json().catch(() => []);
      if (Array.isArray(existing) && existing[0]) {
        return NextResponse.json({ post: existing[0], created: false, deduped: true });
      }
    }
  }

  const row: Record<string, any> = {
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
  if (clientPostId) row.client_post_id = clientPostId;
  // v112.1 — persist the highlight bucket the user tagged the post with
  // at upload time. /me reads social_posts.highlight_key to filter the
  // grid when the user taps a highlight ring.
  if (typeof body.highlightKey === "string" && body.highlightKey.trim()) {
    row.highlight_key = body.highlightKey.trim().slice(0, 64);
  }
  // v114 — persist chosen IG-style filter preset id ("warm" / "noir" / etc).
  // The feed re-applies the same CSS filter on the rendered <video> /
  // <img> via filterCssFor(). Stored on the dedicated `filter` column
  // (added via migrations/2026-05-14-social-posts-filter.sql).
  if (typeof body.filter === "string" && body.filter.trim() && body.filter !== "none") {
    row.filter = body.filter.trim().slice(0, 32);
  }

  const r = await fetch(`${SB_URL}/rest/v1/social_posts`, {
    method: "POST",
    headers: {
      ...HEADERS,
      // Honour the unique (author_id, client_post_id) index — if a race
      // with the dedup SELECT above lost, fall back to ignore + re-fetch.
      ...(clientPostId ? { Prefer: "return=representation,resolution=ignore-duplicates" } : {}),
    },
    body: JSON.stringify(row),
  });
  if (!r.ok) return NextResponse.json({ error: "Could not create post", detail: await r.text() }, { status: 500 });
  const arr = await r.json().catch(() => []);
  let post = Array.isArray(arr) ? arr[0] : arr;

  // If the insert was ignored (race-lost), re-fetch by clientPostId.
  if (!post && clientPostId) {
    const refetch = await fetch(
      `${SB_URL}/rest/v1/social_posts?author_id=eq.${encodeURIComponent(profile.id)}&client_post_id=eq.${encodeURIComponent(clientPostId)}&select=*&limit=1`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, cache: "no-store" }
    );
    if (refetch.ok) {
      const rows = await refetch.json().catch(() => []);
      if (Array.isArray(rows) && rows[0]) post = rows[0];
    }
  }
  return NextResponse.json({ post, created: !!post });
}
