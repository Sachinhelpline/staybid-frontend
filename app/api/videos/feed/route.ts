import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ, userFromReq } from "@/lib/sb";

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

  let url = `${SB_URL}/rest/v1/hotel_videos?verification_status=eq.approved&order=created_at.desc&limit=${limit}&offset=${offset}&select=*${uploaderFilter}`;
  if (hotelId) url += `&hotel_id=eq.${encodeURIComponent(hotelId)}`;
  if (tag)     url += `&title=ilike.*%23${encodeURIComponent(tag)}*`;

  const res = await fetch(url, { headers: SB_READ });
  if (!res.ok) return NextResponse.json({ videos: [] });
  const videos = await res.json().catch(() => []);

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

  // Hotel enrichment
  let hotelMap: Record<string, any> = {};
  if (hotelIds.length > 0) {
    const hRes = await fetch(
      `${SB_URL}/rest/v1/hotels?id=in.(${hotelIds.map(id => `"${id}"`).join(",")})&select=id,name,city,state,star_rating,images`,
      { headers: SB_READ }
    );
    const hotels = await hRes.json().catch(() => []);
    if (Array.isArray(hotels)) hotels.forEach((h: any) => { hotelMap[h.id] = h; });
  }

  // Creator enrichment — find influencers whose user_id matches an uploader
  let creatorMap: Record<string, any> = {};
  if (uploaderIds.length > 0) {
    const cRes = await fetch(
      `${SB_URL}/rest/v1/influencers?user_id=in.(${uploaderIds.map(id => `"${id}"`).join(",")})&select=id,user_id,display_name,avatar_url,verification_tier,followers_count,total_followers`,
      { headers: SB_READ }
    );
    const creators = await cRes.json().catch(() => []);
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
