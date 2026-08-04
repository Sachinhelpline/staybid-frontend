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

// v393 — satellite cities inherit their hub's real seasonal curve.
import { cityMeta } from "@/lib/cities";

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

// ── v720 — Admin-tunable pricing-engine overrides ────────────────────────────
// The AI formula is UNCHANGED — only the "digits" inside it become admin-editable.
// Every field is OPTIONAL: when absent the engine uses the exact hardcoded
// constant it always did, so a caller that passes no cfg (every client-side
// fallback + the security suite) stays byte-identical. The authoritative server
// writers (cron price-spine + read-spine) load the admin config and pass it in,
// so the WRITTEN prices reflect the admin's tuning. See
// lib/pricing/engine-config-store.ts for the resolver + defaults.
export interface PricingEngineOverrides {
  seasonMults?: number[];               // 12 — national curve (city curves stay hardcoded)
  dowMults?: number[];                  // 7  — Sun…Sat
  occupancyMults?: number[];            // 5  — [<30, 30-50, 50-70, 70-85, >85]
  leadMults?: number[];                 // 6  — [same-day, ≤2, ≤7, ≤14, ≤30, >30]
  eventMults?: number[];                // ordered to EVENTS[]
  cityDemand?: Record<string, number>;  // per-city baseline overrides (merged over defaults)
  monsoonMult?: number;                 // 0.80
  schoolMult?: number;                  // 1.15
  longWeekendMult?: number;             // 1.20 (long weekend)
  longWeekendHolidayMult?: number;      // 1.10 (isolated holiday)
  microAmplitudePct?: number;           // 2.5 — ± band of the hourly micro-variation
  clampMin?: number;                    // 0.55 — lower multiplier bound
  clampMax?: number;                    // 2.20 — upper multiplier bound
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

// ── Per-CITY real seasonal curve (month 0–11) ────────────────────────────────
// The national SEASON_MULT above is calibrated for Uttarakhand/Himachal hill
// stations (Oct/Nov peak, winter low). The 12-month demand-cycle hub cities
// each have a DIFFERENT real high/low season — a beach, desert, or high-Himalaya
// market does not peak when Mussoorie does. This is NOT a new engine: it only
// swaps the seasonal INPUT to calculateDynamicPrice per city; the multiplier
// composition, clamp and snap are unchanged. A city without an entry here falls
// back to the national SEASON_MULT, so existing cities are byte-identical.
//
// Curves are calibrated to real Indian tourism seasonality AND kept consistent
// with lib/circle/demand-cycle.ts (a city's poster "primary" months read as
// peak multipliers here). Values [Jan … Dec].
const CITY_SEASON_MULT: Record<string, number[]> = {
  // Beach — peak Nov–Feb (Christmas/New Year), monsoon Jun–Sep low.
  Goa:       [1.35, 1.30, 1.10, 0.95, 0.85, 0.70, 0.68, 0.72, 0.90, 1.10, 1.40, 1.55],
  // Backwaters/hills — peak Oct–Feb, warm shoulder + monsoon softer.
  Kerala:    [1.25, 1.22, 1.15, 1.00, 0.95, 0.85, 0.88, 0.90, 1.05, 1.20, 1.28, 1.30],
  // Lake city + weddings — peak Oct–Mar, brutal desert summer low.
  Udaipur:   [1.30, 1.28, 1.15, 1.00, 0.80, 0.70, 0.75, 0.85, 1.05, 1.30, 1.40, 1.35],
  // Desert — peak Nov–Feb, extreme summer Apr–Aug very low.
  Jaisalmer: [1.30, 1.25, 1.05, 0.85, 0.70, 0.62, 0.65, 0.72, 0.90, 1.15, 1.40, 1.38],
  // High Himalaya — roads shut / near-closed Nov–Mar, peak Jun–Sep.
  Leh:       [0.55, 0.55, 0.62, 0.85, 1.05, 1.35, 1.42, 1.38, 1.20, 0.85, 0.60, 0.55],
  // NE hills — good Mar–May, living-root-bridge monsoon tourism, autumn peak.
  Meghalaya: [1.05, 1.05, 1.15, 1.22, 1.15, 1.00, 0.95, 1.05, 1.20, 1.28, 1.20, 1.10],
  // Coastal temple town — peak Oct–Feb, Rath Yatra Jun bump, summer softer.
  Puri:      [1.25, 1.20, 1.05, 0.95, 0.85, 0.92, 0.85, 0.88, 1.00, 1.20, 1.32, 1.32],
  // Coffee hills — peak Oct–Dec + spring, monsoon Jun–Aug softer.
  Coorg:     [1.20, 1.18, 1.10, 1.05, 1.00, 0.85, 0.82, 0.90, 1.08, 1.28, 1.30, 1.28],
};

/**
 * Resolve a city's real seasonal curve: its own if present, else its hub's
 * curve if it's a satellite (Jaipur → Udaipur, Alleppey → Kerala …), else null.
 */
function cityCurve(city: string): number[] | null {
  if (CITY_SEASON_MULT[city]) return CITY_SEASON_MULT[city];
  const hub = cityMeta(city)?.satelliteOf;
  if (hub && CITY_SEASON_MULT[hub]) return CITY_SEASON_MULT[hub];
  return null;
}

/** True when a city resolves to a real seasonal curve (skips the hill-station monsoon discount). */
function hasCitySeasonCurve(city: string): boolean {
  return cityCurve(city) !== null;
}

/** Seasonal multiplier for a city+month — real curve (own or hub's) if present, else the national curve. */
// The admin-tunable override applies ONLY to the NATIONAL curve (cities without
// their own real curve) — per-city curves stay hardcoded for now.
function seasonMultFor(city: string, month: number, cfg?: PricingEngineOverrides): number {
  const own = cityCurve(city);
  if (own) return own[month] ?? 1.0;
  const nat = cfg?.seasonMults && cfg.seasonMults.length === SEASON_MULT.length ? cfg.seasonMults : SEASON_MULT;
  const v = Number(nat[month]);
  return Number.isFinite(v) ? v : (SEASON_MULT[month] ?? 1.0);
}

// ── Day-of-week multiplier (0=Sun … 6=Sat) ───────────────────────────────────
// v721 — hotel-industry weekend: Friday is a PEAK weekend night (leisure guests
// arrive Fri), so it is weighted as the top day (≥ Saturday). Admin-tunable in
// the Pricing Engine tab.
const DOW_MULT: number[] = [1.20, 0.90, 0.88, 0.92, 0.98, 1.40, 1.38];

// ── City baseline demand ──────────────────────────────────────────────────────
const CITY_DEMAND: Record<string, number> = {
  Mussoorie: 1.22,
  Rishikesh: 1.18,
  Manali:    1.20,
  Shimla:    1.15,
  Dehradun:  1.06,
  Dhanaulti: 1.10,
  // ── 12-month demand-cycle hub cities (baseline demand weight; the per-month
  //    performing/off pattern is a display overlay in lib/circle/demand-cycle.ts,
  //    not wired into pricing — the Spine's SEASON_MULT stays the money engine).
  Goa:       1.30,
  Kerala:    1.22,
  Udaipur:   1.25,
  Jaisalmer: 1.15,
  Leh:       1.20,
  Meghalaya: 1.12,
  Puri:      1.10,
  Coorg:     1.12,
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
function getLongWeekendMult(date: Date, cfg?: PricingEngineOverrides): { mult: number; name: string | null } {
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
        mult: isLong ? (cfg?.longWeekendMult ?? 1.20) : (cfg?.longWeekendHolidayMult ?? 1.10),
        name: `${h.name} ${isLong ? "Long Weekend" : "Holiday"}`,
      };
    }
  }
  return { mult: 1.0, name: null };
}

