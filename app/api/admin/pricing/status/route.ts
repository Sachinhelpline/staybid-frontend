// GET /api/admin/pricing/status
//
// v126 — Real data wire-up. Previously queried `rooms.aiPrice` which doesn't
// exist on the rooms table — admin's AI Status panel was showing zeros.
//
// Truth lives in `room_pricing_config` (one row per room with ai_managed +
// floor_price + current_price + competitor_min + discount_pct + last_updated)
// and `flash_deals.validUntil`. We compute AI vs Manual + active flash counts
// + a real last-recalc timestamp from the most-recently-updated config row.

import { NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";

export const dynamic = "force-dynamic";

const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

export async function GET() {
  const [rooms, cfg, deals] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/rooms?select=id`, { headers: SB_H }).then((r) => (r.ok ? r.json() : [])),
    fetch(
      `${SB_URL}/rest/v1/room_pricing_config?select=room_id,ai_managed,current_price,floor_price,competitor_min,discount_pct,last_updated&order=last_updated.desc&limit=2000`,
      { headers: SB_H },
    ).then((r) => (r.ok ? r.json() : [])),
    fetch(`${SB_URL}/rest/v1/flash_deals?select=id,validUntil,isActive,aiPrice,floorPrice,start_price,last_drop_at`, { headers: SB_H }).then((r) =>
      r.ok ? r.json() : [],
    ),
  ]);

  const totalRooms = Array.isArray(rooms) ? rooms.length : 0;
  const cfgRows: any[] = Array.isArray(cfg) ? cfg : [];
  const aiManaged = cfgRows.filter((r) => r.ai_managed === true).length;
  // "Manual" = rooms that exist in rooms table but either have ai_managed=false
  // in config OR no config row at all (treated as un-managed).
  const manualConfig = cfgRows.filter((r) => r.ai_managed === false).length;
  const uncoveredRooms = Math.max(0, totalRooms - cfgRows.length);
  const manual = manualConfig + uncoveredRooms;

  const dealsRaw: any[] = Array.isArray(deals) ? deals : [];
  const now = new Date();
  const activeDeals = dealsRaw.filter((d) => {
    const validUntil = d.validUntil ? new Date(d.validUntil) : null;
    const stillValid = validUntil ? validUntil > now : false;
    // Schema uses `isActive` (camelCase) not `active`. Default true if missing.
    const active = d.isActive !== false;
    return stillValid && active;
  });
  const expiredDeals = dealsRaw.length - activeDeals.length;
  // v126.2 — surface AI-managed flash deals count. A deal is "AI managed"
  // if it has an aiPrice computed (i.e. the recalc cron has touched it).
  const aiManagedDeals = dealsRaw.filter((d) => d.aiPrice != null && d.aiPrice > 0).length;
  // Most-recent flash deal recalc — falls back to most recent createdAt
  const lastFlashRecalc = dealsRaw
    .map((d) => d.last_drop_at)
    .filter(Boolean)
    .sort()
    .pop() || null;

  // Last recalculation = freshest pricing config update
  const lastRecalc = cfgRows[0]?.last_updated || null;

  // Average / median discount across AI-managed rooms (only those that have
  // both current_price and competitor_min) for an "AI is saving X%" headline
  const compared = cfgRows.filter((r) => r.current_price && r.competitor_min);
  const savingsPcts = compared.map((r) =>
    ((Number(r.competitor_min) - Number(r.current_price)) / Number(r.competitor_min)) * 100,
  );
  const avgSavings = savingsPcts.length
    ? savingsPcts.reduce((s, p) => s + p, 0) / savingsPcts.length
    : 0;

  return NextResponse.json({
    totalRooms,
    aiManaged,
    manual,
    coverage: totalRooms ? Math.round((cfgRows.length / totalRooms) * 100) : 0,
    activeFlashDeals: activeDeals.length,
    activeDeals: activeDeals.length,         // back-compat alias for existing UI
    totalFlashDeals: dealsRaw.length,
    aiManagedFlashDeals: aiManagedDeals,
    expiredFlashDeals: expiredDeals,
    flashDeals: dealsRaw,
    lastRecalc,
    lastFlashRecalc,
    avgSavingsPct: Math.round(avgSavings * 10) / 10,
  });
}
