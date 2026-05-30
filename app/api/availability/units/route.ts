// GET /api/availability/units?hotelId=...&from=YYYY-MM-DD&to=YYYY-MM-DD[&roomId=...]
//
// Returns per-unit (room-number level) availability, not just per-category.
// The customer hotel page and partner dashboard both need to show:
//   "Deluxe Suite — Room #101 ✓ vacant, Room #102 ✗ occupied by bid #abc"
//
// Logic:
//   • Pull every active unit for the hotel from hotel_room_units.
//   • Overlap each unit against the merged occupations list (accepted bids +
//     room_blocks) in [from, to).
//   • Unassigned occupations (a bid that has no unit yet) count as
//     "reserved but not assigned" — surfaced separately so the owner can
//     still see them and assign a unit later.
//
// Response shape:
// {
//   hotelId, from, to,
//   rooms: {
//     [roomId]: {
//       roomId,
//       name, type, capacity, floorPrice,
//       unitsTotal, unitsFree, unitsOccupied, unitsUnassigned,
//       units: [
//         { unitId, unitNumber, status, occupiedBy: { source, refId, guestName?, fromDate, toDate, note } | null }
//       ],
//       unassignedOccs: [ { source, refId, guestName?, fromDate, toDate, note } ]
//     }
//   }
// }

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H } from "@/lib/sb-server";
import { getOccupations, rangesOverlap, toISODate } from "@/lib/availability";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const hotelId = url.searchParams.get("hotelId") || "";
  const roomId  = url.searchParams.get("roomId") || undefined;
  const from    = url.searchParams.get("from") || toISODate(new Date());
  const to      = url.searchParams.get("to")   || toISODate(new Date(Date.now() + 86400000));
  if (!hotelId) return NextResponse.json({ error: "hotelId required" }, { status: 400 });

  try {
    // 1) Rooms (categories) for this hotel — optionally filtered to one roomId
    const roomsUrl = `${SB_URL}/rest/v1/rooms?hotelId=eq.${hotelId}${roomId ? `&id=eq.${roomId}` : ""}&select=id,name,type,capacity,floorPrice,images,quantity`;
    const [roomsRes, unitsRes] = await Promise.all([
      fetch(roomsUrl, { headers: SB_H }).then(r => r.json()).catch(() => []),
      fetch(`${SB_URL}/rest/v1/hotel_room_units?hotelId=eq.${hotelId}&status=eq.active&select=id,roomId,roomNumber,status`, { headers: SB_H }).then(r => r.json()).catch(() => []),
    ]);
    const rooms: any[] = Array.isArray(roomsRes) ? roomsRes : [];
    const units: any[] = Array.isArray(unitsRes) ? unitsRes : [];

    // 2) Occupations overlapping [from, to)
    const occs = await getOccupations({ hotelId, roomId, from, to });

    // 3) Build per-room view
    const perRoom: Record<string, any> = {};
    for (const r of rooms) {
      perRoom[r.id] = {
        roomId: r.id,
        name: r.name,
        type: r.type,
        capacity: r.capacity,
        floorPrice: r.floorPrice,
        image: Array.isArray(r.images) ? r.images[0] : null,
        // v247 — rooms.quantity is the partner-configured total units of this
        // category. Used as the virtual-unit count when hotel_room_units has
        // not been populated for this hotel (31/32 hotels today).
        quantity: r.quantity == null ? null : Math.max(0, Number(r.quantity) || 0),
        unitsTotal: 0,
        unitsFree: 0,
        unitsOccupied: 0,
        unitsUnassigned: 0,
        virtual: false,
        units: [] as any[],
        unassignedOccs: [] as any[],
      };
    }

    // 4) Attach units + status
    for (const u of units) {
      const room = perRoom[u.roomId];
      if (!room) continue;
      // Find any occupation assigned to this unit that overlaps the window
      const occ = occs.find(o => o.assignedUnitId === u.id && rangesOverlap(o.fromDate, o.toDate, from, to));
      room.units.push({
        unitId: u.id,
        unitNumber: u.roomNumber,
        status: occ ? "occupied" : "vacant",
        occupiedBy: occ ? {
          source: occ.source,
          refId: occ.refId,
          guestName: occ.guestName || null,
          fromDate: occ.fromDate,
          toDate: occ.toDate,
          note: occ.note || null,
        } : null,
      });
      room.unitsTotal++;
      if (occ) room.unitsOccupied++;
      else room.unitsFree++;
    }

    // 4.5) v247 — Virtual units from rooms.quantity for any category that has
    // NO active hotel_room_units rows. Without this, a hotel that never set up
    // the per-unit grid (31/32 today) would report unitsTotal=0 → either look
    // sold out or skip oversell math entirely. We synthesize `quantity`
    // anonymous vacant units so the per-date availability below is correct.
    for (const room of Object.values(perRoom) as any[]) {
      if (room.unitsTotal === 0 && room.quantity && room.quantity > 0) {
        room.virtual = true;
        room.unitsTotal = room.quantity;
        room.unitsFree = room.quantity;
      }
    }

    // 5) Unassigned occupations (bids / manual blocks without a unit yet).
    // v247 — a multi-room bid (numRooms = N) consumes N units, not 1. This is
    // the fix for "N rooms book/bid karne par sirf 1 room block hota tha".
    for (const o of occs) {
      if (o.assignedUnitId) continue;
      const room = perRoom[o.roomId];
      if (!room) continue;
      const need = Math.max(1, Number(o.numRooms) || 1);
      room.unassignedOccs.push({
        source: o.source,
        refId: o.refId,
        guestName: o.guestName || null,
        fromDate: o.fromDate,
        toDate: o.toDate,
        note: o.note || null,
        numRooms: need,
      });
      room.unitsUnassigned += need;
      // Each unassigned occupation consumes `need` units from the free pool so
      // customer UIs don't oversell. Clamp at 0 (never negative).
      const take = Math.min(need, room.unitsFree);
      room.unitsFree -= take;
      room.unitsOccupied += take;
    }

    // Sort units by roomNumber for a predictable grid
    Object.values(perRoom).forEach((r: any) => {
      r.units.sort((a: any, b: any) => {
        const na = parseInt(String(a.unitNumber).replace(/\D/g, ""), 10) || 0;
        const nb = parseInt(String(b.unitNumber).replace(/\D/g, ""), 10) || 0;
        return na - nb || String(a.unitNumber).localeCompare(String(b.unitNumber));
      });
    });

    return NextResponse.json({
      hotelId, from, to,
      rooms: perRoom,
    });
  } catch (e: any) {
    return NextResponse.json({ hotelId, from, to, rooms: {}, warning: e?.message });
  }
}
