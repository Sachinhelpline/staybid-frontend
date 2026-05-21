/**
 * StayBid AI Dynamic Pricing Engine
 * Demand/supply model calibrated for Uttarakhand hill-station market.
 * Factors: season, day-of-week, Indian festivals/events, lead time, city demand, micro-variation,
 *          live occupancy (v130 — yield-management layer).
 * Prices update every hour (seeded by hour so deterministic within same hour).
 *
 * v130 — added an OPTIONAL `occupancyRatio` parameter (0–1) to
 * calculateDynamicPrice. When provided, drives a yield-management
 * boost/discount on top of the existing model: empty hotels drop
 * price automatically (fills inventory), near-sold-out nights surge
 * (captures revenue). Callers that don't pass it preserve the old
 * deterministic-only behavior end-to-end (zero regression risk for any
 * existing consumer of this function).
 *
 * v130 — all output prices + suggestedFlash snap to ₹100 (was ₹50). Matches
 * the platform-wide bidding rule established in v129 (lib/price-snap.ts).
 */

export type DemandLevel = "Low" | "Moderate" | "High" | "Very High" | "Surge";
export type PriceTrend  = "rising" | "falling" | "stable";

export interface DynamicPriceResult {
  price: number;           // AI live price (INR, rounded to ₹50)
  suggestedFlash: number;  // Recommended flash deal price
  demandLevel: DemandLevel;
  demandScore: number;     // 0–100
  multiplier: number;      // total multiplier vs base floor price
  priceChangePct: number;  // % vs base
  factors: string[];       // human-readable reasons
  trend: PriceTrend;
  nextUpdateIn: number;    // seconds until next hourly update
}

// ── Seasonal demand for Uttarakhand/Himachal hill stations (month 0–11) ──────
// v169 — June corrected: it is FULL (summer school vacation, monsoon does
// not arrive until 15 Jul). The monsoon discount is now a date-precise
// window (getMonsoonMult), not a blunt month value.
const SEASON_MULT: number[] = [
  0.95,  // Jan  — cold, low occupancy
  0.88,  // Feb  — off-season
  1.02,  // Mar  — Holi, spring begins
  1.20,  // Apr  — spring peak, schools on vacation soon
  1.32,  // May  — summer peak (Delhi/NCR escaping heat)
  1.10,  // Jun  — FULL: summer school vacation, monsoon not until 15 Jul
  0.95,  // Jul  — early Jul busy; monsoon discount (15 Jul+) is date-precise
  0.88,  // Aug  — monsoon
  0.90,  // Sep  — monsoon tail / clearing
  1.40,  // Oct  — peak autumn, Navratri/Dussehra, clearest skies
  1.48,  // Nov  — Diwali season, peak of peak
  1.35,  // Dec  — Christmas, New Year, snowfall starts
];

// ── Day-of-week multiplier (0=Sun … 6=Sat) ───────────────────────────────────
const DOW_MULT: number[] = [1.20, 0.90, 0.88, 0.92, 0.98, 1.32, 1.38];

// ── City baseline demand ──────────────────────────────────────────────────────
const CITY_DEMAND: Record<string, number> = {
  Mussoorie: 1.22,
  Rishikesh: 1.18,
  Manali:    1.20,
  Shimla:    1.15,
  Dehradun:  1.06,
  Dhanaulti: 1.10,
};

// ── Indian festivals / long-weekend events ────────────────────────────────────
interface EventWindow { months: number[]; days: number[]; mult: number; name: string }
const EVENTS: EventWindow[] = [
  { months: [10], days: [18,19,20,21,22,23,24,25,26,27,28,29,30,31], mult: 1.58, name: "Diwali Festival" },
  { months: [11], days: [1,2,3,4,5],                                  mult: 1.45, name: "Post-Diwali" },
  { months: [10], days: [2,3,4,5,6,7,8,9,10,11,12],                  mult: 1.38, name: "Navratri / Dussehra" },
  { months: [12], days: [24,25,26,27,28,29,30,31],                    mult: 1.48, name: "Christmas & New Year" },
  { months: [1],  days: [1,2],                                        mult: 1.45, name: "New Year" },
  { months: [3],  days: [14,15,16,17,18,19],                          mult: 1.32, name: "Holi" },
  { months: [4],  days: [13,14,15],                                   mult: 1.25, name: "Baisakhi / Dr Ambedkar Jayanti" },
];
// v169 — Independence Day + Republic Day removed from EVENTS: they are
// now driven by the day-of-week-aware long-weekend engine below, so the
// surge lands on the actual long-weekend dates instead of a blunt
// fixed 3-day window.

