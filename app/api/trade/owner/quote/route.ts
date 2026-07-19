// v361 — Model 3 owner supply: pre-publish quote. Given a hotel/room/month the
// owner is offering, returns the STAYBID-COMPUTED min bid floor per room-night
// (Spine bidFloor, owner never sells below cost), the auction window timing, the
// list of upcoming auctionable months, and a units hint. Partner-scoped.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";
import { partnerHotelScope } from "@/lib/partner/hotel-scope";
import { resolveAuctionConfig } from "@/lib/trade/config";
import { monthKeyToRange, computeAuctionWindow, upcomingAuctionMonths, computeMinBidFloorPerNight, isCircleOperatedHotel, hasActiveModel2Listing, wholesaleFloor, dynamicWholesaleFloor } from "@/lib/trade/lots";
import { monthMarket } from "@/lib/trade/market";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const scope = await partnerHotelScope(req);
  if (!scope) return NextResponse.json({ error: "Partner auth required." }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const hotelId = String(body.hotelId || "").trim();
  const roomId = String(body.roomId || "").trim();
  const monthKey = String(body.monthKey || "").trim();

  const cfg = await resolveAuctionConfig();
  const upcoming = upcomingAuctionMonths(cfg);

  // Basic form-scaffolding response (no month chosen yet).
  if (!hotelId || !roomId || !monthKey) {
    return NextResponse.json({ upcoming, config: { depositPct: cfg.depositPct, buyerPremiumPct: cfg.buyerPremiumPct } });
  }

  if (!scope.hotelIds.includes(hotelId)) {
    return NextResponse.json({ error: "You don't manage this hotel." }, { status: 403 });
  }
  const range = monthKeyToRange(monthKey);
  if (!range) return NextResponse.json({ error: "Invalid month." }, { status: 400 });
  const win = computeAuctionWindow(range, cfg);
  if (win.phase === "past") return NextResponse.json({ error: "That month's auction window has closed." }, { status: 400 });

  const isCircle = await isCircleOperatedHotel(hotelId);
  // Property owner → floor = retail floorPrice minus the wholesale discount (bulk
  // pricing so the agent has resale margin). Circle owner → floor depends on THEIR
  // purchase price (entered in the form) × the multiplier; client previews it.
  let retailFloor: number | null = null;
  let floor: number | null = null;
  let spineAdr: number | null = null;
  let floorMode: string | null = null;
  if (!isCircle) {
    retailFloor = await computeMinBidFloorPerNight(roomId, range);
    floorMode = cfg.floorMode === "static" ? "static" : "dynamic";
    if (floorMode === "dynamic") {
      const mkt = await monthMarket(roomId, range.monthStart, range.monthEnd);
      spineAdr = mkt?.adr ?? null;
      if (spineAdr && spineAdr > 0) {
        floor = dynamicWholesaleFloor(spineAdr, cfg.wholesaleDiscountPct, retailFloor, cfg.minFloorFraction);
      } else { floor = wholesaleFloor(retailFloor, cfg.wholesaleDiscountPct); floorMode = "static"; }
    } else {
      floor = wholesaleFloor(retailFloor, cfg.wholesaleDiscountPct);
    }
  }
  const model2Conflict = await hasActiveModel2Listing(roomId, range.monthStart, range.monthEnd);

  // Units hint — count active physical units for this room (may be 0 on classic hotels).
  let unitsHint = 0;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/hotel_room_units?hotelId=eq.${encodeURIComponent(hotelId)}&roomId=eq.${encodeURIComponent(roomId)}&status=eq.active&select=id`,
      { headers: SB_READ, cache: "no-store" },
    );
    if (r.ok) { const rows = await r.json().catch(() => []); unitsHint = Array.isArray(rows) ? rows.length : 0; }
  } catch { /* ignore */ }

  return NextResponse.json({
    upcoming,
    range,
    window: win,
    minBidPerRoomNight: floor,
    retailFloor,
    spineAdr,
    floorMode,
    wholesaleDiscountPct: cfg.wholesaleDiscountPct,
    minFloorFraction: cfg.minFloorFraction,
    nights: range.nights,
    unitsHint,
    circleOperated: isCircle,
    circleFloorMultiplier: cfg.circleFloorMultiplier,
    model2Conflict,
    config: { depositPct: cfg.depositPct, buyerPremiumPct: cfg.buyerPremiumPct },
  });
}
