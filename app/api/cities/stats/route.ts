import { NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { sbCached } from "@/lib/sb-cache";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cities/stats
//
// Returns { stats: { "<city-lowercased>": { count, from } } } — the number of
// live (approval_status='approved') hotels per city and the cheapest room floor
// price across them ("from ₹X").
//
// Powers the location picker's per-city meta ("24 stays · from ₹1,200") so the
// list shows REAL supply instead of a generic "live deals available" line. Pure
// read, 60s warm-Lambda cache (city supply is stable minute-to-minute).
// ─────────────────────────────────────────────────────────────────────────────

const SB_H = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};
const TTL = 60_000;

type CityStat = { count: number; from: number };

export async function GET() {
  const stats = await sbCached<Record<string, CityStat>>(
    "cities:stats",
    async () => {
      // Approved hotels → id + city. Cap generous (city fan-out is small).
      const hr = await fetch(
        `${SB_URL}/rest/v1/hotels?approval_status=eq.approved&select=id,city&limit=1000`,
        { headers: SB_H, cache: "no-store" },
      );
      let hotels: any[] = [];
      try {
        const j = JSON.parse(await hr.text());
        hotels = Array.isArray(j) ? j : [];
      } catch {
        hotels = [];
      }

      const cityByHotel: Record<string, string> = {};
      const out: Record<string, CityStat> = {};
      for (const h of hotels) {
        const city = String(h?.city || "").trim();
        if (!h?.id || !city) continue;
        cityByHotel[h.id] = city;
        const k = city.toLowerCase();
        if (!out[k]) out[k] = { count: 0, from: 0 };
        out[k].count += 1;
      }

      // Cheapest room floor per hotel → per city, chunked to keep the URL sane.
      const ids = Object.keys(cityByHotel);
      const floorByHotel: Record<string, number> = {};
      const CHUNK = 150;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const idIn = ids.slice(i, i + CHUNK).map((id) => `"${id}"`).join(",");
        if (!idIn) continue;
        try {
          const rr = await fetch(
            `${SB_URL}/rest/v1/rooms?hotelId=in.(${idIn})&select=hotelId,floorPrice&limit=3000`,
            { headers: SB_H, cache: "no-store" },
          );
          const j = JSON.parse(await rr.text());
          const rooms: any[] = Array.isArray(j) ? j : [];
          for (const room of rooms) {
            const hid = room?.hotelId;
            const fp = Number(room?.floorPrice);
            if (!hid || !Number.isFinite(fp) || fp <= 0) continue;
            if (floorByHotel[hid] === undefined || fp < floorByHotel[hid]) floorByHotel[hid] = fp;
          }
        } catch {
          /* best-effort — a chunk failure just leaves those hotels priceless */
        }
      }
      for (const hid of ids) {
        const fp = floorByHotel[hid];
        if (!Number.isFinite(fp)) continue;
        const k = cityByHotel[hid].toLowerCase();
        if (!out[k]) continue;
        if (out[k].from === 0 || fp < out[k].from) out[k].from = fp;
      }

      return out;
    },
    TTL,
  );

  return NextResponse.json(
    { stats },
    {
      headers: {
        "Cache-Control": "public, max-age=60",
        "CDN-Cache-Control": "public, s-maxage=60",
        "Vercel-CDN-Cache-Control": "public, s-maxage=60",
      },
    },
  );
}
