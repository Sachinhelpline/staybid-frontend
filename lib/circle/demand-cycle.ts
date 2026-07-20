// StayBid — 12-MONTH TRAVEL DEMAND CYCLE (single source of truth).
//
// Encodes the investor-portfolio poster: "Always in season. Always in demand."
// The demand CENTRE rotates city-to-city every 2–3 months, but every hub city
// stays bookable ALL 12 MONTHS — this module is a DISPLAY / CURATION overlay,
// never a gate. A city outside its peak month is still fully available; only
// its price breathes (handled by the pricing Spine, not here).
//
// Pure + read-only (no fetch/Supabase) so the customer panel and the Circle
// panel render the SAME cycle. City tokens are canonical `CityMeta.key`
// strings from lib/cities.ts, so a month lookup and a hotels.city row agree.
//
// ⚠ Legal framing (LOCKED, CLAUDE.md): this module carries NO "guaranteed /
// assured / 100% net profit / returns" language. The poster's money claims are
// deliberately NOT reproduced. Investor-facing copy uses the compliant
// "expected · based on actual bookings · not guaranteed" wording — see
// lib/circle/disclosure.ts. PORTFOLIO_PROMISE below is the compliant substitute
// for the poster's "Investor Promise" panel.

import { HUB_CITIES, type CityMeta } from "@/lib/cities";

export type DemandTier = "primary" | "secondary" | "available";

export interface MonthDemand {
  /** 0 = January … 11 = December. */
  month: number;
  short: string; // "Jan"
  long: string;  // "January"
  season: "Winter" | "Spring" | "Summer" | "Monsoon" | "Autumn";
  /** Top-performing hub cities this month (canonical keys). */
  primary: string[];
  /** Rising / shoulder hub cities this month (canonical keys). */
  secondary: string[];
  /** True where the poster left the month blank and these picks are inferred. */
  inferred?: boolean;
  /** Optional context note the poster attached to a secondary market. */
  notes?: Record<string, string>;
}

// ── The wheel, straight from the poster (Jan → Dec) ──────────────────────────
// June + August were not printed on the poster; their picks are transitional
// inferences (flagged `inferred`) and are trivially editable if the owner
// wants different centres for those two months.
export const DEMAND_CYCLE: MonthDemand[] = [
  {
    month: 0, short: "Jan", long: "January", season: "Winter",
    primary: ["Goa", "Kerala", "Udaipur", "Jaisalmer"],
    secondary: ["Rishikesh"],
  },
  {
    month: 1, short: "Feb", long: "February", season: "Winter",
    primary: ["Goa", "Kerala", "Udaipur"],
    secondary: ["Rishikesh", "Puri"],
  },
  {
    month: 2, short: "Mar", long: "March", season: "Spring",
    primary: ["Rishikesh", "Udaipur", "Goa"],
    secondary: ["Dhanaulti", "Puri"],
  },
  {
    month: 3, short: "Apr", long: "April", season: "Summer",
    primary: ["Dhanaulti", "Rishikesh"],
    secondary: ["Coorg", "Meghalaya"],
  },
  {
    month: 4, short: "May", long: "May", season: "Summer",
    primary: ["Dhanaulti"],
    secondary: ["Coorg", "Meghalaya"],
  },
  {
    month: 5, short: "Jun", long: "June", season: "Summer",
    // Owner-set: peak summer hill escapes.
    primary: ["Dhanaulti", "Manali", "Coorg"],
    secondary: ["Kanatal", "Mussoorie", "Kasol", "Nainital"],
  },
  {
    month: 6, short: "Jul", long: "July", season: "Monsoon",
    primary: ["Leh"],
    secondary: ["Coorg", "Meghalaya", "Kerala"],
    notes: { Kerala: "Monsoon" },
  },
  {
    month: 7, short: "Aug", long: "August", season: "Monsoon",
    // Owner-set: same monsoon-strong markets as July.
    primary: ["Leh", "Meghalaya"],
    secondary: ["Coorg", "Kerala"],
  },
  {
    month: 8, short: "Sep", long: "September", season: "Monsoon",
    primary: ["Leh", "Meghalaya"],
    secondary: ["Udaipur", "Goa"],
    notes: { Udaipur: "Wedding enquiries", Goa: "Shoulder season" },
  },
  {
    month: 9, short: "Oct", long: "October", season: "Autumn",
    primary: ["Udaipur", "Goa", "Rishikesh"],
    secondary: ["Kerala", "Puri"],
  },
  {
    month: 10, short: "Nov", long: "November", season: "Autumn",
    primary: ["Udaipur", "Goa", "Kerala"],
    secondary: ["Rishikesh", "Jaisalmer"],
  },
  {
    month: 11, short: "Dec", long: "December", season: "Winter",
    primary: ["Goa", "Kerala", "Udaipur", "Jaisalmer"],
    secondary: ["Puri", "Rishikesh"],
  },
];

