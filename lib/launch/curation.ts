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
  { id: "garhwal",   label: "Garhwal Getaways",   cities: ["dehradun", "mussoorie", "dhanaulti", "kanatal", "rishikesh", "haridwar"] },
  { id: "himachal",  label: "Himachal Highlands", cities: ["shimla", "manali", "kasol", "kasauli", "chail", "dharamshala", "bir billing"] },
  { id: "rajasthan", label: "Royal Rajasthan",    cities: ["jaipur", "pushkar", "jaisalmer", "udaipur", "neemrana"] },
  { id: "kumaon",    label: "Kumaon Wilds",       cities: ["nainital", "corbett", "lansdowne", "bhimtal", "mukteshwar"] },
  { id: "spiritual", label: "Spiritual Heartland", cities: ["mathura", "vrindavan", "ayodhya", "varanasi"] },
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
  // ── v551 launch batch 2 (12 new cities) ──
  haridwar:     "hco-seed-hdw",
  bhimtal:      "hco-seed-bhi",
  mukteshwar:   "hco-seed-muk",
  kasauli:      "hco-seed-ksl",
  chail:        "hco-seed-chl",
  dharamshala:  "hco-seed-dhr",
  "bir billing":"hco-seed-bir",
  neemrana:     "hco-seed-nmr",
  mathura:      "hco-seed-mth",
  vrindavan:    "hco-seed-vrn",
  ayodhya:      "hco-seed-ayo",
  varanasi:     "hco-seed-vns",
};

/** The set of curated launch hotel ids (1 per city). */
export const LAUNCH_HOTEL_IDS: Set<string> = new Set(Object.values(LAUNCH_HOTEL_BY_CITY));

// The full set of launch cities (lowercased), flattened from the zones. Used to
// curate CITY-keyed surfaces (the location picker, per-city supply summaries)
// that don't carry a hotel id.
export const LAUNCH_CITIES: Set<string> = new Set(
  LAUNCH_ZONES.flatMap((z) => z.cities),
);

