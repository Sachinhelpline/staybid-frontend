# Supabase Bandwidth Optimization Plan — Copy-Paste Ready

Companion to `SUPABASE_BANDWIDTH_AUDIT.md`. Every fix below is concrete: file path, before/after, expected savings, risk note. Items marked **✅ Shipped** are in this PR. Items marked **🔮 Follow-up** are queued for a second pass.

---

## ✅ Step 0 — Shared column projections

New file: `lib/sb-columns.ts`

Single source of truth for which columns each table exposes to API responses. Prevents future `select=*` drift.

```ts
// lib/sb-columns.ts
// Named column projections for Supabase REST queries.
// Use these instead of `select=*` to keep API response sizes predictable.

export const HOTEL_CARD_COLS =
  "id,name,city,state,lat,lng,starRating,avgRating,images,amenities,trustBadge,createdAt,ownerId";

export const HOTEL_DETAIL_COLS = HOTEL_CARD_COLS + ",description,address,reviewsCount";

export const ROOM_CARD_COLS =
  "id,hotelId,type,capacity,floorPrice,aiPrice,images,amenities";

export const SOCIAL_POST_FEED_COLS =
  "id,author_id,hotel_id,media_type,video_url,image_url,poster_url,audio_url,caption,filter_preset,location_name,tagged_users,is_active,created_at,likes_count,comments_count,views_count";

export const SOCIAL_PROFILE_CARD_COLS =
  "id,user_id,username,display_name,avatar_url,user_type,verification_tier,followers_count,bio";

export const HOTEL_VIDEO_FEED_COLS =
  "id,hotel_id,uploaded_by,title,description,video_url,thumbnail_url,duration_seconds,verification_status,created_at,likes_count,comments_count,views_count";

export const INFLUENCER_CARD_COLS =
  "id,user_id,display_name,avatar_url,verification_tier,followers_count,total_followers";
```

---

## ✅ Step 1 — `app/api/flash/near/route.ts`

**Hot path:** every visit to `/` (Flash Deals story rail) AND `/flash-deals`.

### Before (line 56-59)
```ts
const [hotels, rooms] = await Promise.all([
  sbCachedFetch(`hotels?select=*`, TTL_CATALOG),
  sbCachedFetch(`rooms?select=*`, TTL_CATALOG),
]);
```

### After
```ts
import { HOTEL_CARD_COLS, ROOM_CARD_COLS } from "@/lib/sb-columns";
// ...
const [hotels, rooms] = await Promise.all([
  sbCachedFetch(`hotels?select=${HOTEL_CARD_COLS}`, TTL_CATALOG),
  sbCachedFetch(`rooms?select=${ROOM_CARD_COLS}`, TTL_CATALOG),
]);
```

**Estimated saving:** ~80% reduction in hotels payload (drops `description`, `address`, internal fields). ~75% on rooms.

**Risk:** Low. Downstream readers in the same file only consult `id, hotelId, type, floorPrice, images, amenities` on rooms and `id, name, city, images, amenities, starRating` on hotels — all preserved.

---

## ✅ Step 2 — `app/api/hotels/route.ts`

**Hot path:** `/hotels` listing page.

### Before (line 23, 34-38)
```ts
const qs = new URLSearchParams({ select: "*", limit: "100" });
// ...
sbCached<any[]>(`hotels:rooms-all`, async () => {
  const r = await fetch(`${SB_URL}/rest/v1/rooms?select=*&limit=500`, ...);
  // ...
})
```

### After
```ts
import { HOTEL_CARD_COLS, ROOM_CARD_COLS } from "@/lib/sb-columns";
// ...
const qs = new URLSearchParams({ select: HOTEL_CARD_COLS, limit: "100" });
// ...
// Scope rooms to ONLY the hotels we're returning — was pulling 500 rooms
// regardless of which hotels were filtered.
const hotelIdList = hotels.map((h: any) => h.id).filter(Boolean);
const rooms = hotelIdList.length === 0
  ? []
  : await sbCached<any[]>(`hotels:rooms:${hotelIdList.slice().sort().join(",")}`, async () => {
      const idIn = hotelIdList.map((id: string) => `"${id}"`).join(",");
      const r = await fetch(
        `${SB_URL}/rest/v1/rooms?hotelId=in.(${idIn})&select=${ROOM_CARD_COLS}&limit=500`,
        { headers: SB_H, cache: "no-store" }
      );
      const t = await r.text();
      try { const j = JSON.parse(t); return Array.isArray(j) ? j : []; } catch { return []; }
    }, TTL_CATALOG);
```

**Estimated saving:** When filtering to Mussoorie (5 hotels, 12 rooms), drops from 500 rooms in response to 12. ~95% on rooms when city filter is active. ~70% on hotels payload size.

**Risk:** Low. Tradeoff: more cache keys (one per hotel-id set), but per-key hit rate stays high because the underlying filter inputs are stable per city.

