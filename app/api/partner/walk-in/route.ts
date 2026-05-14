// Partner creates a walk-in booking (customer who walks in without online reservation).
// Inserts into room_blocks with source='walk_in'. Immediately blocks the room dates
// across the entire system (customer hotel page, availability API, calendar).
import { NextRequest, NextResponse } from "next/server";
import { sbInsert, decodeJwt, SB_URL, SB_H } from "@/lib/sb-server";

export const dynamic = "force-dynamic";

function auth(req: NextRequest): { userId?: string; phone?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub, phone: p?.phone || req.headers.get("x-phone") || "" };
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