// ── School-vacation demand windows (peak travel for families) ────────────
//   Summer: 15 Apr – 30 Jun   |   Winter: 20 Dec – 15 Jan
function getSchoolSeasonMult(date: Date, cfg?: PricingEngineOverrides): { mult: number; name: string | null } {
  const m = date.getMonth() + 1, d = date.getDate();
  const sm = cfg?.schoolMult ?? 1.15;
  if ((m === 4 && d >= 15) || m === 5 || m === 6)
    return { mult: sm, name: "Summer Vacation Season" };
  if ((m === 12 && d >= 20) || (m === 1 && d <= 15))
    return { mult: sm, name: "Winter Vacation Season" };
  return { mult: 1.0, name: null };
}

// ── Monsoon window — hill-station travel dips (landslide risk) ───────────
//   15 Jul – 15 Sep. June is intentionally NOT monsoon.
function getMonsoonMult(date: Date, cfg?: PricingEngineOverrides): { mult: number; label: string | null } {
  const m = date.getMonth() + 1, d = date.getDate();
  if ((m === 7 && d >= 15) || m === 8 || (m === 9 && d <= 15))
    return { mult: cfg?.monsoonMult ?? 0.80, label: "Monsoon Season" };
  return { mult: 1.0, label: null };
}

function getEventMultiplier(date: Date, cfg?: PricingEngineOverrides): { mult: number; name: string | null } {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  for (let i = 0; i < EVENTS.length; i++) {
    const ev = EVENTS[i];
    if (ev.months.includes(m) && ev.days.includes(d)) {
      const ovr = cfg?.eventMults?.[i];
      return { mult: (typeof ovr === "number" && Number.isFinite(ovr)) ? ovr : ev.mult, name: ev.name };
    }
  }
  return { mult: 1.0, name: null };
}

