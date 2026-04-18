/**
 * StayBid AI Dynamic Pricing Engine
 * Demand/supply model calibrated for Uttarakhand hill-station market.
 * Factors: season, day-of-week, Indian festivals/events, lead time, city demand, micro-variation.
 * Prices update every hour (seeded by hour so deterministic within same hour).
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
const SEASON_MULT: number[] = [
  0.95,  // Jan  — cold, low occupancy
  0.88,  // Feb  — off-season
  1.02,  // Mar  — Holi, spring begins
  1.20,  // Apr  — spring peak, schools on vacation soon
  1.32,  // May  — summer peak (Delhi/NCR escaping heat)
  0.72,  // Jun  — monsoon starts, landslide risk
  0.68,  // Jul  — heavy monsoon, lowest demand
  0.78,  // Aug  — Independence Day bump, monsoon waning
  0.84,  // Sep  — monsoon end, mild
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
  { months: [8],  days: [14,15,16,17],                                mult: 1.22, name: "Independence Day" },
  { months: [1],  days: [25,26,27],                                   mult: 1.18, name: "Republic Day" },
  { months: [4],  days: [13,14,15],                                   mult: 1.25, name: "Baisakhi / Dr Ambedkar Jayanti" },
];

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

// ─────────────────────────────────────────────────────────────────────────────
export function calculateDynamicPrice(
  baseFloorPrice: number,
  checkInDate: string,
  city: string,
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

  const totalMult = seasonMult * dowMult * eventMult * leadMult * cityMult * microMult;
  const rawPrice  = baseFloorPrice * totalMult;
  const price     = Math.max(baseFloorPrice, Math.round(rawPrice / 50) * 50);

  // Demand score 0-100
  const demandScore = Math.min(100, Math.max(0, Math.round((totalMult - 0.60) / (1.80 - 0.60) * 100)));
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
  if (factors.length === 0) factors.push("Standard Market Rate");

  // Flash deal suggestion: 72–78% of AI price, never below baseFloorPrice
  const suggestedFlash = Math.max(
    Math.round(baseFloorPrice * 0.85 / 50) * 50,
    Math.round(price * 0.76 / 50) * 50,
  );

  const priceChangePct = Math.round((totalMult - 1) * 100);

  // Trend: compare with yesterday-same-time multiplier (approximate)
  const yestMult = SEASON_MULT[checkIn.getMonth()] * DOW_MULT[(checkIn.getDay() + 6) % 7] * cityMult;
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
