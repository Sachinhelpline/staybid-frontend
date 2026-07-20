// StayBid — canonical CITY registry (single source of truth).
//
// Historically the city list was a hardcoded 6-entry hill-station array
// duplicated across Navbar / LocationGlobePicker / hotels CITY_PILLS /
// ai-pricing.CITY_DEMAND / areas.ts. Adding a city meant editing all five.
//
// This module is the ONE place a city and its metadata live. It is PURE
// (no fetch/Supabase) so both the customer panel and the Circle panel import
// the same truth. City matching everywhere is case-insensitive on `key`
// (see normalizeCity) — the `key` is exactly the string stored in
// hotels.city / circle_properties.city, so a demand-cycle lookup and a DB
// row always agree.
//
// Scope note (poster "12-Month Travel Demand Cycle"): this ships the 10
// operational HUBS. Their satellite cities are recorded here for the next
// phase but are not seeded as bookable inventory yet.

export type Region =
  | "North India"
  | "West India"
  | "South India"
  | "East India"
  | "Himalayas";

export interface CityMeta {
  /** Canonical token — exactly the string stored in hotels.city / circle_properties.city. */
  key: string;
  /** Display name (short). */
  name: string;
  /** Poster hub label when it differs from the short name, e.g. "Dhanaulti–Kanatal". */
  hubLabel?: string;
  region: Region;
  state: string;
  lat: number;
  lng: number;
  /** True = one of the poster's operational hubs (seeded as year-round inventory). */
  isHub: boolean;
  /** Poster "strategic additions near existing cities" — satellite markets (next phase). */
  satellites: string[];
  /** True = had inventory before the demand-cycle work (do not double-seed). */
  existing?: boolean;
  /** For a satellite: the hub city key it operates under. */
  satelliteOf?: string;
  /** Pricing tier for the seed generator (satellites). */
  tier?: "metro" | "hill" | "beach" | "heritage";
}

// ── The 10 operational HUBS from the poster ──────────────────────────────────
// (Rishikesh + Dhanaulti already existed as hill-station cities; they are hubs
//  here too and are NOT re-seeded — see `existing`.)
export const HUB_CITIES: CityMeta[] = [
  {
    key: "Goa",
    name: "Goa",
    region: "West India",
    state: "Goa",
    lat: 15.4909, lng: 73.8278,
    isHub: true,
    satellites: ["Gokarna", "Karwar", "South Goa"],
  },
  {
    key: "Kerala",
    name: "Kerala",
    region: "South India",
    state: "Kerala",
    lat: 10.0889, lng: 77.0595, // Munnar anchor
    isHub: true,
    satellites: ["Munnar", "Wayanad", "Alleppey", "Kumarakom"],
  },
  {
    key: "Udaipur",
    name: "Udaipur",
    region: "West India",
    state: "Rajasthan",
    lat: 24.5854, lng: 73.7125,
    isHub: true,
    satellites: ["Kumbhalgarh", "Ranakpur", "Jaipur", "Pushkar"],
  },
  {
    key: "Jaisalmer",
    name: "Jaisalmer",
    region: "West India",
    state: "Rajasthan",
    lat: 26.9157, lng: 70.9083,
    isHub: true,
    satellites: ["Jodhpur", "Osian"],
  },
  {
    key: "Rishikesh",
    name: "Rishikesh",
    hubLabel: "Rishikesh–Haridwar",
    region: "Himalayas",
    state: "Uttarakhand",
    lat: 30.0869, lng: 78.2676,
    isHub: true,
    satellites: ["Corbett", "Lansdowne", "Auli", "Joshimath"],
    existing: true,
  },
  {
    key: "Dhanaulti",
    name: "Dhanaulti",
    hubLabel: "Dhanaulti–Kanatal",
    region: "Himalayas",
    state: "Uttarakhand",
    lat: 30.4257, lng: 78.2437,
    isHub: true,
    satellites: ["Mussoorie", "Landour", "Chakrata"],
    existing: true,
  },
  {
    key: "Leh",
    name: "Leh",
    hubLabel: "Leh–Nubra",
    region: "Himalayas",
    state: "Ladakh",
    lat: 34.1526, lng: 77.5771,
    isHub: true,
    satellites: ["Srinagar", "Pahalgam", "Manali", "Spiti"],
  },
  {
    key: "Meghalaya",
    name: "Meghalaya",
    region: "East India",
    state: "Meghalaya",
    lat: 25.5788, lng: 91.8933, // Shillong anchor
    isHub: true,
    satellites: ["Shillong", "Cherrapunji", "Dawki"],
  },
  {
    key: "Puri",
    name: "Puri",
    region: "East India",
    state: "Odisha",
    lat: 19.8135, lng: 85.8312,
    isHub: true,
    satellites: ["Bhubaneswar", "Konark", "Chilika"],
  },
  {
    key: "Coorg",
    name: "Coorg",
    region: "South India",
    state: "Karnataka",
    lat: 12.4244, lng: 75.7382, // Madikeri anchor
    isHub: true,
    satellites: ["Madikeri", "Wayanad"],
  },
];

