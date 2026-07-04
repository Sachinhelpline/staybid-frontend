// ════════════════════════════════════════════════════════════════════════════
// StayCircle™ — LIVE Investment Returns  (v294.5)
//
// The "Investment & Returns · Live" calculator on /circle/build is driven by
// the REAL StayBid AI pricing engine (lib/ai-pricing.calculateDynamicPrice) —
// the exact same demand/supply model that prices every hotel night on the
// platform. NO prototype / static numbers.
//
// How a StayCircle room actually earns: StayBid rents the invested room out
// nightly at a demand-driven dynamic rate (season · day-of-week · Indian
// festivals · long weekends · school vacations · monsoon · city baseline).
// So a room's expected return is NOT a fixed % — it swings with the month and
// the city. This module turns each selected (city, room, month) into a live
// projection using that engine:
//
//   • liveNightly   → the real AI dynamic nightly rate for that city × month
//   • occupancyPct  → projected occupancy from the demand score
//   • demandFactor  → how strong that month is vs the city's yearly average
//   • live ROI band → the property's seeded ROI band × demandFactor
//
// PURE — no DB, no fetch. Imported by /api/circle/returns (authoritative) and
// safe to import client-side for an instant fallback. The COMMITMENT figure
// (monthlyTotal / payNow) is NOT computed here — that stays in
// lib/circle/engine.computeBundle so preview == server charge, always. This
// module only powers the demand-driven RETURN projection shown to the investor.
// ════════════════════════════════════════════════════════════════════════════

import { calculateDynamicPrice } from "@/lib/ai-pricing";
import { diversificationBonus } from "@/lib/circle/engine";

export interface ReturnsItem {
  propertyId: string;
  city: string;
  monthlyRate: number; // ₹/room/month commitment (base engine input)
  rooms: number;
  roiMin: number;      // property seeded ROI band (pct)
  roiMax: number;
}

export interface LiveItemReturn {
  propertyId: string;
  city: string;
  rooms: number;
  liveNightly: number;      // real AI dynamic nightly for city × month
  occupancyPct: number;     // 0–100 projected occupancy
  demandScore: number;      // 0–100
  demandFactor: number;     // month strength vs city yearly avg (~0.75–1.35)
  liveRoiMin: number;       // demand-adjusted ROI band
  liveRoiMax: number;
  factors: string[];        // human-readable "why" (top 3)
}

export interface LiveReturns {
  ok: boolean;
  month: number;            // 0–11
  monthLabel: string;
  items: LiveItemReturn[];
  propertyCount: number;
  roomCount: number;
  diversificationBonusPct: number;
  expectedRoiMin: number;   // pct, incl. diversification bonus
  expectedRoiMax: number;
  avgNightly: number;       // weighted live nightly across the bundle
  avgOccupancyPct: number;  // weighted occupancy
  demandFactor: number;     // weighted month strength vs avg
  peakMonth: number;        // 0–11 — best-return month for this bundle
  peakLabel: string;
  factors: string[];        // merged top demand drivers for the month
}

export const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Sample days spread across a month — captures weekends + mid-week so the
// average reflects the real weekly demand mix, not a single date.
const SAMPLE_DAYS = [2, 6, 10, 14, 18, 22, 26, 29];

// Deterministic sampling year: always the NEXT calendar year so every month
// sits ~6–18 months out. That holds the lead-time multiplier uniform across
// all months, so the seasonal demand signal (M / yearly-avg) is clean and
// month-to-month comparable — the investor is comparing SEASONS, not booking
// urgency. `new Date()` is only used here for the base year, never per-price.
function sampleYear(): number {
  return new Date().getFullYear() + 1;
}

