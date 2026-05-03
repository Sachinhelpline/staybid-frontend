import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";

// Lightweight mixed feed: approved hotel videos + active flash deals,
// sorted by recency. Distinct from /api/discover/feed (which is a ranked
// POST endpoint for the swipe/reels mode).
export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") || 30), 100);

  const [videosRes, dealsRes] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/hotel_videos?verification_status=eq.approved&select=*&order=created_at.desc&limit=${limit}`, { headers: SB_READ }).then(r => r.json()).catch(() => []),
    fetch(`${SB_URL}/rest/v1/flash_deals?select=*&order=createdAt.desc&limit=${limit}`, { headers: SB_READ }).then(r => r.json()).catch(() => []),
  ]);
  const videos: any[] = Array.isArray(videosRes) ? videosRes : [];
  const deals:  any[] = Array.isArray(dealsRes)  ? dealsRes  : [];

  const hotelIds = Array.from(new Set([
    ...videos.map(v => v.hotel_id).filter(Boolean),
    ...deals.map(d => d.hotelId).filter(Boolean),
  ]));
  let hotelMap: Record<string, any> = {};
  if (hotelIds.length) {
    const hRes = await fetch(
      `${SB_URL}/rest/v1/hotels?id=in.(${hotelIds.map(i => encodeURIComponent(i)).join(",")})&select=id,name,city,images`,
      { headers: SB_READ }
    ).then(r => r.json()).catch(() => []);
    if (Array.isArray(hRes)) for (const h of hRes) hotelMap[h.id] = h;
  }

  const items = [
    ...videos.map(v => ({ kind: "video", id: v.id, hotel_id: v.hotel_id, hotel: hotelMap[v.hotel_id] || null, video_url: v.s3_url, thumbnail_url: v.thumbnail_url, title: v.title, room_type: v.room_type, created_at: v.created_at })),
    ...deals.map(d  => ({ kind: "deal",  id: d.id, hotel_id: d.hotelId,  hotel: hotelMap[d.hotelId]  || null, price: d.price, validUntil: d.validUntil, created_at: d.createdAt })),
  ].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, limit);

  return NextResponse.json({ items, total: items.length });
}
