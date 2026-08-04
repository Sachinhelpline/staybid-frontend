// v724 Gap-2 — AI yield-optimizer PREVIEW (read-only, admin).
//
// Lets the owner SEE what the optimizer would do BEFORE enabling it. For a small
// sample of real rooms it computes, at both LOW and HIGH occupancy:
//   • the rule-engine live price (the proven demand model), and
//   • the optimizer's expected-revenue-maximizing price (guarded ±12% nudge),
// plus the accept-probability and expected-revenue lift. Pure reads + pure engine
// math — changes nothing, moves no money, writes nothing.

import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/admin/verify";
import { sbSelect } from "@/lib/onboard/supabase-admin";
import { computeRoomDatePrice } from "@/lib/pricing/spine";
import { optimizePrice } from "@/lib/pricing/optimizer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAMPLE = 8;
const idList = (ids: string[]) => ids.map((x) => encodeURIComponent(x)).join(",");

export async function GET(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // A near-future date (14 days out) — a normal booking window.
  const d = new Date();
  d.setDate(d.getDate() + 14);
  const date = d.toISOString().slice(0, 10);

  try {
    const rooms = await sbSelect<any>(
      "rooms",
      `select=id,hotelId,name,type,floorPrice,mrp,flashFloorPrice&floorPrice=gt.0&limit=${SAMPLE}`,
    );
    if (!rooms.length) return NextResponse.json({ date, rows: [], note: "no priced rooms" });

    const hotelIds = Array.from(new Set(rooms.map((r: any) => r.hotelId).filter(Boolean)));
    const cityOf: Record<string, string> = {};
    const nameOf: Record<string, string> = {};
    if (hotelIds.length) {
      const hotels = await sbSelect<any>("hotels", `id=in.(${idList(hotelIds)})&select=id,city,name`).catch(() => []);
      for (const h of hotels) { cityOf[h.id] = h.city || ""; nameOf[h.id] = h.name || ""; }
    }
    const compOf: Record<string, number> = {};
    const compRows = await sbSelect<any>("room_pricing_config", `room_id=in.(${idList(rooms.map((r: any) => r.id))})&select=room_id,competitor_min`).catch(() => []);
    for (const c of compRows) { const v = Number(c.competitor_min); if (v > 0) compOf[c.room_id] = v; }

    const rows = rooms.map((r: any) => {
      const floor = Number(r.floorPrice) || 0;
      const base = { floorPrice: floor, mrp: Number(r.mrp) || 0, flashFloorPrice: Number(r.flashFloorPrice) || 0, city: cityOf[r.hotelId] || "", date, competitorMin: compOf[r.id] ?? null };
      const scen = (vac: number) => {
        // Rule price WITH this occupancy (optimizer implicitly off — no cfg).
        const rule = computeRoomDatePrice({ ...base, vacancyRatio: vac });
        const opt = optimizePrice({ floor, ruleLive: rule.livePrice, competitorMin: compOf[r.id] ?? null, vacancyRatio: vac });
        return {
          rule: rule.livePrice,
          optimized: opt.optimizedLive,
          deltaPct: opt.deltaPct,
          acceptRule: Number(opt.acceptAtRule.toFixed(3)),
          acceptOpt: Number(opt.acceptAtOpt.toFixed(3)),
          erRule: Math.round(opt.expectedRevenueRule),
          erOpt: Math.round(opt.expectedRevenueOpt),
          erLiftPct: opt.expectedRevenueRule > 0 ? Number((((opt.expectedRevenueOpt - opt.expectedRevenueRule) / opt.expectedRevenueRule) * 100).toFixed(1)) : 0,
        };
      };
      return {
        hotel: nameOf[r.hotelId] || r.hotelId,
        room: r.name || r.type || r.id,
        floor,
        low: scen(0.15),   // near-empty date
        high: scen(0.85),  // nearly sold-out date
      };
    });

    return NextResponse.json({ date, rows });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "preview failed" }, { status: 500 });
  }
}
