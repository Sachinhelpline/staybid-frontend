// ─────────────────────────────────────────────────────────────────────────────
// TRIP FINDER ENGINE (v582) — the answer to "I don't know where to go."
//
// A traveller who can't name a destination CAN answer three easy questions:
// who's going, what kind of trip, and roughly what budget. This pure engine
// turns those three answers into the TOP 3 destinations — each with the
// REASONS a human advisor would give ("~3.5 hr drive from you", "in season
// this month", "fits your budget") and an honest from-price built ONLY from
// the property's real minimum nightly rate.
//
// Deterministic by design (no external AI API): the same pure signals every
// other browse surface uses — lib/browse/trip-formats.ts (deck formats +
// budget bands), lib/browse/affinity.ts (reach), lib/circle/demand-cycle.ts
// (season) — so the Finder can never contradict the rails around it.
// ─────────────────────────────────────────────────────────────────────────────

import { cityAccess, type ViewerPoint } from "@/lib/browse/affinity";
import { demandTier, type DemandTier } from "@/lib/circle/demand-cycle";
import { tripFormat, formatFit, type TripFormatId, type SegmentId } from "@/lib/browse/trip-formats";

export type BudgetBandId = "b1" | "b2" | "b3" | "b4";

export interface BudgetBand {
  id: BudgetBandId;
  label: string;           // "₹3k–6k / person"
  /** Per person per night, ₹. */
  perPerson: [number, number];
}

export const BUDGET_BANDS: BudgetBand[] = [
  { id: "b1", label: "Under ₹3k / person",  perPerson: [1000, 3000] },
  { id: "b2", label: "₹3k–6k / person",     perPerson: [3000, 6000] },
  { id: "b3", label: "₹6k–10k / person",    perPerson: [6000, 10000] },
  { id: "b4", label: "₹10k+ / person",      perPerson: [10000, 40000] },
];

export function budgetBand(id: string | null | undefined): BudgetBand | null {
  return BUDGET_BANDS.find((b) => b.id === id) || null;
}

/** Typical nights per format (deck trip-length bands, midpoint-ish). */
const FORMAT_NIGHTS: Record<TripFormatId, number> = {
  weekend: 2, family: 3, pilgrimage: 3, adventure: 3, premium: 3, workation: 7,
};

export interface FinderHotel {
  id: string;
  name?: string;
  city?: string;
  minPrice?: number | null;   // real cheapest nightly rate (rooms floorPrice)
  overall?: number | null;    // scorecard 0–100 (optional)
  image?: string | null;
}

export interface FinderInput {
  segment: SegmentId;
  format: TripFormatId;
  budget: BudgetBandId;
  viewer?: ViewerPoint | null;
  month?: number;             // 0–11, default current UTC month
  hotels: FinderHotel[];
}

export interface FinderPick {
  hotel: FinderHotel;
  score: number;
  seasonTier: DemandTier;
  /** "~3.5 hr drive" | "Fly-away escape" | null (unknown city). */
  driveLabel: string | null;
  estNights: number;
  /** minPrice × estNights — null when the property has no price data. */
  estFrom: number | null;
  /** Up to 3 human reasons, most persuasive first. */
  reasons: string[];
}

// Room/night ≈ 2 people sharing → a per-person band maps to a 2× room band.
function budgetFit(minPrice: number | null | undefined, band: BudgetBand): number {
  const p = Number(minPrice);
  if (!Number.isFinite(p) || p <= 0) return 0.5; // unknown price → neutral
  const lo = band.perPerson[0] * 2;
  const hi = band.perPerson[1] * 2;
  if (p >= lo && p <= hi) return 1;
  if (p < lo) return 0.8;                        // cheaper than asked — fine
  return Math.max(0, 1 - (p - hi) / hi);         // pricier — fades out
}

/** Shared "how far is it really" label — also used by the Stage cards (v583). */
export function driveLabelFor(km: number | null): string | null {
  if (km == null || !Number.isFinite(km)) return null;
  const hrs = km / 55; // hill-road average
  if (hrs <= 9) {
    const rounded = Math.max(1, Math.round(hrs * 2) / 2);
    return `~${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} hr drive`;
  }
  return "Fly-away escape";
}

/**
 * The answer: top `limit` picks, one per city, scored + explained.
 * Fail-open: empty catalog → empty list (the UI hides itself).
 */
export function answerTrip(input: FinderInput, limit = 3): FinderPick[] {
  const fmt = tripFormat(input.format);
  const band = budgetBand(input.budget);
  if (!fmt || !band || !Array.isArray(input.hotels)) return [];
  const month = input.month ?? new Date().getUTCMonth();

  const scored = input.hotels
    .filter((h) => h && h.id && h.city)
    .map((h) => {
      const fFit = formatFit(fmt, h.city, h.minPrice);
      const bFit = budgetFit(h.minPrice, band);
      const acc = cityAccess(h.city, input.viewer || null);
      const tier = demandTier(h.city || "", month);
      const season = tier === "primary" ? 1 : tier === "secondary" ? 0.5 : 0;
      const sc = Number(h.overall);
      const score =
        fFit * 2.2 +
        bFit * 1.4 +
        acc.score * 1.6 +
        season * 0.9 +
        (Number.isFinite(sc) ? (sc / 100) * 0.4 : 0);

      const estNights = FORMAT_NIGHTS[fmt.id];
      const p = Number(h.minPrice);
      const estFrom = Number.isFinite(p) && p > 0 ? p * estNights : null;
      const driveLabel = driveLabelFor(acc.km);

      const reasons: string[] = [];
      if (driveLabel && driveLabel !== "Fly-away escape") reasons.push(`${driveLabel} from you`);
      if (tier === "primary") reasons.push("In season right now");
      else if (tier === "secondary") reasons.push("Great this time of year");
      if (bFit >= 1) reasons.push("Fits your budget");
      else if (bFit >= 0.8) reasons.push("Under your budget");
      if (driveLabel === "Fly-away escape") reasons.push("Worth the journey");
      if (reasons.length < 3 && Number.isFinite(sc) && sc >= 60) reasons.push("Top-rated stay");

      return {
        hotel: h, score, seasonTier: tier, driveLabel,
        estNights, estFrom, reasons: reasons.slice(0, 3),
      } as FinderPick & { _fit: number };
    })
    // corridor gate — the Finder must never suggest the wrong region for the
    // chosen trip type (same 0.5 gate the trip rail uses)
    .filter((x) => formatFit(fmt, x.hotel.city, x.hotel.minPrice) >= 0.5)
    .sort((a, b) => b.score - a.score);

  // one pick per city so the answer reads as three DESTINATIONS
  const seen = new Set<string>();
  const out: FinderPick[] = [];
  for (const s of scored) {
    const c = String(s.hotel.city || "").toLowerCase();
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}
