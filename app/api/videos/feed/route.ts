import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ, userFromReq } from "@/lib/sb";
import { sbCached } from "@/lib/sb-cache";
import { HOTEL_VIDEO_FEED_COLS, HOTEL_CARD_COLS, INFLUENCER_CARD_COLS } from "@/lib/sb-columns";

// v131 — Reel feed is hit on every Discover scroll. Without caching, three
// Supabase round-trips fire per request. 20 s feed + 60 s lookup TTLs cut
// warm-Lambda traffic to near zero while keeping the feed fresh enough that
// a newly approved video appears within one scroll-back.
const TTL_FEED = 20_000;
const TTL_LOOKUP = 60_000;

// GET /api/videos/feed — approved videos for the reels feed
// Enriches each video with hotel info AND creator (influencer) info so the
// reels UI can render avatar + name + link to the public profile.
// Phase C: ?following=1 filters to videos uploaded by creators the
// current user follows (auth required, otherwise returns empty list).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit  = Math.min(Number(searchParams.get("limit") || 20), 50);
  const offset = Number(searchParams.get("offset") || 0);
  const hotelId = searchParams.get("hotelId");
  const tag    = searchParams.get("tag"); // optional hashtag filter
  const followingMode = searchParams.get("following") === "1";

  // Following filter: pull the user's follow list, map to user_ids, restrict feed
  let uploaderFilter = "";
  if (followingMode) {
    const me = userFromReq(req);
    if (!me) return NextResponse.json({ videos: [] });
    const follows = await fetch(
      `${SB_URL}/rest/v1/user_follows?follower_id=eq.${encodeURIComponent(me.id)}&select=influencer_id`,
      { headers: SB_READ }
    ).then(r => r.json()).catch(() => []);
    const infIds: string[] = Array.isArray(follows) ? follows.map((r: any) => r.influencer_id).filter(Boolean) : [];
    if (infIds.length === 0) return NextResponse.json({ videos: [] });
    const infs = await fetch(
      `${SB_URL}/rest/v1/influencers?id=in.(${infIds.map(id => `"${id}"`).join(",")})&select=user_id`,
      { headers: SB_READ }
    ).then(r => r.json()).catch(() => []);
    const userIds: string[] = Array.isArray(infs) ? infs.map((i: any) => i.user_id).filter(Boolean) : [];
    if (userIds.length === 0) return NextResponse.json({ videos: [] });
    uploaderFilter = `&uploaded_by=in.(${userIds.map(id => `"${id}"`).join(",")})`;
  }

  // v131 — narrowed select (was select=*) + caching.
  let url = `${SB_URL}/rest/v1/hotel_videos?verification_status=eq.approved&order=created_at.desc&limit=${limit}&offset=${offset}&select=${HOTEL_VIDEO_FEED_COLS}${uploaderFilter}`;
  if (hotelId) url += `&hotel_id=eq.${encodeURIComponent(hotelId)}`;
  if (tag)     url += `&title=ilike.*%23${encodeURIComponent(tag)}*`;

  const videos: any[] = await sbCached(
    `videos:feed:${url}`,
    async () => {
      const r = await fetch(url, { headers: SB_READ });
      if (!r.ok) return [];
      return r.json().catch(() => []);
    },
    TTL_FEED,
  );

  if (!Array.isArray(videos) || videos.length === 0) {
    return NextResponse.json({ videos: [] });
  }

  // Dedup hotel + uploader IDs (no Set spread for downlevelIteration safety)
  const hSeen: Record<string, boolean> = {};
  const hotelIds: string[] = [];
  const uSeen: Record<string, boolean> = {};
  const uploaderIds: string[] = [];
  videos.forEach((v: any) => {
    if (v.hotel_id    && !hSeen[v.hotel_id])    { hSeen[v.hotel_id]    = true; hotelIds.push(v.hotel_id); }
    if (v.uploaded_by && !uSeen[v.uploaded_by]) { uSeen[v.uploaded_by] = true; uploaderIds.push(v.uploaded_by); }
  });

  // Hotel enrichment — cached + narrowed select.
  const hotelMap: Record<string, any> = {};
  if (hotelIds.length > 0) {
    const hKey = hotelIds.slice().sort().join(",");
    const hotels: any[] = await sbCached(
      `videos:feed:hotels:${hKey}`,
      async () => {
        const hRes = await fetch(
          `${SB_URL}/rest/v1/hotels?id=in.(${hotelIds.map((id) => `"${id}"`).join(",")})&select=${HOTEL_CARD_COLS}`,
          { headers: SB_READ },
        );
        if (!hRes.ok) return [];
        return hRes.json().catch(() => []);
      },
      TTL_LOOKUP,
    );
    if (Array.isArray(hotels)) hotels.forEach((h: any) => { hotelMap[h.id] = h; });
  }

  // Creator enrichment — cached + shared column projection.
  const creatorMap: Record<string, any> = {};
  if (uploaderIds.length > 0) {
    const uKey = uploaderIds.slice().sort().join(",");
    const creators: any[] = await sbCached(
      `videos:feed:creators:${uKey}`,
      async () => {
        const cRes = await fetch(
          `${SB_URL}/rest/v1/influencers?user_id=in.(${uploaderIds.map((id) => `"${id}"`).join(",")})&select=${INFLUENCER_CARD_COLS}`,
          { headers: SB_READ },
        );
        if (!cRes.ok) return [];
        return cRes.json().catch(() => []);
      },
      TTL_LOOKUP,
    );
    if (Array.isArray(creators)) creators.forEach((c: any) => { creatorMap[c.user_id] = c; });
  }

  return NextResponse.json({
    videos: videos.map((v: any) => ({
      ...v,
      hotel:   hotelMap[v.hotel_id]      || null,
      creator: v.uploaded_by ? (creatorMap[v.uploaded_by] || null) : null,
    })),
  });
}
