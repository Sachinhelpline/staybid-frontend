// v369 — Model 3: PUBLIC lot detail for the full property TOUR page. Returns the
// lot, its month range, the selectable segments (sealed-bid, so NEVER other
// agents' bids), the EMD deposit %, and the REAL hotel + room details (gallery
// images, amenities, description, star) side-loaded from hotels/rooms.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";
import { resolveAuctionConfig } from "@/lib/trade/config";
import { enumerateSegments } from "@/lib/trade/auction-engine";
import { monthMarket } from "@/lib/trade/market";

export const dynamic = "force-dynamic";

const arr = (v: any): string[] => (Array.isArray(v) ? v.filter(Boolean) : []);

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await fetch(
    `${SB_URL}/rest/v1/auction_lots?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
    { headers: SB_READ, cache: "no-store" },
  );
  const [lot] = r.ok ? await r.json().catch(() => []) : [];
  if (!lot) return NextResponse.json({ error: "Lot not found." }, { status: 404 });

  const range = {
    monthKey: lot.month_key, monthStart: String(lot.month_start).slice(0, 10),
    monthEnd: String(lot.month_end).slice(0, 10),
    nights: Math.round((new Date(lot.month_end).getTime() - new Date(lot.month_start).getTime()) / 86_400_000),
  };
  const segments = enumerateSegments(range).map((s) => ({ type: s.type, weekIndex: s.weekIndex, label: s.label, nights: s.nights }));

  // v715 (owner ss2 — slow load) — everything below depends ONLY on the lot we
  // already have (hotel_id / room_id / month), NEVER on each other, so the five
  // lookups (hotel · room · config · live market · scarcity) run CONCURRENTLY
  // instead of one-await-after-another. Identical results; the tour data now
  // arrives in roughly the time of the single slowest lookup, not their sum.
  const [hotel, room, cfg, market, roomsAvailable] = await Promise.all([
    (async (): Promise<any> => {
      try {
        const hr = await fetch(`${SB_URL}/rest/v1/hotels?id=eq.${encodeURIComponent(lot.hotel_id)}&select=id,name,city,starRating,description,images&limit=1`, { headers: SB_READ, cache: "no-store" });
        if (hr.ok) { const [h] = await hr.json().catch(() => []); return h || null; }
      } catch { /* ignore */ }
      return null;
    })(),
    (async (): Promise<any> => {
      try {
        const rr = await fetch(`${SB_URL}/rest/v1/rooms?id=eq.${encodeURIComponent(lot.room_id)}&select=id,name,images,amenities,capacity,description&limit=1`, { headers: SB_READ, cache: "no-store" });
        if (rr.ok) { const [rm] = await rr.json().catch(() => []); return rm || null; }
      } catch { /* ignore */ }
      return null;
    })(),
    resolveAuctionConfig(),
    // Market intelligence (best-effort; the tour still works if it's null).
    (async () => { try { return await monthMarket(lot.room_id, range.monthStart, range.monthEnd); } catch { return null; } })(),
    // Scarcity — rooms still available = num_rooms − rooms already awarded/won.
    (async (): Promise<number> => {
      try {
        const ar = await fetch(
          `${SB_URL}/rest/v1/auction_awards?lot_id=eq.${encodeURIComponent(lot.id)}&status=in.(awarded,paid,voucher_issued)&select=rooms_awarded`,
          { headers: SB_READ, cache: "no-store" },
        );
        if (ar.ok) {
          const rows = await ar.json().catch(() => []);
          const taken = (Array.isArray(rows) ? rows : []).reduce((s: number, x: any) => s + (Number(x.rooms_awarded) || 0), 0);
          return Math.max(0, (Number(lot.num_rooms) || 0) - taken);
        }
      } catch { /* best-effort */ }
      return Number(lot.num_rooms) || 0;
    })(),
  ]);

  return NextResponse.json({
    lot, range, segments, depositPct: cfg.depositPct, buyerPremiumPct: cfg.buyerPremiumPct,
    live: { hybridAcceptRatio: cfg.liveHybridAcceptRatio, payWindowHours: cfg.livePayWindowHours, belowFloorMinRatio: cfg.belowFloorMinRatio },
    market,
    roomsAvailable,
    hotel: hotel ? {
      id: hotel.id, name: hotel.name, city: hotel.city, star: Number(hotel.starRating) || 0,
      description: hotel.description || "", images: arr(hotel.images),
    } : { id: lot.hotel_id, name: lot.metadata?.hotel_name || lot.hotel_id, city: lot.city, star: 0, description: "", images: [] },
    room: room ? {
      id: room.id, name: room.name || lot.category, images: arr(room.images),
      amenities: arr(room.amenities), capacity: Number(room.capacity) || 0, description: room.description || "",
    } : { id: lot.room_id, name: lot.category, images: [], amenities: [], capacity: 0, description: "" },
  });
}
