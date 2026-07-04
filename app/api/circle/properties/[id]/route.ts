import { NextResponse } from "next/server";
import { SB_URL, SB_H } from "@/lib/sb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/circle/properties/[id]
// Single StayCircle property + its room types for the full property tour
// (/circle/[id], a hotel-page replica). Not sbCached — the tour page is a
// per-property detail view; CDN headers cover repeat opens (v131.7 strip fix).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pid = String(id || "").trim();
  if (!pid) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    const [propR, rtR] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/circle_properties?id=eq.${encodeURIComponent(pid)}&select=*&limit=1`, { headers: SB_H }),
      fetch(`${SB_URL}/rest/v1/circle_room_types?property_id=eq.${encodeURIComponent(pid)}&active=eq.true&select=*&order=sort_order.asc`, { headers: SB_H }),
    ]);
    const rows = propR.ok ? await propR.json() : [];
    const p = Array.isArray(rows) ? rows[0] : null;
    if (!p) return NextResponse.json({ error: "Property not found" }, { status: 404 });
    const roomTypes = rtR.ok ? await rtR.json() : [];

    const property = {
      id: p.id,
      title: p.title,
      city: p.city,
      state: p.state,
      locationLabel: p.location_label,
      tagline: p.tagline,
      description: p.description,
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
      roomTypes: (Array.isArray(roomTypes) ? roomTypes : []).map((rt: any) => ({
        id: rt.id,
        name: rt.name,
        monthlyRate: Number(rt.monthly_rate) || 0,
        totalUnits: Number(rt.total_units) || 0,
        lockedUnits: Number(rt.locked_units) || 0,
        availableUnits: Math.max(0, (Number(rt.total_units) || 0) - (Number(rt.locked_units) || 0)),
        // v291 — real per-room detail for the room tour + auto-comparison
        description: rt.description || "",
        images: Array.isArray(rt.images) ? rt.images : [],
        amenities: Array.isArray(rt.amenities) ? rt.amenities : [],
        sizeSqft: Number(rt.size_sqft) || 0,
        capacity: Number(rt.capacity) || 0,
        bedType: rt.bed_type || "",
        viewLabel: rt.view_label || "",
        roiPct: Number(rt.roi_pct) || 0,
      })),
    };

    return NextResponse.json(
      { property },
      {
        headers: {
          "Cache-Control": "public, max-age=0, must-revalidate",
          "CDN-Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
          "Vercel-CDN-Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      },
    );
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 160) }, { status: 200 });
  }
}