// ── Pre-existing hill-station cities (kept live, undisturbed) ─────────────────
// Rishikesh + Dhanaulti live in HUB_CITIES (they are hubs too), so only the
// other four are listed here.
export const LEGACY_CITIES: CityMeta[] = [
  { key: "Mussoorie", name: "Mussoorie", region: "Himalayas", state: "Uttarakhand", lat: 30.4599, lng: 78.0664, isHub: false, satellites: [], existing: true },
  { key: "Shimla",    name: "Shimla",    region: "Himalayas", state: "Himachal Pradesh", lat: 31.1048, lng: 77.1734, isHub: false, satellites: [], existing: true },
  { key: "Manali",    name: "Manali",    region: "Himalayas", state: "Himachal Pradesh", lat: 32.2396, lng: 77.1887, isHub: false, satellites: [], existing: true },
  { key: "Dehradun",  name: "Dehradun",  region: "Himalayas", state: "Uttarakhand", lat: 30.3165, lng: 78.0322, isHub: false, satellites: [], existing: true },
];

// ── Satellite cities (poster "strategic additions" + June hill escapes) ──────
// Real, bookable inventory near an existing hub — "easy to operate" secondary
// markets. Seeded year-round like the hubs (demo StayBid-operated). Munnar /
// Shillong / Madikeri / Mussoorie / Manali are omitted — already a hub anchor
// or an existing city.
export const SATELLITE_CITIES: CityMeta[] = [
  // Goa belt (beach)
  { key: "Gokarna",    name: "Gokarna",    region: "West India",  state: "Karnataka",       lat: 14.5479, lng: 74.3188, isHub: false, satellites: [], satelliteOf: "Goa", tier: "beach" },
  { key: "Karwar",     name: "Karwar",     region: "West India",  state: "Karnataka",       lat: 14.8135, lng: 74.1297, isHub: false, satellites: [], satelliteOf: "Goa", tier: "beach" },
  { key: "South Goa",  name: "South Goa",  region: "West India",  state: "Goa",             lat: 15.2010, lng: 74.0200, isHub: false, satellites: [], satelliteOf: "Goa", tier: "beach" },
  // Kerala belt (backwater/hill)
  { key: "Wayanad",    name: "Wayanad",    region: "South India", state: "Kerala",          lat: 11.6854, lng: 76.1320, isHub: false, satellites: [], satelliteOf: "Kerala", tier: "hill" },
  { key: "Alleppey",   name: "Alleppey",   region: "South India", state: "Kerala",          lat: 9.4981,  lng: 76.3388, isHub: false, satellites: [], satelliteOf: "Kerala", tier: "beach" },
  { key: "Kumarakom",  name: "Kumarakom",  region: "South India", state: "Kerala",          lat: 9.6178,  lng: 76.4300, isHub: false, satellites: [], satelliteOf: "Kerala", tier: "beach" },
  // Udaipur belt (heritage)
  { key: "Kumbhalgarh",name: "Kumbhalgarh",region: "West India",  state: "Rajasthan",       lat: 25.1489, lng: 73.5875, isHub: false, satellites: [], satelliteOf: "Udaipur", tier: "heritage" },
  { key: "Ranakpur",   name: "Ranakpur",   region: "West India",  state: "Rajasthan",       lat: 25.1173, lng: 73.4713, isHub: false, satellites: [], satelliteOf: "Udaipur", tier: "heritage" },
  { key: "Jaipur",     name: "Jaipur",     region: "West India",  state: "Rajasthan",       lat: 26.9124, lng: 75.7873, isHub: false, satellites: [], satelliteOf: "Udaipur", tier: "metro" },
  { key: "Pushkar",    name: "Pushkar",    region: "West India",  state: "Rajasthan",       lat: 26.4899, lng: 74.5511, isHub: false, satellites: [], satelliteOf: "Udaipur", tier: "heritage" },
  // Jaisalmer belt (desert/heritage)
  { key: "Jodhpur",    name: "Jodhpur",    region: "West India",  state: "Rajasthan",       lat: 26.2389, lng: 73.0243, isHub: false, satellites: [], satelliteOf: "Jaisalmer", tier: "metro" },
  { key: "Osian",      name: "Osian",      region: "West India",  state: "Rajasthan",       lat: 26.7167, lng: 72.9111, isHub: false, satellites: [], satelliteOf: "Jaisalmer", tier: "heritage" },
  // Rishikesh–Haridwar belt (hill/wildlife)
  { key: "Corbett",    name: "Corbett",    region: "Himalayas",   state: "Uttarakhand",     lat: 29.5300, lng: 78.7747, isHub: false, satellites: [], satelliteOf: "Rishikesh", tier: "heritage" },
  { key: "Lansdowne",  name: "Lansdowne",  region: "Himalayas",   state: "Uttarakhand",     lat: 29.8377, lng: 78.6871, isHub: false, satellites: [], satelliteOf: "Rishikesh", tier: "hill" },
  { key: "Auli",       name: "Auli",       region: "Himalayas",   state: "Uttarakhand",     lat: 30.5300, lng: 79.5700, isHub: false, satellites: [], satelliteOf: "Rishikesh", tier: "hill" },
  { key: "Joshimath",  name: "Joshimath",  region: "Himalayas",   state: "Uttarakhand",     lat: 30.5550, lng: 79.5646, isHub: false, satellites: [], satelliteOf: "Rishikesh", tier: "hill" },
  // Dhanaulti–Kanatal belt (hill)
  { key: "Landour",    name: "Landour",    region: "Himalayas",   state: "Uttarakhand",     lat: 30.4593, lng: 78.1039, isHub: false, satellites: [], satelliteOf: "Dhanaulti", tier: "hill" },
  { key: "Chakrata",   name: "Chakrata",   region: "Himalayas",   state: "Uttarakhand",     lat: 30.7017, lng: 77.8656, isHub: false, satellites: [], satelliteOf: "Dhanaulti", tier: "hill" },
  { key: "Kanatal",    name: "Kanatal",    region: "Himalayas",   state: "Uttarakhand",     lat: 30.4110, lng: 78.2960, isHub: false, satellites: [], satelliteOf: "Dhanaulti", tier: "hill" },
  { key: "Nainital",   name: "Nainital",   region: "Himalayas",   state: "Uttarakhand",     lat: 29.3803, lng: 79.4636, isHub: false, satellites: [], satelliteOf: "Dhanaulti", tier: "hill" },
  // Leh–Nubra belt (high Himalaya)
  { key: "Srinagar",   name: "Srinagar",   region: "Himalayas",   state: "Jammu & Kashmir", lat: 34.0837, lng: 74.7973, isHub: false, satellites: [], satelliteOf: "Leh", tier: "metro" },
  { key: "Pahalgam",   name: "Pahalgam",   region: "Himalayas",   state: "Jammu & Kashmir", lat: 34.0161, lng: 75.3150, isHub: false, satellites: [], satelliteOf: "Leh", tier: "hill" },
  { key: "Spiti",      name: "Spiti",      region: "Himalayas",   state: "Himachal Pradesh",lat: 32.2464, lng: 78.0349, isHub: false, satellites: [], satelliteOf: "Leh", tier: "hill" },
  { key: "Kasol",      name: "Kasol",      region: "Himalayas",   state: "Himachal Pradesh",lat: 32.0100, lng: 77.3150, isHub: false, satellites: [], satelliteOf: "Leh", tier: "hill" },
  // Meghalaya belt (NE hills)
  { key: "Cherrapunji", name: "Cherrapunji", region: "East India", state: "Meghalaya",      lat: 25.3000, lng: 91.5822, isHub: false, satellites: [], satelliteOf: "Meghalaya", tier: "hill" },
  { key: "Dawki",      name: "Dawki",      region: "East India",  state: "Meghalaya",       lat: 25.2050, lng: 92.0225, isHub: false, satellites: [], satelliteOf: "Meghalaya", tier: "beach" },
  // Puri belt (coast/temple)
  { key: "Bhubaneswar",name: "Bhubaneswar",region: "East India",  state: "Odisha",          lat: 20.2961, lng: 85.8245, isHub: false, satellites: [], satelliteOf: "Puri", tier: "metro" },
  { key: "Konark",     name: "Konark",     region: "East India",  state: "Odisha",          lat: 19.8876, lng: 86.0945, isHub: false, satellites: [], satelliteOf: "Puri", tier: "beach" },
  { key: "Chilika",    name: "Chilika",    region: "East India",  state: "Odisha",          lat: 19.7160, lng: 85.3200, isHub: false, satellites: [], satelliteOf: "Puri", tier: "beach" },
];

