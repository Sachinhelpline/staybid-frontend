import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";

// Public influencer profile — read-only, no auth. `id` accepts the influencer
// row id (`inf_...`) or the underlying user_id.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const byId = await fetch(`${SB_URL}/rest/v1/influencers?id=eq.${encodeURIComponent(params.id)}&status=eq.active&select=id,user_id,bio,interests,location,total_followers,total_hotels_reviewed,avg_rating_given,verification_tier,status,created_at`, { headers: SB_READ })
    .then(r => r.json()).catch(() => []);
  let inf = Array.isArray(byId) && byId[0] ? byId[0] : null;
  if (!inf) {
    const byUser = await fetch(`${SB_URL}/rest/v1/influencers?user_id=eq.${encodeURIComponent(params.id)}&status=eq.active&select=id,user_id,bio,interests,location,total_followers,total_hotels_reviewed,avg_rating_given,verification_tier,status,created_at`, { headers: SB_READ })
      .then(r => r.json()).catch(() => []);
    inf = Array.isArray(byUser) && byUser[0] ? byUser[0] : null;
  }
  if (!inf) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const userRes = await fetch(`${SB_URL}/rest/v1/users?id=eq.${encodeURIComponent(inf.user_id)}&select=id,name,phone`, { headers: SB_READ })
    .then(r => r.json()).catch(() => []);
  const user = Array.isArray(userRes) && userRes[0] ? userRes[0] : null;

  return NextResponse.json({
    influencer: {
      id: inf.id,
      tier: inf.verification_tier,
      bio: inf.bio,
      interests: inf.interests || [],
      location: inf.location,
      totalFollowers: inf.total_followers,
      totalHotelsReviewed: inf.total_hotels_reviewed,
      avgRatingGiven: Number(inf.avg_rating_given || 0),
      memberSince: inf.created_at,
      name: user?.name || null,
    },
  });
}
