import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";

// GET /api/hashtags/[name] — videos that include #name in their title,
// plus a count + a few related hashtags co-occurring in those captions.
export async function GET(_req: NextRequest, { params }: { params: { name: string } }) {
  const tag = String(params.name || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 40);
  if (!tag) return NextResponse.json({ tag: "", videos: [], count: 0, related: [] });

  const url = `${SB_URL}/rest/v1/hotel_videos?verification_status=eq.approved&title=ilike.*%23${encodeURIComponent(tag)}*&order=created_at.desc&limit=60&select=*`;
  const res = await fetch(url, { headers: SB_READ });
  const videos = await res.json().catch(() => []);
  const list = Array.isArray(videos) ? videos : [];

  // Hotel + creator enrichment (small inline version)
  const hSeen: Record<string, boolean> = {};
  const hotelIds: string[] = [];
  list.forEach((v: any) => { if (v.hotel_id && !hSeen[v.hotel_id]) { hSeen[v.hotel_id] = true; hotelIds.push(v.hotel_id); } });
  let hotelMap: Record<string, any> = {};
  if (hotelIds.length > 0) {
    const hRes = await fetch(
      `${SB_URL}/rest/v1/hotels?id=in.(${hotelIds.map(id => `"${id}"`).join(",")})&select=id,name,city,star_rating,images`,
      { headers: SB_READ }
    );
    const hotels = await hRes.json().catch(() => []);
    if (Array.isArray(hotels)) hotels.forEach((h: any) => { hotelMap[h.id] = h; });
  }

  // Related tags — count co-occurring tags in these video titles
  const relatedCounts: Record<string, number> = {};
  list.forEach((v: any) => {
    const tags = ((v.title || "").match(/#[A-Za-z0-9_]+/g) || []).map((t: string) => t.slice(1).toLowerCase());
    tags.forEach((t: string) => {
      if (t && t !== tag) relatedCounts[t] = (relatedCounts[t] || 0) + 1;
    });
  });
  const related = Object.entries(relatedCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t, uses]) => ({ tag: t, uses }));

  return NextResponse.json({
    tag,
    count: list.length,
    related,
    videos: list.map((v: any) => ({ ...v, hotel: hotelMap[v.hotel_id] || null })),
  });
}
