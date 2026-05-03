import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ, userFromReq } from "@/lib/sb";

// GET /api/influencer/following — list of influencer IDs (and basic info)
// the current user follows. Used by /reels "Following" filter and any UI
// that needs to render a follow-list.
export async function GET(req: NextRequest) {
  const user = userFromReq(req);
  if (!user) return NextResponse.json({ following: [], influencerIds: [], userIds: [] });

  const rows = await fetch(
    `${SB_URL}/rest/v1/user_follows?follower_id=eq.${encodeURIComponent(user.id)}&select=influencer_id,created_at`,
    { headers: SB_READ }
  ).then(r => r.json()).catch(() => []);

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ following: [], influencerIds: [], userIds: [] });
  }

  const influencerIds: string[] = rows.map((r: any) => r.influencer_id).filter(Boolean);

  // Fetch the user_id for each followed influencer (for filtering hotel_videos.uploaded_by)
  const infs = await fetch(
    `${SB_URL}/rest/v1/influencers?id=in.(${influencerIds.map(id => `"${id}"`).join(",")})&select=id,user_id,display_name,avatar_url,verification_tier,followers_count`,
    { headers: SB_READ }
  ).then(r => r.json()).catch(() => []);

  const userIds = Array.isArray(infs) ? infs.map((i: any) => i.user_id).filter(Boolean) : [];

  return NextResponse.json({
    following: Array.isArray(infs) ? infs : [],
    influencerIds,
    userIds,
  });
}