---

## ✅ Step 3 — `app/api/videos/feed/route.ts`

**Hot path:** Reels feed (every Discover scroll past pre-loaded window).

### Before (no caching, select=*)
```ts
let url = `${SB_URL}/rest/v1/hotel_videos?verification_status=eq.approved&order=created_at.desc&limit=${limit}&offset=${offset}&select=*${uploaderFilter}`;
const res = await fetch(url, { headers: SB_READ });
// ... 2 more uncached enrichment fetches
```

### After
```ts
import { sbCached } from "@/lib/sb-cache";
import { HOTEL_VIDEO_FEED_COLS, HOTEL_CARD_COLS, INFLUENCER_CARD_COLS } from "@/lib/sb-columns";

const TTL_FEED = 20_000;
const TTL_LOOKUP = 60_000;

// ...

let url = `${SB_URL}/rest/v1/hotel_videos?verification_status=eq.approved&order=created_at.desc&limit=${limit}&offset=${offset}&select=${HOTEL_VIDEO_FEED_COLS}${uploaderFilter}`;
const videos = await sbCached(
  `videos:feed:${url}`,
  async () => {
    const r = await fetch(url, { headers: SB_READ });
    if (!r.ok) return [];
    return r.json().catch(() => []);
  },
  TTL_FEED
);
// ... (similar wrapping on hotel + influencer enrichment with HOTEL_CARD_COLS + INFLUENCER_CARD_COLS)
```

**Estimated saving:** Warm-Lambda hits drop to ~0 Supabase round-trips. Cold-start cost stays the same but payload is ~60% smaller per fetch.

**Risk:** Low. 20s TTL means newly-uploaded videos appear within a feed-refresh, which matches user expectations on a swipe feed.

---

## ✅ Step 4 — `app/api/social/feed/route.ts`

**Hot path:** `/discover` reel feed (parallel with `/api/discover/feed`).

### Before (lines 72, 105, 130)
```ts
let filter = `select=*&is_active=eq.true&order=created_at.desc&limit=${limit}`;
// ...
`${SB_URL}/rest/v1/social_profiles?id=in.(...)&select=*`
// ...
`${SB_URL}/rest/v1/hotels?id=in.(...)&select=*`
```

### After
```ts
import { SOCIAL_POST_FEED_COLS, SOCIAL_PROFILE_CARD_COLS, HOTEL_CARD_COLS } from "@/lib/sb-columns";
// ...
let filter = `select=${SOCIAL_POST_FEED_COLS}&is_active=eq.true&order=created_at.desc&limit=${limit}`;
// ...
`${SB_URL}/rest/v1/social_profiles?id=in.(...)&select=${SOCIAL_PROFILE_CARD_COLS}`
// ...
`${SB_URL}/rest/v1/hotels?id=in.(...)&select=${HOTEL_CARD_COLS}`
```

**Estimated saving:** ~50-65% on the social feed response when posts include long captions / metadata. Profile and hotel enrichment payloads cut by ~60%.

**Risk:** Low. The renderer in `PostsScrollFeed.tsx` only reads the named columns.

---

## ✅ Step 5 — `app/api/discover/feed/route.ts`

**Hot path:** Discover page hotel ranking.

### Before (lines 99-103)
```ts
sbCached("discover:bids", () =>
  fetch(`${SB_URL}/rest/v1/bids?select=hotelId`, { headers: SB_H, cache: "no-store" }).then(r => r.json()).catch(() => []),
  TTL_POPULAR),
sbCached("discover:bookings", () =>
  fetch(`${SB_URL}/rest/v1/bookings?select=hotelId`, { headers: SB_H, cache: "no-store" }).then(r => r.json()).catch(() => []),
  TTL_POPULAR),
```

### After
```ts
// Cap the popularity-source fetches at 2000 rows + 90-day window.
// We only need a *signal* of activity, not a complete tally.
sbCached("discover:bids", () => {
  const since = new Date(Date.now() - 90 * 86400_000).toISOString();
  return fetch(
    `${SB_URL}/rest/v1/bids?select=hotelId&createdAt=gte.${since}&limit=2000`,
    { headers: SB_H, cache: "no-store" }
  ).then(r => r.json()).catch(() => []);
}, TTL_POPULAR),
sbCached("discover:bookings", () => {
  const since = new Date(Date.now() - 90 * 86400_000).toISOString();
  return fetch(
    `${SB_URL}/rest/v1/bookings?select=hotelId&createdAt=gte.${since}&limit=2000`,
    { headers: SB_H, cache: "no-store" }
  ).then(r => r.json()).catch(() => []);
}, TTL_POPULAR),
```

**Estimated saving:** Bids/bookings tables grow over time; this caps the per-request scan to recent activity which is also what "popularity" should mean. ~70% reduction once the tables have ≥3 months of history. Today: marginal — but ships now to keep it bounded as the platform grows.

