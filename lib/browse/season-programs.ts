// ─────────────────────────────────────────────────────────────────────────────
// SEASONAL SELLING PROGRAMS (v581) — the owner's "How StayBid Should Sell It"
// panel (12-Month Selling Calendar deck) as code.
//
// Four month-driven selling programs. The Stage renders the ACTIVE program as
// a campaign band that rewrites itself as the calendar turns — December
// visitors see Winter Leisure, July visitors see Monsoon Value + Workation —
// with zero manual switching. Pure + isomorphic (no fetch, no window).
//
// ⚠ Copy rules: ENGLISH (owner, v369) and no income/guarantee language.
// ─────────────────────────────────────────────────────────────────────────────

import type { TripFormatId } from "@/lib/browse/trip-formats";

export interface SeasonProgram {
  id: "winter" | "summerhills" | "monsoon" | "festive";
  /** UTC months this program owns (0=Jan … 11=Dec). */
  months: number[];
  icon: string;
  title: string;
  tagline: string;
  /** Three benefit pills, straight from the deck's program card. */
  points: [string, string, string];
  /** The trip-format chip the band's CTA activates. */
  featuredFormat: TripFormatId;
  ctaLabel: string;
}

export const SEASON_PROGRAMS: SeasonProgram[] = [
  {
    id: "winter", months: [11, 0, 1],
    icon: "❄️",
    title: "Winter Leisure",
    tagline: "Beach escapes, deserts, heritage & luxury stays",
    points: ["Sun destinations & premium stays", "Early-bird deals", "Long-weekend escapes"],
    featuredFormat: "premium",
    ctaLabel: "Explore winter picks",
  },
  {
    id: "summerhills", months: [2, 3, 4],
    icon: "🌲",
    title: "Summer Hills",
    tagline: "Cool hills, nature & family-friendly stays",
    points: ["School-break family trips", "Adventure, nature & calm", "Hill cottages & resorts"],
    featuredFormat: "family",
    ctaLabel: "Explore hill escapes",
  },
  {
    id: "monsoon", months: [5, 6, 7],
    icon: "🌧️",
    title: "Monsoon Value + Workation",
    tagline: "Green getaways, long stays & slow travel",
    points: ["Value deals & long stays", "Offbeat green destinations", "Work-friendly comfort"],
    featuredFormat: "workation",
    ctaLabel: "Explore monsoon picks",
  },
  {
    id: "festive", months: [8, 9, 10],
    icon: "🪔",
    title: "Festive & Holiday Season",
    tagline: "Weddings, festivals, holidays & celebrations",
    points: ["Premium inventory", "Bespoke experiences", "Book early — season fills fast"],
    featuredFormat: "premium",
    ctaLabel: "Explore festive stays",
  },
];

/** The active program for a UTC month (0–11). Guards out-of-range inputs. */
export function programForMonth(month: number): SeasonProgram {
  const m = ((Math.trunc(month) % 12) + 12) % 12;
  return SEASON_PROGRAMS.find((p) => p.months.includes(m)) || SEASON_PROGRAMS[0];
}

/** Program by id (v583.1 — the season-preference picker). */
export function programById(id: string | null | undefined): SeasonProgram | null {
  return SEASON_PROGRAMS.find((p) => p.id === id) || null;
}

/** The month that best REPRESENTS a program (its middle month) — used to
 *  re-rank every browse surface when the user picks a season preference. */
export function representativeMonth(p: SeasonProgram): number {
  return p.months[1] ?? p.months[0];
}
