// Partner calendar endpoint — returns per-room, per-date occupancy map
// for the partner dashboard calendar tab. Merges bids + all room_blocks.
//
// v132.2 — additionally returns:
//   • `roomPrices`: per-room base floorPrice + mrp + quantity
//   • `priceOverrides`: per-date per-room override map (room_date_overrides)
// So the calendar can display the effective price + qty in every cell
// AND the partner can edit them inline.
import { NextRequest, NextResponse } from "next/server";
import { decodeJwt, sbSelect } from "@/lib/sb-server";
import { getOccupations, toISODate, enumerateDates } from "@/lib/availability";

export const dynamic = "force-dynamic";

function auth(req: NextRequest): { userId?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub };
}

export async function GET(req: NextRequest) {
  const { userId } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const hotelId = url.searchParams.get("hotelId");
  if (!hotelId) return NextResponse.json({ error: "hotelId required" }, { status: 400 });

  // Default window: 60 days back, 180 days forward (owner wants to see recent + upcoming)
  const from = url.searchParams.get("from")
    || toISODate(new Date(Date.now() - 60 * 24 * 3600 * 1000));
  const to = url.searchParams.get("to")
    || toISODate(new Date(Date.now() + 180 * 24 * 3600 * 1000));

  try {
    // Three parallel reads: occupations + base room prices/qty + per-date
    // overrides. Overrides + base prices added in v132.2 to power inline
    // price editing from the calendar.
    const [occs, roomRows, overrideRows] = await Promise.all([
      getOccupations({ hotelId, from, to }),
      sbSelect(`rooms?hotelId=eq.${encodeURIComponent(hotelId)}&select=id,floorPrice,mrp,quantity&limit=200`),
      sbSelect(`room_date_overrides?hotelId=eq.${encodeURIComponent(hotelId)}&date=gte.${from}&date=lte.${to}&select=*&limit=2000`),
    ]);

    // Build per-room -> per-date map (each date carries the occupation's source+meta)
    const map: Record<string, Record<string, any>> = {};
    for (const o of occs) {
      if (!map[o.roomId]) map[o.roomId] = {};
      for (const d of enumerateDates(o.fromDate, o.toDate)) {
        // Priority: ACCEPTED bid > walk_in > ota_ical > manual. Keep first non-empty for a date.
        if (!map[o.roomId][d]) {
          map[o.roomId][d] = {
            source: o.source,
            guestName: o.guestName,
            amount: o.amount,
            provider: o.provider,
            note: o.note,
            refId: o.refId,
            assignedUnitId: o.assignedUnitId,
            assignedUnitNumber: o.assignedUnitNumber,
          };
        }
      }
    }

    // Base room price + quantity map (roomId -> {basePrice, baseQty, mrp})
    const roomPrices: Record<string, { basePrice: number | null; baseQty: number | null; mrp: number | null }> = {};
    (roomRows as any[]).forEach((r: any) => {
      roomPrices[r.id] = {
        basePrice: r.floorPrice != null ? Number(r.floorPrice) : null,
        baseQty:   r.quantity   != null ? Number(r.quantity)   : null,
        mrp:       r.mrp        != null ? Number(r.mrp)        : null,
      };
    });

    // Per-date overrides indexed by `${roomId}|${date}` for O(1) lookup
    const priceOverrides: Record<string, any> = {};
    (overrideRows as any[]).forEach((o: any) => {
      priceOverrides[`${o.roomId}|${o.date}`] = {
        id: o.id,
        roomId: o.roomId,
        date: o.date,
        floorPrice: o.floorPrice != null ? Number(o.floorPrice) : null,
        quantityOverride: o.quantityOverride != null ? Number(o.quantityOverride) : null,
        note: o.note || null,
      };
    });

    return NextResponse.json({
      hotelId, from, to,
      calendar: map,
      occupations: occs,
      roomPrices,
      priceOverrides,
    });
  } catch (e: any) {
    return NextResponse.json({
      hotelId, from, to,
      calendar: {},
      occupations: [],
      roomPrices: {},
      priceOverrides: {},
      warning: e?.message,
    });
  }
}
