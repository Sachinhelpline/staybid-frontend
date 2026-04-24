// Partner calendar endpoint — returns per-room, per-date occupancy map
// for the partner dashboard calendar tab. Merges bids + all room_blocks.
import { NextRequest, NextResponse } from "next/server";
import { decodeJwt } from "@/lib/sb-server";
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
    const occs = await getOccupations({ hotelId, from, to });

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

    return NextResponse.json({
      hotelId, from, to,
      calendar: map,
      occupations: occs,
    });
  } catch (e: any) {
    return NextResponse.json({
      hotelId, from, to,
      calendar: {},
      occupations: [],
      warning: e?.message,
    });
  }
}