/** Every canonical city (hubs ∪ legacy ∪ satellites). */
export const ALL_CITIES: CityMeta[] = [...HUB_CITIES, ...LEGACY_CITIES, ...SATELLITE_CITIES];

/** City keys to seed as brand-new year-round inventory (hubs that did NOT exist before). */
export const CITIES_TO_SEED: CityMeta[] = HUB_CITIES.filter((c) => !c.existing);

/** Satellite cities to seed (all are new). */
export const SATELLITES_TO_SEED: CityMeta[] = SATELLITE_CITIES.filter((c) => !c.existing);

const BY_KEY: Record<string, CityMeta> = ALL_CITIES.reduce((m, c) => {
  m[c.key.toLowerCase()] = c;
  return m;
}, {} as Record<string, CityMeta>);

/** Lowercase + trim, so "Goa " and "goa" match the same city (mirrors city-access normalizeCity). */
export function normalizeCity(city: string | null | undefined): string {
  return String(city || "").trim().toLowerCase();
}

/** Resolve a stored city string to its canonical meta (case-insensitive), or null. */
export function cityMeta(city: string | null | undefined): CityMeta | null {
  return BY_KEY[normalizeCity(city)] || null;
}

/** Display label for a hub (poster label when present, else the name). */
export function cityHubLabel(city: string | null | undefined): string {
  const m = cityMeta(city);
  return m ? m.hubLabel || m.name : String(city || "");
}

