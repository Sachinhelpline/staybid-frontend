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

// Social posts (Discover reel feed). Includes only fields the renderer
// actually consumes — drops internal moderation columns, retry counts, etc.
export const SOCIAL_POST_FEED_COLS =
  "id,author_id,hotel_id,media_type,video_url,image_url,poster_url,audio_url,caption,filter_preset,location_name,tagged_users,is_active,created_at,likes_count,comments_count,views_count";

// Social profile chip on every reel card.
export const SOCIAL_PROFILE_CARD_COLS =
  "id,user_id,username,display_name,avatar_url,user_type,verification_tier,followers_count,bio";

// Influencer card on /reels creator chip + public profile.
export const INFLUENCER_CARD_COLS =
  "id,user_id,display_name,avatar_url,verification_tier,followers_count,total_followers";

// Reel feed videos.
export const HOTEL_VIDEO_FEED_COLS =
  "id,hotel_id,uploaded_by,title,description,video_url,thumbnail_url,duration_seconds,verification_status,created_at,likes_count,comments_count,views_count";
