// Returns auto_accept_at + bidder_tier for a batch of bid IDs. The main
// /api/bids/my endpoint (Railway/Prisma) doesn't include these new
// Phase 6 columns, so My Bids enriches its rendering with this call.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ, userFromReq } from "@/lib/sb";

export async function GET(req: NextRequest) {
  const user = userFromReq(req);
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const idsParam = searchParams.get("ids");
  if (!idsParam) return NextResponse.json({ info: {} });

  try {
    const ids = idsParam.split(",").filter(Boolean).slice(0, 200);
    if (!ids.length) return NextResponse.json({ info: {} });
    const inList = ids.map((i) => `"${i}"`).join(",");
    const r = await fetch(
      `${SB_URL}/rest/v1/bids?id=in.(${encodeURIComponent(inList)})&customerId=eq.${encodeURIComponent(user.id)}&select=id,auto_accept_at,bidder_tier,status`,
      { headers: SB_READ }
    );
    const rows = await r.json().catch(() => []);
    const info: Record<string, { auto_accept_at: string | null; bidder_tier: string | null; status: string }> = {};
    for (const row of rows as any[]) {
      info[row.id] = {
        auto_accept_at: row.auto_accept_at || null,
        bidder_tier:    row.bidder_tier || null,
        status:         row.status,
      };
    }
    return NextResponse.json({ info });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
