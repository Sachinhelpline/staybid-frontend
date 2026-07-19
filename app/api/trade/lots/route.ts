// v361 — Model 3: PUBLIC browse of live auction lots (no auth — browsing is
// open; only BIDDING needs an approved agent). Returns open lots whose window
// is still running, newest first, optionally filtered by city.
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
    `${SB_URL}/rest/v1/auction_lots?${filter}&select=id,hotel_id,room_id,category,city,month_key,month_start,month_end,num_rooms,min_bid_per_room_night,window_open_at,window_close_at,status,metadata&order=city.asc,created_at.desc&limit=300`,
    { headers: SB_READ, cache: "no-store" },
  );
  const lots = r.ok ? await r.json().catch(() => []) : [];
  const cities = Array.from(new Set((Array.isArray(lots) ? lots : []).map((l: any) => l.city).filter(Boolean)));
  return NextResponse.json({ lots, cities });
}
