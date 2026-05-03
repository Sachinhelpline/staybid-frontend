import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ, userFromReq } from "@/lib/sb";

// Enriched saves — joins each save row with the underlying video / hotel /
// influencer / deal so the /saved page can render rich cards in one round-trip.
export async function GET(req: NextRequest) {
  const u = userFromReq(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const type = req.nextUrl.searchParams.get("type");
  const filter = type ? `&target_type=eq.${encodeURIComponent(type)}` : "";
  const res = await fetch(
    `${SB_URL}/rest/v1/user_saves?user_id=eq.${encodeURIComponent(u.id)}${filter}&select=*&order=created_at.desc&limit=200`,
    { headers: SB_READ }
  );
  const saves: any[] = res.ok ? await res.json().catch(() => []) : [];
  if (saves.length === 0) return NextResponse.json({ saves: [] });

  const byType: Record<string, string[]> = {};
  saves.forEach(s => {
    if (!byType[s.target_type]) byType[s.target_type] = [];
    byType[s.target_type].push(s.target_id);
  });

  const lookups: Record<string, Record<string, any>> = { video: {}, hotel: {}, influencer: {}, deal: {} };

  if (byType.video?.length) {
    const ids = byType.video.map(id => `"${id}"`).join(",");
    const r = await fetch(
      `${SB_URL}/rest/v1/hotel_videos?id=in.(${ids})&select=id,s3_url,thumbnail_url,title,likes_count,views_count,hotel_id`,
      { headers: SB_READ }
    ).then(x => x.json()).catch(() => []);
    if (Array.isArray(r)) r.forEach((row: any) => { lookups.video[row.id] = row; });
  }
  if (byType.hotel?.length) {
    const ids = byType.hotel.map(id => `"${id}"`).join(",");
    const r = await fetch(
      `${SB_URL}/rest/v1/hotels?id=in.(${ids})&select=id,name,city,star_rating,images`,
      { headers: SB_READ }
    ).then(x => x.json()).catch(() => []);
    if (Array.isArray(r)) r.forEach((row: any) => { lookups.hotel[row.id] = row; });
  }
  if (byType.influencer?.length) {
    const ids = byType.influencer.map(id => `"${id}"`).join(",");
    const r = await fetch(
      `${SB_URL}/rest/v1/influencers?id=in.(${ids})&select=id,display_name,avatar_url,bio,verification_tier,followers_count`,
      { headers: SB_READ }
    ).then(x => x.json()).catch(() => []);
    if (Array.isArray(r)) r.forEach((row: any) => { lookups.influencer[row.id] = row; });
  }
  if (byType.deal?.length) {
    const ids = byType.deal.map(id => `"${id}"`).join(",");
    const r = await fetch(
      `${SB_URL}/rest/v1/flash_deals?id=in.(${ids})&select=*`,
      { headers: SB_READ }
    ).then(x => x.json()).catch(() => []);
    if (Array.isArray(r)) r.forEach((row: any) => { lookups.deal[row.id] = row; });
  }

  return NextResponse.json({
    saves: saves.map(s => ({
      ...s,
      target: lookups[s.target_type]?.[s.target_id] || null,
    })),
  });
}
