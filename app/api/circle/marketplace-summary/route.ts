// v339 — Circle Marketplace Redesign · Phase M0: honest supply counts.
//
// GET /api/circle/marketplace-summary
//   model3 — how many StayBid-OPERATED host-circle properties are ready for
//            Model-3 pre-buy (owner_type=host_circle AND prebuy_enabled=true),
//            plus the distinct cities they span. This is browsable supply,
//            NOT customer-bookable (that needs approval_status=approved).
//   model4 — how many live B2B-exchange listings exist right now
//            (b2b_listings.status=listed).
//
// Read-only, no auth. Used by /circle/model3 + /circle/model4 shells to render
// an HONEST empty / ready state instead of a fake "browse" grid (M1 owns the
// real yearly-calendar marketplace). Fails soft to zeros on any error.

import { NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { curateHotels } from "@/lib/launch/curation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

async function sb(path: string): Promise<any[]> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_H, cache: "no-store" });
    const j = await r.json().catch(() => []);
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

export async function GET() {
  const [prebuyHotelsRaw, liveListings] = await Promise.all([
    sb("hotels?owner_type=eq.host_circle&prebuy_enabled=eq.true&select=id,city"),
    sb("b2b_listings?status=eq.listed&select=id"),
  ]);

  // v536 — launch curation: count/advertise only curated launch host-circle
  // hotels so the Model-3 shell's "N properties · cities" matches the browse.
  const prebuyHotels = curateHotels(prebuyHotelsRaw);

  const cities = Array.from(
    new Set(
      prebuyHotels
        .map((h) => (typeof h?.city === "string" ? h.city.trim() : ""))
        .filter(Boolean),
    ),
  ).sort();

  return NextResponse.json(
    {
      model3: { prebuyHotels: prebuyHotels.length, cities },
      model4: { liveListings: liveListings.length },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
