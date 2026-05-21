// v170 — Housekeeping room-status board (partner panel, Phase 1).
//
// Per physical room unit: clean / dirty / inspected / out_of_order.
// Stored in room_housekeeping (see migrations/2026-05-21-room-housekeeping.sql).
// Degrades gracefully — if the table is not yet provisioned, GET returns
// an empty map with provisioned:false and PATCH returns a clear message.
//
// Auth: partner Bearer JWT → resolveOwnerIdsCrossPool → hotel ownership.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_H_REPRESENT, sbSelect, decodeJwt } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";

export const dynamic = "force-dynamic";

const VALID = new Set(["clean", "dirty", "inspected", "out_of_order"]);

async function ownedHotelIds(req: NextRequest): Promise<{ ids: string[]; userId: string } | null> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const payload = decodeJwt(token);
  if (!payload?.id) return null;
  const ownerIds = await resolveOwnerIdsCrossPool(
    payload.id,
    payload.phone || req.headers.get("x-phone") || "",
    payload.email || req.headers.get("x-email") || ""
  );
  if (!ownerIds.length) return { ids: [], userId: payload.id };
  const hotels = await sbSelect(`hotels?ownerId=in.(${ownerIds.join(",")})&select=id`);
  return { ids: (Array.isArray(hotels) ? hotels : []).map((h: any) => h.id), userId: payload.id };
}

// GET /api/partner/housekeeping?hotelId=...
export async function GET(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const hotelId = new URL(req.url).searchParams.get("hotelId");
  if (!hotelId || !owned.ids.includes(hotelId))
    return NextResponse.json({ error: "hotelId required / not yours" }, { status: 403 });

  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/room_housekeeping?hotel_id=eq.${encodeURIComponent(hotelId)}&select=*`,
      { headers: SB_H }
    );
    if (!r.ok) {
      // Table not provisioned yet — degrade gracefully.
      return NextResponse.json({ statuses: {}, provisioned: false });
    }
    const rows = await r.json().catch(() => []);
    const statuses: Record<string, any> = {};
    for (const row of Array.isArray(rows) ? rows : []) {
      statuses[row.unit_id] = {
        status: row.status,
        assignedTo: row.assigned_to || "",
        note: row.note || "",
        updatedAt: row.updated_at,
      };
    }
    return NextResponse.json({ statuses, provisioned: true });
  } catch {
    return NextResponse.json({ statuses: {}, provisioned: false });
  }
}

// PATCH /api/partner/housekeeping — set a unit's housekeeping status (upsert)
export async function PATCH(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const { hotelId, unitId, status } = body;
  if (!hotelId || !unitId) return NextResponse.json({ error: "hotelId, unitId required" }, { status: 400 });
  if (!owned.ids.includes(hotelId))
    return NextResponse.json({ error: "Not your hotel" }, { status: 403 });
  if (!VALID.has(String(status)))
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });

  const row = {
    unit_id: unitId,
    hotel_id: hotelId,
    status,
    assigned_to: body.assignedTo != null ? String(body.assignedTo) : null,
    note: body.note != null ? String(body.note) : null,
    updated_by: owned.userId,
    updated_at: new Date().toISOString(),
  };

  try {
    // PostgREST upsert — unit_id is the PK, merge-duplicates updates in place.
    const r = await fetch(`${SB_URL}/rest/v1/room_housekeeping`, {
      method: "POST",
      headers: { ...SB_H_REPRESENT, Prefer: "return=representation,resolution=merge-duplicates" },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      const txt = await r.text();
      if (/relation .*room_housekeeping.* does not exist/i.test(txt) || r.status === 404) {
        return NextResponse.json(
          { error: "Housekeeping table not provisioned yet. Apply migrations/2026-05-21-room-housekeeping.sql." },
          { status: 412 }
        );
      }
      throw new Error(txt);
    }
    const j = await r.json().catch(() => []);
    return NextResponse.json({ ok: true, row: Array.isArray(j) ? j[0] : j });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 500 });
  }
}
