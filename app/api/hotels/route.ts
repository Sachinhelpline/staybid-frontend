import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { sbCached } from "@/lib/sb-cache";
import { HOTEL_CARD_COLS, ROOM_CARD_COLS } from "@/lib/sb-columns";


const SB_H = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

// v107 — hotels + rooms are catalog data; perfectly safe to share across
// concurrent requests on a warm Lambda. 60 s TTL matches the catalog data
// volatility (admin edits land in the next minute, which is fine).
const TTL_CATALOG = 60_000;

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const city = searchParams.get("city") || "";
  const q    = searchParams.get("q")    || "";

  // Build hotel filter — no camelCase ordering (PostgREST requires quoted identifiers)
  // Narrowed select (was *). Drops description/address fields not used by cards.
  const qs = new URLSearchParams({ select: HOTEL_CARD_COLS, limit: "100" });
  if (city) qs.set("city", `ilike.${city}`);
  if (q)    qs.set("name", `ilike.*${q}*`);

  const filterKey = qs.toString();
  const hotels = await sbCached<any[]>(`hotels:list:${filterKey}`, async () => {
    const r = await fetch(`${SB_URL}/rest/v1/hotels?${filterKey}`, { headers: SB_H, cache: "no-store" });
    const t = await r.text();
    try { const j = JSON.parse(t); return Array.isArray(j) ? j : []; } catch { return []; }
  }, TTL_CATALOG);

  // v131 — scope rooms to ONLY the hotels we're about to return. Previously
  // pulled 500 rooms across every hotel regardless of the city filter; with
  // a 5-hotel Mussoorie filter that's a ~95% over-fetch. The cache key uses
  // the sorted hotelId set so repeat opens of the same city stay warm.
  const hotelIdList: string[] = hotels.map((h: any) => h.id).filter(Boolean);
  const rooms: any[] = hotelIdList.length === 0
    ? []
    : await sbCached<any[]>(`hotels:rooms:${hotelIdList.slice().sort().join(",")}`, async () => {
        const idIn = hotelIdList.map((id) => `"${id}"`).join(",");
        const r = await fetch(
          `${SB_URL}/rest/v1/rooms?hotelId=in.(${idIn})&select=${ROOM_CARD_COLS}&limit=500`,
          { headers: SB_H, cache: "no-store" }
        );
        const t = await r.text();
        try { const j = JSON.parse(t); return Array.isArray(j) ? j : []; } catch { return []; }
      }, TTL_CATALOG);

  // Attach rooms to each hotel — build an index once (was N*M scan).
  const roomsByHotel: Record<string, any[]> = {};
  for (const r of rooms) {
    if (!r?.hotelId) continue;
    (roomsByHotel[r.hotelId] ||= []).push(r);
  }
  const hotelsWithRooms = hotels.map((h: any) => ({
    ...h,
    rooms: roomsByHotel[h.id] || [],
  }));

  const res = NextResponse.json({ hotels: hotelsWithRooms, total: hotelsWithRooms.length });
  // v131.2 — bump CDN window: Vercel's edge cache absorbs ~90% of repeat
  // traffic at the same freshness. New hotels appear within 60s; stale
  // serves keep us fast during the bg revalidate. Was max-age=10/swr=30.
  res.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return res;
}
