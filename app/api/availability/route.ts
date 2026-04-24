// Public GET: returns blocked dates per room for a hotel over a date range.
// Used by customer hotel detail page date picker to grey out unavailable days.
// Also safely returns {} if availability tables don't exist yet (pre-migration).
import { NextRequest, NextResponse } from "next/server";
import { getOccupations, occupationsToDateSet, toISODate } from "@/lib/availability";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const hotelId = url.searchParams.get("hotelId") || "";
  const roomId  = url.searchParams.get("roomId") || undefined;
  const from    = url.searchParams.get("from") || toISODate(new Date());
  const to      = url.searchParams.get("to")   || toISODate(new Date(Date.now() + 1000 * 60 * 60 * 24 * 180));

  if (!hotelId) return NextResponse.json({ error: "hotelId required" }, { status: 400 });

  try {
    const occs = await getOccupations({ hotelId, roomId, from, to });

    // Per-room breakdown
    const perRoom: Record<string, string[]> = {};
    for (const o of occs) {
      if (!perRoom[o.roomId]) perRoom[o.roomId] = [];
    }
    for (const rid of Object.keys(perRoom)) {
      perRoom[rid] = Array.from(occupationsToDateSet(occs, rid)).sort();
    }

    return NextResponse.json({
      hotelId, from, to,
      rooms: perRoom,
      occupations: occs, // full list for partner panel
    });
  } catch (e: any) {
    // Never break the frontend if tables missing — just return empty
    return NextResponse.json({ hotelId, from, to, rooms: {}, occupations: [], warning: e?.message });
  }
}
