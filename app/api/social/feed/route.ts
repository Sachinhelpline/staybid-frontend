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
import {
  SOCIAL_POST_FEED_COLS,
  SOCIAL_PROFILE_CARD_COLS,
  HOTEL_CARD_COLS,
} from "@/lib/sb-columns";
// v112.3 — normalize so legacy "fb_<uid>" tokens still resolve to the
// canonical social_profiles row (which has user_id without the prefix
// after the v112.2 merge). Without this, /me showed 0 posts for any
// user whose sb_token was issued under the old auth path.
import { normalizeAuthId, socialUserFromReq } from "@/lib/social/auth-helper";
// v132.10 — Cross-identity bridge. When the direct user_id lookup misses
// (user authed via Google/FB, then later via phone-OTP), this helper
// walks phone + email matches across the users table and returns any
// orphan social_profile that belongs to the same human. Prevents /me
// from showing 0 posts after an auth-method switch.
import { findProfileAcrossIdentities } from "@/lib/social/social-profile.service";

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
  // Filter to a specific author. Two accepted forms:
  //   ?author=<social_profiles.id>   — direct (legacy callers)
  //   ?authorUser=<auth users.id>    — resolved via social_profiles.user_id
  // /me's profile grid uses authorUser because client-side we only know
  // the auth user id from the JWT, not the derived social-profile id.
  let authorId       = searchParams.get("author");
  const authorUserId = searchParams.get("authorUser");

  // Resolve auth-user → social-profile (cached so repeated /me opens don't
  // re-hit social_profiles on every load).
  // v112.3 — accept BOTH the raw token id AND the normalized form
  // (without "fb_" / "firebase_" prefix), so a single in.(a,b) query
  // matches whichever shape the canonical row uses. Bulletproof against
  // mixed-era tokens.
  if (!authorId && authorUserId) {
    const normalized = normalizeAuthId(authorUserId);
    const candidates = Array.from(new Set([authorUserId, normalized])).filter(Boolean);
    const inList = candidates.map((c) => encodeURIComponent(c)).join(",");
    const profileRows = await sbCached(
      `social:profile-by-user:${candidates.join("|")}`,
      async () => {
        const r = await fetch(
          `${SB_URL}/rest/v1/social_profiles?user_id=in.(${inList})&select=id&limit=1`,
          { headers: READ, cache: "no-store" }
        );
        if (!r.ok) return [];
        return r.json().catch(() => []);
      },
      TTL_LOOKUPS,
    );
    let resolved = Array.isArray(profileRows) && profileRows[0]?.id ? String(profileRows[0].id) : "";
    if (!resolved) {
      // v132.10 — Direct user_id miss. Walk phone + email across the
      // `users` table to catch the multi-auth case (same human signed
      // up with Google first, now logged in via Phone-OTP — the new
      // session's user.id won't match the old Firebase-bound profile).
      //
      // v132.12 — ALSO consult the caller's JWT claims (email + phone)
      // when an Authorization header is present. Critical for the
      // Google-auth case: the Railway backend stores Google users with
      // users.email = NULL even though the Firebase ID token carries
      // the verified email. JWT claims fill that gap so cross-identity
      // matching works on the very first /me load — no manual SQL
      // backfill required for new users.
      const jwtUser = socialUserFromReq(req);
      const userRows = await sbCached(
        `social:user-by-id:${normalized}`,
        async () => {
          const r = await fetch(
            `${SB_URL}/rest/v1/users?id=eq.${encodeURIComponent(normalized)}&select=id,phone,email&limit=1`,
            { headers: READ, cache: "no-store" }
          );
          if (!r.ok) return [];
          return r.json().catch(() => []);
        },
        TTL_LOOKUPS,
      );
      const me = Array.isArray(userRows) && userRows[0] ? userRows[0] : null;
      // Prefer JWT-derived claims when present (they're authoritative
      // for fresh Firebase sessions where the users row hasn't been
      // backfilled yet), fall back to whatever the users row has.
      const claimsPhone = (jwtUser?.phone && !/^unknown_/i.test(jwtUser.phone))
        ? jwtUser.phone
        : (me?.phone && !/^unknown_/i.test(me.phone) ? me.phone : null);
      const claimsEmail = jwtUser?.email || me?.email || null;
      if (me || claimsEmail || claimsPhone) {
        const cross = await findProfileAcrossIdentities({
          id: normalized, phone: claimsPhone, email: claimsEmail,
        });
        if (cross?.id) resolved = String(cross.id);
      }
      if (!resolved) {
        // Still no profile → no posts. Return empty quickly without a
        // wasted social_posts scan.
        return NextResponse.json({ posts: [], nextCursor: null });
      }
    }
    authorId = resolved;
  }

  // v131 — narrowed select (was *). Drops internal moderation columns +
  // retry counters that the public feed never renders.
  // v160 — only published content is feed-visible. moderation_status is NOT
  // NULL DEFAULT 'APPROVED' (Phase 1), so every pre-tier-system row + every
  // CREATOR/HOTEL upload via /api/social/posts is 'APPROVED'. Verified-guest
  // uploads land 'AUTO_APPROVED'. Community-contributor uploads sit in
  // 'PENDING_ADMIN_REVIEW' and stay hidden until an admin verifies them.
  // REJECTED / FLAGGED / DELETED rows are excluded for everyone.
  let filter = `select=${SOCIAL_POST_FEED_COLS}&is_active=eq.true&moderation_status=in.(APPROVED,AUTO_APPROVED)&order=created_at.desc&limit=${limit}`;
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
          `${SB_URL}/rest/v1/social_profiles?id=in.(${authorIds.map(encodeURIComponent).join(",")})&select=${SOCIAL_PROFILE_CARD_COLS}`,
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
          `${SB_URL}/rest/v1/hotels?id=in.(${hotelIds.map(encodeURIComponent).join(",")})&select=${HOTEL_CARD_COLS}`,
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

  const res = NextResponse.json({ posts: enriched, nextCursor });
  // v107 — browser-side cache. Returning users on the home feed get the
  // warm response in ~30 ms via the SW SWR lane (see public/sw.js). The
  // `must-revalidate` keeps us safe if a CDN ever sits in front; SWR
  // still serves stale while the bg revalidate runs.
  // v131.2 — bigger CDN window. The feed query is keyed on cursor/limit/
  // type/author in the URL, so per-user filtered views still get their own
  // cache entries. New posts appear within 60s for the SHARED feed; the
  // user's own /me grid is augmented by PostsStore client-side which makes
  // their own new uploads appear instantly regardless of the API cache.
  // Was max-age=10/swr=30.
  // v131.7 — PROPER CDN caching via Vercel-specific headers.
  res.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  res.headers.set("CDN-Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  res.headers.set("Vercel-CDN-Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return res;
}
