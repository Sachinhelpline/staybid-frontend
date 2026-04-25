// Hotel details "deep fetch" — given a search hit, build a full editable
// HotelDraft (description, photos, amenities, room types). Like search-provider,
// providers are pluggable and switch on env vars.
//
// Legal-safer default: use Google Hotels public data (SerpAPI property_details)
// + the hotel's own website (when discoverable). Owner consent tick is required
// before going live, so the user always confirms photo usage rights.

import type { HotelSearchResult } from "./search-provider";

export type RoomDraft = {
  type: string;          // "Deluxe", "Suite", etc.
  capacity: number;
  basePrice: number;
  floorPrice: number;
  amenities: string[];
};

export type HotelDraftPayload = {
  name: string;
  description: string;
  city: string;
  state?: string;
  country: string;
  address: string;
  starRating: number;
  rating?: number;
  reviewCount?: number;
  photos: string[];
  amenities: string[];
  rooms: RoomDraft[];
  contact: { phone?: string; email?: string; website?: string };
  policies: { checkIn?: string; checkOut?: string; cancellation?: string };
  source: string;
  sourceRef: string;
};

const PROVIDER =
  process.env.HOTEL_DETAILS_PROVIDER ||
  (process.env.SERPAPI_KEY ? "serpapi" : "mock");

// ----------------------------------------------------------------------------
// SerpAPI property details
// ----------------------------------------------------------------------------
async function fetchSerpApi(hit: HotelSearchResult): Promise<HotelDraftPayload> {
  const params = new URLSearchParams({
    engine: "google_hotels",
    property_token: hit.sourceRef,
    api_key: process.env.SERPAPI_KEY!,
    currency: "INR",
    gl: "in",
    hl: "en",
    check_in_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    check_out_date: new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10),
    adults: "2",
  });
  const r = await fetch(`https://serpapi.com/search.json?${params}`);
  if (!r.ok) throw new Error(`SerpAPI details ${r.status}`);
  const j: any = await r.json();
  const photos = (j.images || []).slice(0, 12).map((i: any) => i.original_image || i.thumbnail).filter(Boolean);
  const amenities = (j.amenities || []).map((a: any) => a.name || a).filter(Boolean);
  const rooms = (j.featured_prices || []).slice(0, 4).map((rp: any, i: number) => ({
    type: rp.name || ["Deluxe Room", "Premium Suite", "Executive Suite", "Family Room"][i] || "Standard Room",
    capacity: 2,
    basePrice: rp.rate_per_night?.extracted_lowest || hit.priceHint || 4999,
    floorPrice: Math.round(((rp.rate_per_night?.extracted_lowest || hit.priceHint || 4999) as number) * 0.78),
    amenities: ["AC", "WiFi", "TV"],
  }));
  return {
    name: hit.name,
    description: j.description || `${hit.name} is a ${hit.starRating || 4}-star property in ${hit.city}.`,
    city: hit.city,
    country: "India",
    address: hit.address || j.address || "",
    starRating: hit.starRating || j.hotel_class || 4,
    rating: hit.rating || j.overall_rating,
    reviewCount: hit.reviewCount || j.reviews,
    photos,
    amenities,
    rooms: rooms.length ? rooms : mockRooms(hit.priceHint || 4999),
    contact: { website: hit.link, phone: j.phone, email: j.email },
    policies: { checkIn: j.check_in_time || "14:00", checkOut: j.check_out_time || "11:00" },
    source: "serpapi",
    sourceRef: hit.sourceRef,
  };
}

// ----------------------------------------------------------------------------
// Mock — pre-populated realistic hotel so wizard works end-to-end without keys
// ----------------------------------------------------------------------------
function mockRooms(base: number): RoomDraft[] {
  return [
    { type: "Deluxe Room", capacity: 2, basePrice: base, floorPrice: Math.round(base * 0.78), amenities: ["AC", "WiFi", "TV", "Mountain View"] },
    { type: "Premium Suite", capacity: 3, basePrice: Math.round(base * 1.4), floorPrice: Math.round(base * 1.1), amenities: ["AC", "WiFi", "TV", "Balcony", "Mini Bar"] },
    { type: "Family Suite", capacity: 4, basePrice: Math.round(base * 1.8), floorPrice: Math.round(base * 1.4), amenities: ["AC", "WiFi", "TV", "Living Room", "Kitchenette"] },
  ];
}

function fetchMock(hit: HotelSearchResult): HotelDraftPayload {
  const base = hit.priceHint || 4999;
  const photos = [
    "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=1600",
    "https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=1600",
    "https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=1600",
    "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=1600",
    "https://images.unsplash.com/photo-1455587734955-081b22074882?w=1600",
    "https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=1600",
    "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=1600",
    "https://images.unsplash.com/photo-1578683010236-d716f9a3f461?w=1600",
  ];
  return {
    name: hit.name,
    description: `${hit.name} is a ${hit.starRating || 4}-star ${hit.city} retreat curated for discerning travellers — featuring panoramic views, contemporary luxury rooms, an in-house multi-cuisine restaurant, and concierge services. Perfectly placed for both leisure and business stays.`,
    city: hit.city,
    state: "Uttarakhand",
    country: "India",
    address: hit.address || `Heritage Lane, ${hit.city}, Uttarakhand 248179`,
    starRating: hit.starRating || 4,
    rating: hit.rating || 4.5,
    reviewCount: hit.reviewCount || 320,
    photos,
    amenities: [
      "Free WiFi", "24/7 Room Service", "Multi-cuisine Restaurant", "Spa & Wellness",
      "Swimming Pool", "Gym", "Free Parking", "Airport Shuttle", "Concierge",
      "Laundry Service", "Pet Friendly", "Family Rooms",
    ],
    rooms: mockRooms(base),
    contact: { website: hit.link, phone: "+91 98XXXXXXXX", email: "stay@example.com" },
    policies: { checkIn: "14:00", checkOut: "11:00", cancellation: "Free cancellation up to 24 hours before check-in." },
    source: "mock",
    sourceRef: hit.sourceRef,
  };
}

export async function fetchHotelDetails(hit: HotelSearchResult): Promise<{
  provider: string;
  draft: HotelDraftPayload;
}> {
  try {
    if (PROVIDER === "serpapi" && hit.source === "serpapi") {
      return { provider: "serpapi", draft: await fetchSerpApi(hit) };
    }
    return { provider: "mock", draft: fetchMock(hit) };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[details-fetcher] error, falling back to mock:", e);
    return { provider: "mock-fallback", draft: fetchMock(hit) };
  }
}

export const DETAILS_PROVIDER = PROVIDER;
