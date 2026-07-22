import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { sbCached } from "@/lib/sb-cache";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/hotels/starting-prices?ids=h1,h2,h3
//
// Returns { prices: { "<hotelId>": <cheapestRoomFloorPrice> } } — the "starting
// from" ₹/night for each requested hotel = the cheapest room's `floorPrice`.
//
// Why this exists:
//   A TAGGED reel card shows "From ₹X /n". The reel item only carries the tagged
//   hotel's {id, name, city} (that's all CreateFlow stores + all /api/social/feed
//   joins) — it has NO price. Self-uploaded reels (rendered locally from the
//   PostsStore) never pass through the discover feed's price map at all, and even
//   a feed post's tagged hotel might not be inside a capped hotels payload. So the
//   reel feed calls THIS endpoint with the exact tagged-hotel ids and hydrates
//   each card with a real starting price — instead of falling back to "View
//   rates ›".
//
// The price is the room floor (the same number every hotel/reel card shows as
// "From ₹X"), NOT a flash-deal price — so it resolves whether or not the hotel
// has a live flash deal. A hotel with no rooms simply returns no entry (the card
// keeps its "View rates ›" fallback, which is honest).
// ─────────────────────────────────────────────────────────────────────────────

const SB_H = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

// Room catalog data is stable across callers → 60s warm-Lambda cache, keyed on
// the sorted id set so repeat opens of the same feed stay warm.
const TTL_CATALOG = 60_000;

export async function GET(req: NextRequest) {
  const idsRaw = req.nextUrl.searchParams.get("ids") || "";
  const ids = Array.from(
    new Set(
      idsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ).slice(0, 200); // hard cap — a feed never tags more than a handful

  if (ids.length === 0) {
    return NextResponse.json({ prices: {} });
  }

  const cacheKey = `hotels:startprices:${ids.slice().sort().join(",")}`;
  const prices = await sbCached<Record<string, number>>(
    cacheKey,
    async () => {
      const idIn = ids.map((id) => `"${id}"`).join(",");
      const r = await fetch(
        `${SB_URL}/rest/v1/rooms?hotelId=in.(${idIn})&select=hotelId,floorPrice`,
        { headers: SB_H, cache: "no-store" },
      );
      const t = await r.text();
      let rooms: any[] = [];
      try {
        const j = JSON.parse(t);
        rooms = Array.isArray(j) ? j : [];
      } catch {
        rooms = [];
      }
      // Cheapest positive room floor per hotel.
      const out: Record<string, number> = {};
      for (const room of rooms) {
        const hid = room?.hotelId;
        const fp = Number(room?.floorPrice);
        if (!hid || !Number.isFinite(fp) || fp <= 0) continue;
        if (out[hid] === undefined || fp < out[hid]) out[hid] = fp;
      }
      return out;
    },
    TTL_CATALOG,
  );

  const res = NextResponse.json({ prices });
  // Same CDN posture as the other catalog reads — cheap to serve from edge.
  res.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  res.headers.set("CDN-Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  res.headers.set("Vercel-CDN-Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return res;
}
