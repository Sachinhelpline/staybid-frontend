import { NextResponse } from "next/server";
import { sbSelect } from "@/lib/onboard/supabase-admin";

// GET /api/pricing/competitor/:hotel_id
// Returns the latest snapshot per platform for this hotel + computed minimum.
// Customer-side caller should request only fields below — `competitor_min`
// is fine to expose (we use it for "Best price guaranteed" copy), but
// floor / discount_pct / ai_managed are NOT included.
export async function GET(_req: Request, { params }: { params: { hotel_id: string } }) {
  try {
    const rows = await sbSelect<any>(
      "competitor_prices",
      `hotel_id=eq.${params.hotel_id}&order=fetched_at.desc&limit=24`
    );
    // Keep latest per platform
    const latestByPlatform: Record<string, any> = {};
    for (const r of rows) {
      if (!latestByPlatform[r.platform]) latestByPlatform[r.platform] = r;
    }
    const list = Object.values(latestByPlatform).map((r: any) => ({
      platform: r.platform, price: Number(r.price), fetchedAt: r.fetched_at,
    }));
    const competitor_min = list.length ? Math.min(...list.map((r) => r.price)) : null;
    return NextResponse.json({ platforms: list, competitor_min });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "competitor fetch failed" }, { status: 500 });
  }
}
