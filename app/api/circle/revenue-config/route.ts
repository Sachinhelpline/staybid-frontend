import { NextResponse } from "next/server";
import { resolveRevenueConfig } from "@/lib/circle/revenue-config-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/circle/revenue-config — resolved honest-revenue levers for the
// /circle/build "Investment & Returns" panel. Public + CDN-cached 60s (matches
// the store TTL). DISPLAY-ONLY — the checkout charge never reads this.
export async function GET() {
  const config = await resolveRevenueConfig();
  return NextResponse.json(
    { config },
    {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=120",
        "CDN-Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        "Vercel-CDN-Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    },
  );
}
