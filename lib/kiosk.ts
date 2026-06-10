// ─────────────────────────────────────────────────────────────────────────
// StayBid Offline Kiosk — shared helpers (additive, kiosk-only)
//
// A self-contained module for the `/kiosk/**` surfaces. NOTHING here is
// imported by the customer / partner / admin panels — it's a leaf module so
// the kiosk can never break an existing flow.
//
// The kiosk shows ONLY same-day StayBid flash deals, live-fetched from the
// SAME backend the customer site uses (`/api/flash/near` → Supabase, wired to
// the hotel + admin panels). The kiosk adds a "stock-market" presentation
// layer on top: live price deltas, a ticker, and a 3-step touchscreen booking
// flow. No new source of truth — pure presentation + a thin booking proxy.
// ─────────────────────────────────────────────────────────────────────────

export type KioskLocation = {
  id: string;
  name: string;       // human label shown on screen
  city: string;       // maps to hotels.city / flash deal city
  lat: number;
  lng: number;
  radiusKm: number;   // how far the display reaches
};

// Preset physical kiosk locations. A unit picks its location via
// `/kiosk/display?loc=mussoorie-mall`. Add a row here to deploy a new unit —
// no code change needed elsewhere.
export const KIOSK_LOCATIONS: Record<string, KioskLocation> = {
  "mussoorie-mall":   { id: "mussoorie-mall",   name: "Mall Road · Mussoorie",      city: "Mussoorie", lat: 30.4599, lng: 78.0648, radiusKm: 30 },
  "rishikesh-laxman": { id: "rishikesh-laxman", name: "Laxman Jhula · Rishikesh",    city: "Rishikesh", lat: 30.1262, lng: 78.3300, radiusKm: 25 },
  "dehradun-clock":   { id: "dehradun-clock",   name: "Clock Tower · Dehradun",      city: "Dehradun",  lat: 30.3256, lng: 78.0437, radiusKm: 35 },
  "dhanaulti":        { id: "dhanaulti",        name: "Village Center · Dhanaulti",  city: "Dhanaulti", lat: 30.4264, lng: 78.2436, radiusKm: 30 },
  "nainital-mall":    { id: "nainital-mall",    name: "Mall Road · Nainital",        city: "Nainital",  lat: 29.3919, lng: 79.4542, radiusKm: 25 },
  "shimla-mall":      { id: "shimla-mall",      name: "Mall Road · Shimla",          city: "Shimla",    lat: 31.1048, lng: 77.1734, radiusKm: 30 },
  "manali-mall":      { id: "manali-mall",      name: "Mall Road · Manali",          city: "Manali",    lat: 32.2396, lng: 77.1887, radiusKm: 30 },
};

export const DEFAULT_KIOSK_LOC = "mussoorie-mall";

export function resolveKioskLocation(loc?: string | null): KioskLocation {
  if (loc && KIOSK_LOCATIONS[loc]) return KIOSK_LOCATIONS[loc];
  return KIOSK_LOCATIONS[DEFAULT_KIOSK_LOC];
}

// Cities the booking kiosk lets a walk-in pick from (mirrors the supported
// flash-deal cities). Order = display order in the kiosk Step-1 grid.
export const KIOSK_CITIES: { city: string; emoji: string }[] = [
  { city: "Mussoorie", emoji: "🏔️" },
  { city: "Rishikesh", emoji: "🌊" },
  { city: "Dhanaulti", emoji: "🌿" },
  { city: "Dehradun",  emoji: "🏙️" },
  { city: "Nainital",  emoji: "⛰️" },
  { city: "Shimla",    emoji: "🏞️" },
  { city: "Manali",    emoji: "🏕️" },
];

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (!lat1 || !lng1 || !lat2 || !lng2) return 0;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

// Deterministic 32-bit hash for stable-per-hotel pseudo values.
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

// Stock-market style price delta. STABLE within a 60-second bucket (so the
// board feels live each refresh without flickering mid-render), DERIVED from
// the real discount (a genuinely cheaper deal trends DOWN/green) plus a tiny
// per-hotel/minute jitter for life. Returns { pct, trend }.
export function priceDelta(hotelId: string, discount: number, bucket: number): { pct: number; trend: "up" | "down" } {
  const j = (hashStr(hotelId + ":" + bucket) % 7) - 3; // −3..+3
  // Higher real discount ⇒ price has dropped ⇒ negative (down/green).
  let pct = -(Math.round(discount)) + j;
  // Clamp to a believable band.
  if (pct > 14) pct = 14;
  if (pct < -28) pct = -28;
  const trend: "up" | "down" = pct >= 0 ? "up" : "down";
  return { pct, trend };
}

export function formatINR(n: number): string {
  return "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
}

// Minute bucket — used as the seed for `priceDelta` so the board shifts each
// minute but is consistent for everyone viewing in the same minute.
export function minuteBucket(): number {
  return Math.floor(Date.now() / 60000);
}

// Shape a raw `/api/flash/near` deal into the kiosk card model. Pure +
// defensive — any missing field degrades gracefully so the board never breaks.
export type KioskDeal = {
  id: string;
  hotelId: string;
  roomId: string;
  hotelName: string;
  city: string;
  area: string;
  stars: number;
  image: string;
  aiPrice: number;
  floorPrice: number;
  mrp: number;
  discount: number;
  deltaPct: number;
  trend: "up" | "down";
  unitsFree: number;
  distanceKm: number;
  validUntil: string;
  roomType: string;
  capacity: number;
  upgrades: any[];
};

const PLACEHOLDER_IMG =
  "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=600&q=70";

export function shapeKioskDeal(
  d: any,
  bucket: number,
  origin?: { lat: number; lng: number } | null,
): KioskDeal | null {
  if (!d) return null;
  const hotel = d.hotel || {};
  const room = d.room || {};
  const hotelId = String(d.hotelId || hotel.id || "");
  if (!hotelId) return null;

  const ai = Number(d.aiPrice) || 0;
  const floor = Number(d.floorPrice) || Number(room.floorPrice) || 0;
  const mrp = Number(room.mrp) || Math.round((floor || ai) * 1.45);
  const discount = Number(d.discount) || (mrp > 0 && ai > 0 ? Math.round(((mrp - ai) / mrp) * 100) : 0);
  const { pct, trend } = priceDelta(hotelId, discount, bucket);

  const imgs = Array.isArray(hotel.images) ? hotel.images : Array.isArray(room.images) ? room.images : [];
  const image = (imgs && imgs[0]) || PLACEHOLDER_IMG;

  const distanceKm =
    origin && hotel.lat && hotel.lng ? haversineKm(origin.lat, origin.lng, Number(hotel.lat), Number(hotel.lng)) : 0;

  return {
    id: String(d.id || hotelId),
    hotelId,
    roomId: String(d.roomId || room.id || ""),
    hotelName: String(hotel.name || "Hotel"),
    city: String(d.city || hotel.city || ""),
    area: String(hotel.area || ""),
    stars: Number(hotel.starRating || hotel.stars || 3),
    image,
    aiPrice: ai,
    floorPrice: floor,
    mrp,
    discount,
    deltaPct: pct,
    trend,
    unitsFree: Number(d.unitsFree) || 0,
    distanceKm,
    validUntil: String(d.validUntil || ""),
    roomType: String(room.type || room.name || "Room"),
    capacity: Number(room.capacity) || 2,
    upgrades: Array.isArray(d.upgrades) ? d.upgrades : [],
  };
}
