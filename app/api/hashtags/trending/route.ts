import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H } from "@/lib/sb";

// GET /api/hashtags/trending — top hashtags from approved videos in last N days
// ?days=30&limit=12
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days  = Math.max(1, Math.min(365, Number(searchParams.get("days")  || 30)));
  const limit = Math.max(1, Math.min(50,  Number(searchParams.get("limit") || 12)));

  const res = await fetch(`${SB_URL}/rest/v1/rpc/trending_hashtags`, {
    method: "POST",
    headers: SB_H,
    body: JSON.stringify({ p_days: days, p_limit: limit }),
  });
  if (!res.ok) return NextResponse.json({ tags: [] });
  const tags = await res.json().catch(() => []);
  return NextResponse.json({ tags: Array.isArray(tags) ? tags : [] });
}
