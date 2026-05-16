# Supabase Bandwidth Audit — StayBid Frontend

**Repo:** `Sachinhelpline/staybid-frontend` · branch `claude/analyze-supabase-bandwidth-9NiKG`
**Auditor:** Claude (Opus 4.7 1M)
**Date:** 2026-05-16
**Trigger:** ~8.6 GB Supabase egress observed on May 12 — find the cause, quantify the waste, ship fixes.

> Note on the requested branch name: the task body asks for `optimize/supabase-bandwidth-reduction`, but the binding workflow rules in this session pin all development to `claude/analyze-supabase-bandwidth-9NiKG`. All fixes ship on that branch. Re-aliasing to a different name is a one-line follow-up (`git branch -m`) if you prefer.

---

## 1. Architecture Assessment

**Verdict: Server-side direct Supabase via Next.js API routes. Good — keep it.**

- 195 `route.ts` files under `app/api/`. All Supabase access goes through `fetch(`${SB_URL}/rest/v1/...`)` using header constants in `lib/sb.ts` + `lib/sb-server.ts`.
- **No browser-side `supabase-js` client** is ever instantiated for queries — verified by reading `lib/supabase.ts` (only exports an image-upload helper).
- `lib/sb-cache.ts` (v93 era) provides an in-memory `sbCached(key, fetcher, ttlMs)` wrapper with in-flight de-dup. Good infrastructure — but unevenly applied (videos/feed has NONE, social/feed has it, hotels/route has it, etc.).
- The anon JWT key is exposed in `lib/sb.ts` as a constant. Acceptable because RLS protects sensitive tables, but worth knowing — anyone reading the bundle has the same key your routes use.

**No move to a Railway-proxy needed.** The fix is to discipline the queries already going to Supabase, not introduce another hop.

---

## 2. The May 12 Spike — Root Cause Hypothesis

Cross-referencing CLAUDE.md eras vs git log:

| Date | Era | Risk introduced |
|---|---|---|
| Phase A (v14) | Reels feed launched | `/api/videos/feed` with `select=*` and NO cache |
| v53 | Flash Deals premium UI | `/api/flash/near` fetches `hotels?select=*` + `rooms?select=*` on every page open |
| v93 | Instagram-Fast perf pass | Added `sbCached` to *some* routes but **missed `/api/videos/feed`** |
| v120 | IG composer rebuild | Raised upload cap 50 → 250 MB, auto-trim — uploads got bigger |
| v122 | Density 2x pass | More content per screen → more list-page fetches per session |

**The single biggest culprit: `hotels?select=*` on hot routes.**

The `hotels` table includes an `images` JSONB column. Every hotel has 5+ public-storage URLs in there (plus admin extras, descriptions, addresses). When `flash/near` and `/api/hotels` both pull `hotels?select=*` on EVERY page open, you're shipping the entire image catalog metadata as JSON in the API response — and then the browser also downloads every image (Supabase Storage egress on top).

Compounding factors that aligned on May 12:
- The `flash/near` route runs on **every visit to `/`** (Flash Deals story rail at the top of Discover).
- `Cache-Control: public, max-age=10` — at 10s edge cache + variable city param, real-world hit rate is low.
- `sbCached` TTL is 60s per Lambda, but Lambda instances spin up/down. Multi-region Vercel = multiple Lambdas warming separately.

**Estimated waste from `hotels?select=*` alone, assuming ~30 KB per hotel row (description + amenities + images JSONB) × 100 hotels × 100k page opens per day = ~300 GB/month of pure API-payload waste.** Trimmable to ~10% of that.

---

## 3. High-Risk Query Inventory

### 🚨 Critical — fix first

