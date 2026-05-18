// POST /api/social/posts/community
// Community Contributor upload — body must include {hotelId, locationVerificationId,
// mediaType, mediaUrl, ...}. Consumes an active VERIFIED location_verifications
// row (one OTP = one post). Sets moderation_status='PENDING_HOTEL_APPROVAL'
// and verification_method='location_otp'. Promotes PUBLIC → COMMUNITY_CONTRIBUTOR.
//
// Auth: any signed-in customer.
import { NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { socialUserFromReq } from "@/lib/social/auth-helper";
import { ensureForUser } from "@/lib/social/social-profile.service";
import { maybePromoteToTier, queueTierPromotionNudge } from "@/lib/tier/promote";
import type { ContentTier } from "@/lib/tier/types";

const HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const VALID_TYPES = new Set(["PHOTO", "REEL", "STORY"]);

export async function POST(req: Request) {
  const user = socialUserFromReq(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const mediaType = String(body.mediaType || "").toUpperCase();
  if (!VALID_TYPES.has(mediaType)) {
    return NextResponse.json(
      { error: "mediaType must be PHOTO | REEL | STORY" },
      { status: 400 }
    );
  }
  if (!body.mediaUrl) {
    return NextResponse.json({ error: "mediaUrl required" }, { status: 400 });
  }
  if (!body.hotelId || !body.locationVerificationId) {
    return NextResponse.json(
      {
        error:
          "hotelId + locationVerificationId required for Community Contributor path",
      },
      { status: 400 }
    );
  }

  // Validate the locationVerification: must belong to this user, this hotel,
  // be VERIFIED, not expired, and not already consumed.
  const now = new Date().toISOString();
  const lvRes = await fetch(
    `${SB_URL}/rest/v1/location_verifications` +
      `?id=eq.${encodeURIComponent(body.locationVerificationId)}` +
      `&user_id=eq.${encodeURIComponent(user.id)}` +
      `&hotel_id=eq.${encodeURIComponent(body.hotelId)}` +
      `&status=eq.VERIFIED` +
      `&expires_at=gt.${encodeURIComponent(now)}` +
      `&select=id,used_for_post_id&limit=1`,
    {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      cache: "no-store",
    }
  );
  const lvs = (lvRes.ok ? await lvRes.json().catch(() => []) : []) as any[];
  if (!lvs[0]) {
    return NextResponse.json(
      {
        error:
          "Location verification not found, expired, or doesn't belong to this hotel",
      },
      { status: 403 }
    );
  }
  if (lvs[0].used_for_post_id) {
    return NextResponse.json(
      {
        error:
          "This location verification has already been consumed by another post",
      },
      { status: 409 }
    );
  }

  const profile = await ensureForUser({
    id: user.id,
    email: user.email,
    phone: user.phone,
    name: user.name,
  });
  if (!profile) {
    return NextResponse.json(
      { error: "Profile setup required" },
      { status: 400 }
    );
  }

  // Idempotency via client_post_id
  const clientPostId: string | null =
    typeof body.clientPostId === "string" && body.clientPostId.trim()
      ? body.clientPostId.trim().slice(0, 64)
      : null;

  if (clientPostId) {
    const dedupRes = await fetch(
      `${SB_URL}/rest/v1/social_posts?author_id=eq.${encodeURIComponent(profile.id)}&client_post_id=eq.${encodeURIComponent(clientPostId)}&select=*&limit=1`,
      {
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
        cache: "no-store",
      }
    );
    if (dedupRes.ok) {
      const existing = await dedupRes.json().catch(() => []);
      if (Array.isArray(existing) && existing[0]) {
        return NextResponse.json({
          post: existing[0],
          created: false,
          deduped: true,
        });
      }
    }
  }

  const row: Record<string, any> = {
    author_id: profile.id,
    hotel_id: body.hotelId,
    media_type: mediaType,
    media_url: body.mediaUrl,
    thumbnail_url: body.thumbnailUrl || null,
    caption: body.caption || null,
    sound_track: body.soundTrack || null,
    sound_url: body.soundUrl || null,
    sound_owner_id: profile.id,
    location_name: body.locationName || null,
    location_lat: typeof body.locationLat === "number" ? body.locationLat : null,
    location_lng: typeof body.locationLng === "number" ? body.locationLng : null,
    moderation_status: "PENDING_HOTEL_APPROVAL",
    verification_method: "location_otp",
  };
  if (clientPostId) row.client_post_id = clientPostId;
  if (typeof body.highlightKey === "string" && body.highlightKey.trim()) {
    row.highlight_key = body.highlightKey.trim().slice(0, 64);
  }
  if (
    typeof body.filter === "string" &&
    body.filter.trim() &&
    body.filter !== "none"
  ) {
    row.filter = body.filter.trim().slice(0, 32);
  }

  const r = await fetch(`${SB_URL}/rest/v1/social_posts`, {
    method: "POST",
    headers: {
      ...HEADERS,
      ...(clientPostId
        ? {
            Prefer: "return=representation,resolution=ignore-duplicates",
          }
        : {}),
    },
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    return NextResponse.json(
      { error: "Could not create post", detail: await r.text() },
      { status: 500 }
    );
  }
  const arr = await r.json().catch(() => []);
  let post = Array.isArray(arr) ? arr[0] : arr;

  if (!post && clientPostId) {
    const refetch = await fetch(
      `${SB_URL}/rest/v1/social_posts?author_id=eq.${encodeURIComponent(profile.id)}&client_post_id=eq.${encodeURIComponent(clientPostId)}&select=*&limit=1`,
      {
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
        cache: "no-store",
      }
    );
    if (refetch.ok) {
      const rows = await refetch.json().catch(() => []);
      if (Array.isArray(rows) && rows[0]) post = rows[0];
    }
  }

  // Consume the location verification (one OTP = one post)
  if (post?.id) {
    void fetch(
      `${SB_URL}/rest/v1/location_verifications?id=eq.${encodeURIComponent(body.locationVerificationId)}`,
      {
        method: "PATCH",
        headers: HEADERS,
        body: JSON.stringify({
          status: "CONSUMED",
          used_for_post_id: post.id,
        }),
      }
    );
  }

  // Promote PUBLIC → COMMUNITY_CONTRIBUTOR
  const promotion = await maybePromoteToTier(
    profile.id,
    profile.user_type as ContentTier,
    "COMMUNITY_CONTRIBUTOR"
  );
  if (promotion.promoted) {
    void queueTierPromotionNudge(user.id, "COMMUNITY_CONTRIBUTOR");
  }

  // Notify the hotel partner
  try {
    const hr = await fetch(
      `${SB_URL}/rest/v1/hotels?id=eq.${encodeURIComponent(body.hotelId)}&select=ownerId,name`,
      {
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
        cache: "no-store",
      }
    );
    if (hr.ok) {
      const hotels = (await hr.json().catch(() => [])) as any[];
      const ownerId = hotels[0]?.ownerId || null;
      const hotelName = hotels[0]?.name || "Your hotel";
      if (ownerId) {
        void fetch(`${SB_URL}/rest/v1/notification_queue`, {
          method: "POST",
          headers: HEADERS,
          body: JSON.stringify([
            {
              user_id: ownerId,
              channel: "in_app",
              template: "content_pending_approval",
              payload: { post_id: post?.id, hotel_name: hotelName },
              status: "pending",
            },
          ]),
        });
      }
    }
  } catch {}

  return NextResponse.json({
    post,
    created: !!post,
    tier_promoted: promotion.promoted,
    new_tier: promotion.to,
  });
}
