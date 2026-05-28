import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { HOTEL_VIDEO_FEED_COLS } from "@/lib/sb-columns";


const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

// Public list endpoint: only approved videos are returned by default. Pass
// ?status=all|pending|approved|rejected to filter (admin / partner usage).
export async function GET(req: NextRequest, props: { params: Promise<{ hotelId: string }> }) {
  const params = await props.params;
  const status = req.nextUrl.searchParams.get("status") || "approved";
  const filter = status === "all" ? "" : `&verification_status=eq.${encodeURIComponent(status)}`;
  // v131 — narrowed select (was *). Drops internal admin fields.
  const res = await fetch(
    `${SB_URL}/rest/v1/hotel_videos?hotel_id=eq.${encodeURIComponent(params.hotelId)}${filter}&select=${HOTEL_VIDEO_FEED_COLS}&order=created_at.desc&limit=100`,
    { headers: SB_H }
  );
  const data = res.ok ? await res.json() : [];
  const out = NextResponse.json({ videos: Array.isArray(data) ? data : [], total: Array.isArray(data) ? data.length : 0 });
  // v131.7 — per-hotel video lists rarely change. Long CDN window so the
  // hotel detail page's video tab loads instantly on every revisit.
  out.headers.set("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
  out.headers.set("CDN-Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
  out.headers.set("Vercel-CDN-Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
  return out;
}
