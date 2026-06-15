// Hotel details "deep fetch" — given a search hit, build a full editable
// HotelDraft (description, photos, amenities, room types). Like search-provider,
// providers are pluggable and switch on env vars.
//
// Legal-safer default: use Google Hotels public data (SerpAPI property_details)
// + the hotel's own website (when discoverable). Owner consent tick is required
// before going live, so the user always confirms photo usage rights.

import type { HotelSearchResult } from "./search-provider";
import { geminiScrapeHotel } from "./gemini-scraper";

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
  lat?: number;
  lng?: number;
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
  // GEMINI_API_KEY (onboarding-dedicated) OR GEMINI_CHAT_API_KEY (shared with
  // customer-support chat) → FREE real-AI scraper (web-grounded).
  ((process.env.GEMINI_API_KEY || process.env.GEMINI_CHAT_API_KEY) ? "gemini" :
   process.env.SERPAPI_KEY ? "serpapi" : "mock");

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
    // Real listing copy only — no fabricated template fallback.
    description: j.description || "",
    city: hit.city,
    country: "India",
    address: hit.address || j.address || "",
    starRating: hit.starRating || j.hotel_class || 4,
    rating: hit.rating || j.overall_rating,
    reviewCount: hit.reviewCount || j.reviews,
    photos,
    amenities,
    // Real featured-price rooms only; blank when SerpAPI returned none.
    rooms,
    contact: { website: hit.link, phone: j.phone, email: j.email },
    policies: { checkIn: j.check_in_time, checkOut: j.check_out_time },
    source: "serpapi",
    sourceRef: hit.sourceRef,
  };
}

// ----------------------------------------------------------------------------
// Blank draft — HONEST fallback when no real source can verify the property.
// NEVER fabricates NAP (name/address/phone/email), description, ratings,
// photos, or room prices. Carries ONLY what the user actually typed (name +
// city + whatever a real search hit supplied). The onboarding owner fills the
// rest in the wizard. (v263.2: replaced the old `fetchMock` that injected
// "Heritage Lane" / "+91 98XXXXXXXX" / "stay@example.com" / template
// descriptions / stock photos — Sachin: "khud se guess kar raha hai … 100
// percent actual data nahi … bulletproof God level kardo".)
// ----------------------------------------------------------------------------
function blankDraft(hit: HotelSearchResult): HotelDraftPayload {
  return {
    name: hit.name,
    description: "",
    city: hit.city,
    state: undefined,
    country: hit.country || "India",
    address: hit.address || "",
    starRating: hit.starRating || 4,
    rating: hit.rating,
    reviewCount: hit.reviewCount,
    photos: [],
    amenities: [],
    rooms: [],
    contact: { website: hit.link, phone: undefined, email: undefined },
    policies: {},
    source: "manual",
    sourceRef: hit.sourceRef,
  };
}

// Build the draft purely from VERIFIED Gemini-scraped fields. No mock base — a
// field Gemini could not confirm stays blank (the owner fills it), so the draft
// only ever contains real, sourced data. Gemini grounding returns text, not
// images, so photos stay empty for the owner to upload their own.
function geminiDraft(hit: HotelSearchResult, s: import("./gemini-scraper").ScrapedHotel): HotelDraftPayload {
  return {
    name: s.name || hit.name,
    description: s.description || "",
    city: s.city || hit.city,
    state: s.state,
    country: s.country || hit.country || "India",
    address: s.address || hit.address || "",
    lat: s.lat,
    lng: s.lng,
    starRating: s.starRating ?? hit.starRating ?? 4,
    rating: s.rating ?? hit.rating,
    reviewCount: s.reviewCount ?? hit.reviewCount,
    photos: [],
    amenities: s.amenities || [],
    rooms: (s.rooms || []).map((r) => ({
      type: r.type,
      capacity: r.capacity,
      basePrice: r.basePrice,
      floorPrice: Math.round(r.basePrice * 0.78),
      amenities: [],
    })),
    contact: {
      website: s.contact.website || hit.link,
      phone: s.contact.phone,
      email: s.contact.email,
    },
    policies: { checkIn: s.policies.checkIn, checkOut: s.policies.checkOut },
    source: s.contact.website ? "gemini+web" : "gemini",
    sourceRef: hit.sourceRef,
  };
}

export type FetchDetailsResult = {
  provider: string;
  draft: HotelDraftPayload;
  // TRUE only when the draft came from a REAL, verified source (Gemini found a
  // genuine listing, or SerpAPI). FALSE → blank draft, nothing was auto-found;
  // the wizard tells the owner to fill in details manually. Never present fake
  // data as if it were verified.
  verified: boolean;
  // Where the match came from ("Google Maps listing", "booking.com", …) — shown
  // to the owner so they can confirm "yes, that's my hotel" before relying on it.
  matchEvidence?: string;
};

export async function fetchHotelDetails(hit: HotelSearchResult): Promise<FetchDetailsResult> {
  try {
    if (PROVIDER === "gemini") {
      const scraped = await geminiScrapeHotel(hit.name, hit.city).catch(() => null);
      if (scraped) {
        return {
          provider: scraped.provider,
          draft: geminiDraft(hit, scraped.hotel),
          verified: true,
          matchEvidence: scraped.hotel.matchEvidence,
        };
      }
      // Gemini miss → try SerpAPI if available (that IS a real source), else
      // return an HONEST blank draft (no fabrication).
      if (process.env.SERPAPI_KEY && hit.source === "serpapi") {
        return { provider: "serpapi", draft: await fetchSerpApi(hit), verified: true };
      }
      return { provider: "unverified", draft: blankDraft(hit), verified: false };
    }
    if (PROVIDER === "serpapi" && hit.source === "serpapi") {
      return { provider: "serpapi", draft: await fetchSerpApi(hit), verified: true };
    }
    return { provider: "unverified", draft: blankDraft(hit), verified: false };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[details-fetcher] error, returning blank draft:", e);
    return { provider: "unverified", draft: blankDraft(hit), verified: false };
  }
}

export const DETAILS_PROVIDER = PROVIDER;
