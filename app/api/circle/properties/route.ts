import { NextResponse } from "next/server";
import { SB_URL, SB_H } from "@/lib/sb";
import { sbCached } from "@/lib/sb-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/circle/properties?city=&maxBudget=&model=
// Public Discover feed for StayCircle. Returns active investment properties
// with room types + live availability (total_units - locked_units).
// Shared catalog reads go through sbCached (v93 discipline); the CDN headers
// use CDN-Cache-Control + Vercel-CDN-Cache-Control (v131.7 strip fix).
const TTL_CATALOG = 60_000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const city = (url.searchParams.get("city") || "").trim();
  const model = (url.searchParams.get("model") || "").trim();
  const maxBudget = Number(url.searchParams.get("maxBudget") || 0);

  try {
    const [props, roomTypes] = await Promise.all([
      sbCached(
        "circle:properties",
        () =>
          fetch(
            `${SB_URL}/rest/v1/circle_properties?status=in.(active,sold_out,coming_soon)&select=*&order=sort_order.asc`,
            { headers: SB_H },
          ).then((r) => (r.ok ? r.json() : [])),
        TTL_CATALOG,
      ),
      sbCached(
        "circle:room_types",
        () =>
          fetch(
            `${SB_URL}/rest/v1/circle_room_types?active=eq.true&select=*&order=sort_order.asc`,
            { headers: SB_H },
          ).then((r) => (r.ok ? r.json() : [])),
        TTL_CATALOG,
      ),
    ]);

    const rtByProp: Record<string, any[]> = {};
    (Array.isArray(roomTypes) ? roomTypes : []).forEach((rt: any) => {
      const pid = String(rt.property_id);
      if (!rtByProp[pid]) rtByProp[pid] = [];
      rtByProp[pid].push({
        id: rt.id,
        name: rt.name,
        monthlyRate: Number(rt.monthly_rate) || 0,
        totalUnits: Number(rt.total_units) || 0,
        lockedUnits: Number(rt.locked_units) || 0,
        availableUnits: Math.max(0, (Number(rt.total_units) || 0) - (Number(rt.locked_units) || 0)),
        // v292 — per-room detail so the full-screen room-tour reel can render
        // without an extra detail fetch per property. Additive: legacy consumers
        // (bottom-sheet room rows) simply ignore these fields.
        description: rt.description || "",
        images: Array.isArray(rt.images) ? rt.images.filter(Boolean) : [],
        amenities: Array.isArray(rt.amenities) ? rt.amenities.filter(Boolean) : [],
        sizeSqft: Number(rt.size_sqft) || 0,
        capacity: Number(rt.capacity) || 0,
        bedType: rt.bed_type || "",
        viewLabel: rt.view_label || "",
        roiPct: Number(rt.roi_pct) || 0,
      });
    });

    let list = (Array.isArray(props) ? props : []).map((p: any) => ({
      id: p.id,
      title: p.title,
      city: p.city,
      state: p.state,
      locationLabel: p.location_label,
      tagline: p.tagline,
      images: Array.isArray(p.images) ? p.images : [],
      videoUrl: p.video_url || null,
      roomsLabel: p.rooms_label,
      viewLabel: p.view_label,
      monthlyRate: Number(p.monthly_rate) || 0,
      roiMin: Number(p.roi_min_pct) || 0,
      roiMax: Number(p.roi_max_pct) || 0,
      occupancyLabel: p.occupancy_label,
      badges: Array.isArray(p.badges) ? p.badges : [],
      operationModel: p.operation_model || "managed",
      status: p.status,
      roomTypes: rtByProp[String(p.id)] || [],
    }));

    if (city && city.toLowerCase() !== "all") {
      list = list.filter((p) => String(p.city).toLowerCase() === city.toLowerCase());
    }
    if (model && model !== "all") {
      list = list.filter((p) => p.operationModel === model);
    }
    if (maxBudget > 0) {
      list = list.filter((p) => p.monthlyRate <= maxBudget);
    }

    const cities: string[] = [];
    (Array.isArray(props) ? props : []).forEach((p: any) => {
      if (p.city && !cities.includes(p.city)) cities.push(p.city);
    });

    return NextResponse.json(
      { properties: list, cities },
      {
        headers: {
          "Cache-Control": "public, max-age=0, must-revalidate",
          "CDN-Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
          "Vercel-CDN-Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      },
    );
  } catch (e: any) {
    return NextResponse.json(
      { properties: [], cities: [], error: String(e?.message || e).slice(0, 160) },
      { status: 200 },
    );
  }
}
