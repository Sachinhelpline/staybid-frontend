import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";

// GET /api/videos/feed — approved videos for the reels feed, newest first
// Joins hotel info from the hotels table via Supabase's PostgREST embedding.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit  = Math.min(Number(searchParams.get("limit") || 20), 50);
  const offset = Number(searchParams.get("offset") || 0);
  const hotelId = searchParams.get("hotelId");

  let url = `${SB_URL}/rest/v1/hotel_videos?verification_status=eq.approved&order=created_at.desc&limit=${limit}&offset=${offset}&select=*`;
  if (hotelId) url += `&hotel_id=eq.${encodeURIComponent(hotelId)}`;

  const res = await fetch(url, { headers: SB_READ });
  if (!res.ok) return NextResponse.json({ videos: [] });
  const videos = await res.json().catch(() => []);

  if (!Array.isArray(videos) || videos.length === 0) {
    return NextResponse.json({ videos: [] });
  }

  // Enrich with hotel info
  const seen: Record<string, boolean> = {};
  const hotelIds: string[] = [];
  videos.forEach((v: any) => {
    if (v.hotel_id && !seen[v.hotel_id]) { seen[v.hotel_id] = true; hotelIds.push(v.hotel_id); }
  });
  let hotelMap: Record<string, any> = {};
  if (hotelIds.length > 0) {
    const hRes = await fetch(
      `${SB_URL}/rest/v1/hotels?id=in.(${hotelIds.map(id => `"${id}"`).join(",")})&select=id,name,city,state,star_rating,images`,
      { headers: SB_READ }
    );
    const hotels = await hRes.json().catch(() => []);
    if (Array.isArray(hotels)) hotels.forEach((h: any) => { hotelMap[h.id] = h; });
  }

  return NextResponse.json({
    videos: videos.map((v: any) => ({ ...v, hotel: hotelMap[v.hotel_id] || null })),
  });
}
