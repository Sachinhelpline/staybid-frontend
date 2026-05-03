import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";

// Public influencer profile — read-only, no auth. `id` accepts the influencer
// row id (`inf_...`) or the underlying user_id.
// Phase C: also returns recent videos + live follower count.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const cols = "id,user_id,bio,interests,location,total_followers,followers_count,following_count,total_hotels_reviewed,avg_rating_given,verification_tier,status,created_at,display_name,avatar_url";

  const byId = await fetch(`${SB_URL}/rest/v1/influencers?id=eq.${encodeURIComponent(params.id)}&status=eq.active&select=${cols}`, { headers: SB_READ })
    .then(r => r.json()).catch(() => []);
  let inf = Array.isArray(byId) && byId[0] ? byId[0] : null;
  if (!inf) {
    const byUser = await fetch(`${SB_URL}/rest/v1/influencers?user_id=eq.${encodeURIComponent(params.id)}&status=eq.active&select=${cols}`, { headers: SB_READ })
      .then(r => r.json()).catch(() => []);
    inf = Array.isArray(byUser) && byUser[0] ? byUser[0] : null;
  }
  if (!inf) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const userRes = await fetch(`${SB_URL}/rest/v1/users?id=eq.${encodeURIComponent(inf.user_id)}&select=id,name,phone`, { headers: SB_READ })
    .then(r => r.json()).catch(() => []);
  const user = Array.isArray(userRes) && userRes[0] ? userRes[0] : null;

  // Recent approved videos uploaded by this creator
  const vidsRes = await fetch(
    `${SB_URL}/rest/v1/hotel_videos?uploaded_by=eq.${encodeURIComponent(inf.user_id)}&verification_status=eq.approved&order=created_at.desc&limit=24&select=id,s3_url,thumbnail_url,title,likes_count,comments_count,views_count,hotel_id,created_at`,
    { headers: SB_READ }
  ).then(r => r.json()).catch(() => []);
  const videos = Array.isArray(vidsRes) ? vidsRes : [];

  // Live follower count — prefer trigger-maintained followers_count, fall back to total_followers
  const followersCount = (inf.followers_count != null ? inf.followers_count : inf.total_followers) || 0;

  return NextResponse.json({
    influencer: {
      id: inf.id,
      userId: inf.user_id,
      tier: inf.verification_tier,
      bio: inf.bio,
      interests: inf.interests || [],
      location: inf.location,
      totalFollowers: followersCount,
      followingCount: inf.following_count || 0,
      totalHotelsReviewed: inf.total_hotels_reviewed,
      avgRatingGiven: Number(inf.avg_rating_given || 0),
      memberSince: inf.created_at,
      name: inf.display_name || user?.name || null,
      avatarUrl: inf.avatar_url || null,
      videosCount: videos.length,
    },
    videos,
  });
}
