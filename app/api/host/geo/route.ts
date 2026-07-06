import { NextResponse } from "next/server";
import { searchPlaces, reverseGeocode } from "@/lib/host/geo";

export const dynamic = "force-dynamic";

// GET /api/host/geo?q=<query>          → real place suggestions (Google→Nominatim)
// GET /api/host/geo?lat=..&lng=..      → reverse geocode a coordinate
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  const lat = url.searchParams.get("lat");
  const lng = url.searchParams.get("lng");

  try {
    if (lat != null && lng != null) {
      const place = await reverseGeocode(Number(lat), Number(lng));
      return NextResponse.json({ place }, {
        headers: { "Cache-Control": "public, max-age=60" },
      });
    }
    const places = await searchPlaces(q || "");
    return NextResponse.json({ places }, {
      headers: { "Cache-Control": "public, max-age=120" },
    });
  } catch (e: any) {
    return NextResponse.json({ places: [], place: null, error: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }
}
