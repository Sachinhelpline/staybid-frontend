import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";


const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

// Public list endpoint: only approved videos are returned by default. Pass
// ?status=all|pending|approved|rejected to filter (admin / partner usage).
export async function GET(req: NextRequest, { params }: { params: { hotelId: string } }) {
  const status = req.nextUrl.searchParams.get("status") || "approved";
  const filter = status === "all" ? "" : `&verification_status=eq.${encodeURIComponent(status)}`;
  const res = await fetch(
    `${SB_URL}/rest/v1/hotel_videos?hotel_id=eq.${encodeURIComponent(params.hotelId)}${filter}&select=*&order=created_at.desc&limit=100`,
    { headers: SB_H }
  );
  const data = res.ok ? await res.json() : [];
  return NextResponse.json({ videos: Array.isArray(data) ? data : [], total: Array.isArray(data) ? data.length : 0 });
}
