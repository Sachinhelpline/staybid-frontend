// v318 — Channel Manager Phase 4: overbooking conflict detector.
//
// GET ?hotelId=...  → date windows where an OTA-imported booking pushes a room
// PAST its physical capacity (occupied > capacity), i.e. a genuine overbooking
// risk between an OTA channel and StayBid's own bookings.
//
// Read-only, owner ∪ operated scoped. Uses the SAME availability engine the
// booking flow uses (lib/availability), so the conflict math is identical to
// what gates a customer booking. Capacity = active hotel_room_units, else
// rooms.quantity virtual units; a room with no capacity signal is skipped
// (fail-open — never a false alarm).
//
import { NextRequest, NextResponse } from "next/server";
import { sbSelect } from "@/lib/sb-server";
import { partnerHotelScope } from "@/lib/partner/hotel-scope";
import { unitsFreeForRange, getOccupations } from "@/lib/availability";

export const dynamic = "force-dynamic";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// bound the work: only the nearest future OTA blocks are checked on demand.
const MAX_BLOCKS = 40;
const HORIZON_DAYS = 180;

export async function GET(req: NextRequest) {
  const scope = await partnerHotelScope(req);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const hotelId = url.searchParams.get("hotelId") || "";
  if (!hotelId) return NextResponse.json({ error: "hotelId required" }, { status: 400 });
  if (!scope.hotelIds.includes(hotelId))
    return NextResponse.json({ error: "Not your hotel" }, { status: 403 });

  const today = isoDate(new Date());
  const horizon = isoDate(new Date(Date.now() + HORIZON_DAYS * 86400000));

  try {
    const blocks = await sbSelect(
      `room_blocks?hotelId=eq.${encodeURIComponent(hotelId)}&source=eq.ota_ical` +
        `&toDate=gt.${today}&fromDate=lt.${horizon}` +
        `&select=id,roomId,fromDate,toDate,provider,guestName,externalRef&order=fromDate.asc&limit=${MAX_BLOCKS}`
    );
    const otaBlocks = Array.isArray(blocks) ? blocks : [];
    if (otaBlocks.length === 0) return NextResponse.json({ conflicts: [], checked: 0 });

    // room names
    const roomIds = Array.from(new Set(otaBlocks.map((b: any) => String(b.roomId)).filter(Boolean)));
    const nameOf: Record<string, string> = {};
    if (roomIds.length) {
      const rooms = await sbSelect(
        `rooms?id=in.(${roomIds.map((i) => encodeURIComponent(i)).join(",")})&select=id,name,type`
      ).catch(() => []);
      (Array.isArray(rooms) ? rooms : []).forEach((r: any) => {
        nameOf[r.id] = r.name || r.type || r.id;
      });
    }

    const conflicts: any[] = [];
    for (const b of otaBlocks) {
      const from = String(b.fromDate).slice(0, 10);
      const to = String(b.toDate).slice(0, 10);
      const cap = await unitsFreeForRange({ hotelId, roomId: b.roomId, from, to }).catch(() => null);
      if (!cap) continue; // no capacity signal → fail open (no false alarm)
      if (cap.occupied > cap.capacity) {
        // pull the StayBid-side bookings overlapping this range for context
        const occs = await getOccupations({ hotelId, roomId: b.roomId, from, to }).catch(() => []);
        const staybid = (Array.isArray(occs) ? occs : []).filter((o: any) => o.source === "bid");
        conflicts.push({
          roomId: b.roomId,
          roomName: nameOf[b.roomId] || b.roomId,
          provider: (b.provider || "other").toLowerCase(),
          fromDate: from,
          toDate: to,
          capacity: cap.capacity,
          occupied: cap.occupied,
          over: cap.occupied - cap.capacity,
          otaGuest: b.guestName || null,
          externalRef: b.externalRef || null,
          staybidCount: staybid.length,
        });
      }
    }

    return NextResponse.json({ conflicts, checked: otaBlocks.length });
  } catch {
    return NextResponse.json({ conflicts: [], checked: 0 });
  }
}
