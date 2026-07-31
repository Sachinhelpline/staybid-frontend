// v309 (Host Property-Listing Redesign, Phase 4) — admin "Approve + Provision".
//
//   POST body { propertyId }
//     → creates the operated StayBid-Circle hotel (+ rooms + units) from the
//       discovery_properties listing, grants the lister dashboard access, then
//       flips the listing status='provisioned' + records provisioned_hotel_id.
//
//   POST body { action:"go_live", hotelId }  (v336 · Circle Phase F)
//     → publishes an already-provisioned host_circle DRAFT hotel to customers
//       (approval_status='approved' + status='active' + isVerified + published_at
//       — byte-identical to the /admin/hotels v262 approve semantics). This is
//       the ops "flip it live" step. It is guarded to owner_type='host_circle'
//       so it can NEVER publish an arbitrary classic hotel, and it never touches
//       ownerId/owner_type — the owner-invisible operated model is preserved.
//
// Idempotent: re-running converges (deterministic hotel/room ids, unit stamping
// only fills the still-unowned pool; a re-published hotel just re-stamps the
// same approved fields). Auth: x-admin-token / x-admin-id.
import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin, auditIdentity } from "@/lib/admin/verify";
import { SB_URL, SB_H } from "@/lib/sb";
import { logAdminAction } from "@/lib/admin/audit";
import { provisionListing } from "@/lib/host/provision";

export const dynamic = "force-dynamic";

const REST = `${SB_URL}/rest/v1`;

export async function POST(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}

  // v336 (Circle Phase F) — publish an already-provisioned operated hotel.
  const action = String(body.action || "provision");
  if (action === "go_live") {
    const hotelId = String(body.hotelId || "").trim();
    if (!hotelId) return NextResponse.json({ error: "hotelId is required" }, { status: 400 });

    // Guard: only a StayBid-operated host_circle hotel may be published here.
    const rows = await fetch(
      `${REST}/hotels?id=eq.${encodeURIComponent(hotelId)}&select=id,owner_type,approval_status`,
      { headers: SB_H, cache: "no-store" },
    ).then((r) => r.json()).catch(() => []);
    const hotel = Array.isArray(rows) ? rows[0] : null;
    if (!hotel) return NextResponse.json({ error: "Hotel not found" }, { status: 404 });
    if (hotel.owner_type !== "host_circle") {
      return NextResponse.json({ error: "Not a host-circle operated hotel" }, { status: 400 });
    }

    // Publish — identical fields to the /admin/hotels approve action. The single
    // customer-feed gate across /api/hotels, /api/discover/feed, /api/flash/near
    // and /api/circle/resale is approval_status='approved'.
    const pr = await fetch(`${REST}/hotels?id=eq.${encodeURIComponent(hotelId)}`, {
      method: "PATCH",
      headers: { ...SB_H, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        approval_status: "approved",
        status: "active",
        isVerified: true,
        published_at: new Date().toISOString(),
      }),
    });
    if (!pr.ok) {
      return NextResponse.json({ error: "Publish failed" }, { status: 502 });
    }

    logAdminAction({
      admin,
      action: "host_hotel_go_live",
      targetType: "hotel",
      targetId: hotelId,
    } as any);

    return NextResponse.json({ ok: true, hotelId, published: true });
  }

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
