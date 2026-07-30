// ─────────────────────────────────────────────────────────────────────────────
// TRIP FORMATS (v581) — the owner's "Trip Economics, Budget Bands & Travel
// Formats" + "Product Architecture" decks as code.
//
// Six productized trip formats, each carrying:
//   • the destination CORRIDORS it naturally maps to (the same corridor ids
//     lib/browse/affinity.ts uses — one vocabulary across the whole engine)
//   • the deck's per-night room-rate band (₹) — how we know a property FITS
//     the format's budget expectations
//   • the audience segments the deck targets with it
//
// formatFit() is the pure matcher every surface uses (home chips, Trip
// Finder, rails): corridor match + price-band fit → 0..1. Fail-open: unknown
// city / missing price never zeroes a property out completely.
// ─────────────────────────────────────────────────────────────────────────────

export type TripFormatId =
  | "weekend" | "family" | "pilgrimage" | "adventure" | "premium" | "workation";

export type SegmentId = "couple" | "family" | "group" | "solo" | "pilgrim";

export interface TripFormat {
  id: TripFormatId;
  emoji: string;
  label: string;
  blurb: string;              // one-line answer to "what is this trip?"
  corridors: string[];        // affinity corridor ids (see lib/browse/affinity.ts)
  /** Deck room-rate band per night [min, max] in ₹. */
  nightBand: [number, number];
  /** Deck trip length band, for copy ("2–3 nights"). */
  nights: string;
  /** Audience segments this format serves (deck "ideal party"). */
  segments: SegmentId[];
}

export const TRIP_FORMATS: TripFormat[] = [
  {
    id: "weekend", emoji: "⛰️", label: "Weekend Hills",
    blurb: "2–3 nights · cottages & boutique stays · easy road trips",
    corridors: ["uttarakhand", "kumaon", "shorthimachal", "haridwar"],
    nightBand: [3000, 7500], nights: "2–3 nights",
    segments: ["couple", "group", "solo"],
  },
  {
    id: "family", emoji: "👨‍👩‍👧", label: "Family Escape",
    blurb: "3–4 nights · resorts with family rooms & activities",
    corridors: ["manali", "shorthimachal", "haridwar", "kumaon"],
    nightBand: [6000, 12000], nights: "3–4 nights",
    segments: ["family"],
  },
  {
    id: "pilgrimage", emoji: "🛕", label: "Pilgrimage",
    blurb: "2–5 nights · darshan-friendly stays near the ghats & temples",
    corridors: ["braj", "religiousup", "haridwar"],
    nightBand: [2500, 6000], nights: "2–5 nights",
    segments: ["pilgrim", "family", "group"],
  },
  {
    id: "adventure", emoji: "🏕️", label: "Adventure & Youth",
    blurb: "2–4 nights · camps, treks, rafting & wildlife",
    corridors: ["kumaon", "haridwar", "manali"],
    nightBand: [2500, 7500], nights: "2–4 nights",
    segments: ["group", "solo"],
  },
  {
    id: "premium", emoji: "👑", label: "Premium Leisure",
    blurb: "2–4 nights · luxury resorts, villas & curated experiences",
    corridors: ["manali", "kumaon", "haridwar", "shorthimachal", "rajasthan", "longhaul"],
    nightBand: [12000, 40000], nights: "2–4 nights",
    segments: ["couple", "family"],
  },
  {
    id: "workation", emoji: "💻", label: "Workation",
    blurb: "5+ nights · Wi-Fi, workspace & long-stay comfort",
    corridors: ["haridwar", "uttarakhand", "shorthimachal", "manali", "kumaon"],
    nightBand: [6000, 15000], nights: "5–14 nights",
    segments: ["solo", "couple"],
  },
];

export function tripFormat(id: string | null | undefined): TripFormat | null {
  return TRIP_FORMATS.find((f) => f.id === id) || null;
}

// City (lowercased) → corridor — mirrors lib/browse/affinity.ts's map. Kept
// here as a lookup import to avoid a circular dep; the corridor VOCABULARY is
// shared, the city membership is identical.
const CITY_CORRIDOR: Record<string, string> = {
  dehradun: "uttarakhand", mussoorie: "uttarakhand", dhanaulti: "uttarakhand", kanatal: "uttarakhand",
  haridwar: "haridwar", rishikesh: "haridwar",
  nainital: "kumaon", corbett: "kumaon", bhimtal: "kumaon", mukteshwar: "kumaon", lansdowne: "kumaon",
  kasauli: "shorthimachal", chail: "shorthimachal", shimla: "shorthimachal",
  manali: "manali", kasol: "manali", "bir billing": "manali", dharamshala: "manali",
  jaipur: "rajasthan", pushkar: "rajasthan", jaisalmer: "rajasthan", udaipur: "rajasthan", neemrana: "rajasthan",
  mathura: "braj", vrindavan: "braj",
  ayodhya: "religiousup", varanasi: "religiousup",
  goa: "longhaul", coorg: "longhaul", kerala: "longhaul", leh: "longhaul",
};

/**
 * How well a property fits a trip format — 0..1.
 *   • corridor match is the gate (0.7 weight): right REGION for the format
 *   • price-band fit (0.3): inside the deck band = full; near-miss decays
 * Unknown city → 0 corridor credit; missing price → neutral 0.15 (never a
 * hard zero, so a sparse catalog still fills a rail).
 */
export function formatFit(
  format: TripFormat,
  city: string | null | undefined,
  minPricePerNight: number | null | undefined,
): number {
  const c = String(city || "").trim().toLowerCase();
  const corridor = CITY_CORRIDOR[c];
  const corridorFit = corridor && format.corridors.includes(corridor) ? 1 : 0;

  let priceFit = 0.5; // neutral when we don't know the price
  const p = Number(minPricePerNight);
  if (Number.isFinite(p) && p > 0) {
    const [lo, hi] = format.nightBand;
    if (p >= lo && p <= hi) priceFit = 1;
    else if (p < lo) priceFit = Math.max(0.35, p / lo);            // cheaper than the band is fine-ish
    else priceFit = Math.max(0, 1 - (p - hi) / hi);                // far above band → fades out
  }

  return corridorFit * 0.7 + priceFit * 0.3;
}

/** The default format for an inferred audience segment (chip pre-selection). */
export function formatForSegment(seg: SegmentId | null | undefined): TripFormatId {
  switch (seg) {
    case "family":  return "family";
    case "pilgrim": return "pilgrimage";
    case "group":   return "adventure";
    case "solo":    return "workation";
    case "couple":  return "weekend";
    default:        return "weekend"; // the deck's most universal NCR format
  }
}
