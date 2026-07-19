// v361 — Model 3 owner supply: list + publish monthly auction lots.
//   GET  → the owner's lots (across their managed hotels) + live bid counts.
//   POST → publish a lot { hotelId, roomId, monthKey, numRooms, minBidPerRoomNight? }.
//          Min bid is RE-COMPUTED server-side and clamped up to the Spine floor
//          (owner can raise it, never below cost — tamper-safe). Window timing is
//          server-derived from auction_config. One live lot per (hotel,room,month).
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";
import { genId } from "@/lib/sb-server";
import { partnerHotelScope } from "@/lib/partner/hotel-scope";
import { resolveAuctionConfig } from "@/lib/trade/config";
import { monthKeyToRange, computeAuctionWindow, computeMinBidFloorPerNight, isCircleOperatedHotel, circleOwnerFloor, activeUnitCount } from "@/lib/trade/lots";
import { normalizeAutopilotMode } from "@/lib/trade/live-auction";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const scope = await partnerHotelScope(req);
  if (!scope) return NextResponse.json({ error: "Partner auth required." }, { status: 401 });
  if (!scope.hotelIds.length) return NextResponse.json({ lots: [] });

  const hotelIn = scope.hotelIds.map((i) => encodeURIComponent(i)).join(",");
  const r = await fetch(
    `${SB_URL}/rest/v1/auction_lots?hotel_id=in.(${hotelIn})&select=*&order=created_at.desc&limit=200`,
    { headers: SB_READ, cache: "no-store" },
  );
  const lots = r.ok ? await r.json().catch(() => []) : [];

  // Side-load bid counts per lot (no FK embeds).
  const ids = (Array.isArray(lots) ? lots : []).map((l: any) => l.id);
  const bidCount: Record<string, number> = {};
  if (ids.length) {
    try {
      const idIn = ids.map((i: string) => encodeURIComponent(i)).join(",");
      const br = await fetch(
        `${SB_URL}/rest/v1/auction_bids?lot_id=in.(${idIn})&status=in.(active,won,partial)&select=lot_id`,
        { headers: SB_READ, cache: "no-store" },
      );
      if (br.ok) {
        const rows = await br.json().catch(() => []);
        (Array.isArray(rows) ? rows : []).forEach((b: any) => { bidCount[b.lot_id] = (bidCount[b.lot_id] || 0) + 1; });
      }
    } catch { /* counts are best-effort */ }
  }
  const enriched = (Array.isArray(lots) ? lots : []).map((l: any) => ({ ...l, bid_count: bidCount[l.id] || 0 }));
  return NextResponse.json({ lots: enriched });
}

