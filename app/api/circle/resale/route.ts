// v329 — Circle Phase C3: PUBLIC resale-offers feed (Model 3 consumer side).
//
// GET /api/circle/resale[?city=&hotelId=]
//   Every LISTED inventory block whose stay is still in the future, priced at
//   the investor's resale price, enriched with hotel (name/city/image) + room
//   (name/type/image) so it renders as a bookable card on the SAME consumer
//   surface as flash deals. Discount is computed vs the block's suggested
//   Spine resale (metadata.suggestedResaleTotal) when present.
//
// Read-only, no auth (consumer feed). Checkout/verify (sibling routes) settle.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { HOTEL_CARD_COLS, ROOM_CARD_COLS } from "@/lib/sb-columns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

async function sb(path: string): Promise<any[]> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_H, cache: "no-store" });
    const j = await r.json().catch(() => []);
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

const idList = (ids: string[]) => ids.map((x) => encodeURIComponent(x)).join(",");
const firstImage = (imgs: any): string | null => {
  if (Array.isArray(imgs)) return imgs.find((x) => typeof x === "string" && x) || null;
  if (typeof imgs === "string" && imgs.trim()) {
    try { const a = JSON.parse(imgs); if (Array.isArray(a)) return a[0] || null; } catch { /* raw url */ }
    return imgs;
  }
  return null;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const city = (url.searchParams.get("city") || "").trim();
  const hotelId = (url.searchParams.get("hotelId") || "").trim();
  const today = new Date().toISOString().slice(0, 10);

  // LISTED, future-dated, resale price set. Cheapest first, then soonest.
  let q =
    `status=eq.listed&resale_price_per_night=gt.0&date_to=gt.${today}` +
    `&select=*&order=resale_price_per_night.asc,date_from.asc&limit=60`;
  if (hotelId) q += `&hotel_id=eq.${encodeURIComponent(hotelId)}`;
  const blocks = await sb(`inventory_blocks?${q}`);
  if (!blocks.length) return NextResponse.json({ offers: [] }, { headers: { "Cache-Control": "no-store" } });

  // Enrich — hotels (approved only, so a pending hotel can't surface) + rooms.
  const hotelIds = Array.from(new Set(blocks.map((b) => String(b.hotel_id)).filter(Boolean)));
  const roomIds = Array.from(new Set(blocks.map((b) => String(b.room_id)).filter(Boolean)));
  const [hotels, rooms] = await Promise.all([
    hotelIds.length
      ? sb(`hotels?id=in.(${idList(hotelIds)})&approval_status=eq.approved&select=${HOTEL_CARD_COLS}`)
      : Promise.resolve([]),
    roomIds.length ? sb(`rooms?id=in.(${idList(roomIds)})&select=${ROOM_CARD_COLS}`) : Promise.resolve([]),
  ]);
  const hotelBy: Record<string, any> = {};
  hotels.forEach((h: any) => { hotelBy[String(h.id)] = h; });
  const roomBy: Record<string, any> = {};
  rooms.forEach((r: any) => { roomBy[String(r.id)] = r; });

  const offers = blocks
    .map((b: any) => {
      const h = hotelBy[String(b.hotel_id)];
      if (!h) return null; // hotel not approved / missing → skip
      const room = roomBy[String(b.room_id)];
      const nights = Number(b.nights) || 0;
      const perNight = Math.round(Number(b.resale_price_per_night) || 0);
      const total = perNight * nights;
      // Discount vs the Spine suggestion frozen on the block.
      const suggested = Math.round(Number(b?.metadata?.suggestedResaleTotal) || 0);
      const discount = suggested > total && suggested > 0
        ? Math.round(((suggested - total) / suggested) * 100)
        : 0;
      return {
        id: String(b.id),
        hotelId: String(b.hotel_id),
        roomId: String(b.room_id),
        dateFrom: String(b.date_from),
        dateTo: String(b.date_to),
        nights,
        perNight,
        total,
        suggestedTotal: suggested || null,
        discount,
        hotel: { name: h.name, city: h.city, image: firstImage(h.images) },
        room: room ? { name: room.name || room.type, type: room.type, image: firstImage(room.images) } : null,
      };
    })
    .filter(Boolean)
    .filter((o: any) => (city ? String(o.hotel.city || "").toLowerCase() === city.toLowerCase() : true));

  return NextResponse.json({ offers }, { headers: { "Cache-Control": "no-store" } });
}
