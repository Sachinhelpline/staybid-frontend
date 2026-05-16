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

// Room rows used on listings + flash-deal candidate selection.
//
// HOTFIX v131.4: previous projection included `aiPrice` — that column
// DOES NOT EXIST on the rooms table (only on flash_deals). PostgREST
// 400'd every rooms read since v131, returning [] → /api/flash/near
// synthesized 0 deals → "All deals sold out for tonight" everywhere.
// Real rooms columns per migration: id, hotelId, type, capacity,
// floorPrice, mrp, name, description, amenities, images, bedrooms,
// bathrooms, quantity, isAvailable, createdAt, flashFloorPrice.
//
// Including mrp so detail pages can show strikethrough original prices.
export const ROOM_CARD_COLS =
  "id,hotelId,type,name,capacity,floorPrice,mrp,images,amenities";

// Social posts (Discover reel feed).
//
// HOTFIX v131.3: previous narrow projection used non-existent columns
// (video_url / image_url / poster_url / audio_url / likes_count etc.)
// which made PostgREST 400 the entire query → empty feed, no reels.
// Real columns per migrations/2026-05-10-social-feed.sql: media_url,
// thumbnail_url, sound_*, view_count / like_count / comment_count
// (singular). To stay future-proof against silent column additions,
// this stays as `*`. Bandwidth wins still come from the 15s sbCached
// + 60s CDN window on /api/social/feed.
export const SOCIAL_POST_FEED_COLS = "*";

// Social profile chip on every reel card.
//
// HOTFIX v131.3: previous projection used verification_tier (doesn't
// exist on social_profiles — that's an `influencers` column) +
// followers_count (plural — real column is `follower_count`).
// Renderer reads multiple author fields, so stays `*` to avoid silent
// undefined on a downstream field.
export const SOCIAL_PROFILE_CARD_COLS = "*";

// Influencer card on /reels creator chip + public profile.
// NOTE: influencers table DOES have verification_tier + followers_count
// (plural) — different schema from social_profiles. Verified against
// pre-fix /api/videos/feed which used these exact columns in production.
export const INFLUENCER_CARD_COLS =
  "id,user_id,display_name,avatar_url,verification_tier,followers_count,total_followers";

// Reel feed videos.
//
// HOTFIX v131.3: previous projection used `video_url` + `description`
// — neither exists on hotel_videos. Real video URL column is `s3_url`
// (verified against /api/influencer/public/[id]/route.ts which has been
// in production for months). Reverting to `*` so the renderer doesn't
// silently lose any later-added columns. Bandwidth win still comes from
// the 20s sbCached + 60s CDN window on /api/videos/feed.
export const HOTEL_VIDEO_FEED_COLS = "*";
