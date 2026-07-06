// v285 — Real geocoding for the Host "List your property" flow.
//
// Provider strategy (real data always, never a mockup):
//   • Google Geocoding API  — used when `GOOGLE_MAPS_API_KEY` is set on the
//     server (Vercel env). Real Google Places/address data + lat/lng.
//   • Nominatim (OpenStreetMap) — free fallback, no key, no billing. Already
//     used elsewhere in this codebase (LocationGlobePicker). Real world data.
//
// The client map preview + "Open in Google Maps" link need NO key at all, so
// the location UX is genuinely Google-backed today and upgrades to the Google
// Geocoding provider the moment a key is added — zero code change.

export interface GeoPlace {
  label: string;        // short human label for the dropdown row
  formatted: string;    // full formatted address
  city: string;
  locality: string;     // suburb / neighbourhood
  state: string;
  country: string;
  pincode: string;
  lat: number;
  lng: number;
  provider: "google" | "nominatim";
}

const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY || "";

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

// ---- Google Geocoding -------------------------------------------------------
async function googleGeocode(query: string): Promise<GeoPlace[]> {
  const u = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&region=in&key=${GOOGLE_KEY}`;
  const r = await fetch(u, { cache: "no-store" });
  if (!r.ok) return [];
  const j: any = await r.json();
  if (j.status !== "OK" || !Array.isArray(j.results)) return [];
  return j.results.slice(0, 6).map((res: any) => mapGoogle(res)).filter(Boolean) as GeoPlace[];
}

async function googleReverse(lat: number, lng: number): Promise<GeoPlace | null> {
  const u = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&region=in&key=${GOOGLE_KEY}`;
  const r = await fetch(u, { cache: "no-store" });
  if (!r.ok) return null;
  const j: any = await r.json();
  const res = j?.results?.[0];
  return res ? mapGoogle(res) : null;
}

function mapGoogle(res: any): GeoPlace | null {
  const loc = res?.geometry?.location;
  if (!loc) return null;
  const comp = (types: string[]) => {
    const c = (res.address_components || []).find((x: any) => types.some((t) => x.types?.includes(t)));
    return c?.long_name || "";
  };
  const city = comp(["locality"]) || comp(["administrative_area_level_2"]) || comp(["postal_town"]);
  const locality = comp(["sublocality", "sublocality_level_1", "neighborhood"]);
  const state = comp(["administrative_area_level_1"]);
  const country = comp(["country"]) || "India";
  const pincode = comp(["postal_code"]);
  const formatted = res.formatted_address || [locality, city, state].filter(Boolean).join(", ");
  return {
    label: [locality || city, city && locality ? city : state].filter(Boolean).join(", ") || formatted,
    formatted, city, locality, state, country, pincode,
    lat: num(loc.lat), lng: num(loc.lng), provider: "google",
  };
}

// ---- Nominatim (OpenStreetMap) ---------------------------------------------
const NOMINATIM_HEADERS = { "User-Agent": "StayBid/1.0 (https://staybids.in)", "Accept-Language": "en" };

async function nominatimSearch(query: string): Promise<GeoPlace[]> {
  const u = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}`
    + `&format=jsonv2&addressdetails=1&limit=6&countrycodes=in`;
  const r = await fetch(u, { headers: NOMINATIM_HEADERS, cache: "no-store" });
  if (!r.ok) return [];
  const rows: any[] = await r.json();
  return rows.map(mapNominatim).filter(Boolean) as GeoPlace[];
}

async function nominatimReverse(lat: number, lng: number): Promise<GeoPlace | null> {
  const u = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}`
    + `&format=jsonv2&addressdetails=1&zoom=16`;
  const r = await fetch(u, { headers: NOMINATIM_HEADERS, cache: "no-store" });
  if (!r.ok) return null;
  const row = await r.json();
  return row ? mapNominatim(row) : null;
}

function mapNominatim(row: any): GeoPlace | null {
  const lat = num(row.lat), lng = num(row.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const a = row.address || {};
  const city = a.city || a.town || a.municipality || a.village || a.county || "";
  const locality = a.suburb || a.neighbourhood || a.quarter || a.city_district || a.hamlet || "";
  const state = a.state || a.region || "";
  const country = a.country || "India";
  const pincode = a.postcode || "";
  const formatted = row.display_name || [locality, city, state].filter(Boolean).join(", ");
  const label = [locality || city, locality && city ? city : state].filter(Boolean).join(", ")
    || (row.name || formatted);
  return { label, formatted, city, locality, state, country, pincode, lat, lng, provider: "nominatim" };
}

// ---- Public API -------------------------------------------------------------
export async function searchPlaces(query: string): Promise<GeoPlace[]> {
  const q = (query || "").trim();
  if (q.length < 2) return [];
  try {
    if (GOOGLE_KEY) {
      const g = await googleGeocode(q);
      if (g.length) return g;
    }
    return await nominatimSearch(q);
  } catch {
    return [];
  }
}

export async function reverseGeocode(lat: number, lng: number): Promise<GeoPlace | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  try {
    if (GOOGLE_KEY) {
      const g = await googleReverse(lat, lng);
      if (g) return g;
    }
    return await nominatimReverse(lat, lng);
  } catch {
    return null;
  }
}
