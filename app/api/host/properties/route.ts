import { NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";

export const dynamic = "force-dynamic";

// GET /api/host/properties — available discovery properties.
// Optional ?city=, ?type=<property_type>, ?max=<rent>, ?featured=1.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const city = url.searchParams.get("city");
  const type = url.searchParams.get("type");
  const maxRent = Number(url.searchParams.get("max") || 0);
  const featuredOnly = url.searchParams.get("featured") === "1";

  let q = `${SB_URL}/rest/v1/discovery_properties?status=eq.available`
    + `&select=id,title,city,locality,state,property_type,bhk,area_sqft,furnishing,rent_monthly,deposit,score,images,amenities,source,featured`
    + `&order=featured.desc,score.desc`;
  if (city) q += `&city=eq.${encodeURIComponent(city)}`;
  if (type) q += `&property_type=eq.${encodeURIComponent(type)}`;
  if (maxRent > 0) q += `&rent_monthly=lte.${maxRent}`;
  if (featuredOnly) q += `&featured=eq.true`;

  try {
    const r = await fetch(q, { headers: SB_READ, cache: "no-store" });
    const properties = r.ok ? await r.json() : [];
    // Distinct cities for the filter chips.
    const cr = await fetch(
      `${SB_URL}/rest/v1/discovery_properties?status=eq.available&select=city`,
      { headers: SB_READ, cache: "no-store" },
    );
    const rows = cr.ok ? await cr.json() : [];
    const cities = Array.from(new Set(rows.map((x: any) => x.city).filter(Boolean))).sort();
    return NextResponse.json({ properties, cities });
  } catch (e: any) {
    return NextResponse.json({ properties: [], cities: [], error: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }
}