// ── Helpers (all pure) ───────────────────────────────────────────────────────

/** Month 0–11 → its demand row. Guards out-of-range gracefully. */
export function monthDemand(month: number): MonthDemand {
  const m = ((Math.trunc(month) % 12) + 12) % 12;
  return DEMAND_CYCLE[m];
}

/** The current calendar month's demand row (pass a Date for testability). */
export function currentMonthDemand(now?: Date): MonthDemand {
  const d = now || new Date();
  return monthDemand(d.getUTCMonth());
}

/** The demand tier of a city in a given month (case-insensitive on the token). */
export function demandTier(city: string, month: number): DemandTier {
  const row = monthDemand(month);
  const c = String(city || "").toLowerCase();
  if (row.primary.some((x) => x.toLowerCase() === c)) return "primary";
  if (row.secondary.some((x) => x.toLowerCase() === c)) return "secondary";
  return "available"; // still bookable — just not a highlighted performer
}

/** Every month (0–11) in which a city is a primary or secondary performer. */
export function peakMonthsForCity(city: string): number[] {
  const c = String(city || "").toLowerCase();
  return DEMAND_CYCLE.filter(
    (r) =>
      r.primary.some((x) => x.toLowerCase() === c) ||
      r.secondary.some((x) => x.toLowerCase() === c)
  ).map((r) => r.month);
}

/** Distinct primary + secondary hub cities for a month, primaries first. */
export function citiesForMonth(month: number): string[] {
  const row = monthDemand(month);
  return Array.from(new Set([...row.primary, ...row.secondary]));
}

/** Full hub metadata for the cities highlighted in a month (primaries first). */
export function hubsForMonth(month: number): { meta: CityMeta; tier: DemandTier }[] {
  const row = monthDemand(month);
  const pick = (keys: string[], tier: DemandTier) =>
    keys
      .map((k) => HUB_CITIES.find((h) => h.key.toLowerCase() === k.toLowerCase()))
      .filter((m): m is CityMeta => !!m)
      .map((meta) => ({ meta, tier }));
  return [...pick(row.primary, "primary"), ...pick(row.secondary, "secondary")];
}

// ── Compliant portfolio narrative (replaces the poster's "Investor Promise") ─
// NEVER "guaranteed / 100% net profit / assured returns". These strings are the
// approved substitute; investor money surfaces must also render the
// lib/circle/disclosure.ts constants.
export const PORTFOLIO_PROMISE = {
  headline: "Always in Season. Always in Demand.",
  subhead:
    "A multi-destination portfolio: as demand rotates city to city through the year, your inventory keeps working across seasons.",
  points: [
    "Demand centre shifts every 2–3 months across the hub cities.",
    "2–3 peak destinations active in every month of the year.",
    "Weather and seasonal risk spread across regions, not one market.",
    "Year-round availability in every city — bookable all 12 months.",
  ],
  // Compliant framing note — pair with CIRCLE_INCOME_DISCLOSURE on any surface.
  disclaimer:
    "Occupancy and income depend on actual bookings and are not guaranteed. Illustrative demand pattern, not a promise of returns.",
} as const;

/** Poster portfolio highlights (facts, no income claims). */
export const PORTFOLIO_HIGHLIGHTS = [
  { value: "12", label: "Months active demand" },
  { value: "8–10", label: "Operational hubs" },
  { value: "25+", label: "Cities in the plan" },
  { value: "365", label: "Days availability goal" },
] as const;
