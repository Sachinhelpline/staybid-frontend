import { NextRequest, NextResponse } from "next/server";
import { resolveKioskLocation, shapeKioskDeal, minuteBucket, KioskDeal } from "@/lib/kiosk";

// ─────────────────────────────────────────────────────────────────────────
// GET /api/kiosk/feed?loc=<kioskLocId>&city=<city>
//
// Live same-day flash-deal feed for the StayBid offline kiosk. It REUSES the
// canonical `/api/flash/near` engine (Supabase, wired to the hotel + admin
// panels) — no duplicate booking/availability logic — and adds the kiosk's
// stock-market presentation layer (price deltas, ticker stats, distance).
//
// `/api/flash/near` already returns ONLY tonight's still-available deals
// (validUntil > now, unitsFree tonight > 0), so "same-day flash only" is
// inherited for free. Hotels with zero free units are already excluded there.
// ─────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const locId = req.nextUrl.searchParams.get("loc");
  const cityParam = req.nextUrl.searchParams.get("city");
  const loc = resolveKioskLocation(locId);
  const city = cityParam || loc.city;

  // Reuse the canonical flash engine on the SAME origin (single source of
  // truth — wired to hotels + admin). Never throws to the client: any failure
  // degrades to an empty board instead of breaking the kiosk.
  let rawDeals: any[] = [];
  try {
    const url = `${req.nextUrl.origin}/api/flash/near?city=${encodeURIComponent(city)}`;
    const r = await fetch(url, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    rawDeals = Array.isArray(j?.deals) ? j.deals : [];
  } catch {
    rawDeals = [];
  }

  const bucket = minuteBucket();
  const origin = { lat: loc.lat, lng: loc.lng };

  const deals: KioskDeal[] = rawDeals
    .map((d) => shapeKioskDeal(d, bucket, origin))
    .filter((d): d is KioskDeal => !!d && d.aiPrice > 0)
    // Display board sorts by best deal: biggest discount first, then cheapest.
    .sort((a, b) => b.discount - a.discount || a.aiPrice - b.aiPrice);

  // Ticker / footer stats.
  const cheapest = deals.length ? Math.min(...deals.map((d) => d.aiPrice)) : 0;
  const totalRoomsLeft = deals.reduce((s, d) => s + (d.unitsFree || 0), 0);
  const under1000 = deals.filter((d) => d.aiPrice > 0 && d.aiPrice < 1000).length;
  const bestDeal = deals[0] || null;

  const res = NextResponse.json({
    location: { id: loc.id, name: loc.name, city: loc.city },
    city,
    generatedAt: new Date().toISOString(),
    stats: {
      hotelsOnline: deals.length,
      cheapest,
      totalRoomsLeft,
      under1000,
      bestDealName: bestDeal?.hotelName || "",
      bestDealPrice: bestDeal?.aiPrice || 0,
    },
    deals,
  });
  // Kiosk refreshes itself; short edge cache keeps the board snappy without
  // hammering the flash engine when many units share a location.
  res.headers.set("Cache-Control", "public, s-maxage=20, stale-while-revalidate=60");
  res.headers.set("CDN-Cache-Control", "public, s-maxage=20, stale-while-revalidate=60");
  res.headers.set("Vercel-CDN-Cache-Control", "public, s-maxage=20, stale-while-revalidate=60");
  return res;
}
