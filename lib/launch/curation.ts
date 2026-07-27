// ─────────────────────────────────────────────────────────────────────────────
// Launch-phase inventory CURATION (v534) — additive + fully reversible.
//
// During the launch phase we show exactly ONE curated premium property per city,
// and only for a curated set of cities grouped into ZONES. This is a thin
// post-fetch FILTER layered on top of the existing feed — it changes NO rule,
// gate, engine, or contract. It applies by HOTEL ID (an explicit allow-list),
// so it is deterministic and trivially reversible/expandable:
//   • expand later  → add more ids to LAUNCH_HOTEL_BY_CITY (or per zone)
//   • turn off       → set NEXT_PUBLIC_LAUNCH_CURATION="0" (everything back as-is)
//
// Because Circle-operated (host_circle) hotels flow through the SAME customer
// feed routes as classic hotels, applying this filter in those routes curates
// BOTH the main frontend and the Circle-operated inventory at once.
//
// Pure + isomorphic (no DB). Fail-open everywhere: any error → input unchanged.
// ─────────────────────────────────────────────────────────────────────────────

export interface LaunchZone {
  id: string;
  label: string;
  cities: string[]; // lowercased city keys (match hotels.city, case-insensitive)
}

// The launch zones (owner-approved). "South & Coastal" and "Leh–Ladakh" are split
// (they are different regions/seasons). Kufri/Narkanda/Manikaran deferred — no
// inventory yet.
export const LAUNCH_ZONES: LaunchZone[] = [
  { id: "garhwal",   label: "Garhwal Getaways",   cities: ["dehradun", "mussoorie", "dhanaulti", "kanatal", "rishikesh"] },
  { id: "himachal",  label: "Himachal Highlands", cities: ["shimla", "manali", "kasol"] },
  { id: "rajasthan", label: "Royal Rajasthan",    cities: ["jaipur", "pushkar", "jaisalmer", "udaipur"] },
  { id: "kumaon",    label: "Kumaon Wilds",       cities: ["nainital", "corbett", "lansdowne"] },
  { id: "south",     label: "South & Coastal",    cities: ["goa", "coorg", "kerala"] },
  { id: "leh",       label: "Leh–Ladakh",         cities: ["leh"] },
];

// city (lowercase) → the ONE curated hotel id shown for that city during launch.
// Ids verified live from /api/hotels. Most are host_circle (hco-seed-*); Dehradun
// + Dhanaulti are premium classic resorts (host_circle conversion deferred).
export const LAUNCH_HOTEL_BY_CITY: Record<string, string> = {
  dehradun:  "deh03",           // Colonial Heritage Dehradun
  mussoorie: "hco-seed-mus",    // Mussoorie Ridge Retreat
  dhanaulti: "202601",          // Dhanaulti Village Resort By Woodora
  kanatal:   "hco-seed-kanatal",
  rishikesh: "hco-seed-ris",
  shimla:    "hco-seed-shi",
  manali:    "hco-seed-man",
  kasol:     "hco-seed-kasol",
  jaipur:    "hco-seed-jaipur",
  pushkar:   "hco-seed-pushkar",
  jaisalmer: "hco-seed-jai",
  udaipur:   "hco-seed-uda",
  nainital:  "hco-seed-nainital",
  corbett:   "hco-seed-corbett",
  lansdowne: "hco-seed-lansdowne",
  goa:       "hco-seed-goa",
  coorg:     "hco-seed-crg",
  kerala:    "hco-seed-ker",
  leh:       "hco-seed-leh",
};

/** The set of curated launch hotel ids (1 per city). */
export const LAUNCH_HOTEL_IDS: Set<string> = new Set(Object.values(LAUNCH_HOTEL_BY_CITY));

/** Is launch curation active? On by default; flip off with NEXT_PUBLIC_LAUNCH_CURATION="0". */
export function isLaunchCurationOn(): boolean {
  return process.env.NEXT_PUBLIC_LAUNCH_CURATION !== "0";
}

/**
 * Keep only the curated launch hotels (one per city, launch-zone cities only).
 * Additive + FAIL-OPEN: if curation is off or anything goes wrong, the input is
 * returned unchanged so the feed is never broken.
 */
export function curateHotels<T extends { id?: unknown }>(hotels: T[]): T[] {
  try {
    if (!isLaunchCurationOn() || !Array.isArray(hotels)) return hotels;
    return hotels.filter((h) => h && LAUNCH_HOTEL_IDS.has(String((h as any).id)));
  } catch {
    return hotels;
  }
}

/** Is this hotel id part of the curated launch set? */
export function isLaunchHotel(id: unknown): boolean {
  try {
    return !isLaunchCurationOn() || LAUNCH_HOTEL_IDS.has(String(id));
  } catch {
    return true;
  }
}

/** The launch zone id for a city (lowercased match), or null if outside the launch set. */
export function zoneForCity(city?: string | null): string | null {
  const c = String(city || "").trim().toLowerCase();
  if (!c) return null;
  for (const z of LAUNCH_ZONES) if (z.cities.includes(c)) return z.id;
  return null;
}
