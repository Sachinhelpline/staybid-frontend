// ─────────────────────────────────────────────────────────────────────────────
// BROWSING AFFINITY ENGINE (v580) — the owner's strategy decks as code.
//
// Encodes two owner strategy artifacts:
//   1. "Origin-to-Destination Fit Matrix" — which source markets (Delhi NCR +
//      Haryana + Western UP clusters) naturally connect with which destination
//      corridors, scored 1–5.
//   2. "Western UP Demand Landscape" — the origin feeder clusters themselves.
//
// One pure engine ranks EVERY browse surface (home hero, "easy to reach" rail,
// reel rails, the /discover feed cold-start) so no two surfaces can ever order
// the catalog by different rules. It composes three signals:
//
//   • SEASON   — lib/circle/demand-cycle.ts demandTier (the existing wheel)
//   • ACCESS   — corridor fit (matrix) + road-distance decay from the viewer
//   • TASTE    — the existing sb_disco_signals store (lib/track.ts): the
//                cities/hotels the user actually watched, saved, booked
//
// Pure + isomorphic: no fetch, no localStorage, no window. Callers pass the
// viewer point + signals in. FAIL-OPEN: with no viewer point we assume the
// DELHI CORE origin (the strategy docs' core market), so "easily accessible"
// ordering works from the first page-view; with nothing at all the input
// order is preserved.
// ─────────────────────────────────────────────────────────────────────────────

import { haversineMeters } from "@/lib/tier/haversine";
import { demandTier } from "@/lib/circle/demand-cycle";
import { cityMeta } from "@/lib/cities";

export interface ViewerPoint { lat: number; lng: number; }

// ── Origin clusters (fit-matrix rows; centroids ≈ the cluster's anchor city) ──
export interface OriginCluster {
  id: string;
  label: string;   // shown in UI copy ("Handpicked for Delhi NCR")
  lat: number;
  lng: number;
}

export const ORIGIN_CLUSTERS: OriginCluster[] = [
  { id: "delhi",      label: "Delhi NCR",            lat: 28.6139, lng: 77.2090 },
  { id: "noida",      label: "Noida–Ghaziabad",      lat: 28.5900, lng: 77.4000 },
  { id: "gurugram",   label: "Gurugram",             lat: 28.4595, lng: 77.0266 },
  { id: "faridabad",  label: "Faridabad",            lat: 28.4089, lng: 77.3178 },
  { id: "sonipat",    label: "Sonipat–Panipat",      lat: 29.1500, lng: 77.0100 },
  { id: "ambala",     label: "Ambala–Panchkula",     lat: 30.3782, lng: 76.7767 },
  { id: "rohtak",     label: "Rohtak–Rewari",        lat: 28.8955, lng: 76.6066 },
  { id: "hisar",      label: "Hisar–Sirsa",          lat: 29.1492, lng: 75.7217 },
  { id: "meerut",     label: "Meerut–Hapur",         lat: 28.9845, lng: 77.7064 },
  { id: "saharanpur", label: "Saharanpur belt",      lat: 29.9680, lng: 77.5510 },
  { id: "moradabad",  label: "Moradabad–Amroha",     lat: 28.8386, lng: 78.7733 },
  { id: "bareilly",   label: "Bareilly belt",        lat: 28.3670, lng: 79.4304 },
  { id: "agra",       label: "Agra–Mathura",         lat: 27.1767, lng: 78.0081 },
  { id: "aligarh",    label: "Aligarh–Hathras",      lat: 27.8974, lng: 78.0880 },
];

/** The assumed origin when the viewer shares no location — the strategy docs'
 *  core market. Ordering still works day-1; a granted location only refines it. */
export const DEFAULT_ORIGIN: ViewerPoint = { lat: 28.6139, lng: 77.209 };

// ── Destination corridors → the launch cities they contain (lowercased) ──────
const CORRIDOR_CITIES: Record<string, string[]> = {
  uttarakhand:  ["dehradun", "mussoorie", "dhanaulti", "kanatal"],
  haridwar:     ["haridwar", "rishikesh"],
  kumaon:       ["nainital", "corbett", "bhimtal", "mukteshwar", "lansdowne"],
  shorthimachal:["kasauli", "chail", "shimla"],
  manali:       ["manali", "kasol", "bir billing", "dharamshala"],
  rajasthan:    ["jaipur", "pushkar", "jaisalmer", "udaipur", "neemrana"],
  braj:         ["mathura", "vrindavan"],
  religiousup:  ["ayodhya", "varanasi"],
  longhaul:     ["goa", "coorg", "kerala", "leh"],
};

const CORRIDOR_OF_CITY: Record<string, string> = {};
Object.keys(CORRIDOR_CITIES).forEach((cor) => {
  CORRIDOR_CITIES[cor].forEach((c) => { CORRIDOR_OF_CITY[c] = cor; });
});