// ── Lead-time urgency ─────────────────────────────────────────────────────────
// Bands: [same-day, ≤2, ≤7, ≤14, ≤30, >30]. Extracted so the admin config store
// shares the SAME defaults (single source of truth).
export const LEAD_MULTS_DEFAULT: number[] = [0.80, 0.87, 1.06, 1.12, 1.08, 1.03];
const LEAD_LABELS = ["Same-day (Last Minute)", "Last Minute Deal", "This Week", "Advance Booking", "Early Booking", "Far Advance"];
function leadBand(days: number): number {
  if (days === 0) return 0;
  if (days <= 2)  return 1;
  if (days <= 7)  return 2;
  if (days <= 14) return 3;
  if (days <= 30) return 4;
  return 5;
}
function getLeadMult(days: number, cfg?: PricingEngineOverrides): { mult: number; label: string } {
  const i = leadBand(days);
  const arr = cfg?.leadMults && cfg.leadMults.length === LEAD_MULTS_DEFAULT.length ? cfg.leadMults : LEAD_MULTS_DEFAULT;
  const v = Number(arr[i]);
  return { mult: Number.isFinite(v) ? v : LEAD_MULTS_DEFAULT[i], label: LEAD_LABELS[i] };
}

// ── Micro-variation: deterministic, changes every hour ────────────────────────
function getMicroMult(base: number, checkIn: string, city: string, cfg?: PricingEngineOverrides): number {
  const h = new Date().getHours();
  const seed = (base % 100) * 3 + h * 17 + city.length * 7 + new Date(checkIn).getDate() * 5;
  // Default path is byte-identical to the original ((seed%11)-5)/200 (±2.5%).
  // When admin sets an amplitude, scale the same ±5 step to ±(amplitude).
  const amp = cfg?.microAmplitudePct;
  const variation = (typeof amp === "number" && Number.isFinite(amp))
    ? ((seed % 11) - 5) / 5 * (amp / 100)
    : ((seed % 11) - 5) / 200;
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
// Bands: [<30%, 30-50%, 50-70%, 70-85%, >85%]. Extracted so the admin config
// store shares the SAME defaults (single source of truth).
export const OCCUPANCY_MULTS_DEFAULT: number[] = [0.88, 0.96, 1.00, 1.12, 1.28];
const OCCUPANCY_LABELS: (string | null)[] = ["Low Occupancy — Deal", "Open Inventory", null, "Limited Rooms", "Near Sold-out — Surge"];
function getOccupancyMult(ratio?: number, cfg?: PricingEngineOverrides): { mult: number; label: string | null } {
  if (typeof ratio !== "number" || !Number.isFinite(ratio)) return { mult: 1.0, label: null };
  const r = Math.max(0, Math.min(1, ratio));
  const i = r < 0.30 ? 0 : r < 0.50 ? 1 : r < 0.70 ? 2 : r < 0.85 ? 3 : 4;
  const arr = cfg?.occupancyMults && cfg.occupancyMults.length === OCCUPANCY_MULTS_DEFAULT.length ? cfg.occupancyMults : OCCUPANCY_MULTS_DEFAULT;
  const v = Number(arr[i]);
  return { mult: Number.isFinite(v) ? v : OCCUPANCY_MULTS_DEFAULT[i], label: OCCUPANCY_LABELS[i] };
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
  /**
   * v720 — OPTIONAL admin-tuned overrides for the formula's constants. When
   * absent every value falls back to the hardcoded default, so the result is
   * byte-identical to the pre-v720 engine (every client fallback passes none).
   */
  cfg?: PricingEngineOverrides,
): DynamicPriceResult {
  const checkIn = new Date(checkInDate);
  const today   = new Date();

  // Clamp to today if date is in past
  const daysUntil = Math.max(0, Math.floor((checkIn.getTime() - today.setHours(0,0,0,0)) / 86400000));

  const seasonMult = seasonMultFor(city, checkIn.getMonth(), cfg);
  const dowMult    = ((cfg?.dowMults && cfg.dowMults.length === DOW_MULT.length ? cfg.dowMults : DOW_MULT)[checkIn.getDay()]) ?? 1.0;
  const { mult: eventMult, name: eventName } = getEventMultiplier(checkIn, cfg);
  const { mult: leadMult,  label: leadLabel } = getLeadMult(daysUntil, cfg);
  const cityMult   = (cfg?.cityDemand?.[city] ?? CITY_DEMAND[city]) ?? 1.0;
  const microMult  = getMicroMult(baseFloorPrice, checkInDate, city, cfg);
  // v130 — yield-management. mult = 1.0 when ratio not supplied → legacy
  // callers preserved verbatim.
  const { mult: occupancyMult, label: occupancyLabel } = getOccupancyMult(occupancyRatio, cfg);
  // v169 — Indian-calendar demand windows: long weekends, school
  // vacations, and the date-precise monsoon discount.
  const { mult: schoolMult,  name:  schoolName }   = getSchoolSeasonMult(checkIn, cfg);
  // The generic monsoon discount is Uttarakhand-calibrated (15 Jul–15 Sep). A
  // hub city with its own real seasonal curve already prices its own monsoon,
  // so skip it there to avoid double-discounting.
  const { mult: monsoonMult, label: monsoonLabel } = hasCitySeasonCurve(city)
    ? { mult: 1.0, label: null as string | null }
    : getMonsoonMult(checkIn, cfg);
  const { mult: lwMult,      name:  lwName }       = getLongWeekendMult(checkIn, cfg);

  let totalMult = seasonMult * dowMult * eventMult * leadMult * cityMult * microMult
                * occupancyMult * schoolMult * monsoonMult * lwMult;
  // v169 — bulletproof clamp: however many surges/discounts stack, the
  // multiplier (and therefore the price) stays inside a sane band.
  const clampMin = (typeof cfg?.clampMin === "number" && Number.isFinite(cfg.clampMin)) ? cfg.clampMin : 0.55;
  const clampMax = (typeof cfg?.clampMax === "number" && Number.isFinite(cfg.clampMax)) ? cfg.clampMax : 2.20;
  totalMult = Math.max(clampMin, Math.min(clampMax, totalMult));
  const rawPrice  = baseFloorPrice * totalMult;
  // v130 — snap to ₹100 (was ₹50). Aligns with the platform-wide price-snap
  // rule (lib/price-snap.ts). Floor remains a hard lower bound.
  const price     = Math.max(baseFloorPrice, Math.round(rawPrice / 100) * 100);

  // Demand score 0-100
  // v169 — score band widened to match the clamped multiplier range.
  const demandScore = Math.min(100, Math.max(0, Math.round((totalMult - clampMin) / ((clampMax - clampMin) || 1) * 100)));
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
  const yestMult = seasonMultFor(city, checkIn.getMonth(), cfg) * ((cfg?.dowMults && cfg.dowMults.length === DOW_MULT.length ? cfg.dowMults : DOW_MULT)[(checkIn.getDay() + 6) % 7]) * cityMult;
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

// ── v720 — hardcoded pricing-engine defaults (single source of truth) ────────
// The admin config store falls back to THESE exact values field-by-field, so a
// missing/partial config row always resolves to today's behaviour. EVENTS is
// surfaced as {name, mult} so the admin UI can label each festival knob.
export const PRICING_ENGINE_HARDCODED = {
  seasonMults: SEASON_MULT.slice(),
  dowMults: DOW_MULT.slice(),
  occupancyMults: OCCUPANCY_MULTS_DEFAULT.slice(),
  leadMults: LEAD_MULTS_DEFAULT.slice(),
  eventMults: EVENTS.map((e) => e.mult),
  eventNames: EVENTS.map((e) => e.name),
  cityDemand: { ...CITY_DEMAND },
  monsoonMult: 0.80,
  schoolMult: 1.15,
  longWeekendMult: 1.20,
  longWeekendHolidayMult: 1.10,
  microAmplitudePct: 2.5,
  clampMin: 0.55,
  clampMax: 2.20,
} as const;

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
