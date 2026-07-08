// v309 (Host Property-Listing Redesign, Phase 4) — admin "Approve + Provision".
//
//   POST body { propertyId }
//     → creates the operated StayBid-Circle hotel (+ rooms + units) from the
//       discovery_properties listing, grants the lister dashboard access, then
//       flips the listing status='provisioned' + records provisioned_hotel_id.
//
// Idempotent: re-running converges (deterministic hotel/room ids, unit stamping
// only fills the still-unowned pool). Auth: x-admin-token / x-admin-id.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H } from "@/lib/sb";
import { adminFromReq, logAdminAction } from "@/lib/admin/audit";
import { provisionListing } from "@/lib/host/provision";

export const dynamic = "force-dynamic";

const REST = `${SB_URL}/rest/v1`;

export async function POST(req: NextRequest) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const propertyId = String(body.propertyId || body.id || "").trim();
  if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });

  const result = await provisionListing(propertyId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error || "Provision failed" }, { status: 502 });
  }

  // Flip the listing to provisioned + record the operated hotel link (idempotent).
  try {
    await fetch(`${REST}/discovery_properties?id=eq.${encodeURIComponent(propertyId)}`, {
      method: "PATCH",
      headers: { ...SB_H, Prefer: "return=minimal" },
      body: JSON.stringify({
        status: "provisioned",
        provisioned_hotel_id: result.hotelId,
        provisioned_at: new Date().toISOString(),
      }),
    });
  } catch { /* the hotel exists regardless; status flip is best-effort */ }

  logAdminAction({
    admin,
    action: "host_listing_provision",
    targetType: "discovery_property",
    targetId: propertyId,
  } as any);

  return NextResponse.json({ ...result });
}