// ── Gazetted national holidays (fixed-date) — drive long-weekend surge ──
const GAZETTED_HOLIDAYS: { month: number; day: number; name: string }[] = [
  { month: 1,  day: 26, name: "Republic Day" },
  { month: 8,  day: 15, name: "Independence Day" },
  { month: 10, day: 2,  name: "Gandhi Jayanti" },
];

// When a holiday touches a weekend it forms a long weekend — the single
// biggest demand driver for hill stations. Returns a surge for every
// date inside that window (holiday + weekend + any bridge day).
function getLongWeekendMult(date: Date): { mult: number; name: string | null } {
  const y = date.getFullYear();
  const t = new Date(y, date.getMonth(), date.getDate()).getTime();
  for (const h of GAZETTED_HOLIDAYS) {
    const w = new Date(y, h.month - 1, h.day).getDay(); // 0 Sun … 6 Sat
    let startOff = 0, endOff = 0, isLong = true;
    if      (w === 5) { startOff = 0;  endOff = 2;  }   // Fri → Fri-Sun
    else if (w === 1) { startOff = -2; endOff = 0;  }   // Mon → Sat-Mon
    else if (w === 4) { startOff = 0;  endOff = 3;  }   // Thu → Thu-Sun (Fri bridge)
    else if (w === 2) { startOff = -3; endOff = 0;  }   // Tue → Sat-Tue (Mon bridge)
    else if (w === 6) { startOff = -1; endOff = 1;  }   // Sat → Fri-Sun
    else if (w === 0) { startOff = -1; endOff = 1;  }   // Sun → Sat-Mon
    else              { startOff = 0;  endOff = 0; isLong = false; } // Wed → isolated
    const start = new Date(y, h.month - 1, h.day + startOff).getTime();
    const end   = new Date(y, h.month - 1, h.day + endOff).getTime();
    if (t >= start && t <= end) {
      return {
        mult: isLong ? 1.20 : 1.10,
        name: `${h.name} ${isLong ? "Long Weekend" : "Holiday"}`,
      };
    }
  }
  return { mult: 1.0, name: null };
}

// ── School-vacation demand windows (peak travel for families) ────────────
//   Summer: 15 Apr – 30 Jun   |   Winter: 20 Dec – 15 Jan
function getSchoolSeasonMult(date: Date): { mult: number; name: string | null } {
  const m = date.getMonth() + 1, d = date.getDate();
  if ((m === 4 && d >= 15) || m === 5 || m === 6)
    return { mult: 1.15, name: "Summer Vacation Season" };
  if ((m === 12 && d >= 20) || (m === 1 && d <= 15))
    return { mult: 1.15, name: "Winter Vacation Season" };
  return { mult: 1.0, name: null };
}

// ── Monsoon window — hill-station travel dips (landslide risk) ───────────
//   15 Jul – 15 Sep. June is intentionally NOT monsoon.
function getMonsoonMult(date: Date): { mult: number; label: string | null } {
  const m = date.getMonth() + 1, d = date.getDate();
  if ((m === 7 && d >= 15) || m === 8 || (m === 9 && d <= 15))
    return { mult: 0.80, label: "Monsoon Season" };
  return { mult: 1.0, label: null };
}

function getEventMultiplier(date: Date): { mult: number; name: string | null } {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  for (const ev of EVENTS) {
    if (ev.months.includes(m) && ev.days.includes(d)) return { mult: ev.mult, name: ev.name };
  }
  return { mult: 1.0, name: null };
}

// ── Lead-time urgency ─────────────────────────────────────────────────────────
function getLeadMult(days: number): { mult: number; label: string } {
  if (days === 0)   return { mult: 0.80, label: "Same-day (Last Minute)" };
  if (days <= 2)    return { mult: 0.87, label: "Last Minute Deal" };
  if (days <= 7)    return { mult: 1.06, label: "This Week" };
  if (days <= 14)   return { mult: 1.12, label: "Advance Booking" };
  if (days <= 30)   return { mult: 1.08, label: "Early Booking" };
  return              { mult: 1.03, label: "Far Advance" };
}

// ── Micro-variation: deterministic, changes every hour ────────────────────────
function getMicroMult(base: number, checkIn: string, city: string): number {
  const h = new Date().getHours();
  const seed = (base % 100) * 3 + h * 17 + city.length * 7 + new Date(checkIn).getDate() * 5;
  const variation = ((seed % 11) - 5) / 200; // ±2.5%
  return 1 + variation;
}