function ymd(year: number, month: number, day: number): string {
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

// Average the real AI engine across a month for one city + nightly anchor.
function monthDemand(anchor: number, city: string, month: number, year: number) {
  let sumMult = 0, sumScore = 0, sumPrice = 0;
  const factorTally: Record<string, number> = {};
  for (const d of SAMPLE_DAYS) {
    const r = calculateDynamicPrice(anchor, ymd(year, month, d), city);
    sumMult += r.multiplier;
    sumScore += r.demandScore;
    sumPrice += r.price;
    r.factors.forEach((f) => { factorTally[f] = (factorTally[f] || 0) + 1; });
  }
  const n = SAMPLE_DAYS.length;
  // top factors by frequency across the sampled month
  const factors = Object.entries(factorTally)
    .sort((a, b) => b[1] - a[1])
    .map(([f]) => f)
    .filter((f) => f !== "Standard Market Rate")
    .slice(0, 3);
  return {
    mult: sumMult / n,
    score: sumScore / n,
    nightly: Math.round(sumPrice / n),
    factors: factors.length ? factors : ["Standard Market Rate"],
  };
}

// City yearly-average multiplier — the denominator that turns a month's raw
// demand into a comparable "strength vs average" factor. Cached per request
// via the closure map the caller passes in.
function cityYearAvgMult(
  anchor: number, city: string, year: number, cache: Map<string, number>,
): number {
  const key = `${city}|${anchor}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let sum = 0;
  for (let m = 0; m < 12; m++) sum += monthDemand(anchor, city, m, year).mult;
  const avg = sum / 12;
  cache.set(key, avg);
  return avg;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function computeItem(
  it: ReturnsItem, month: number, year: number, cache: Map<string, number>,
): LiveItemReturn {
  const rate = Math.max(0, Number(it.monthlyRate) || 0);
  // Nightly anchor derived from the monthly commitment (~22 booked nights of
  // baseline earning). The engine's city + season multipliers then move it to
  // the real dynamic nightly for the selected city × month.
  const anchor = Math.max(500, Math.round(rate / 22) || 500);
  const md = monthDemand(anchor, it.city, month, year);
  const yearAvg = cityYearAvgMult(anchor, it.city, year, cache) || md.mult || 1;
  const demandFactor = clamp(md.mult / yearAvg, 0.75, 1.35);

  const roiMin = clamp(Math.round((Number(it.roiMin) || 0) * demandFactor), 4, 55);
  const roiMax = clamp(Math.round((Number(it.roiMax) || 0) * demandFactor), roiMin, 60);
  const occupancyPct = clamp(Math.round(52 + md.score * 0.42), 45, 97);

  return {
    propertyId: it.propertyId,
    city: it.city,
    rooms: Math.max(1, Math.floor(Number(it.rooms) || 1)),
    liveNightly: md.nightly,
    occupancyPct,
    demandScore: Math.round(md.score),
    demandFactor: Math.round(demandFactor * 100) / 100,
    liveRoiMin: roiMin,
    liveRoiMax: roiMax,
    factors: md.factors,
  };
}

/**
 * Compute the live demand-driven return projection for a bundle in a given
 * month. Pure + deterministic within the hour (the AI engine is hour-seeded).
 */
export function computeLiveReturns(rawItems: ReturnsItem[], month: number): LiveReturns {
  const mo = clamp(Math.floor(Number(month)), 0, 11);
  const year = sampleYear();
  const cache = new Map<string, number>();
  const items = (Array.isArray(rawItems) ? rawItems : [])
    .filter((it) => it && Number(it.rooms) > 0 && Number(it.monthlyRate) > 0 && it.city)
    .map((it) => computeItem(it, mo, year, cache));

  const empty: LiveReturns = {
    ok: false, month: mo, monthLabel: MONTH_LABELS[mo],
    items: [], propertyCount: 0, roomCount: 0, diversificationBonusPct: 0,
    expectedRoiMin: 0, expectedRoiMax: 0, avgNightly: 0, avgOccupancyPct: 0,
    demandFactor: 1, peakMonth: mo, peakLabel: MONTH_SHORT[mo], factors: [],
  };
  if (!items.length) return empty;

  // contribution weight = monthly commitment for that line
  const weightOf = (i: LiveItemReturn, src: ReturnsItem) =>
    Math.max(0, (Number(src.monthlyRate) || 0) * i.rooms);
  const srcById = new Map(rawItems.map((s) => [`${s.propertyId}|${s.city}`, s]));
  const totalWeight = items.reduce(
    (s, i) => s + weightOf(i, srcById.get(`${i.propertyId}|${i.city}`) || ({} as any)), 0,
  ) || 1;

  const wMin = items.reduce((s, i) => s + i.liveRoiMin * weightOf(i, srcById.get(`${i.propertyId}|${i.city}`) || ({} as any)), 0) / totalWeight;
  const wMax = items.reduce((s, i) => s + i.liveRoiMax * weightOf(i, srcById.get(`${i.propertyId}|${i.city}`) || ({} as any)), 0) / totalWeight;
  const avgNightly = Math.round(items.reduce((s, i) => s + i.liveNightly * weightOf(i, srcById.get(`${i.propertyId}|${i.city}`) || ({} as any)), 0) / totalWeight);
  const avgOcc = Math.round(items.reduce((s, i) => s + i.occupancyPct * weightOf(i, srcById.get(`${i.propertyId}|${i.city}`) || ({} as any)), 0) / totalWeight);
  const wFactor = items.reduce((s, i) => s + i.demandFactor * weightOf(i, srcById.get(`${i.propertyId}|${i.city}`) || ({} as any)), 0) / totalWeight;

  const propertyIds: string[] = [];
  items.forEach((i) => { if (!propertyIds.includes(i.propertyId)) propertyIds.push(i.propertyId); });
  const propertyCount = propertyIds.length;
  const bonus = diversificationBonus(propertyCount);

  const expectedRoiMin = Math.round((wMin + bonus) * 10) / 10;
  const expectedRoiMax = Math.round((wMax + bonus) * 10) / 10;

  // merge top demand drivers across items for this month
  const factors: string[] = [];
  items.forEach((i) => i.factors.forEach((f) => { if (!factors.includes(f)) factors.push(f); }));

  // peak-return month for THIS bundle (best weighted demandFactor across the
  // year) — powers a "best season: Oct" hint without a second round-trip.
  let peakMonth = mo, peakFactor = -Infinity;
  for (let m = 0; m < 12; m++) {
    const f = items.reduce((s, i) => {
      const src = srcById.get(`${i.propertyId}|${i.city}`);
      if (!src) return s;
      const anchor = Math.max(500, Math.round((Number(src.monthlyRate) || 0) / 22) || 500);
      const md = monthDemand(anchor, i.city, m, year);
      const avg = cityYearAvgMult(anchor, i.city, year, cache) || md.mult || 1;
      return s + clamp(md.mult / avg, 0.75, 1.35) * weightOf(i, src);
    }, 0) / totalWeight;
    if (f > peakFactor) { peakFactor = f; peakMonth = m; }
  }

  return {
    ok: true,
    month: mo, monthLabel: MONTH_LABELS[mo],
    items, propertyCount, roomCount: items.reduce((s, i) => s + i.rooms, 0),
    diversificationBonusPct: bonus,
    expectedRoiMin, expectedRoiMax,
    avgNightly, avgOccupancyPct: avgOcc,
    demandFactor: Math.round(wFactor * 100) / 100,
    peakMonth, peakLabel: MONTH_SHORT[peakMonth],
    factors: factors.slice(0, 4),
  };
}
