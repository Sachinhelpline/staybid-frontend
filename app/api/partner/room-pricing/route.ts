// Per-date per-room price + quantity overrides — v132.2 partner feature.
//
// GET  /api/partner/room-pricing?hotelId=X&from=YYYY-MM-DD&to=YYYY-MM-DD
//   Returns every override for the hotel in the window, indexed by
//   `${roomId}|${date}` so the client can build a per-cell map cheaply.
//
// POST /api/partner/room-pricing
//   Body: { hotelId, items: [{ roomId, date, floorPrice?, quantityOverride?, note? }, ...] }
//   Bulk upsert. Each item is keyed on (roomId, date) — second write
//   updates the prior row. Allows single OR multi-date saves in one call.
//
// DELETE /api/partner/room-pricing?id=<overrideId>
//   Clear a single override (cell reverts to base room price/quantity).
//
// Auth: standard partner Bearer JWT. The handler verifies the caller
// owns the hotel via the same dual-userId resolver pattern used by
// /api/partner/hotel.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_H_REPRESENT, sbSelect, decodeJwt } from "@/lib/sb-server";

export const dynamic = "force-dynamic";

function auth(req: NextRequest): { userId?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub };
}

// Verify the caller owns this hotel. Reuses the dual-userId pattern
// (same phone may have 2 user rows — with + without country code).
async function verifyOwnership(userId: string, hotelId: string): Promise<boolean> {
  try {
    const users = await sbSelect(`users?id=eq.${encodeURIComponent(userId)}&select=phone`);
    const phones = new Set<string>();
    if (users[0]?.phone) {
      const p = String(users[0].phone);
      phones.add(p);
      phones.add(p.startsWith("+91") ? p.slice(3) : `+91${p}`);
    }
    const phoneList = Array.from(phones);
    const peers = phoneList.length
      ? await sbSelect(`users?phone=in.(${phoneList.map(p => `"${p}"`).join(",")})&select=id`)
      : [];
    const ownerIds = new Set<string>([userId, ...peers.map((u: any) => u.id)]);
    const ownerList = Array.from(ownerIds).map(id => `"${id}"`).join(",");
    const hotels = await sbSelect(`hotels?id=eq.${encodeURIComponent(hotelId)}&ownerId=in.(${ownerList})&select=id&limit=1`);
    return hotels.length > 0;
  } catch {
    return false;
  }
}

// cuid-ish id without dragging in a dep
function makeId(prefix = "rdo"): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export async function GET(req: NextRequest) {
  const { userId } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const hotelId = url.searchParams.get("hotelId");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!hotelId) return NextResponse.json({ error: "hotelId required" }, { status: 400 });

  const ok = await verifyOwnership(userId, hotelId);
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const dateFilter = (from && to) ? `&date=gte.${from}&date=lte.${to}` : "";
  try {
    const rows = await sbSelect(
      `room_date_overrides?hotelId=eq.${encodeURIComponent(hotelId)}${dateFilter}&select=*&order=date.asc&limit=2000`
    );
    // Build a flat map keyed on `${roomId}|${date}` so the client can lookup O(1).
    const overrides: Record<string, any> = {};
    rows.forEach((r: any) => {
      overrides[`${r.roomId}|${r.date}`] = r;
    });
    return NextResponse.json({ overrides, rows });
  } catch (e: any) {
    return NextResponse.json({ overrides: {}, rows: [], warning: e?.message }, { status: 200 });
  }
}

type UpsertItem = {
  roomId: string;
  date: string;
  // v132.2 — single floor price override
  floorPrice?: number | null;
  quantityOverride?: number | null;
  // v132.3 — three additional price overrides
  mrp?: number | null;             // regular price (customer-visible)
  flashPrice?: number | null;      // flash deal regular price
  flashFloorPrice?: number | null; // flash deal floor
  note?: string | null;
};

export async function POST(req: NextRequest) {
  const { userId } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const hotelId = String(body?.hotelId || "");
  const items: UpsertItem[] = Array.isArray(body?.items) ? body.items : [];
  if (!hotelId) return NextResponse.json({ error: "hotelId required" }, { status: 400 });
  if (items.length === 0) return NextResponse.json({ error: "items required" }, { status: 400 });
  if (items.length > 365) return NextResponse.json({ error: "max 365 items per call" }, { status: 400 });

  const ok = await verifyOwnership(userId, hotelId);
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Validate each item.
  const PRICE_FIELDS: Array<keyof UpsertItem> = ["floorPrice", "mrp", "flashPrice", "flashFloorPrice"];
  for (const it of items) {
    if (!it.roomId || !it.date) return NextResponse.json({ error: "roomId + date required on every item" }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(it.date)) return NextResponse.json({ error: `Bad date: ${it.date}` }, { status: 400 });
    for (const f of PRICE_FIELDS) {
      const v = it[f] as unknown;
      if (v != null && (typeof v !== "number" || (v as number) < 0)) {
        return NextResponse.json({ error: `${String(f)} must be a non-negative number` }, { status: 400 });
      }
    }
    if (it.quantityOverride != null && (typeof it.quantityOverride !== "number" || it.quantityOverride < 0 || !Number.isInteger(it.quantityOverride))) {
      return NextResponse.json({ error: "quantityOverride must be a non-negative integer" }, { status: 400 });
    }
  }

  // Upsert via PostgREST `Prefer: resolution=merge-duplicates`.
  // The unique index on (roomId, date) drives the merge.
  const rows = items.map(it => ({
    id: makeId(),
    hotelId,
    roomId: it.roomId,
    date: it.date,
    floorPrice:       it.floorPrice       != null ? Number(it.floorPrice)       : null,
    mrp:              it.mrp              != null ? Number(it.mrp)              : null,
    flashPrice:       it.flashPrice       != null ? Number(it.flashPrice)       : null,
    flashFloorPrice:  it.flashFloorPrice  != null ? Number(it.flashFloorPrice)  : null,
    quantityOverride: it.quantityOverride != null ? Number(it.quantityOverride) : null,
    note: it.note || null,
  }));

  try {
    const res = await fetch(`${SB_URL}/rest/v1/room_date_overrides?on_conflict="roomId",date`, {
      method: "POST",
      headers: { ...SB_H_REPRESENT, Prefer: "return=representation,resolution=merge-duplicates" },
      body: JSON.stringify(rows),
    });
    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: err || "Upsert failed" }, { status: 500 });
    }
    const saved = await res.json();
    return NextResponse.json({ saved, count: Array.isArray(saved) ? saved.length : 0 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Upsert error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { userId } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const hotelId = url.searchParams.get("hotelId");
  const id = url.searchParams.get("id");
  const roomId = url.searchParams.get("roomId");
  const date = url.searchParams.get("date");
  if (!hotelId) return NextResponse.json({ error: "hotelId required" }, { status: 400 });

  const ok = await verifyOwnership(userId, hotelId);
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let filter = "";
  if (id) filter = `id=eq.${encodeURIComponent(id)}`;
  else if (roomId && date) filter = `roomId=eq.${encodeURIComponent(roomId)}&date=eq.${encodeURIComponent(date)}`;
  else return NextResponse.json({ error: "id OR roomId+date required" }, { status: 400 });

  // Scope to hotelId for safety.
  filter += `&hotelId=eq.${encodeURIComponent(hotelId)}`;

  try {
    const res = await fetch(`${SB_URL}/rest/v1/room_date_overrides?${filter}`, {
      method: "DELETE",
      headers: SB_H,
    });
    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: err || "Delete failed" }, { status: 500 });
    }
    return NextResponse.json({ deleted: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Delete error" }, { status: 500 });
  }
}