**Risk:** Low — the bid/booking columns used for ranking are intact.

🔮 **Follow-up (proper fix):** add a `hotel_popularity_30d` materialized view refreshed nightly. Then `discover/feed` reads ONE row per hotel instead of N bids/bookings.

---

## ✅ Step 6 — `app/api/videos/[hotelId]/route.ts`

### Before (line 13)
```ts
`${SB_URL}/rest/v1/hotel_videos?hotel_id=eq.${...}${filter}&select=*&order=created_at.desc&limit=100`
```

### After
```ts
import { HOTEL_VIDEO_FEED_COLS } from "@/lib/sb-columns";
// ...
`${SB_URL}/rest/v1/hotel_videos?hotel_id=eq.${...}${filter}&select=${HOTEL_VIDEO_FEED_COLS}&order=created_at.desc&limit=100`
```

**Estimated saving:** ~60% per video row.

---

## ✅ Step 7 — `app/api/social/profiles/[username]/route.ts`

### Before (line 35)
```ts
`${SB_URL}/rest/v1/hotels?id=eq.${...}&select=*&limit=1`
```

### After
```ts
import { HOTEL_CARD_COLS } from "@/lib/sb-columns";
// ...
`${SB_URL}/rest/v1/hotels?id=eq.${...}&select=${HOTEL_CARD_COLS}&limit=1`
```

---

## ✅ Step 8 — `app/api/hashtags/[name]/route.ts`

### Before (line 10)
```ts
`${SB_URL}/rest/v1/hotel_videos?...&limit=60&select=*`
```

### After
```ts
`${SB_URL}/rest/v1/hotel_videos?...&limit=60&select=${HOTEL_VIDEO_FEED_COLS}`
```

---

## 🔮 Follow-up Wave 2 — beyond this PR

### A. Image transformations on Supabase Storage
Switch every `<img src={hotelImage}>` in `/hotels` cards and Discover rail to:
```
${SB_URL}/storage/v1/render/image/public/hotel-images/${path}?width=400&quality=70&format=webp
```
**Impact:** ~80% reduction in image-byte egress for listing surfaces. Largest single bandwidth lever remaining.

### B. CDN-level caching on hot listing routes
Change `Cache-Control` on `/api/hotels` and `/api/flash/near` from `public, max-age=10` to `public, s-maxage=60, stale-while-revalidate=300`. Vercel's CDN absorbs ~90% of repeat traffic at the same freshness.

### C. Materialized popularity views
- `hotel_popularity_30d` — refreshed nightly via Vercel cron.
- `hotel_bid_counts` per-hotel running tally written by the bid lifecycle.

### D. Move `hotel.images` JSONB out
- New `hotel_images` table with `is_primary`, `position`, `kind` (hero/gallery/room).
- Card surfaces fetch primary only; detail page fetches full set on-demand.

### E. Eliminate redundant `sb_token` round-trips
The `/api/auth/social-login` path is missing — Firebase users go through inline verification on every booking action (CLAUDE.md "Pending issues"). Once that backend endpoint is added, the v44 tokenType system stops re-issuing tokens.

---

## Implementation Checklist (this PR)

- [x] Create `lib/sb-columns.ts` with named projections
- [x] Patch `app/api/flash/near/route.ts` — narrow hotels + rooms selects
- [x] Patch `app/api/hotels/route.ts` — narrow hotels + scope rooms by hotelId
- [x] Patch `app/api/videos/feed/route.ts` — sbCached wrap + narrow selects
- [x] Patch `app/api/social/feed/route.ts` — narrow posts/profiles/hotels selects
- [x] Patch `app/api/discover/feed/route.ts` — cap bids/bookings to 90 days + 2000 rows
- [x] Patch `app/api/videos/[hotelId]/route.ts` — narrow select
- [x] Patch `app/api/social/profiles/[username]/route.ts` — narrow hotel select
- [x] Patch `app/api/hashtags/[name]/route.ts` — narrow video select
- [x] Verify `tsc --noEmit` clean
- [x] Push branch
- [ ] Vercel preview deploy verified (manual)
- [ ] Vercel dashboard egress chart watched over 24-48h to confirm reduction (manual)

## What to verify post-deploy

1. **`/` (Discover home)** — flash deals story rail renders correctly, all 18 avatars + countdowns intact.
2. **`/hotels`** — list page renders all hotel cards with hero image + rooms tab works on each.
3. **`/hotels/[id]`** — detail page renders rooms + reviews + bid flow unchanged.
4. **`/discover` reel feed** — posts render with author chip + hotel pill + audio + caption.
5. **`/reels` (creator videos)** — videos play + creator card + hotel pill render.
6. **`/me/posts`** — user's own posts render with all metadata.
7. **`/influencer/[id]`** — public creator profile shows correct posts.
8. **Vercel Function logs** — no `unexpected null` / `cannot read property` from missing columns in any feed route over a 24h window.
