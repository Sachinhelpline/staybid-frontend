import { NextResponse } from "next/server";
import { SB_URL, SB_H, userFromReq } from "@/lib/sb";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Phase 3d — StayCircle → partner-dashboard handoff signal.
//
// Tells the /circle dashboard whether the signed-in investor owns any physical
// rooms yet (i.e. their bundle is active and StayBid has provisioned units).
// When they do, the dashboard surfaces a "Manage your rooms →" card into the
// partner dashboard's operator "My Rooms" tab.
//
// Uses the SAME cross-pool id resolver as /api/partner/hotel, so the count here
// matches exactly what the operator will see after they sign into /partner with
// the same phone. Never leaks another owner's rooms — filtered by owner ids.

export async function GET(req: Request) {
  const user = userFromReq(req);
  if (!user?.id) return NextResponse.json({ ownsUnits: false, unitCount: 0, hotelCount: 0 });

  try {
    const ownerIds = await resolveOwnerIdsCrossPool(user.id, user.phone, user.email);
    const inList = ownerIds.map((i) => encodeURIComponent(i)).join(",");
    const r = await fetch(
      `${SB_URL}/rest/v1/hotel_room_units?owner_user_id=in.(${inList})&status=eq.active&select=hotelId`,
      { headers: SB_H },
    );
    if (!r.ok) return NextResponse.json({ ownsUnits: false, unitCount: 0, hotelCount: 0 });
    const rows = await r.json().catch(() => []);
    const units = Array.isArray(rows) ? rows : [];
    const hotels = new Set(units.map((u: any) => String(u.hotelId)).filter(Boolean));
    return NextResponse.json({
      ownsUnits: units.length > 0,
      unitCount: units.length,
      hotelCount: hotels.size,
    });
  } catch {
    return NextResponse.json({ ownsUnits: false, unitCount: 0, hotelCount: 0 });
  }
}