// ── Yield-management: live occupancy → price boost / discount ────────────────
// v130 — Option B yield rule. Takes a 0–1 ratio (0 = totally empty, 1 = sold
// out). When unknown / not provided, returns 1.0 (no-op) so legacy callers
// stay byte-identical.
//   <30%  → 0.88×  (deep discount — fill empty rooms)
//   30-50% → 0.96× (gentle discount — pull demand)
//   50-70% → 1.00× (neutral)
//   70-85% → 1.12× (limited rooms — premium)
//   >85%  → 1.28× (near sold-out — surge)
function getOccupancyMult(ratio?: number): { mult: number; label: string | null } {
  if (typeof ratio !== "number" || !Number.isFinite(ratio)) return { mult: 1.0, label: null };
  const r = Math.max(0, Math.min(1, ratio));
  if (r < 0.30) return { mult: 0.88, label: "Low Occupancy — Deal" };
  if (r < 0.50) return { mult: 0.96, label: "Open Inventory" };
  if (r < 0.70) return { mult: 1.00, label: null };
  if (r < 0.85) return { mult: 1.12, label: "Limited Rooms" };
  return            { mult: 1.28, label: "Near Sold-out — Surge" };
}

// ─────────────────────────────────────────────────────────────────────────────
export function calculateDynamicPrice(
  baseFloorPrice: number,
  checkInDate: string,
  city: string,
  /**
   * Optional yield-management input. 0 = empty, 1 = fully sold for the
   * date. When provided, drives an occupancy boost on top of the demand
   * model. Callers without this value get the pre-v130 deterministic-only
   * behavior unchanged.
   */
  occupancyRatio?: number,
): DynamicPriceResult {
  const checkIn = new Date(checkInDate);
  const today   = new Date();

  // Clamp to today if date is in past
  const daysUntil = Math.max(0, Math.floor((checkIn.getTime() - today.setHours(0,0,0,0)) / 86400000));

  const seasonMult = SEASON_MULT[checkIn.getMonth()] ?? 1.0;
  const dowMult    = DOW_MULT[checkIn.getDay()] ?? 1.0;
  const { mult: eventMult, name: eventName } = getEventMultiplier(checkIn);
  const { mult: leadMult,  label: leadLabel } = getLeadMult(daysUntil);
  const cityMult   = CITY_DEMAND[city] ?? 1.0;
  const microMult  = getMicroMult(baseFloorPrice, checkInDate, city);
  // v130 — yield-management. mult = 1.0 when ratio not supplied → legacy
  // callers preserved verbatim.
  const { mult: occupancyMult, label: occupancyLabel } = getOccupancyMult(occupancyRatio);
  // v169 — Indian-calendar demand windows: long weekends, school
  // vacations, and the date-precise monsoon discount.
  const { mult: schoolMult,  name:  schoolName }   = getSchoolSeasonMult(checkIn);
  const { mult: monsoonMult, label: monsoonLabel } = getMonsoonMult(checkIn);
  const { mult: lwMult,      name:  lwName }       = getLongWeekendMult(checkIn);

  let totalMult = seasonMult * dowMult * eventMult * leadMult * cityMult * microMult
                * occupancyMult * schoolMult * monsoonMult * lwMult;
  // v169 — bulletproof clamp: however many surges/discounts stack, the
  // multiplier (and therefore the price) stays inside a sane band.
  totalMult = Math.max(0.55, Math.min(2.20, totalMult));
  const rawPrice  = baseFloorPrice * totalMult;
  // v130 — snap to ₹100 (was ₹50). Aligns with the platform-wide price-snap
  // rule (lib/price-snap.ts). Floor remains a hard lower bound.
  const price     = Math.max(baseFloorPrice, Math.round(rawPrice / 100) * 100);

  // Demand score 0-100
  // v169 — score band widened to match the clamped multiplier range.
  const demandScore = Math.min(100, Math.max(0, Math.round((totalMult - 0.55) / (2.20 - 0.55) * 100)));
  const demandLevel: DemandLevel =
    demandScore >= 88 ? "Surge" :
    demandScore >= 72 ? "Very High" :
    demandScore >= 52 ? "High" :
    demandScore >= 32 ? "Moderate" : "Low";

  // Human-readable factor list
  const factors: string[] = [];
  if (eventName) factors.push(eventName);
  const monthName = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][checkIn.getMonth()];
  if (seasonMult >= 1.28) factors.push(`${monthName} Peak Season`);
  else if (seasonMult <= 0.78) factors.push(`${monthName} Off-Season`);
  if (dowMult >= 1.28) factors.push("Weekend Surge");
  if (leadMult < 0.90) factors.push("Last-minute Vacancy");
  else if (leadMult >= 1.10) factors.push("Advance Booking Demand");
  if (cityMult >= 1.18) factors.push(`High Demand — ${city}`);
  // v169 — Indian-calendar demand windows.
  if (lwName) factors.push(lwName);
  if (schoolName) factors.push(schoolName);
  if (monsoonLabel) factors.push(monsoonLabel);
  // v130 — surface the yield factor only when it actually moved price.
  if (occupancyLabel) factors.push(occupancyLabel);
  if (factors.length === 0) factors.push("Standard Market Rate");

  // Flash deal suggestion: 72–78% of AI price, never below baseFloorPrice.
  // v130 — snap to ₹100 like the rest of the platform.
  const suggestedFlash = Math.max(
    Math.round(baseFloorPrice * 0.85 / 100) * 100,
    Math.round(price * 0.76 / 100) * 100,
  );

  const priceChangePct = Math.round((totalMult - 1) * 100);

  // Trend: compare with yesterday-same-time multiplier (approximate)
  const yestMult = SEASON_MULT[checkIn.getMonth()] * DOW_MULT[(checkIn.getDay() + 6) % 7] * cityMult;
  // v130 — trend reflects yield-adjusted total mult too: a hotel that filled
  // up overnight reads as "rising" even mid-week.
  const trend: PriceTrend = totalMult > yestMult * 1.03 ? "rising" : totalMult < yestMult * 0.97 ? "falling" : "stable";

  const nextUpdateIn = (60 - new Date().getMinutes()) * 60;

  return {
    price,
    suggestedFlash,
    demandLevel,
    demandScore,
    multiplier: parseFloat(totalMult.toFixed(3)),
    priceChangePct,
    factors,
    trend,
    nextUpdateIn,
  };
}

