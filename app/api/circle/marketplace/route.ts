// v340 — Circle Marketplace Phase M1: Model-3 pre-buy BROWSE feed.
//
// GET /api/circle/marketplace[?city=]
//   Every StayBid-OPERATED host-circle property open for pre-buy
//   (owner_type=host_circle AND prebuy_enabled=true), enriched with its rooms +
//   an indicative "from" WHOLESALE price per room (Spine bidFloor for a near
//   date). This is browsable SUPPLY — NOT customer-bookable (that needs
//   approval_status=approved). Read-only, no auth.
//
// The investor picks a hotel + room + date range here → quote → checkout
// (sibling routes). Checkout AUTO-ASSIGNS a free physical unit (the M1 twist:
// the buyer owns nothing yet).

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { HOTEL_CARD_COLS, ROOM_CARD_COLS } from "@/lib/sb-columns";
import { resolveSpinePrices } from "@/lib/pricing/read-spine";
import { curateHotels } from "@/lib/launch/curation";

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

// Indicative wholesale per night from a Spine price row — bidFloor first.
function wholesaleFrom(p: { bidFloor?: number; flashFloor?: number; livePrice?: number } | undefined): number {
  if (!p) return 0;
  const floor = Number(p.bidFloor) || 0;
  if (floor > 0) return floor;
  const flash = Number(p.flashFloor) || 0;
  if (flash > 0) return flash;
  const live = Number(p.livePrice) || 0;
  return live > 0 ? Math.round(live * 0.7) : 0;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const city = (url.searchParams.get("city") || "").trim();

  // Operated host-circle properties open for pre-buy.
  let hq = `owner_type=eq.host_circle&prebuy_enabled=eq.true&select=${HOTEL_CARD_COLS}&order=name.asc&limit=60`;
  if (city) hq += `&city=ilike.${encodeURIComponent(city)}`;
  const hotelsRaw = await sb(`hotels?${hq}`);
  // v536 — launch curation: only curated launch host-circle hotels. Fail-open.
  const hotels = curateHotels(hotelsRaw);
  if (!hotels.length) return NextResponse.json({ hotels: [] }, { headers: { "Cache-Control": "no-store" } });

  const hotelIds = hotels.map((h: any) => String(h.id));
  const rooms = await sb(`rooms?hotelId=in.(${idList(hotelIds)})&select=${ROOM_CARD_COLS}&order=floorPrice.asc`);

  // Indicative "from" wholesale — one Spine read for a near-future date.
  const roomIds = Array.from(new Set(rooms.map((r: any) => String(r.id)).filter(Boolean)));
  const near = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  let spine: Record<string, any> = {};
  try { if (roomIds.length) spine = await resolveSpinePrices(roomIds, near); } catch { spine = {}; }

  const roomsByHotel: Record<string, any[]> = {};
  for (const r of rooms) {
    const hid = String(r.hotelId);
    const w = wholesaleFrom(spine[String(r.id)]) || Math.round(Number(r.floorPrice) || 0);
    (roomsByHotel[hid] ||= []).push({
      id: String(r.id),
      name: r.name || r.type,
      type: r.type,
      image: firstImage(r.images),
      capacity: Number(r.capacity) || 2,
      fromWholesale: w > 0 ? w : null,
    });
  }

  const out = hotels
    .map((h: any) => {
      const rs = roomsByHotel[String(h.id)] || [];
      if (!rs.length) return null; // no rooms → nothing to pre-buy
      const fromWholesale = rs
        .map((r: any) => r.fromWholesale)
        .filter((n: any) => typeof n === "number" && n > 0)
        .sort((a: number, b: number) => a - b)[0] || null;
      return {
        id: String(h.id),
        name: h.name,
        city: h.city,
        state: h.state || null,
        starRating: Number(h.starRating) || 0,
        image: firstImage(h.images),
        fromWholesale,
        rooms: rs,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ hotels: out }, { headers: { "Cache-Control": "no-store" } });
}
