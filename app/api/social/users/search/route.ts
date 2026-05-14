// ═══════════════════════════════════════════════════════════════════════════
// GET /api/social/users/search?q=<term>&limit=<n>
//   Lightweight @mention search. ILIKE-matches the query against
//   social_profiles.username AND social_profiles.display_name. Returns
//   the top N (default 8) ranked roughly by:
//     • exact username match (case-insensitive) first
//     • prefix-on-username matches second
//     • prefix-on-display-name matches third
//     • everything else by follower_count desc
//   This is read-only and public; no auth needed (it surfaces only
//   publicly visible profile fields anyway).
//
// Used by the Composer caption's @-mention dropdown (v119). The shape
// here MIRRORS the `MentionSuggestion` type in components/discover/
// CreateFlow.tsx — keep them in sync if you change either.
// ═══════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { sbCached } from "@/lib/sb-cache";

const READ = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const qRaw = (url.searchParams.get("q") || "").trim();
  const limitRaw = parseInt(url.searchParams.get("limit") || "8", 10);
  const limit = Math.max(1, Math.min(20, isFinite(limitRaw) ? limitRaw : 8));

  // Empty query → return empty list (the UI uses this as the "no
  // suggestions yet" state). Saves a wasted Supabase round-trip.
  if (qRaw.length === 0) {
    return NextResponse.json({ users: [] }, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  // Sanitize: drop anything that isn't safe inside an ILIKE pattern.
  // PostgREST's `ilike` operator value is URL-encoded so the `*` wildcards
  // already need to be percent-encoded — but the SQL-side metachars
  // `%`/`_` are still allowed by the parser and would let a caller turn
  // every search into "match everything". Strip them.
  const q = qRaw.replace(/[%_\\]/g, "").slice(0, 30);
  if (q.length === 0) {
    return NextResponse.json({ users: [] }, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  // PostgREST ilike uses `*` as wildcard, NOT `%`.
  const pattern = encodeURIComponent(`*${q}*`);
  const select = encodeURIComponent("id,user_id,username,display_name,avatar_url,is_verified,follower_count");
  // OR clause: username ilike OR display_name ilike. PostgREST `or` is
  // a comma-separated list inside `or=(...)`.
  const orClause = encodeURIComponent(`username.ilike.*${q}*,display_name.ilike.*${q}*`);

  // sbCached keyed on the exact query — same query within 30s returns
  // the cached set. Avoids hammering Supabase during fast keystrokes.
  const rows = await sbCached(
    `social:users:search:q=${q.toLowerCase()}:l=${limit}`,
    async () => {
      const r = await fetch(
        `${SB_URL}/rest/v1/social_profiles?select=${select}&or=(${orClause})&order=follower_count.desc&limit=${limit * 3}`,
        { headers: READ, cache: "no-store" }
      );
      if (!r.ok) return [];
      return (await r.json().catch(() => [])) as any[];
    },
    30_000,
  );

  // Re-rank in JS so the cheaper SQL query stays simple:
  //   0 = exact username match (case-insensitive)
  //   1 = username starts with the query
  //   2 = display name starts with the query
  //   3 = everything else
  const qLower = q.toLowerCase();
  const ranked = rows
    .map((row: any) => {
      const u = (row.username || "").toLowerCase();
      const d = (row.display_name || "").toLowerCase();
      let rank = 3;
      if (u === qLower) rank = 0;
      else if (u.startsWith(qLower)) rank = 1;
      else if (d.startsWith(qLower)) rank = 2;
      return { row, rank };
    })
    .sort((a, b) => a.rank - b.rank || (b.row.follower_count || 0) - (a.row.follower_count || 0))
    .slice(0, limit)
    .map(({ row }) => ({
      userId: row.user_id,
      handle: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url || null,
      verified: !!row.is_verified,
    }));

  return NextResponse.json({ users: ranked }, {
    headers: {
      // Same TTL as the in-memory sbCached so browser intermediaries can
      // also reuse hot queries without re-hitting our edge.
      "Cache-Control": "public, max-age=10, stale-while-revalidate=30",
    },
  });
}
