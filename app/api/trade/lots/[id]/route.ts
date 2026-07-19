// v369 — Model 3: PUBLIC lot detail for the full property TOUR page. Returns the
// lot, its month range, the selectable segments (sealed-bid, so NEVER other
// agents' bids), the EMD deposit %, and the REAL hotel + room details (gallery
// images, amenities, description, star) side-loaded from hotels/rooms.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";
import { resolveAuctionConfig } from "@/lib/trade/config";
import { enumerateSegments } from "@/lib/trade/auction-engine";
import { resolveSpinePrices } from "@/lib/pricing/read-spine";

export const dynamic = "force-dynamic";

const arr = (v: any): string[] => (Array.isArray(v) ? v.filter(Boolean) : []);

// The room's REAL guest-facing selling price (Spine live_price) across the lot
// month — so an agent sees, stock-style, what the room sells for in the market
// (ADR + low/high) vs their wholesale floor → their resale headroom. Bounded so
// the tour loads fast (room_date_price cache first, a few Spine fills for gaps).
function enumerateMonth(from: string, to: string): string[] {
  const out: string[] = [];
  let d = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  while (d < end) { out.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 86_400_000); }
  return out;
}
async function marketRange(roomId: string, from: string, to: string) {
  const dates = enumerateMonth(from, to);
  if (!dates.length) return null;
  const price: Record<string, number> = {};
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/room_date_price?room_id=eq.${encodeURIComponent(roomId)}&date=gte.${from}&date=lt.${to}&select=date,live_price`,
      { headers: SB_READ, cache: "no-store" },
    );
    (r.ok ? await r.json().catch(() => []) : []).forEach((x: any) => {
      const d = String(x.date).slice(0, 10); const p = Math.round(Number(x.live_price) || 0);
      if (p > 0) price[d] = p;
    });
  } catch { /* fall through to Spine */ }
  const missing = dates.filter((d) => !price[d]).slice(0, 14); // bounded Spine fill
  for (const d of missing) {
    try { const sp = await resolveSpinePrices([roomId], d); const p = Math.round(Number(sp?.[roomId]?.livePrice) || 0); if (p > 0) price[d] = p; }
    catch { /* skip */ }
  }
  const vals = dates.map((d) => price[d]).filter((v) => v > 0);
  if (!vals.length) return null;
  return { low: Math.min(...vals), high: Math.max(...vals), adr: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), samples: vals.length };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await fetch(
    `${SB_URL}/rest/v1/auction_lots?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
    { headers: SB_READ, cache: "no-store" },
  );
  const [lot] = r.ok ? await r.json().catch(() => []) : [];
  if (!lot) return NextResponse.json({ error: "Lot not found." }, { status: 404 });

  // Side-load real hotel + room (no FK embeds).
  let hotel: any = null, room: any = null;
  try {
    const hr = await fetch(`${SB_URL}/rest/v1/hotels?id=eq.${encodeURIComponent(lot.hotel_id)}&select=id,name,city,starRating,description,images&limit=1`, { headers: SB_READ, cache: "no-store" });
    if (hr.ok) [hotel] = await hr.json().catch(() => []);
  } catch { /* ignore */ }
  try {
    const rr = await fetch(`${SB_URL}/rest/v1/rooms?id=eq.${encodeURIComponent(lot.room_id)}&select=id,name,images,amenities,capacity,description&limit=1`, { headers: SB_READ, cache: "no-store" });
    if (rr.ok) [room] = await rr.json().catch(() => []);
  } catch { /* ignore */ }

  const range = {
    monthKey: lot.month_key, monthStart: String(lot.month_start).slice(0, 10),
    monthEnd: String(lot.month_end).slice(0, 10),
    nights: Math.round((new Date(lot.month_end).getTime() - new Date(lot.month_start).getTime()) / 86_400_000),
  };
  const segments = enumerateSegments(range).map((s) => ({ type: s.type, weekIndex: s.weekIndex, label: s.label, nights: s.nights }));
  const cfg = await resolveAuctionConfig();

  // Market intelligence (best-effort; the tour still works if it's null).
  let market: { low: number; high: number; adr: number; samples: number } | null = null;
  try { market = await marketRange(lot.room_id, range.monthStart, range.monthEnd); } catch { market = null; }

  return NextResponse.json({
    lot, range, segments, depositPct: cfg.depositPct, buyerPremiumPct: cfg.buyerPremiumPct,
    live: { hybridAcceptRatio: cfg.liveHybridAcceptRatio, payWindowHours: cfg.livePayWindowHours },
    market,
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