// ── The fit matrix (origin cluster → corridor → 1..5), from the owner deck ───
// Corridor order: uttarakhand, haridwar, kumaon, shorthimachal, manali,
//                 rajasthan, braj, religiousup, longhaul
const FIT: Record<string, Record<string, number>> = {
  delhi:      { uttarakhand: 4, haridwar: 5, kumaon: 4, shorthimachal: 3, manali: 4, rajasthan: 4, braj: 5, religiousup: 5, longhaul: 5 },
  gurugram:   { uttarakhand: 4, haridwar: 4, kumaon: 3, shorthimachal: 3, manali: 3, rajasthan: 5, braj: 4, religiousup: 3, longhaul: 5 },
  faridabad:  { uttarakhand: 4, haridwar: 4, kumaon: 3, shorthimachal: 3, manali: 3, rajasthan: 4, braj: 4, religiousup: 3, longhaul: 4 },
  sonipat:    { uttarakhand: 3, haridwar: 3, kumaon: 3, shorthimachal: 4, manali: 3, rajasthan: 3, braj: 3, religiousup: 3, longhaul: 3 },
  ambala:     { uttarakhand: 3, haridwar: 3, kumaon: 3, shorthimachal: 4, manali: 4, rajasthan: 3, braj: 3, religiousup: 3, longhaul: 3 },
  rohtak:     { uttarakhand: 3, haridwar: 3, kumaon: 3, shorthimachal: 3, manali: 4, rajasthan: 4, braj: 3, religiousup: 3, longhaul: 3 },
  hisar:      { uttarakhand: 2, haridwar: 2, kumaon: 2, shorthimachal: 4, manali: 4, rajasthan: 4, braj: 3, religiousup: 2, longhaul: 2 },
  noida:      { uttarakhand: 5, haridwar: 5, kumaon: 5, shorthimachal: 3, manali: 4, rajasthan: 4, braj: 4, religiousup: 4, longhaul: 5 },
  meerut:     { uttarakhand: 3, haridwar: 4, kumaon: 3, shorthimachal: 3, manali: 3, rajasthan: 3, braj: 3, religiousup: 4, longhaul: 3 },
  saharanpur: { uttarakhand: 2, haridwar: 3, kumaon: 2, shorthimachal: 2, manali: 2, rajasthan: 2, braj: 2, religiousup: 3, longhaul: 2 },
  moradabad:  { uttarakhand: 2, haridwar: 2, kumaon: 4, shorthimachal: 2, manali: 2, rajasthan: 2, braj: 2, religiousup: 2, longhaul: 2 },
  bareilly:   { uttarakhand: 2, haridwar: 2, kumaon: 4, shorthimachal: 2, manali: 2, rajasthan: 2, braj: 2, religiousup: 3, longhaul: 2 },
  agra:       { uttarakhand: 3, haridwar: 3, kumaon: 3, shorthimachal: 2, manali: 2, rajasthan: 4, braj: 5, religiousup: 4, longhaul: 3 },
  aligarh:    { uttarakhand: 2, haridwar: 2, kumaon: 3, shorthimachal: 2, manali: 2, rajasthan: 3, braj: 4, religiousup: 3, longhaul: 2 },
};

// ── City coordinates ─────────────────────────────────────────────────────────
// lib/cities.ts is the primary source (cityMeta). The v551 batch-2 launch
// cities aren't in that catalog yet, so this SUPPLEMENT covers exactly them.
// If a city later lands in lib/cities.ts, cityMeta wins automatically.
const CITY_POINT_SUPPLEMENT: Record<string, ViewerPoint> = {
  haridwar:      { lat: 29.9457, lng: 78.1642 },
  bhimtal:       { lat: 29.3444, lng: 79.5537 },
  mukteshwar:    { lat: 29.4722, lng: 79.6479 },
  kasauli:       { lat: 30.8988, lng: 76.9648 },
  chail:         { lat: 30.9679, lng: 77.1861 },
  dharamshala:   { lat: 32.2190, lng: 76.3234 },
  "bir billing": { lat: 32.0333, lng: 76.7167 },
  neemrana:      { lat: 27.9891, lng: 76.3868 },
  mathura:       { lat: 27.4924, lng: 77.6737 },
  vrindavan:     { lat: 27.5829, lng: 77.7002 },
  ayodhya:       { lat: 26.7996, lng: 82.2041 },
  varanasi:      { lat: 25.3176, lng: 82.9739 },
};

/** Coordinates for a catalog city (lib/cities.ts first, supplement second). */
export function cityPoint(city?: string | null): ViewerPoint | null {
  const key = String(city || "").trim().toLowerCase();
  if (!key) return null;
  const meta = cityMeta(key);
  if (meta && Number.isFinite(meta.lat) && Number.isFinite(meta.lng)) {
    return { lat: meta.lat, lng: meta.lng };
  }
  return CITY_POINT_SUPPLEMENT[key] || null;
}

// ── Viewer → origin cluster ──────────────────────────────────────────────────
/** Nearest origin cluster within 180 km of the viewer, or null (viewer is
 *  outside the feeder belt → distance decay alone drives ACCESS). */