// ─── Model-1 investment catalog (circle_properties) — a DIFFERENT table ───────
// The Model-1 fractional-investment catalog lives in `circle_properties`, not
// `hotels`, so the hotel-id allow-list above cannot match it. During launch we
// show exactly ONE investment property per launch city. Ids verified live from
// /api/circle/properties. Dehradun has no Model-1 property (guest-catalog only);
// Dhanaulti uses "Dhanaulti Village Resort" (owner pick); Nainital/Kasol had
// duplicates — one chosen each.
export const LAUNCH_CIRCLE_PROPERTY_BY_CITY: Record<string, string> = {
  mussoorie: "0dc3b7a9-4bb6-4b88-b4bb-9bae895d5216", // Premium Cottage
  rishikesh: "a26e7582-ede7-4ff3-8746-7b09cd0bd73b", // Riverside Retreat
  dhanaulti: "ca81dde4-dba8-4c73-94b1-4c02ea907a3f", // Dhanaulti Village Resort
  kanatal:   "80f1b0dd-6812-24ac-0553-44250d07b8d5", // Kanatal Stay
  shimla:    "212263af-9f14-4fd5-8140-a0ea4f1fd8fb", // Colonial Heritage
  manali:    "8f0ef803-1bb0-4b40-913e-467e9854526b", // Himalayan Escape
  kasol:     "1bb2a518-b1fe-4cd3-b6d1-859f444ab52b", // Riverside Bliss
  jaipur:    "ab82a2ef-1e26-aa7b-e224-2e8efdd5d953", // Jaipur Stay
  pushkar:   "86c88a47-0f78-fc34-6b92-3add769dabc3", // Pushkar Stay
  jaisalmer: "6b069bd6-5b31-220a-49c5-a7f52579d19b", // Jaisalmer Desert Haveli
  udaipur:   "17bcb889-0a67-8056-58fa-5673e330eaf9", // Udaipur Lake Palace Stay
  nainital:  "0e88cdd4-d4c0-4dc6-9d5f-f8499a463f09", // Lake View Cottage
  corbett:   "7976e9d4-71d5-4981-35f9-1ffc251e8dec", // Corbett Stay
  lansdowne: "7463a276-e52c-b788-81c5-0d8f269286f8", // Lansdowne Stay
  goa:       "a9573523-e4eb-ac17-05cf-5cbb67f33710", // Goa Beachside Resort
  coorg:     "d11d4120-ced2-682f-43ee-4f73bc3def1b", // Coorg Coffee Estate
  kerala:    "abc179f0-eed4-b51d-667c-934687a654fb", // Munnar Hills Retreat
  leh:       "a05b46a1-ce3f-96cf-a9a4-6a3dd35e9ad4", // Leh Himalayan Lodge
  // ── v551 launch batch 2 (md5('cp-hco-seed-<slug>')::uuid — matches the migration) ──
  haridwar:     "711b8ef4-7489-421e-3e64-8294697b4aaa", // Har Ki Pauri Riverside
  bhimtal:      "76c81ed3-0dc5-0fe0-ae45-d897b16b9348", // Bhimtal Lakeside Resort
  mukteshwar:   "7c45a083-f297-8ab9-824b-ec9cd0711366", // Mukteshwar Orchard Retreat
  kasauli:      "3bcdb2d5-2fa8-248b-9cbb-7cfb2aad6fd2", // Kasauli Pinewood Manor
  chail:        "ad5e6bab-b874-9380-24fb-b7497e4998d4", // Chail Palace Woods
  dharamshala:  "6b3757d3-28ce-1e18-55ba-f6f5bf785b3d", // Dhauladhar Dharamshala Retreat
  "bir billing":"6c1d9457-8579-8e31-0122-eaf7d647282e", // Bir Billing Meadows Resort
  neemrana:     "076d61b7-678a-d65f-e6eb-7d60b75fcd1c", // Neemrana Fort Haveli
  mathura:      "6f84c12a-822a-4a24-7329-a185dc2dfe8d", // Braj Heritage Mathura
  vrindavan:    "6f5e70c8-1d60-503e-6ea2-89a9c9af536a", // Vrindavan Temple Residency
  ayodhya:      "af9a40e5-3593-736c-7312-fee2a38ee8f1", // Ayodhya Ram Nagari Stay
  varanasi:     "eb9e9177-30d2-15d8-6210-4081166a2492", // Kashi Ghatside Varanasi
};

/** The set of curated Model-1 investment-property ids (1 per launch city). */
export const LAUNCH_CIRCLE_PROPERTY_IDS: Set<string> = new Set(
  Object.values(LAUNCH_CIRCLE_PROPERTY_BY_CITY),
);

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

/** Is this city one of the launch cities? Curation-off / blank → true (fail-open). */
export function isLaunchCity(city?: string | null): boolean {
  try {
    if (!isLaunchCurationOn()) return true;
    const c = String(city || "").trim().toLowerCase();
    if (!c) return true;
    return LAUNCH_CITIES.has(c);
  } catch {
    return true;
  }
}

/** Is this Model-1 investment property (circle_properties) part of the launch set? */
export function isLaunchCircleProperty(id: unknown): boolean {
  try {
    return !isLaunchCurationOn() || LAUNCH_CIRCLE_PROPERTY_IDS.has(String(id));
  } catch {
    return true;
  }
}

/**
 * Keep only the curated launch Model-1 investment properties (one per launch
 * city). Additive + FAIL-OPEN — off or on error, the input is returned unchanged.
 */
export function curateCircleProperties<T extends { id?: unknown }>(props: T[]): T[] {
  try {
    if (!isLaunchCurationOn() || !Array.isArray(props)) return props;
    return props.filter((p) => p && LAUNCH_CIRCLE_PROPERTY_IDS.has(String((p as any).id)));
  } catch {
    return props;
  }
}
