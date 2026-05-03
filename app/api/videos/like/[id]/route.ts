import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ, userFromReq } from "@/lib/sb";

// GET  /api/videos/like/:id  — check if current user liked this video
// POST /api/videos/like/:id  — toggle like (like if not liked, unlike if liked)
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = userFromReq(req);
  if (!user) return NextResponse.json({ liked: false });

  const check = await fetch(
    `${SB_URL}/rest/v1/video_likes?video_id=eq.${encodeURIComponent(params.id)}&user_id=eq.${encodeURIComponent(user.id)}&select=id`,
    { headers: SB_READ }
  );
  const rows = await check.json().catch(() => []);
  return NextResponse.json({ liked: Array.isArray(rows) && rows.length > 0 });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = userFromReq(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const videoId = params.id;

  // Check existing
  const check = await fetch(
    `${SB_URL}/rest/v1/video_likes?video_id=eq.${encodeURIComponent(videoId)}&user_id=eq.${encodeURIComponent(user.id)}&select=id`,
    { headers: SB_READ }
  );
  const existing = await check.json().catch(() => []);

  if (Array.isArray(existing) && existing.length > 0) {
    // Unlike
    await fetch(
      `${SB_URL}/rest/v1/video_likes?video_id=eq.${encodeURIComponent(videoId)}&user_id=eq.${encodeURIComponent(user.id)}`,
      { method: "DELETE", headers: SB_H }
    );
    return NextResponse.json({ liked: false });
  } else {
    // Like
    await fetch(`${SB_URL}/rest/v1/video_likes`, {
      method: "POST",
      headers: SB_H,
      body: JSON.stringify({ video_id: videoId, user_id: user.id }),
    });
    return NextResponse.json({ liked: true });
  }
}