export function nearestOriginCluster(viewer?: ViewerPoint | null): OriginCluster | null {
  if (!viewer || !Number.isFinite(viewer.lat) || !Number.isFinite(viewer.lng)) return null;
  let best: OriginCluster | null = null;
  let bestM = Infinity;
  ORIGIN_CLUSTERS.forEach((c) => {
    const m = haversineMeters(viewer.lat, viewer.lng, c.lat, c.lng);
    if (m < bestM) { bestM = m; best = c; }
  });
  return bestM <= 180_000 ? best : null;
}

// ── ACCESS score (0..1) for one city from one viewer ─────────────────────────
// 60% corridor fit (when the viewer maps to a feeder cluster) + 40% distance
// decay; outside the feeder belt it's 100% distance decay. Distance decay is
// a road-trip proxy: ≤120 km ≈ 1, ~600 km ≈ 0.45, ≥1000 km ≈ floor 0.05.
function distanceDecay(km: number): number {
  if (!Number.isFinite(km)) return 0.05;
  if (km <= 120) return 1;
  return Math.max(0.05, 1 - (km - 120) / 880);
}

export interface CityAccess {
  score: number;            // 0..1
  km: number | null;        // straight-line distance viewer → city
  fit: number | null;       // 1..5 matrix fit (null when no cluster/corridor)
  cluster: OriginCluster | null;
}

export function cityAccess(city: string | null | undefined, viewer?: ViewerPoint | null): CityAccess {
  const pt = cityPoint(city);
  // v582 fix — no viewer point falls back to DEFAULT_ORIGIN (Delhi Core),
  // matching browseScore(). Previously a null viewer returned the neutral
  // score here, so direct callers (reach rail, trip rail, Trip Finder)
  // silently lost the Delhi-default ordering + drive-time labels.
  const v = viewer && Number.isFinite(viewer.lat) && Number.isFinite(viewer.lng) ? viewer : DEFAULT_ORIGIN;
  if (!pt) return { score: 0.5, km: null, fit: null, cluster: null }; // unknown city stays neutral
  const km = haversineMeters(v.lat, v.lng, pt.lat, pt.lng) / 1000;
  const dScore = distanceDecay(km);
  const cluster = nearestOriginCluster(v);
  const corridor = CORRIDOR_OF_CITY[String(city || "").trim().toLowerCase()];
  const fit = cluster && corridor ? (FIT[cluster.id]?.[corridor] ?? null) : null;
  const score = fit != null ? 0.6 * (fit / 5) + 0.4 * dScore : dScore;
  return { score, km, fit, cluster };
}

// ── Taste (the existing sb_disco_signals shape — lib/track.ts) ───────────────
export interface TasteSignals {
  cities?: string[];    // cities the user engaged with (most-recent first)
  likedIds?: string[];  // hotel ids the user saved / booked / long-watched
  viewedIds?: string[];
}

/** Below this much engagement the user is COLD — season + access lead. */
export function isColdStart(sig?: TasteSignals | null): boolean {
  const n = (sig?.viewedIds?.length || 0) + (sig?.likedIds?.length || 0);
  return n < 3;
}

// ── THE ranking — one formula for every browse surface ───────────────────────
export interface BrowseRankOpts {
  viewer?: ViewerPoint | null;  // null → DEFAULT_ORIGIN (Delhi Core)
  month?: number;               // 0..11; default = current UTC month
  signals?: TasteSignals | null;
  /** Weight multipliers — defaults tuned so ACCESS leads, SEASON is a strong
   *  second, TASTE dominates once the user is warm. */
  weights?: { season?: number; access?: number; taste?: number };
}

export function browseScore(city: string | null | undefined, hotelId: string | null | undefined, opts: BrowseRankOpts): number {
  const month = opts.month ?? new Date().getUTCMonth();
  const w = { season: 2.2, access: 3, taste: 2.6, ...(opts.weights || {}) };
  const viewer = opts.viewer || DEFAULT_ORIGIN;

  const tier = demandTier(String(city || ""), month);
  const season = tier === "primary" ? 1 : tier === "secondary" ? 0.5 : 0;
  const access = cityAccess(city, viewer).score;

  let taste = 0;
  const sig = opts.signals;
  if (sig) {
    const cLc = String(city || "").trim().toLowerCase();
    if (cLc && (sig.cities || []).some((x) => String(x).toLowerCase() === cLc)) taste += 0.6;
    if (hotelId && (sig.likedIds || []).includes(String(hotelId))) taste += 1;
  }

  return w.season * season + w.access * access + w.taste * taste;
}

/**
 * Stable rank of any item list by the shared formula. Ties keep the incoming
 * order, so server-side ranking / per-session shuffle variety survives inside
 * each affinity band.
 */
export function rankForBrowse<T>(
  items: T[],
  getCity: (item: T) => string | null | undefined,
  getHotelId: (item: T) => string | null | undefined,
  opts: BrowseRankOpts = {},
): T[] {
  if (!Array.isArray(items) || items.length < 2) return items;
  try {
    const scored = items.map((item, i) => ({
      item, i,
      s: browseScore(getCity(item), getHotelId(item), opts),
    }));
    scored.sort((a, b) => (b.s - a.s) || (a.i - b.i));
    return scored.map((x) => x.item);
  } catch {
    return items; // fail-open: never break a feed over a ranking bug
  }
}
