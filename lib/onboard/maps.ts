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

// ---- Mock ---------------------------------------------------------------
const MOCK_CITIES: Record<string, { lat: number; lng: number; state: string; pin: string }> = {
  mussoorie:   { lat: 30.4598, lng: 78.0664, state: "Uttarakhand", pin: "248179" },
  dhanaulti:   { lat: 30.4262, lng: 78.2376, state: "Uttarakhand", pin: "249179" },
  rishikesh:   { lat: 30.0869, lng: 78.2676, state: "Uttarakhand", pin: "249201" },
  shimla:      { lat: 31.1048, lng: 77.1734, state: "Himachal Pradesh", pin: "171001" },
  manali:      { lat: 32.2396, lng: 77.1887, state: "Himachal Pradesh", pin: "175131" },
  dehradun:    { lat: 30.3165, lng: 78.0322, state: "Uttarakhand", pin: "248001" },
  delhi:       { lat: 28.6139, lng: 77.2090, state: "Delhi", pin: "110001" },
  mumbai:      { lat: 19.0760, lng: 72.8777, state: "Maharashtra", pin: "400001" },
  jaipur:      { lat: 26.9124, lng: 75.7873, state: "Rajasthan", pin: "302001" },
  goa:         { lat: 15.2993, lng: 74.1240, state: "Goa", pin: "403001" },
};

function autocompleteMock(input: string): PlaceSuggestion[] {
  const q = input.toLowerCase().trim();
  const tokens = q.split(/\s+/).filter(Boolean);
  const cityHit = Object.keys(MOCK_CITIES).find((c) => tokens.some((t) => c.includes(t) || t.includes(c)));
  const city = cityHit || "mussoorie";
  const titleCity = city.charAt(0).toUpperCase() + city.slice(1);
  const baseName = input.trim() || "Hotel";
  return [
    `The ${baseName} Grand`, `${baseName} Heritage Palace`, `${baseName} Resort & Spa`,
    `${baseName} Boutique Stay`, `${baseName} Mountain View`, `${baseName} Riverside Retreat`,
  ].map((name, i) => ({
    placeId: `mock-${city}-${i}-${name.toLowerCase().replace(/\s+/g, "-")}`,
    description: `${name}, ${titleCity}, ${MOCK_CITIES[city].state}`,
    primary: name,
    secondary: `${titleCity}, ${MOCK_CITIES[city].state}, India`,
  }));
}

function detailsMock(placeId: string): PlaceDetails {
  const parts = placeId.split("-");
  const city = parts[1] || "mussoorie";
  const idx = parseInt(parts[2] || "0", 10);
  const name = (parts.slice(3).join(" ") || "Hotel").replace(/\b\w/g, (c) => c.toUpperCase());
  const meta = MOCK_CITIES[city] || MOCK_CITIES.mussoorie;
  // Tiny offset per index so multiple hotels don't share the exact same coords
  const offset = (idx + 1) * 0.0015;
  return {
    placeId,
    name,
    formattedAddress: `Heritage Lane, ${city.charAt(0).toUpperCase() + city.slice(1)}, ${meta.state}, ${meta.pin}, India`,
    city: city.charAt(0).toUpperCase() + city.slice(1),
    state: meta.state,
    country: "India",
    pincode: meta.pin,
    lat: meta.lat + offset,
    lng: meta.lng + offset,
    phone: "+91 98XXXXXXXX",
    website: undefined,
    rating: 4.5,
    reviewCount: 320,
    photos: [
      "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=1600",
      "https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=1600",
      "https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=1600",
      "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=1600",
    ],
  };
}

// ---- Public API ---------------------------------------------------------
export async function placesAutocomplete(input: string): Promise<{ provider: string; results: PlaceSuggestion[] }> {
  if (!input || input.length < 2) return { provider: PROVIDER, results: [] };
  try {
    if (PROVIDER === "google") return { provider: "google", results: await autocompleteGoogle(input) };
  } catch (e) { console.error("[maps] autocomplete fallback to mock:", e); }
  return { provider: "mock", results: autocompleteMock(input) };
}

export async function placeDetails(placeId: string): Promise<{ provider: string; place: PlaceDetails | null }> {
  try {
    if (PROVIDER === "google" && !placeId.startsWith("mock-")) {
      return { provider: "google", place: await detailsGoogle(placeId) };
    }
  } catch (e) { console.error("[maps] details fallback to mock:", e); }
  return { provider: "mock", place: detailsMock(placeId) };
}

export const MAPS_PROVIDER = PROVIDER;
