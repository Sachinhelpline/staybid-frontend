import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ, userFromReq } from "@/lib/sb";

export async function GET(req: NextRequest) {
  const user = userFromReq(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = `${SB_URL}/rest/v1/hotel_videos?uploaded_by=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=50`;
  const res = await fetch(url, { headers: SB_READ });
  const videos = await res.json().catch(() => []);
  return NextResponse.json({ videos: Array.isArray(videos) ? videos : [] });
}
