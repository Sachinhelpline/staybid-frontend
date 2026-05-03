import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ, userFromReq } from "@/lib/sb";

export async function GET(req: NextRequest) {
  const u = userFromReq(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit  = Math.min(Number(req.nextUrl.searchParams.get("limit") || 50), 200);
  const offset = Number(req.nextUrl.searchParams.get("offset") || 0);

  const res = await fetch(
    `${SB_URL}/rest/v1/points_history?user_id=eq.${encodeURIComponent(u.id)}&select=*&order=created_at.desc&limit=${limit}&offset=${offset}`,
    { headers: SB_READ }
  );
  const data = res.ok ? await res.json() : [];
  return NextResponse.json({ history: Array.isArray(data) ? data : [], limit, offset });
}
