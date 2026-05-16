// ────────────────────────────────────────────────────────────────────────────
// Named column projections for Supabase REST queries.
//
// Why: every `select=*` on a hot route ships every column to the browser —
// including JSONB blobs (images, amenities, metadata), long-text fields
// (description, address), and admin-only fields that the UI never reads.
// Across the ~100k daily API calls these unused columns add up to GB of
// egress per day.
//
// How: import the matching projection and interpolate it into the query
// string. Single source of truth means one place to edit when a new column
// joins the public payload.
//
// Rule of thumb: include the smallest set of columns the consumer surface
// actually reads. Detail pages can use _DETAIL_COLS; cards use _CARD_COLS.
// ────────────────────────────────────────────────────────────────────────────

// Used on listing surfaces (/hotels, /flash-deals rail, search), Discover
// feed enrichment. Excludes description / address / reviewsCount which only
// the hotel-detail page needs.
export const HOTEL_CARD_COLS =
  "id,name,city,state,lat,lng,starRating,avgRating,images,amenities,trustBadge,createdAt,ownerId";

// Hotel-detail page (full page above the fold). Includes description fields.
export const HOTEL_DETAIL_COLS =
  HOTEL_CARD_COLS + ",description,address,reviewsCount";

// Room rows used on listings + flash-deal candidate selection. Excludes
// the heavy `description` text and admin-only knobs.
export const ROOM_CARD_COLS =
  "id,hotelId,type,capacity,floorPrice,aiPrice,images,amenities";

// Social posts (Discover reel feed).
//
// HOTFIX v131.3: previous narrow projection used non-existent columns
// (video_url / image_url / poster_url / audio_url / likes_count etc.)
// which made PostgREST 400 the entire query → empty feed, no reels.
// Real columns per migrations/2026-05-10-social-feed.sql + later
// filter / highlight_key migrations: media_url, thumbnail_url, sound_*,
// view_count / like_count / comment_count (singular).
//
// To stay future-proof against silent column additions (sound_owner_id,
// location_lat/lng, additional filter knobs, anti-bypass flags), this
// stays as `*`. The bandwidth win on social_posts comes from the route's
// existing 15s sbCached + 60s CDN window, not the projection.
export const SOCIAL_POST_FEED_COLS = "*";

// Social profile chip on every reel card.
//
// HOTFIX v131.3: previous projection used verification_tier (doesn't
// exist on social_profiles) + followers_count (plural — real column is
// follower_count). The InstagramHotelFeed renderer reads multiple author
// fields, so to avoid silent undefined on a downstream field, this stays
// as `*`. Cache + CDN windows still cover the bandwidth case.
export const SOCIAL_PROFILE_CARD_COLS = "*";

// Influencer card on /reels creator chip + public profile.
// NOTE: influencers table DOES have verification_tier + followers_count
// (plural) — different schema from social_profiles. Verified against
// pre-fix /api/videos/feed. Safe to keep narrow.
export const INFLUENCER_CARD_COLS =
  "id,user_id,display_name,avatar_url,verification_tier,followers_count,total_followers";

// Reel feed videos.
//
// HOTFIX v131.3: previous projection used `video_url` and `description`
// — neither exists on hotel_videos. Real video URL column is `s3_url`
// (verified against /api/influencer/public/[id]/route.ts which has been
// in production for months). Reverting to `*` so any other columns the
// renderer needs (e.g. uploader_type, caption, filter knobs added later)
// don't silently disappear. Bandwidth win still comes from the 20s
// sbCached + 60s CDN window on /api/videos/feed.
export const HOTEL_VIDEO_FEED_COLS = "*";
