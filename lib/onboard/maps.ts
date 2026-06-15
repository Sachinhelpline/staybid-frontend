// Google Places abstraction.
// - Real mode: GOOGLE_MAPS_API_KEY → Places Autocomplete + Place Details
// - Mock mode: deterministic seed for India cities so UI works without a key

export type PlaceSuggestion = {
  placeId: string;
  description: string;
  primary: string;
  secondary: string;
};

export type PlaceDetails = {
  placeId: string;
  name: string;
  formattedAddress: string;
  city?: string;
  state?: string;
  country?: string;
  pincode?: string;
  lat: number;
  lng: number;
  phone?: string;
  website?: string;
  rating?: number;
  reviewCount?: number;
  photos?: string[];
};

const KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
const PROVIDER = KEY ? "google" : "mock";

// ---- Real Google Places --------------------------------------------------
async function autocompleteGoogle(input: string, country = "in"): Promise<PlaceSuggestion[]> {
  const u = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
  u.searchParams.set("input", input);
  u.searchParams.set("types", "lodging");
  u.searchParams.set("components", `country:${country}`);
  u.searchParams.set("key", KEY!);
  const r = await fetch(u);
  if (!r.ok) throw new Error(`Places autocomplete ${r.status}`);
  const j: any = await r.json();
  return (j.predictions || []).slice(0, 8).map((p: any) => ({
    placeId: p.place_id,
    description: p.description,
    primary: p.structured_formatting?.main_text || p.description,
    secondary: p.structured_formatting?.secondary_text || "",
  }));
}

async function detailsGoogle(placeId: string): Promise<PlaceDetails> {
  const u = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  u.searchParams.set("place_id", placeId);
  u.searchParams.set("fields", "place_id,name,formatted_address,address_components,geometry,formatted_phone_number,international_phone_number,website,rating,user_ratings_total,photos");
  u.searchParams.set("key", KEY!);
  const r = await fetch(u);
  if (!r.ok) throw new Error(`Place details ${r.status}`);
  const j: any = await r.json();
  const p = j.result || {};
  const comps: any[] = p.address_components || [];
  const find = (t: string) => comps.find((c) => c.types.includes(t))?.long_name;
  const photos = (p.photos || []).slice(0, 8).map((ph: any) =>
    `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1600&photoreference=${ph.photo_reference}&key=${KEY}`
  );
  return {
    placeId: p.place_id,
    name: p.name,
    formattedAddress: p.formatted_address,
    city: find("locality") || find("administrative_area_level_2"),
    state: find("administrative_area_level_1"),
    country: find("country"),
    pincode: find("postal_code"),
    lat: p.geometry?.location?.lat,
    lng: p.geometry?.location?.lng,
    phone: p.international_phone_number || p.formatted_phone_number,
    website: p.website,
    rating: p.rating,
    reviewCount: p.user_ratings_total,
    photos,
  };
}

// ---- Public API ---------------------------------------------------------
// v263.2 — HONEST mode: when there is no real Google Places key we no longer
// return fabricated "The {name} Grand / Heritage Lane / +91 98XXXXXXXX"
// suggestions. We return zero results + `unavailable: true` so the wizard tells
// the owner "Google lookup is unavailable — fill the fields manually" instead
// of dumping fake data the user might mistake for real (Sachin: "your property
// on Google main kuch bhi aa raha hai").
export async function placesAutocomplete(input: string): Promise<{ provider: string; results: PlaceSuggestion[]; unavailable?: boolean }> {
  if (!input || input.length < 2) return { provider: PROVIDER, results: [] };
  if (PROVIDER === "google") {
    try {
      return { provider: "google", results: await autocompleteGoogle(input) };
    } catch (e) {
      console.error("[maps] autocomplete error:", e);
      return { provider: "google", results: [], unavailable: true };
    }
  }
  // No real key → no fake suggestions.
  return { provider: "mock", results: [], unavailable: true };
}

export async function placeDetails(placeId: string): Promise<{ provider: string; place: PlaceDetails | null; unavailable?: boolean }> {
  if (PROVIDER === "google" && !placeId.startsWith("mock-")) {
    try {
      return { provider: "google", place: await detailsGoogle(placeId) };
    } catch (e) {
      console.error("[maps] details error:", e);
      return { provider: "google", place: null, unavailable: true };
    }
  }
  // No real key (or a stale mock id) → return nothing rather than fabricate.
  return { provider: "mock", place: null, unavailable: true };
}

export const MAPS_PROVIDER = PROVIDER;