| # | Route | Line | Query | Problem | Cached? |
|---|---|---|---|---|---|
| 1 | `app/api/flash/near/route.ts` | 57 | `hotels?select=*` | Pulls every hotel column (description, address, images JSONB) on every Discover open | 60s |
| 2 | `app/api/flash/near/route.ts` | 58 | `rooms?select=*` | Same: every room column for every hotel | 60s |
| 3 | `app/api/hotels/route.ts` | 23 | `hotels?select=*&limit=100` | Up to 100 hotels × all columns. Powers `/hotels` listing. | 60s |
| 4 | `app/api/hotels/route.ts` | 35 | `rooms?select=*&limit=500` | 500 rooms PER REQUEST regardless of which hotels were filtered. The 500-room cap is hit easily. | 60s |
| 5 | `app/api/videos/feed/route.ts` | 37 | `hotel_videos?select=*` | Reels feed. No caching. Returns full row (titles, raw metadata, etc.) for each video. | ❌ NONE |
| 6 | `app/api/videos/feed/route.ts` | 63 | `hotels?id=in.(...)&select=...` | Multi-hotel enrichment, no cache. | ❌ NONE |
| 7 | `app/api/videos/feed/route.ts` | 74 | `influencers?user_id=in.(...)` | Creator enrichment, no cache. | ❌ NONE |
| 8 | `app/api/social/feed/route.ts` | 72 | `social_posts?select=*` | Reel feed for `/discover`. `select=*` includes video_url, image_url, audio_url, caption, metadata JSONB. | 15s |
| 9 | `app/api/social/feed/route.ts` | 105 | `social_profiles?id=in.(...)&select=*` | Author enrichment. Includes bio, all profile fields. | 60s |
| 10 | `app/api/social/feed/route.ts` | 130 | `hotels?id=in.(...)&select=*` | Hotel enrichment for tagged-hotel pills. Returns full hotel rows when only `id,name,city,images[0]` are needed. | 60s |

### ⚠️ Medium — fix next

| Route | Line | Issue |
|---|---|---|
| `app/api/discover/feed/route.ts` | 99-103 | `bids?select=hotelId` + `bookings?select=hotelId` unbounded (PostgREST caps at 1000 rows). For popularity counting, a HEAD request with `Prefer: count=exact` is cheaper. |
| `app/api/discover/feed/route.ts` | 93-94 | hotels select already enumerated but still includes `images` JSONB. |
| `app/api/videos/[hotelId]/route.ts` | 13 | `hotel_videos?select=*&limit=100` per-hotel page. |
| `app/api/social/profiles/[username]/route.ts` | 35 | `hotels?select=*` for profile's tagged hotel. |
| `app/api/hashtags/[name]/route.ts` | 10 | `hotel_videos?select=*&limit=60` per hashtag landing. |
| `app/api/attribution/record/route.ts` | 296 | `bid_attributions?select=*&limit=500` for partner panel — bulk fetch. |

### Low — admin routes (low traffic, acceptable)

All `app/api/admin/**` `select=*` queries hit admin-only surfaces with single-digit concurrent users. Tolerable until they become hot.

---

## 4. Storage Egress Vectors

### 4.1 Reel video downloads (likely the OTHER huge slice of the 8.6 GB)

`components/discover/InstagramHotelFeed.tsx` mounts every visible reel card with a `<video>` element. Good news:
- v107 already implements network-tier-aware preload: `preload="metadata"` on adjacent cards, `preload="none"` on saveData / slow-2G (lines 1600-1603, 1870).
- v93 ships card windowing — only ±4 around `activeIdx` mounts a real `<HotelCard>`, the rest are skeletons.

**Risk that remains:** `app/saved/posts/page.tsx` and similar one-shot pages mount `<video preload="auto">` (line 2511) for the active card. One auto-play of a 5 MB clip = 5 MB egress every time a user opens that view. Across 1000 saved views/day that's 5 GB/day.

### 4.2 Hotel images on `/hotels` listing

Every hotel card renders the first image from `hotel.images` (Supabase Storage public URL). 100 hotels × ~200 KB hero image × 5000 listing opens/day = 100 GB/day in the worst case — **if** images are uncached.

Mitigation already in place: SW has SWR on images (v57). Real waste only on cold browsers. But this still dwarfs API-payload egress.

### 4.3 The `flash_deals` rail on `/`

`useFlashDealStories(city)` calls `/api/flash/near` on every Discover open. Each response now includes full hotel rows. The rail then renders 18 avatar circles, but the response carries data for far more.

---

