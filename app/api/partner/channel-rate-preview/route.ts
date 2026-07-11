// v317 — Channel Manager Phase 3: channel rate preview.
//
// For each active room mapping, shows what the OTA rate SHOULD be:
//   channel price = spine live_price × (1 + markup%/100)
// The spine (lib/pricing/read-spine) already bakes in the competitor-undercut
// + per-date vacancy, so a channel markup sits on top of StayBid's own price.
// Read-only, owner ∪ operated scoped. Never mutates anything.
//
import { NextRequest, NextResponse } from "next/server";
import { sbSelect } from "@/lib/sb-server";
import { partnerHotelScope } from "@/lib/partner/hotel-scope";
import { resolveSpinePrices } from "@/lib/pricing/read-spine";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const scope = await partnerHotelScope(req);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const hotelId = url.searchParams.get("hotelId") || "";
  if (!hotelId) return NextResponse.json({ error: "hotelId required" }, { status: 400 });
  if (!scope.hotelIds.includes(hotelId))
    return NextResponse.json({ error: "Not your hotel" }, { status: 403 });

  const date = (url.searchParams.get("date") || new Date().toISOString().slice(0, 10)).slice(0, 10);

  // 1) Every room in this hotel (the mapping editor previews all of them) +
  //    active mappings.
  const [roomsRes, mapRes] = await Promise.all([
    sbSelect(`rooms?hotelId=eq.${encodeURIComponent(hotelId)}&select=id,name,type`).catch(() => []),
    sbSelect(`channel_room_mappings?hotel_id=eq.${encodeURIComponent(hotelId)}&active=eq.true&select=*`).catch(() => []),
  ]);
  const hotelRooms = Array.isArray(roomsRes) ? roomsRes : [];
  const mappings = Array.isArray(mapRes) ? mapRes : [];
  const nameOf: Record<string, string> = {};
  for (const r of hotelRooms) nameOf[r.id] = r.name || r.type || r.id;

  // 2) Spine live price for EVERY room on that date (so the editor can preview
  //    a channel rate before the first mapping is even saved).
  const roomIds = Array.from(new Set(hotelRooms.map((r: any) => String(r.id)).filter(Boolean)));
  const spine = roomIds.length
    ? await resolveSpinePrices(roomIds, date).catch(() => ({} as Record<string, any>))
    : {};

  const roomPrices: Record<string, { livePrice: number; source: string }> = {};
  for (const id of roomIds) {
    const sp = spine[id];
    roomPrices[id] = { livePrice: sp ? Number(sp.livePrice) || 0 : 0, source: sp?.source || "none" };
  }

  // 3) Per-mapping preview: channel price = spine live_price × (1 + markup%)
  const previews = mappings.map((m: any) => {
    const live = roomPrices[String(m.room_id)]?.livePrice || 0;
    const markup = Number(m.markup_pct) || 0;
    const channelPrice = live > 0 ? Math.round(live * (1 + markup / 100)) : 0;
    return {
      id: m.id,
      connectionId: m.connection_id,
      roomId: m.room_id,
      roomName: nameOf[m.room_id] || m.room_id,
      otaRoomRef: m.ota_room_ref || null,
      otaRatePlanRef: m.ota_rate_plan_ref || null,
      markupPct: markup,
      livePrice: live,
      channelPrice,
      priceSource: roomPrices[String(m.room_id)]?.source || "none",
    };
  });

  return NextResponse.json({ date, previews, roomPrices });
}
