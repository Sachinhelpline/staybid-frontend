// v369 — Model 3: PUBLIC browse of live auction lots (no auth — browsing is
// open; only BIDDING needs an approved agent). Returns open lots whose window is
// still running, enriched with the REAL room image (side-loaded from rooms).
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const city = (url.searchParams.get("city") || "").trim();
  const nowIso = new Date().toISOString();

  let filter = `status=eq.open&window_close_at=gt.${encodeURIComponent(nowIso)}`;
  if (city && city.toLowerCase() !== "all") filter += `&city=eq.${encodeURIComponent(city)}`;

  const r = await fetch(
    `${SB_URL}/rest/v1/auction_lots?${filter}&select=id,hotel_id,room_id,category,city,month_key,month_start,month_end,num_rooms,min_bid_per_room_night,sale_mode,autopilot_mode,window_open_at,window_close_at,status,metadata&order=city.asc,created_at.desc&limit=300`,
    { headers: SB_READ, cache: "no-store" },
  );
  const lots: any[] = r.ok ? await r.json().catch(() => []) : [];

  // Side-load real room images (first image) for every lot's room.
  const roomIds = Array.from(new Set(lots.map((l) => l.room_id).filter(Boolean)));
  const imgByRoom: Record<string, string> = {};
  if (roomIds.length) {
    try {
      const idIn = roomIds.map((i) => encodeURIComponent(i)).join(",");
      const rr = await fetch(`${SB_URL}/rest/v1/rooms?id=in.(${idIn})&select=id,images&limit=500`, { headers: SB_READ, cache: "no-store" });
      if (rr.ok) {
        (await rr.json().catch(() => [])).forEach((row: any) => {
          const img = Array.isArray(row.images) ? row.images.find(Boolean) : null;
          if (img) imgByRoom[row.id] = img;
        });
      }
    } catch { /* best-effort */ }
  }
  const enriched = lots.map((l) => ({ ...l, image: imgByRoom[l.room_id] || l.metadata?.room_img || "" }));
  const cities = Array.from(new Set(lots.map((l) => l.city).filter(Boolean)));
  return NextResponse.json({ lots: enriched, cities });
}