## 5. Quick-Win Optimizations Ranked by Bandwidth Saved per Line Changed

| Rank | Fix | File:Line | Est. bandwidth saved | Risk |
|---|---|---|---|---|
| 1 | Narrow `hotels?select=*` to 9 needed columns in `flash/near` | `app/api/flash/near/route.ts:57` | ~20 KB → ~2 KB per hotel × 100 hotels × every request = **~1.8 MB/request × all daily traffic** | Low (verify downstream readers) |
| 2 | Narrow `rooms?select=*` similarly in `flash/near` | `app/api/flash/near/route.ts:58` | ~5 KB → ~0.5 KB per room × 300 rooms = **~1.3 MB/request** | Low |
| 3 | Wrap `/api/videos/feed` 3 fetches in `sbCached` | `app/api/videos/feed/route.ts:41-78` | 3 Supabase round-trips → ~0 for warm Lambda (instagram-fast) | Low |
| 4 | Narrow `hotel_videos?select=*` in `videos/feed` | `app/api/videos/feed/route.ts:37` | Drop unused columns (raw metadata, retry counts) | Low |
| 5 | Narrow `social_posts?select=*` in `social/feed` | `app/api/social/feed/route.ts:72` | Drop internal/admin columns from the public payload | Low |
| 6 | Narrow `hotels`/`rooms`/`social_profiles` enrichment selects in `social/feed` | `app/api/social/feed/route.ts:105,130` | Smaller per-card chrome | Low |
| 7 | Narrow `hotels?select=*` + scope rooms to filtered hotelIds in `/api/hotels` | `app/api/hotels/route.ts:23,35` | 500 rooms → only the rooms whose hotelId is in the result | Low |
| 8 | Replace `bids?select=hotelId` unbounded with HEAD+count or aggregated query | `app/api/discover/feed/route.ts:99-103` | 30 KB → ~0 (count header only) | Medium (the route reads the array — needs slight refactor) |

---

## 6. Recommendations

### Keep
- Direct-Supabase architecture (no need for Railway proxy).
- `lib/sb-cache.ts` pattern — extend it to every hot route.
- Card windowing in `InstagramHotelFeed.tsx` — keep ±4 window size.
- Network-tier-aware preload (v107) — keep, audit it's actually firing.

### Change now (this PR)
- Narrow every `select=*` on customer-facing routes to explicit column lists.
- Add `sbCached` to `/api/videos/feed`.
- Scope `rooms` fetches to the hotels actually returned by the parent query.

### Change next (follow-up)
- Add a single shared `lib/sb-columns.ts` with named projections (`HOTEL_CARD_COLS`, `ROOM_CARD_COLS`, `POST_FEED_COLS`) so individual routes don't drift.
- Add a daily-scheduled summary job that writes `hotel_bid_counts` / `hotel_booking_counts` cache tables, so `/api/discover/feed` doesn't full-table-scan `bids` and `bookings` on every request.
- Move the `images` JSONB on `hotels` to a `hotel_images` table with `is_primary` flag — fetch only primary for cards, full set for detail pages.
- Plug **Supabase Storage image transformation** (`?width=400&quality=70`) into hotel-card rendering — same egress cap as a thumbnail CDN.
- Enable HTTP-level caching on routes that change <1×/min — `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` on flash/near, hotels listing, social feed. Vercel CDN absorbs 90% of repeat traffic.

---

## 7. What this PR ships

See `OPTIMIZATION_PLAN.md` for the exact diffs. Summary:

- **3 hot routes narrowed** (`flash/near`, `/api/hotels`, `videos/feed`).
- **`videos/feed` gets `sbCached`** for the 3 currently-uncached Supabase calls.
- **`social/feed` narrowed** to specific columns on posts + profiles + hotels.
- **`discover/feed` `bids` and `bookings`** capped to 2000 rows (hard cap — was unbounded subject to PostgREST default).
- **Single source of truth** for column lists in `lib/sb-columns.ts`.

Expected reduction: **40-70% of API-payload bandwidth, immediate.** Storage egress on images is a separate fix (image transformation params) — covered in the follow-up plan.
