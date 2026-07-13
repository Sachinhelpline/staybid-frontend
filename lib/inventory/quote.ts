// ════════════════════════════════════════════════════════════════════════
// v327 — Circle Phase C1: server-side inventory-block QUOTE (Pricing-Spine).
//
// For one room + date range, resolve the Spine price per night and build the
// Model-3 pre-buy quote:
//   • wholesale (buy)   = Spine bidFloor (the lowest StayBid would sell) —
//                         with sane fallbacks so a night never quotes ₹0.
//   • retail suggestion = Spine livePrice.
// One `room_date_price` range read + a per-missing-night `resolveSpinePrices`
// fallback (so it's correct even before the price-spine cron has filled a date).
// Server-only.
// ════════════════════════════════════════════════════════════════════════

import { sbSelect } from "@/lib/onboard/supabase-admin";
import { resolveSpinePrices } from "@/lib/pricing/read-spine";
import {
  computeBlockQuote,
  nightsBetween,
  MAX_BLOCK_NIGHTS,
  type BlockQuote,
} from "./engine";

function isoAddDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Wholesale per night from a Spine price row — bidFloor first, then flashFloor,
// then 70% of live, never ₹0 while any signal exists.
function wholesaleOf(p: { bidFloor?: number; flashFloor?: number; livePrice?: number } | undefined): number {
  if (!p) return 0;
  const floor = Number(p.bidFloor) || 0;
  if (floor > 0) return floor;
  const flash = Number(p.flashFloor) || 0;
  if (flash > 0) return flash;
  const live = Number(p.livePrice) || 0;
  return live > 0 ? Math.round(live * 0.7) : 0;
}
// Retail suggestion — livePrice, then flashPrice, then baseRate.
function retailOf(p: { livePrice?: number; flashPrice?: number; baseRate?: number } | undefined): number {
  if (!p) return 0;
  return Number(p.livePrice) || Number(p.flashPrice) || Number(p.baseRate) || 0;
}

export interface InventoryQuote extends BlockQuote {
  roomId: string;
  from: string;
  to: string;
  perNight: { date: string; buy: number; suggestedResale: number }[];
}

/**
 * Quote a pre-buy inventory block. Caps at MAX_BLOCK_NIGHTS.
 * Returns null when the range is invalid or no price signal exists at all.
 */
export async function quoteInventoryBlock(args: {
  roomId: string;
  from: string;
  to: string;
  feePct?: number;
}): Promise<InventoryQuote | null> {
  const roomId = String(args.roomId || "").trim();
  const from = String(args.from || "").slice(0, 10);
  const to = String(args.to || "").slice(0, 10);
  if (!roomId || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;

  const nights = nightsBetween(from, to);
  if (nights <= 0 || nights > MAX_BLOCK_NIGHTS) return null;

  // Build the exclusive night list.
  const dates: string[] = [];
  for (let i = 0; i < nights; i++) dates.push(isoAddDays(from, i));

  // 1) one cached range read.
  const cached: Record<string, any> = {};
  try {
    const rows = await sbSelect<any>(
      "room_date_price",
      `room_id=eq.${encodeURIComponent(roomId)}&date=gte.${from}&date=lt.${to}&select=*`,
    );
    for (const r of rows) {
      cached[String(r.date).slice(0, 10)] = {
        bidFloor: Number(r.bid_floor) || 0,
        flashFloor: Number(r.flash_floor) || 0,
        livePrice: Number(r.live_price) || 0,
        flashPrice: Number(r.flash_price) || 0,
        baseRate: Number(r.base_rate) || 0,
      };
    }
  } catch { /* fall through to compute */ }

  // 2) per-missing-night fallback (rare after the cron runs).
  const perNight: { date: string; buy: number; suggestedResale: number }[] = [];
  const buyPerNight: number[] = [];
  const suggestedResalePerNight: number[] = [];
  for (const day of dates) {
    let p = cached[day];
    if (!p) {
      try {
        const m = await resolveSpinePrices([roomId], day);
        p = m[roomId];
      } catch { p = undefined; }
    }
    const buy = wholesaleOf(p);
    const resale = retailOf(p);
    buyPerNight.push(buy);
    suggestedResalePerNight.push(resale);
    perNight.push({ date: day, buy, suggestedResale: resale });
  }

  // No price signal anywhere → can't quote.
  if (buyPerNight.every((n) => n <= 0) && suggestedResalePerNight.every((n) => n <= 0)) return null;

  const q = computeBlockQuote({ buyPerNight, suggestedResalePerNight, feePct: args.feePct });
  return { ...q, roomId, from, to, perNight };
}
