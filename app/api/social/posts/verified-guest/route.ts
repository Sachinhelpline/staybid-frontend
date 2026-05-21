// POST /api/social/posts/verified-guest
// Verified Guest upload — body must include {bookingId, hotelId, mediaType,
// mediaUrl, ...}. Validates booking ownership + CHECKED_OUT window before
// inserting a social_posts row.
//
// v160 — the booking ID IS the proof. A guest with a confirmed, checked-out
// stay gets DIRECT publish: moderation_status='AUTO_APPROVED' — the post is
// live in the feed instantly, no hotel gate, no admin gate. The hotel is
// notified for awareness only (FYI, no action). Admin can still take a
// published post down later via /admin/content if it's abusive.
// verification_method='booking'. If the user was PUBLIC, promotes them
// to VERIFIED_GUEST.
//
// Auth: any signed-in customer. Existing /api/social/posts is untouched.
import { NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { socialUserFromReq } from "@/lib/social/auth-helper";
import { ensureForUser } from "@/lib/social/social-profile.service";
import { hasEligibleBookingForHotel } from "@/lib/tier/eligibility";
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
  if (!body.hotelId || !body.bookingId) {
    return NextResponse.json(
      { error: "hotelId + bookingId required for Verified Guest path" },
      { status: 400 }
    );
  }

  // Validate that this user actually has the booking they're claiming
  const eligibility = await hasEligibleBookingForHotel(
    user.id,
    user.phone || null,
    body.hotelId,
    body.bookingId
  );
  if (!eligibility.ok) {
    return NextResponse.json(
      {
        error:
          "Booking not eligible — must be CHECKED_OUT for this hotel in the last 90 days",
      },
      { status: 403 }
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

  // Idempotency via client_post_id (same v131.8 chain as /api/social/posts)
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
    booking_id: body.bookingId,
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
    moderation_status: "AUTO_APPROVED",
    verification_method: "booking",
    auto_approved_at: new Date().toISOString(),
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

  // Promote PUBLIC → VERIFIED_GUEST (idempotent; never downgrades)
  const promotion = await maybePromoteToTier(
    profile.id,
    profile.user_type as ContentTier,
    "VERIFIED_GUEST"
  );
  if (promotion.promoted) {
    void queueTierPromotionNudge(user.id, "VERIFIED_GUEST");
  }

  // FYI notification to the hotel partner — a verified guest just published
  // content about their hotel. This is informational only (no approval
  // needed); the hotel sees it in their read-only Guest Content tab.
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
              template: "content_guest_published",
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
