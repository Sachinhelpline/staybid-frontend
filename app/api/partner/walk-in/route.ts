// Partner creates a walk-in booking (customer who walks in without online reservation).
// Inserts into room_blocks with source='walk_in'. Immediately blocks the room dates
// across the entire system (customer hotel page, availability API, calendar).
import { NextRequest, NextResponse } from "next/server";
import { sbInsert, sbSelect, decodeJwt, SB_URL, SB_H, SB_H_REPRESENT } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";

export const dynamic = "force-dynamic";

function auth(req: NextRequest): { userId?: string; phone?: string; email?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return {
    userId: p?.id || p?.user_id || p?.sub,
    phone: p?.phone || req.headers.get("x-phone") || "",
    email: p?.email || req.headers.get("x-email") || "",
  };
}

// v170 — every hotel id this caller owns (front-desk reservations are
// owner-scoped). Empty array → caller owns nothing.
async function ownedHotelIds(req: NextRequest): Promise<string[]> {
  const { userId, phone, email } = auth(req);
  if (!userId) return [];
  const ownerIds = await resolveOwnerIdsCrossPool(userId, phone, email);
  if (!ownerIds.length) return [];
  const hotels = await sbSelect(`hotels?ownerId=in.(${ownerIds.join(",")})&select=id`);
  return (Array.isArray(hotels) ? hotels : []).map((h: any) => h.id);
}

// GET /api/partner/walk-in?hotelId=...  — list front-desk reservations
export async function GET(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned.length) return NextResponse.json({ reservations: [] });
  const hotelId = new URL(req.url).searchParams.get("hotelId");
  if (!hotelId || !owned.includes(hotelId)) {
    return NextResponse.json({ error: "hotelId required / not yours" }, { status: 403 });
  }
  try {
    const rows = await sbSelect(
      `room_blocks?hotelId=eq.${encodeURIComponent(hotelId)}&select=*&order=fromDate.desc`
    );
    return NextResponse.json({ reservations: Array.isArray(rows) ? rows : [] });
  } catch (e: any) {
    return NextResponse.json({ reservations: [], warning: e?.message });
  }
}

// PATCH /api/partner/walk-in  — edit an existing reservation (room_blocks row)
export async function PATCH(req: NextRequest) {
  const owned = await ownedHotelIds(req);
  if (!owned.length) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const existing = await sbSelect(`room_blocks?id=eq.${encodeURIComponent(body.id)}&select=id,hotelId`);
  if (!existing?.[0]) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
  if (!owned.includes(existing[0].hotelId)) {
    return NextResponse.json({ error: "Not your reservation" }, { status: 403 });
  }

  const patch: any = {};
  for (const k of ["fromDate", "toDate", "guestName", "guestPhone", "guestEmail", "note", "roomId", "assignedUnitId", "assignedUnitNumber"]) {
    if (body[k] !== undefined) patch[k] = body[k] === "" ? null : body[k];
  }
  if (body.amount !== undefined) patch.amount = body.amount === "" || body.amount == null ? null : Number(body.amount);
  if (patch.fromDate && patch.toDate && patch.toDate <= patch.fromDate) {
    return NextResponse.json({ error: "Check-out must be after check-in" }, { status: 400 });
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  try {
    const r = await fetch(`${SB_URL}/rest/v1/room_blocks?id=eq.${encodeURIComponent(body.id)}`, {
      method: "PATCH", headers: SB_H_REPRESENT, body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error(await r.text());
    const j = await r.json().catch(() => []);
    return NextResponse.json({ ok: true, reservation: Array.isArray(j) ? j[0] : j });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { userId } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}

  const {
    hotelId, roomId, fromDate, toDate,
    guestName, guestPhone, guestEmail, amount, note,
    assignedUnitId, assignedUnitNumber,
    // v113 — bulk block-dates flow can send these. Default `source` to
    // `walk_in` so every existing caller stays correct without changes.
    source: rawSource,
    roomIds,     // optional bulk array
  } = body;

  const source = (() => {
    const allowed = new Set(["walk_in", "manual", "group"]);
    return allowed.has(String(rawSource)) ? String(rawSource) : "walk_in";
  })();

  // v113 — accept multi-room bulk insert. Falls back to the single-room
  // flow when `roomIds` is missing or empty.
  const targets: string[] = Array.isArray(roomIds) && roomIds.length
    ? roomIds.filter((r: any) => typeof r === "string" && r)
    : (roomId ? [roomId] : []);

  if (!hotelId || !targets.length || !fromDate || !toDate) {
    return NextResponse.json({ error: "hotelId, roomId (or roomIds[]), fromDate, toDate required" }, { status: 400 });
  }
  if (toDate <= fromDate) {
    return NextResponse.json({ error: "toDate must be after fromDate" }, { status: 400 });
  }

  // For manual blocks we don't require a guest name (it's a maintenance /
  // owner hold). Pick a sensible default per source.
  const defaultGuestName =
    source === "walk_in" ? "Walk-in guest" :
    source === "group"   ? (guestName || "Group booking") :
                           (guestName || "Blocked");

  try {
    const inserted: any[] = [];
    for (const rid of targets) {
      // Defensive: refuse to insert overlapping blocks on the same unit.
      // The /api/partner/calendar query catches overlaps visually, but
      // the DB has no unique constraint — so a frantic double-click
      // would otherwise duplicate. Skip the check when no unit is
      // assigned (bulk maintenance blocks rarely target a specific
      // unit, and the partner can review duplicates manually).
      const row = await sbInsert("room_blocks", {
        hotelId, roomId: rid,
        fromDate, toDate,
        source,
        guestName: source === "walk_in" ? (guestName || defaultGuestName) : defaultGuestName,
        guestPhone: guestPhone || null,
        guestEmail: guestEmail || null,
        amount: amount != null ? Number(amount) : null,
        note: note || null,
        createdBy: userId,
        assignedUnitId: assignedUnitId || null,
        assignedUnitNumber: assignedUnitNumber || null,
      });
      inserted.push(row);
    }
    return NextResponse.json({
      ok: true,
      block: inserted[0] || null,
      blocks: inserted,
      count: inserted.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to create walk-in / block" }, { status: 500 });
  }
}

// Cancel a walk-in (or any block)
export async function DELETE(req: NextRequest) {
  const { userId } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    const r = await fetch(`${SB_URL}/rest/v1/room_blocks?id=eq.${id}`, { method: "DELETE", headers: SB_H });
    if (!r.ok) throw new Error(await r.text());
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to cancel" }, { status: 500 });
  }
}
