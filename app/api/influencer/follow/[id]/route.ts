import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ, userFromReq } from "@/lib/sb";

// GET  — check follow status
// POST — toggle follow
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = userFromReq(req);
  if (!user) return NextResponse.json({ following: false });

  const check = await fetch(
    `${SB_URL}/rest/v1/user_follows?follower_id=eq.${encodeURIComponent(user.id)}&influencer_id=eq.${encodeURIComponent(params.id)}&select=id`,
    { headers: SB_READ }
  );
  const rows = await check.json().catch(() => []);
  return NextResponse.json({ following: Array.isArray(rows) && rows.length > 0 });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = userFromReq(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const influencerId = params.id;

  const check = await fetch(
    `${SB_URL}/rest/v1/user_follows?follower_id=eq.${encodeURIComponent(user.id)}&influencer_id=eq.${encodeURIComponent(influencerId)}&select=id`,
    { headers: SB_READ }
  );
  const existing = await check.json().catch(() => []);

  if (Array.isArray(existing) && existing.length > 0) {
    await fetch(
      `${SB_URL}/rest/v1/user_follows?follower_id=eq.${encodeURIComponent(user.id)}&influencer_id=eq.${encodeURIComponent(influencerId)}`,
      { method: "DELETE", headers: SB_H }
    );
    return NextResponse.json({ following: false });
  } else {
    await fetch(`${SB_URL}/rest/v1/user_follows`, {
      method: "POST",
      headers: SB_H,
      body: JSON.stringify({ follower_id: user.id, influencer_id: influencerId }),
    });
    return NextResponse.json({ following: true });
  }
}
