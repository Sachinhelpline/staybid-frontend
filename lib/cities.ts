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

/** Every canonical city (hubs ∪ legacy). */
export const ALL_CITIES: CityMeta[] = [...HUB_CITIES, ...LEGACY_CITIES];

/** City keys to seed as brand-new year-round inventory (hubs that did NOT exist before). */
export const CITIES_TO_SEED: CityMeta[] = HUB_CITIES.filter((c) => !c.existing);

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
];

export const CITY_ICON: Record<string, string> = {
  Mussoorie: "⛰️", Dhanaulti: "🌲", Rishikesh: "🕉", Shimla: "🌨", Manali: "🏂", Dehradun: "🌳",
  Goa: "🏖", Kerala: "🌴", Udaipur: "🏰", Jaisalmer: "🐪", Leh: "🏔", Meghalaya: "☁️", Puri: "🛕", Coorg: "☕",
};

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