// ── Luxury room fallback images by type keyword ───────────────────────────────
const ROOM_IMAGES: { keywords: string[]; url: string }[] = [
  {
    keywords: ["suite", "presidential", "royal", "penthouse"],
    url: "https://images.unsplash.com/photo-1590490360182-c33d57733427?w=800&q=80",
  },
  {
    keywords: ["mountain", "view", "valley", "peak", "hilltop"],
    url: "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800&q=80",
  },
  {
    keywords: ["forest", "wood", "jungle", "nature", "cottage", "cabin"],
    url: "https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=800&q=80",
  },
  {
    keywords: ["river", "ganga", "water", "stream", "lake"],
    url: "https://images.unsplash.com/photo-1578683010236-d716f9a3f461?w=800&q=80",
  },
  {
    keywords: ["deluxe", "luxury", "premium", "superior"],
    url: "https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=800&q=80",
  },
  {
    keywords: ["heritage", "palace", "classic", "vintage"],
    url: "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=800&q=80",
  },
  {
    keywords: ["studio", "studio"],
    url: "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=800&q=80",
  },
];
const DEFAULT_ROOM_IMAGE = "https://images.unsplash.com/photo-1631049421450-348ccd7f8949?w=800&q=80";

export function getRoomImage(roomType: string, existingImages?: string[]): string {
  if (existingImages?.[0]) return existingImages[0];
  const lower = (roomType || "").toLowerCase();
  for (const r of ROOM_IMAGES) {
    if (r.keywords.some((k) => lower.includes(k))) return r.url;
  }
  return DEFAULT_ROOM_IMAGE;
}

// ── Demand badge colors ───────────────────────────────────────────────────────
export const DEMAND_STYLE: Record<DemandLevel, { bg: string; text: string; border: string; dot: string }> = {
  "Low":       { bg: "bg-slate-100",   text: "text-slate-600",   border: "border-slate-200",   dot: "bg-slate-400"   },
  "Moderate":  { bg: "bg-amber-50",    text: "text-amber-700",   border: "border-amber-200",   dot: "bg-amber-400"   },
  "High":      { bg: "bg-orange-50",   text: "text-orange-700",  border: "border-orange-200",  dot: "bg-orange-500"  },
  "Very High": { bg: "bg-red-50",      text: "text-red-700",     border: "border-red-200",     dot: "bg-red-500"     },
  "Surge":     { bg: "bg-rose-50",     text: "text-rose-700",    border: "border-rose-300",    dot: "bg-rose-600"    },
};
