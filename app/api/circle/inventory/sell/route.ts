// v360 — Circle Model 2: list your purchased room-nights FOR PUBLIC BOOKING.
//
//   POST /api/circle/inventory/sell  { blockId, action: "list" | "pause", price? }
//     A Model-2 buyer holds the SELLING RIGHTS to an owned `inventory_blocks`
//     row (their purchased room-nights on a Circle-operated hotel). This flips
//     those nights between "held" (blocked from guests) and "live for guests":
//       • list  → DELETE the protective invhold (opens the nights) + mark the
//                 unit is_listed + (optional) set the guest price_override.
//                 On an APPROVED host_circle hotel the unit is already an
//                 individual guest listing, so the nights become bookable and a
//                 guest booking that unit carries bids.assignedUnitId → the
//                 buyer's owner_user_id (shows in their owner dashboard).
//       • pause → re-write the invhold (re-block the nights from guests).
//
// Purely additive: touches only THIS buyer's own block/unit + its invhold. No
// core booking-engine change. Auth: customer sb_token → cross-pool owner ids.
// NOTE: the automatic payout of a guest's payment to the buyer is a settlement
// (Railway) phase — this route only controls guest AVAILABILITY, never money.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, decodeJwt } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function auth(req: NextRequest): { userId?: string; phone?: string; email?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub, phone: p?.phone, email: p?.email };
}

export async function POST(req: NextRequest) {
  const { userId, phone, email } = auth(req);
  if (!userId) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const blockId = String(body?.blockId || "").trim();
  const action = String(body?.action || "").trim();
  const price = body?.price === undefined || body?.price === null || body?.price === "" ? null : Math.round(Number(body.price));
  if (!blockId || !["list", "pause"].includes(action)) {
    return NextResponse.json({ error: "blockId + action (list|pause) required." }, { status: 400 });
  }
  if (price !== null && (!Number.isFinite(price) || price < 0 || price > 10_000_000)) {
    return NextResponse.json({ error: "Invalid price." }, { status: 400 });
  }

  const ownerIds = await resolveOwnerIdsCrossPool(userId, phone, email);
  if (!ownerIds.length) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const idsCsv = ownerIds.map((x) => encodeURIComponent(x)).join(",");

  // Load the block + verify the caller owns it and it's a live (owned) holding.
  let block: any = null;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(blockId)}` +
        `&investor_user_id=in.(${idsCsv})&select=*`,
      { headers: SB_H },
    );
    block = (r.ok ? await r.json().catch(() => []) : [])?.[0] || null;
  } catch { /* handled below */ }
  if (!block) return NextResponse.json({ error: "Not your inventory, or it changed — refresh." }, { status: 403 });
  if (!["owned", "listed"].includes(String(block.status))) {
    return NextResponse.json({ error: `A ${String(block.status).replace(/_/g, " ")} block can't be listed.` }, { status: 409 });
  }

  const unitId = block.unit_id ? String(block.unit_id) : "";
  const from = String(block.date_from).slice(0, 10);
  const to = String(block.date_to).slice(0, 10);
  const nowIso = new Date().toISOString();
  const meta = (block.metadata && typeof block.metadata === "object") ? block.metadata : {};

  if (action === "list") {
    // 1) release the protective hold → nights open for guests (best-effort).
    try {
      await fetch(
        `${SB_URL}/rest/v1/room_blocks?id=eq.${encodeURIComponent(`invhold_${blockId}`)}&source=eq.inventory`,
        { method: "DELETE", headers: SB_H },
      );
    } catch { /* non-fatal */ }
    // 2) ensure the unit is a listed guest listing + (optional) set guest price.
    if (unitId) {
      const patch: any = { is_listed: true };
      if (price !== null) patch.price_override = price;
      try {
        await fetch(
          `${SB_URL}/rest/v1/hotel_room_units?id=eq.${encodeURIComponent(unitId)}&owner_user_id=in.(${idsCsv})`,
          { method: "PATCH", headers: { ...SB_H, Prefer: "return=minimal" }, body: JSON.stringify(patch) },
        );
      } catch { /* non-fatal */ }
    }
    // 3) stamp the block so the UI shows "listed".
    try {
      await fetch(`${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(blockId)}`, {
        method: "PATCH", headers: { ...SB_H, Prefer: "return=minimal" },
        body: JSON.stringify({ metadata: { ...meta, publicListed: true, listedAt: nowIso }, updated_at: nowIso }),
      });
    } catch { /* non-fatal */ }
    return NextResponse.json({ ok: true, status: "listed" });
  }

  // action === "pause": re-write the invhold to block the nights from guests.
  if (unitId) {
    let unitNumber: string | null = meta?.roomNumber || null;
    if (!unitNumber) {
      try {
        const ur = await fetch(`${SB_URL}/rest/v1/hotel_room_units?id=eq.${encodeURIComponent(unitId)}&select=roomNumber`, { headers: SB_H });
        unitNumber = (await ur.json().catch(() => []))?.[0]?.roomNumber || null;
      } catch { /* optional */ }
    }
    try {
      await fetch(`${SB_URL}/rest/v1/room_blocks?on_conflict=id`, {
        method: "POST", headers: { ...SB_H, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          id: `invhold_${blockId}`, hotelId: String(block.hotel_id), roomId: String(block.room_id),
          fromDate: from, toDate: to, source: "inventory",
          assignedUnitId: unitId, assignedUnitNumber: unitNumber,
          note: "StayBid Circle B2B hold (paused from public sale)", createdBy: String(block.investor_user_id),
        }),
      });
    } catch { /* non-fatal */ }
  }
  try {
    await fetch(`${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(blockId)}`, {
      method: "PATCH", headers: { ...SB_H, Prefer: "return=minimal" },
      body: JSON.stringify({ metadata: { ...meta, publicListed: false, pausedAt: nowIso }, updated_at: nowIso }),
    });
  } catch { /* non-fatal */ }
  return NextResponse.json({ ok: true, status: "paused" });
}
