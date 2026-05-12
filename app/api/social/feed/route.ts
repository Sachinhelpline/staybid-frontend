// GET /api/social/feed — paginated reel/post feed across all user types.
// Query params:
//   ?cursor=<ISO date>  pagination (created_at < cursor)
//   ?limit=<n>          default 20, max 50
//   ?type=PHOTO|REEL|STORY  optional media filter
//   ?source=PUBLIC|CREATOR|HOTEL  optional user_type filter
//
// Posts are joined with their author profile and (when hotel-tagged)
// the linked hotel record for the bottom identity strip.
import { NextResponse, type NextRequest } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { sbCached } from "@/lib/sb-cache";

const READ = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

// Reels feed is read N times per second across all visitors; the underlying
// query is the same. 15 s in-memory cache per Lambda gives Instagram-fast
// repeat visits while still surfacing new posts within seconds.
const TTL_POSTS   = 15_000;
const TTL_LOOKUPS = 60_000;

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const cursor = searchParams.get("cursor");
  const limit  = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
  const type   = searchParams.get("type");
  const source = searchParams.get("source");
  // Filter to a specific author — used by the /me profile grid to show
  // only the current user's uploads.
  const authorId = searchParams.get("author");

  let filter = `select=*&is_active=eq.true&order=created_at.desc&limit=${limit}`;
  if (cursor)             filter += `&created_at=lt.${encodeURIComponent(cursor)}`;
  if (type)               filter += `&media_type=eq.${encodeURIComponent(type)}`;
  if (authorId)           filter += `&author_id=eq.${encodeURIComponent(authorId)}`;
  // Stories auto-expire after 24 hours
  // (handled at fetch time so we don't need a cron)
  if (type === "STORY") {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    filter += `&created_at=gt.${encodeURIComponent(cutoff)}`;
  }

  // Fetch posts (cached for TTL_POSTS — keyed on the full filter string so
  // /me's `?author=…` and `?type=STORY` get their own buckets).
  let posts: any[] = await sbCached(
    `social:posts:${filter}`,
    async () => {
      const pr = await fetch(`${SB_URL}/rest/v1/social_posts?${filter}`, { headers: READ, cache: "no-store" });
      if (!pr.ok) return [];
      return pr.json().catch(() => []);
    },
    TTL_POSTS,
  );
  if (!Array.isArray(posts)) posts = [];

  // Side-load authors (cached separately — profile rows rarely change).
  const authorIds = Array.from(new Set(posts.map((p) => p.author_id))).filter(Boolean);
  let authors: any[] = [];
  if (authorIds.length) {
    const authorKey = authorIds.slice().sort().join(",");
    authors = await sbCached(
      `social:authors:${authorKey}`,
      async () => {
        const ar = await fetch(
          `${SB_URL}/rest/v1/social_profiles?id=in.(${authorIds.map(encodeURIComponent).join(",")})&select=*`,
          { headers: READ, cache: "no-store" }
        );
        if (!ar.ok) return [];
        return ar.json().catch(() => []);
      },
      TTL_LOOKUPS,
    );
  }
  const authorById = new Map(authors.map((a) => [a.id, a]));

  // Optional source filter (post-fetch since social_posts doesn't carry user_type)
  if (source) {
    posts = posts.filter((p) => authorById.get(p.author_id)?.user_type === source);
  }

  // Side-load hotels referenced by hotel_id (cached for TTL_LOOKUPS).
  const hotelIds = Array.from(new Set(posts.map((p) => p.hotel_id).filter(Boolean)));
  let hotels: any[] = [];
  if (hotelIds.length) {
    const hotelKey = hotelIds.slice().sort().join(",");
    hotels = await sbCached(
      `social:hotels:${hotelKey}`,
      async () => {
        const hr = await fetch(
          `${SB_URL}/rest/v1/hotels?id=in.(${hotelIds.map(encodeURIComponent).join(",")})&select=*`,
          { headers: READ, cache: "no-store" }
        );
        if (!hr.ok) return [];
        return hr.json().catch(() => []);
      },
      TTL_LOOKUPS,
    );
  }
  const hotelById = new Map(hotels.map((h) => [h.id, h]));

  const enriched = posts.map((p) => ({
    ...p,
    author: authorById.get(p.author_id) || null,
    hotel:  p.hotel_id ? hotelById.get(p.hotel_id) || null : null,
  }));

  const nextCursor = enriched.length === limit ? enriched[enriched.length - 1].created_at : null;

  return NextResponse.json({ posts: enriched, nextCursor });
}
