import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, decodeJwt } from "@/lib/sb";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/partner/circle — live StayCircle investments scoped to the
// signed-in hotel partner. A circle_property can carry a soft `hotel_id`
// link to public.hotels; this route surfaces every circle property linked
// to a hotel the partner owns + the investor bundles touching them.
// Auth: partner Bearer token (same pattern as /api/partner/bids).
export async function GET(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = decodeJwt(token);
  if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  try {
    const ownerIds = await resolveOwnerIdsCrossPool(payload.id, payload.phone, payload.email);
    const hr = await fetch(
      `${SB_URL}/rest/v1/hotels?ownerId=in.(${ownerIds.join(",")})&select=id,name`,
      { headers: SB_H },
    );
    const hotels = hr.ok ? await hr.json() : [];
    if (!Array.isArray(hotels) || !hotels.length) {
      return NextResponse.json({ properties: [], bundles: [], kpis: null });
    }
    const hotelIds = hotels.map((h: any) => String(h.id));

    const pr = await fetch(
      `${SB_URL}/rest/v1/circle_properties?hotel_id=in.(${hotelIds.map((i) => `"${i}"`).join(",")})&select=*&order=sort_order.asc`,
      { headers: SB_H },
    );
    const properties = pr.ok ? await pr.json() : [];
    if (!Array.isArray(properties) || !properties.length) {
      return NextResponse.json({ properties: [], bundles: [], kpis: { linked: 0 } });
    }
    const propIds = properties.map((p: any) => String(p.id));

    const [rtR, bundlesR] = await Promise.all([
      fetch(
        `${SB_URL}/rest/v1/circle_room_types?property_id=in.(${propIds.map((i) => `"${i}"`).join(",")})&select=*&order=sort_order.asc`,
        { headers: SB_H },
      ),
      fetch(`${SB_URL}/rest/v1/circle_bundles?status=in.(active,completed)&select=*&order=created_at.desc&limit=300`, { headers: SB_H }),
    ]);
    const roomTypes = rtR.ok ? await rtR.json() : [];
    const allBundles = bundlesR.ok ? await bundlesR.json() : [];

    // A bundle touches this partner when ANY item points at one of their
    // circle properties (items is a JSONB array — filter in memory).
    const bundles = (Array.isArray(allBundles) ? allBundles : [])
      .map((b: any) => {
        const items = (Array.isArray(b.items) ? b.items : []).filter((it: any) =>
          propIds.includes(String(it?.propertyId || "")),
        );
        return items.length ? { ...b, items, contact: undefined, user_id: undefined } : null;
      })
      .filter(Boolean);

    const investedRooms = bundles.reduce(
      (s: number, b: any) => s + b.items.reduce((x: number, it: any) => x + (Number(it.rooms) || 0), 0),
      0,
    );
    const monthlyInflow = bundles.reduce(
      (s: number, b: any) =>
        s + b.items.reduce((x: number, it: any) => x + (Number(it.monthlyRate) || 0) * (Number(it.rooms) || 0), 0),
      0,
    );

    return NextResponse.json({
      properties: properties.map((p: any) => ({
        ...p,
        roomTypes: (Array.isArray(roomTypes) ? roomTypes : []).filter(
          (rt: any) => String(rt.property_id) === String(p.id),
        ),
      })),
      bundles,
      kpis: {
        linked: properties.length,
        investorBundles: bundles.length,
        investedRooms,
        monthlyInflow,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { properties: [], bundles: [], kpis: null, error: String(e?.message || e).slice(0, 160) },
      { status: 200 },
    );
  }
}