// ── City-picker ordering + icons (customer surfaces) ─────────────────────────
// Existing hill-stations FIRST (nothing existing re-orders), then the new hubs.
// Consumed by Navbar CITIES, LocationGlobePicker LOCATION_CITIES, hotels
// CITY_PILLS — one place to add a city to every picker.
export const CITY_DISPLAY_ORDER: string[] = [
  "Mussoorie", "Dhanaulti", "Rishikesh", "Shimla", "Manali", "Dehradun",
  "Goa", "Kerala", "Udaipur", "Jaisalmer", "Leh", "Meghalaya", "Puri", "Coorg",
  ...SATELLITE_CITIES.map((c) => c.key),
];

const TIER_ICON: Record<string, string> = { metro: "🏙", hill: "⛰️", beach: "🏖", heritage: "🏰" };

export const CITY_ICON: Record<string, string> = SATELLITE_CITIES.reduce(
  (m, c) => { m[c.key] = TIER_ICON[c.tier || "hill"] || "📍"; return m; },
  {
    Mussoorie: "⛰️", Dhanaulti: "🌲", Rishikesh: "🕉", Shimla: "🌨", Manali: "🏂", Dehradun: "🌳",
    Goa: "🏖", Kerala: "🌴", Udaipur: "🏰", Jaisalmer: "🐪", Leh: "🏔", Meghalaya: "☁️", Puri: "🛕", Coorg: "☕",
  } as Record<string, string>,
);

/** City-pill descriptors for the hotels browse (leading "All", then every city in order). */
export function cityPills(): Array<{ key: string; label: string; icon: string }> {
  return [
    { key: "", label: "All", icon: "🏔" },
    ...CITY_DISPLAY_ORDER.map((k) => ({
      key: k,
      label: cityMeta(k)?.name || k,
      icon: CITY_ICON[k] || "📍",
    })),
  ];
}