export async function POST(req: NextRequest) {
  const scope = await partnerHotelScope(req);
  if (!scope) return NextResponse.json({ error: "Partner auth required." }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const hotelId = String(body.hotelId || "").trim();
  const roomId = String(body.roomId || "").trim();
  const monthKey = String(body.monthKey || "").trim();
  const numRooms = Math.round(Number(body.numRooms) || 0);
  const category = String(body.category || "").trim() || null;
  const city = String(body.city || "").trim() || null;

  if (!hotelId || !roomId || !monthKey) return NextResponse.json({ error: "hotelId, roomId, monthKey required." }, { status: 400 });
  if (!scope.hotelIds.includes(hotelId)) return NextResponse.json({ error: "You don't manage this hotel." }, { status: 403 });
  if (numRooms < 1 || numRooms > 50) return NextResponse.json({ error: "numRooms must be 1–50." }, { status: 400 });

  const range = monthKeyToRange(monthKey);
  if (!range) return NextResponse.json({ error: "Invalid month." }, { status: 400 });

  const cfg = await resolveAuctionConfig();

  // Sale mode: 'live' (always-open, autopilot, no EMD — the new launch default)
  // or 'sealed' (the monthly sealed-bid auction with an EMD + clearing engine).
  const saleMode = String(body.saleMode) === "sealed" ? "sealed" : "live";
  const autopilotMode = normalizeAutopilotMode(body.autopilotMode ?? cfg.liveDefaultAutopilot);

  // Window timing differs by mode:
  //  • sealed → the admin window (opens on windowOpenDay of the prev month,
  //    closes when the month begins); reject if that window has already passed.
  //  • live   → ALWAYS OPEN from publish; bids accepted until the inventory
  //    month ends. Reject only if the whole month is already in the past.
  const now = new Date();
  let windowOpenAt: string;
  let windowCloseAt: string;
  let phase: "open" | "scheduled";
  if (saleMode === "sealed") {
    const win = computeAuctionWindow(range, cfg);
    if (win.phase === "past") return NextResponse.json({ error: "That month's auction window has closed." }, { status: 400 });
    windowOpenAt = win.windowOpenAt;
    windowCloseAt = win.windowCloseAt;
    phase = win.phase === "open" ? "open" : "scheduled";
  } else {
    if (new Date(range.monthEnd + "T00:00:00Z").getTime() <= now.getTime()) {
      return NextResponse.json({ error: "That month has already ended." }, { status: 400 });
    }
    windowOpenAt = now.toISOString();
    windowCloseAt = new Date(range.monthEnd + "T00:00:00Z").toISOString(); // bids accepted through the month
    phase = "open"; // live lots are biddable immediately
  }

  // Model 2 & Model 3 may run CONCURRENTLY on the same property — the shared
  // physical layer (assignFreeUnit + inventory_blocks + room_blocks holds)
  // guarantees no unit-night is ever double-sold. So NO cross-channel block; we
  // only guard PHYSICAL CAPACITY: the auction must not promise more rooms than
  // units exist (classic category rooms with no per-unit rows self-regulate).
  const unitCount = await activeUnitCount(hotelId, roomId);
  if (unitCount > 0 && numRooms > unitCount) {
    return NextResponse.json({ error: `Only ${unitCount} units exist in this room category — reduce the room count.` }, { status: 400 });
  }

  // TAMPER-SAFE floor by OWNER TYPE:
  //  • Circle owner (host_circle): floor = THEIR purchase price/night × 1.20
  //    (cover cost + profit). Purchase = monthly rate ÷ 30, supplied at publish.
  //  • Property owner (classic):   floor = the room's normal floorPrice.
  const isCircle = await isCircleOperatedHotel(hotelId);
  let floor: number;
  let purchasePerNight: number | null = null;
  if (isCircle) {
    purchasePerNight = Math.round(
      Number(body.purchasePricePerNight) > 0
        ? Number(body.purchasePricePerNight)
        : (Number(body.monthlyRate) > 0 ? Number(body.monthlyRate) / 30 : 0),
    );
    if (!purchasePerNight || purchasePerNight <= 0) {
      return NextResponse.json({ error: "Enter your purchase price per night (your monthly rate ÷ 30)." }, { status: 400 });
    }
    floor = circleOwnerFloor(purchasePerNight, cfg.circleFloorMultiplier);
  } else {
    floor = await computeMinBidFloorPerNight(roomId, range);
  }
  const askedMin = Math.round(Number(body.minBidPerRoomNight) || 0);
  const minBid = Math.max(askedMin, floor);

  // status: open (biddable now) or draft (sealed lot whose window hasn't opened).
  // Live lots are always 'open'; cron flips a scheduled sealed lot open→closed.
  const status = phase === "open" ? "open" : "draft";

  const row = {
    id: genId("lot"),
    owner_user_id: scope.userId,
    hotel_id: hotelId,
    room_id: roomId,
    category,
    city,
    month_key: range.monthKey,
    month_start: range.monthStart,
    month_end: range.monthEnd,
    num_rooms: numRooms,
    min_bid_per_room_night: minBid,
    purchase_price_per_night: purchasePerNight,
    sale_mode: saleMode,
    autopilot_mode: autopilotMode,
    window_open_at: windowOpenAt,
    window_close_at: windowCloseAt,
    status,
    metadata: { floor_at_publish: floor, published_by: scope.userId, owner_kind: isCircle ? "circle_owner" : "property_owner", sale_mode: saleMode, autopilot_mode: autopilotMode },
  };

  // One live lot per (hotel,room,month) — the partial unique index rejects dupes.
  const r = await fetch(`${SB_URL}/rest/v1/auction_lots`, {
    method: "POST",
    headers: { ...SB_H, Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    const t = await r.text();
    if (/uniq_auction_lot_live|duplicate key/i.test(t)) {
      return NextResponse.json({ error: "You already have a live lot for this room & month." }, { status: 409 });
    }
    return NextResponse.json({ error: "Publish failed.", detail: t }, { status: 500 });
  }
  const [lot] = await r.json().catch(() => []);
  return NextResponse.json({ ok: true, lot, floor, saleMode, autopilotMode, scheduledOpensAt: windowOpenAt, phase });
}
