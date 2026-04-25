// AI Hotel Search abstraction.
// Searches public hotel directories by name + city across the web.
// Provider order:
//   1. SerpAPI (Google Hotels) — when SERPAPI_KEY is set
//   2. Tavily AI search        — when TAVILY_API_KEY is set
//   3. Mock                    — deterministic, dev-friendly seed data
//
// All providers return the same `HotelSearchResult` shape so the UI never
// branches on provider. To add a new provider (Bing, Brave, RapidAPI Hotels)
// just implement `searchXxx(query, city)` and add a case in `searchHotels()`.

export type HotelSearchResult = {
  source: "serpapi" | "tavily" | "mock" | "manual";
  sourceRef: string;       // provider's stable id (place_id, url, etc.)
  name: string;
  address?: string;
  city: string;
  country?: string;
  rating?: number;          // 0-5
  reviewCount?: number;
  thumbnail?: string;       // single small image url
  starRating?: number;
  priceHint?: number;       // INR/night ballpark
  link?: string;            // hotel's external page
};

const PROVIDER =
  process.env.HOTEL_SEARCH_PROVIDER ||
  (process.env.SERPAPI_KEY ? "serpapi" :
   process.env.TAVILY_API_KEY ? "tavily" : "mock");

// ----------------------------------------------------------------------------
// SerpAPI (Google Hotels engine)
// ----------------------------------------------------------------------------
async function searchSerpApi(query: string, city: string): Promise<HotelSearchResult[]> {
  const params = new URLSearchParams({
    engine: "google_hotels",
    q: `${query} ${city}`,
    api_key: process.env.SERPAPI_KEY!,
    currency: "INR",
    gl: "in",
    hl: "en",
    check_in_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    check_out_date: new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10),
    adults: "2",
  });
  const r = await fetch(`https://serpapi.com/search.json?${params}`);
  if (!r.ok) throw new Error(`SerpAPI ${r.status}`);
  const j: any = await r.json();
  const props = j.properties || j.ads || [];
  return props.slice(0, 12).map((p: any) => ({
    source: "serpapi" as const,
    sourceRef: p.property_token || p.serpapi_property_details_link || p.name,
    name: p.name,
    address: p.address || p.gps_coordinates?.formatted,
    city,
    country: "India",
    rating: p.overall_rating,
    reviewCount: p.reviews,
    thumbnail: p.images?.[0]?.thumbnail || p.thumbnail,
    starRating: p.hotel_class ? parseInt(String(p.hotel_class).match(/\d/)?.[0] || "0") : undefined,
    priceHint: p.rate_per_night?.extracted_lowest || p.total_rate?.extracted_lowest,
    link: p.link,
  }));
}

// ----------------------------------------------------------------------------
// Tavily — generic AI web search; we ask for hotel-shaped results
// ----------------------------------------------------------------------------
async function searchTavily(query: string, city: string): Promise<HotelSearchResult[]> {
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query: `Hotels named "${query}" in ${city} India site:booking.com OR site:makemytrip.com OR site:goibibo.com OR site:agoda.com OR site:google.com/maps`,
      search_depth: "advanced",
      include_images: true,
      max_results: 10,
    }),
  });
  if (!r.ok) throw new Error(`Tavily ${r.status}`);
  const j: any = await r.json();
  return (j.results || []).map((x: any) => ({
    source: "tavily" as const,
    sourceRef: x.url,
    name: (x.title || "").replace(/[-|·].+$/, "").trim(),
    address: x.content?.slice(0, 120),
    city,
    thumbnail: x.image_url || j.images?.[0],
    link: x.url,
  })).filter((x: any) => x.name);
}

// ----------------------------------------------------------------------------
// Mock — realistic, deterministic so the UI works pre-API-key
// ----------------------------------------------------------------------------
function searchMock(query: string, city: string): HotelSearchResult[] {
  const q = query.trim() || "Resort";
  const c = city.trim() || "Mussoorie";
  const base = [
    { suffix: "Grand", stars: 5, price: 8499, rating: 4.7, reviews: 1284 },
    { suffix: "Heritage Palace", stars: 5, price: 12999, rating: 4.8, reviews: 2103 },
    { suffix: "Resort & Spa", stars: 4, price: 4799, rating: 4.4, reviews: 612 },
    { suffix: "Boutique Stay", stars: 3, price: 2899, rating: 4.2, reviews: 188 },
    { suffix: "Mountain View", stars: 4, price: 5499, rating: 4.5, reviews: 743 },
    { suffix: "Riverside Retreat", stars: 4, price: 6299, rating: 4.6, reviews: 901 },
  ];
  const photos = [
    "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=400",
    "https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=400",
    "https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=400",
    "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=400",
    "https://images.unsplash.com/photo-1455587734955-081b22074882?w=400",
    "https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=400",
  ];
  return base.map((b, i) => ({
    source: "mock" as const,
    sourceRef: `mock-${q.toLowerCase().replace(/\s+/g, "-")}-${c.toLowerCase()}-${i}`,
    name: `The ${q} ${b.suffix}`,
    address: `${["Mall Road", "Camel Back Road", "Lake View", "Heritage Lane", "Forest Edge", "Ridge Top"][i]}, ${c}`,
    city: c,
    country: "India",
    rating: b.rating,
    reviewCount: b.reviews,
    thumbnail: photos[i],
    starRating: b.stars,
    priceHint: b.price,
    link: `https://www.google.com/maps/search/${encodeURIComponent(`${q} ${b.suffix} ${c}`)}`,
  }));
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------
export async function searchHotels(query: string, city: string): Promise<{
  provider: string;
  results: HotelSearchResult[];
}> {
  if (!query && !city) return { provider: PROVIDER, results: [] };
  try {
    switch (PROVIDER) {
      case "serpapi":
        return { provider: "serpapi", results: await searchSerpApi(query, city) };
      case "tavily":
        return { provider: "tavily", results: await searchTavily(query, city) };
      default:
        return { provider: "mock", results: searchMock(query, city) };
    }
  } catch (e) {
    // Always degrade gracefully — never block onboarding because of search outage.
    // eslint-disable-next-line no-console
    console.error("[search-provider] error, falling back to mock:", e);
    return { provider: "mock-fallback", results: searchMock(query, city) };
  }
}

export const SEARCH_PROVIDER = PROVIDER;
