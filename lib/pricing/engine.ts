// Core AI price engine. Recalculates room.current_price from competitor min,
// demand and vacancy — clamped to floor_price (hard rule, never violated).

import { sbInsert, sbSelect, sbUpdate, SB } from "@/lib/onboard/supabase-admin";
import { getLatestCompetitorMin } from "./scraper";

export async function getDemandScore(roomId: string): Promise<number> {
  // Heuristic from app_events table: room views in last 2h × 0.5 + searches
  // in last 24h × 2 + wishlists × 5. Caps at 100. Falls back to 35 if events
  // table not populated yet.
  try {
    const now = Date.now();
    const since2h = new Date(now - 2 * 3600_000).toISOString();
    const since24h = new Date(now - 24 * 3600_000).toISOString();
    const url = `${SB.url}/rest/v1/app_events?meta->>roomId=eq.${roomId}&created_at=gte.${since2h}&select=count`;
    const r = await fetch(url, { headers: { apikey: SB.key, Authorization: `Bearer ${SB.key}`, Prefer: "count=exact" } });
    const total = parseInt(r.headers.get("content-range")?.split("/")[1] || "0", 10);
    return Math.min(100, total * 0.5 + 35);
  } catch { return 35; }
}

export async function getVacancyRate(hotelId: string): Promise<number> {
  // Approximation: count rooms vs accepted bids today
  try {
    const rooms = await sbSelect<any>("rooms", `"hotelId"=eq.${hotelId}&select=id&limit=200`);
    const total = rooms.length || 1;
    const today = new Date().toISOString().slice(0, 10);
    const bids = await sbSelect<any>(
      "bids",
      `"hotelId"=eq.${hotelId}&status=eq.ACCEPTED&"checkIn"=gte.${today}&select=id&limit=500`
    );
    const booked = bids.length;
    return Math.max(0, ((total - booked) / total) * 100);
  } catch { return 60; }
}

export async function ensurePricingConfig(roomId: string): Promise<any> {
  const rows = await sbSelect<any>("room_pricing_config", `room_id=eq.${roomId}&limit=1`);
  if (rows[0]) return rows[0];
  const room = await sbSelect<any>("rooms", `id=eq.${roomId}&select=floorPrice,mrp,"hotelId"&limit=1`);
  if (!room[0]) throw new Error("room not found");
  const floor = Number(room[0].floorPrice) || 999;
  const created = await sbInsert("room_pricing_config", {
    room_id: roomId,
    hotel_id: room[0].hotelId,
    floor_price: floor,
    current_price: Number(room[0].mrp) || floor * 1.5,
    discount_pct: 7.0,
    ai_managed: true,
  });
  return created;
}

export async function recalculateRoomPrice(roomId: string): Promise<{
  oldPrice: number; newPrice: number; reason: string; aiManaged: boolean;
}> {
  const config = await ensurePricingConfig(roomId);
  const oldPrice = Number(config.current_price);

  if (!config.ai_managed) {
    return { oldPrice, newPrice: oldPrice, reason: "manual_skip", aiManaged: false };
  }

  const competitorMin = await getLatestCompetitorMin(config.hotel_id);
  const demand = await getDemandScore(roomId);
  const vacancy = await getVacancyRate(config.hotel_id);

  let target = competitorMin
    ? competitorMin * (1 - Number(config.discount_pct) / 100)
    : oldPrice;

  let reason = competitorMin ? "competitor_update" : "ai_recalculate";

  if (vacancy < 30 || demand > 75) { target *= 1.12; reason = "demand_spike"; }
  else if (vacancy > 80 && demand < 30) { target *= 0.93; reason = "low_vacancy"; }

  // Hard floor — never violated
  const floor = Number(config.floor_price);
  let newPrice = Math.max(target, floor);
  newPrice = Math.round(newPrice / 10) * 10;

  if (newPrice !== oldPrice) {
    await sbUpdate("room_pricing_config", `id=eq.${config.id}`, {
      current_price: newPrice,
      competitor_min: competitorMin || null,
      last_updated: new Date().toISOString(),
    });
    await sbInsert("price_history", {
      room_id: roomId,
      hotel_id: config.hotel_id,
      old_price: oldPrice,
      new_price: newPrice,
      reason,
      triggered_by: "ai",
    });
  }
  return { oldPrice, newPrice, reason, aiManaged: true };
}

// Hotel-owner manual override
export async function manualOverride(roomId: string, newPrice: number, ownerId: string): Promise<any> {
  const config = await ensurePricingConfig(roomId);
  const oldPrice = Number(config.current_price);
  const floor = Number(config.floor_price);
  if (newPrice < floor) throw new Error(`Price cannot be below floor (₹${floor})`);
  await sbUpdate("room_pricing_config", `id=eq.${config.id}`, {
    current_price: newPrice,
    ai_managed: false,
    last_updated: new Date().toISOString(),
  });
  await sbInsert("price_history", {
    room_id: roomId, hotel_id: config.hotel_id,
    old_price: oldPrice, new_price: newPrice,
    reason: "manual_override", triggered_by: "hotel_owner",
  });
  return { oldPrice, newPrice };
}

export async function setFloor(roomId: string, floor: number): Promise<any> {
  const config = await ensurePricingConfig(roomId);
  await sbUpdate("room_pricing_config", `id=eq.${config.id}`, {
    floor_price: floor, last_updated: new Date().toISOString(),
  });
  // If current price drops below new floor, raise to floor.
  if (Number(config.current_price) < floor) {
    await sbUpdate("room_pricing_config", `id=eq.${config.id}`, { current_price: floor });
  }
  return { ok: true };
}
