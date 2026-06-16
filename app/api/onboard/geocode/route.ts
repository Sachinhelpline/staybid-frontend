import { NextResponse } from "next/server";
import { requireOnboardUser } from "@/lib/onboard/jwt";

// Real geotag geocoder for onboarding — OpenStreetMap Nominatim (free, no key,
// works immediately). Runs SERVER-SIDE so we control the User-Agent (Nominatim
// usage policy requires one) and dodge browser CORS. Two modes on one route:
//
//   GET /api/onboard/geocode?lat=..&lng=..   → REVERSE: device GPS → place
//   GET /api/onboard/geocode?q=..            → FORWARD: typed locality → matches
//
// This is the engine behind the onboarding LocationPicker: the owner either taps
// "use my current location" (the real geotag of the property) or searches a
// locality and picks a real geocoded result. Either way we capture a verified
// { city, state, country, area, lat, lng } in one step — no separate manual
// lat/lng entry. Always best-effort: returns an empty result (never throws) so
// the wizard degrades to manual fields if Nominatim is unreachable.

const UA = "StayBidOnboard/1.0 (+https://staybids.in)";
const BASE = "https://nominatim.openstreetmap.org";

type Place = {
  label: string;       // full display string
  city: string;        // best city/town/village
  area: string;        // suburb / neighbourhood / locality
  state: string;
  country: string;
  lat: number;
  lng: number;
};

// Nominatim address object → our normalized shape.
function fromAddress(a: any, display: string, lat: number, lng: number): Place {
  const city =
    a?.city || a?.town || a?.village || a?.municipality ||
    a?.county || a?.state_district || a?.state || "";
  const area =
    a?.suburb || a?.neighbourhood || a?.hamlet || a?.locality ||
    a?.city_district || a?.county || "";
  return {
    label: display || [area, city, a?.state].filter(Boolean).join(", "),
    city: String(city || "").trim(),
    area: String(area || "").trim(),
    state: String(a?.state || "").trim(),
    country: String(a?.country || "India").trim(),
    lat,
    lng,
  };
}

async function reverse(lat: number, lng: number): Promise<Place | null> {
  const u = new URL(`${BASE}/reverse`);
  u.searchParams.set("lat", String(lat));
  u.searchParams.set("lon", String(lng));
  u.searchParams.set("format", "json");
  u.searchParams.set("zoom", "14");
  u.searchParams.set("addressdetails", "1");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch(u, { headers: { "User-Agent": UA, "Accept-Language": "en" }, signal: ctrl.signal });
    if (!r.ok) return null;
    const j: any = await r.json();
    if (!j || j.error) return null;
    return fromAddress(j.address || {}, j.display_name || "", lat, lng);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function forward(q: string): Promise<Place[]> {
  const u = new URL(`${BASE}/search`);
  u.searchParams.set("q", q);
  u.searchParams.set("format", "json");
  u.searchParams.set("addressdetails", "1");
  u.searchParams.set("limit", "6");
  u.searchParams.set("countrycodes", "in");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch(u, { headers: { "User-Agent": UA, "Accept-Language": "en" }, signal: ctrl.signal });
    if (!r.ok) return [];
    const arr: any[] = await r.json();
    if (!Array.isArray(arr)) return [];
    return arr
      .map((p) => fromAddress(p.address || {}, p.display_name || "", parseFloat(p.lat), parseFloat(p.lon)))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && (p.city || p.area));
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

export async function GET(req: Request) {
  try {
    requireOnboardUser(req);
    const sp = new URL(req.url).searchParams;
    const latRaw = sp.get("lat");
    const lngRaw = sp.get("lng");
    const q = (sp.get("q") || "").trim();

    if (latRaw != null && lngRaw != null) {
      const lat = parseFloat(latRaw);
      const lng = parseFloat(lngRaw);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return NextResponse.json({ error: "invalid coordinates", place: null }, { status: 400 });
      }
      const place = await reverse(lat, lng);
      return NextResponse.json({ ok: true, place, available: !!place });
    }

    if (q.length >= 2) {
      const results = await forward(q);
      return NextResponse.json({ ok: true, results, available: results.length > 0 });
    }

    return NextResponse.json({ ok: true, results: [] });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "geocode failed" }, { status: 500 });
  }
}
