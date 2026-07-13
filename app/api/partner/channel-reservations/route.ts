// v318 — Channel Manager Phase 4: OTA reservations inbox.
//
// GET ?hotelId=...  → the hotel's OTA-imported bookings (room_blocks with
// source=ota_ical) surfaced as "channel reservations", plus per-channel
// production stats. Read-only, owner ∪ operated scoped (Circle partners
// included). Degrades gracefully to empty when nothing is imported.
//
// This is the same data the reconciling sync engine writes (lib/channels/sync)
// — cancelled OTA bookings vanish from here automatically because the engine
// deletes the block on the next sync.
//
import { NextRequest, NextResponse } from "next/server";
import { sbSelect } from "@/lib/sb-server";
import { partnerUnitScope, canManageUnitRow } from "@/lib/partner/hotel-scope";

export const dynamic = "force-dynamic";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function nightsBetween(from: string, to: string): number {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

export async function GET(req: NextRequest) {
  // v326 — per-unit scope: a unit-scoped investor only sees OTA reservations on
  // the units they own (never a co-investor's guest data); the full-hotel owner
  // sees all.
  const scope = await partnerUnitScope(req);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const hotelId = url.searchParams.get("hotelId") || "";
  if (!hotelId) return NextResponse.json({ error: "hotelId required" }, { status: 400 });
  if (!scope.hotelIds.includes(hotelId))
    return NextResponse.json({ error: "Not your hotel" }, { status: 403 });

  const today = isoDate(new Date());
  // keep recently-past stays visible so the partner can see "checked out" OTA
  // arrivals from the last 30 days; older ones drop off.
  const backFloor = isoDate(new Date(Date.now() - 30 * 86400000));

  const empty = { reservations: [], byChannel: [], totals: { count: 0, upcoming: 0, nights: 0 } };
  try {
    const blocks = await sbSelect(
      `room_blocks?hotelId=eq.${encodeURIComponent(hotelId)}&source=eq.ota_ical` +
        `&toDate=gte.${backFloor}&select=*&order=fromDate.asc&limit=500`
    );
    const rows = (Array.isArray(blocks) ? blocks : []).filter((b: any) =>
      canManageUnitRow(scope, hotelId, b.assignedUnitId ?? null)
    );
    if (rows.length === 0) return NextResponse.json(empty);

    // room names
    const roomIds = Array.from(new Set(rows.map((b: any) => String(b.roomId)).filter(Boolean)));
    const nameOf: Record<string, string> = {};
    if (roomIds.length) {
      const rooms = await sbSelect(
        `rooms?id=in.(${roomIds.map((i) => encodeURIComponent(i)).join(",")})&select=id,name,type`
      ).catch(() => []);
      (Array.isArray(rooms) ? rooms : []).forEach((r: any) => {
        nameOf[r.id] = r.name || r.type || r.id;
      });
    }

    const reservations = rows.map((b: any) => {
      const from = String(b.fromDate).slice(0, 10);
      const to = String(b.toDate).slice(0, 10);
      const upcoming = to >= today;
      const inHouse = from <= today && to > today;
      return {
        id: b.id,
        roomId: b.roomId,
        roomName: nameOf[b.roomId] || b.roomId,
        provider: (b.provider || "other").toLowerCase(),
        guestName: b.guestName || null,
        fromDate: from,
        toDate: to,
        nights: nightsBetween(from, to),
        note: b.note || null,
        externalRef: b.externalRef || null,
        importedAt: b.createdAt || null,
        status: inHouse ? "in_house" : upcoming ? "upcoming" : "checked_out",
      };
    });

    const chan: Record<string, { provider: string; count: number; nights: number; upcoming: number }> = {};
    let totalUpcoming = 0;
    let totalNights = 0;
    for (const r of reservations) {
      const p = r.provider;
      (chan[p] ||= { provider: p, count: 0, nights: 0, upcoming: 0 });
      chan[p].count++;
      chan[p].nights += r.nights;
      if (r.status !== "checked_out") {
        chan[p].upcoming++;
        totalUpcoming++;
      }
      totalNights += r.nights;
    }

    return NextResponse.json({
      reservations,
      byChannel: Object.values(chan).sort((a, b) => b.count - a.count),
      totals: { count: reservations.length, upcoming: totalUpcoming, nights: totalNights },
    });
  } catch {
    return NextResponse.json(empty);
  }
}
