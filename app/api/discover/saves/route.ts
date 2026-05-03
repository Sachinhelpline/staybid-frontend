import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ, userFromReq } from "@/lib/sb";

export async function GET(req: NextRequest) {
  const u = userFromReq(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const type = req.nextUrl.searchParams.get("type");
  const filter = type ? `&target_type=eq.${encodeURIComponent(type)}` : "";
  const res = await fetch(
    `${SB_URL}/rest/v1/user_saves?user_id=eq.${encodeURIComponent(u.id)}${filter}&select=*&order=created_at.desc&limit=200`,
    { headers: SB_READ }
  );
  const data = res.ok ? await res.json() : [];
  return NextResponse.json({ saves: Array.isArray(data) ? data : [] });
}
