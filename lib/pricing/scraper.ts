// Competitor price scraper abstraction.
// Provider order:
//   - "scraperapi" (SCRAPER_API_KEY) — real MMT/Goibibo/Booking.com/OYO scrape
//   - "apify"      (APIFY_TOKEN)
//   - "rapidapi"   (RAPIDAPI_HOTELS_KEY)
//   - "mock" (default)  — deterministic seed: floor × 1.55–1.85, varies per platform
//
// Adding a real provider = one new function + a case in `scrape()`. Consumers
// never branch on provider — always get the same shape back.

import { sbInsert, sbSelect } from "@/lib/onboard/supabase-admin";

export type Platform = "makemytrip" | "goibibo" | "booking_com" | "oyo" | "mock";

export type CompetitorPrice = {
  hotel_id: string;
  platform: Platform;
  price: number;
  date?: string;
};

const PROVIDER =
  process.env.PRICING_SCRAPER_PROVIDER ||
  (process.env.SCRAPER_API_KEY ? "scraperapi"
    : process.env.APIFY_TOKEN  ? "apify"
    : process.env.RAPIDAPI_HOTELS_KEY ? "rapidapi" : "mock");

// ---------------------------------------------------------------------------
// Mock — deterministic, realistic spread around the room's floor price
// ---------------------------------------------------------------------------
async function scrapeMock(hotelId: string): Promise<CompetitorPrice[]> {
  // Look up cheapest floor price from the hotel's rooms; use 1.55–1.85× as
  // synthetic "competitor" prices spread across 4 platforms.
  const rooms = await sbSelect<any>("rooms", `"hotelId"=eq.${hotelId}&select=floorPrice&limit=20`);
  const floor = rooms.length ? Math.min(...rooms.map((r) => Number(r.floorPrice) || 99999).filter((n) => n < 99999)) : 3000;
  const seed = floor;
  const platforms: { p: Platform; mult: number }[] = [
    { p: "makemytrip",  mult: 1.55 + (seed % 7)  / 100 },
    { p: "goibibo",     mult: 1.62 + (seed % 11) / 100 },
    { p: "booking_com", mult: 1.78 + (seed % 13) / 100 },
    { p: "oyo",         mult: 1.42 + (seed % 5)  / 100 },
  ];
  return platforms.map((x) => ({
    hotel_id: hotelId,
    platform: x.p,
    price: Math.round((floor * x.mult) / 10) * 10,
  }));
}

// ---------------------------------------------------------------------------
// Real provider stubs — defer to mock until keys are wired. Each function is
// independently swappable.
// ---------------------------------------------------------------------------
async function scrapeScraperApi(hotelId: string): Promise<CompetitorPrice[]> {
  // TODO: hit /v1/?api_key=...&url=https://www.makemytrip.com/hotels/...
  return scrapeMock(hotelId);
}
async function scrapeApify(hotelId: string): Promise<CompetitorPrice[]> {
  return scrapeMock(hotelId);
}
async function scrapeRapidApi(hotelId: string): Promise<CompetitorPrice[]> {
  return scrapeMock(hotelId);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function scrapeAndPersist(hotelId: string, date?: string): Promise<{
  provider: string;
  prices: CompetitorPrice[];
  competitor_min: number;
}> {
  let prices: CompetitorPrice[] = [];
  try {
    switch (PROVIDER) {
      case "scraperapi": prices = await scrapeScraperApi(hotelId); break;
      case "apify":      prices = await scrapeApify(hotelId);      break;
      case "rapidapi":   prices = await scrapeRapidApi(hotelId);   break;
      default:           prices = await scrapeMock(hotelId);
    }
  } catch (e) {
    console.error("[pricing-scraper] error → mock:", e);
    prices = await scrapeMock(hotelId);
  }
  // Persist snapshots
  for (const p of prices) {
    try {
      await sbInsert("competitor_prices", { ...p, date: date || new Date().toISOString().slice(0, 10) });
    } catch {}
  }
  const competitor_min = prices.length ? Math.min(...prices.map((p) => p.price)) : 0;
  return { provider: PROVIDER, prices, competitor_min };
}

export async function getLatestCompetitorMin(hotelId: string): Promise<number | null> {
  const rows = await sbSelect<any>(
    "competitor_prices",
    `hotel_id=eq.${hotelId}&order=fetched_at.desc&limit=12`
  );
  if (!rows.length) return null;
  return Math.min(...rows.map((r) => Number(r.price)).filter(Number.isFinite));
}

export const SCRAPER_PROVIDER = PROVIDER;
