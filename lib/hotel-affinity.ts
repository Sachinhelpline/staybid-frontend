// ═══════════════════════════════════════════════════════════════════════════
// lib/hotel-affinity.ts — v508
//
// Lightweight, privacy-safe (localStorage-only, no server) behavioural
// preference engine for the "More stays" recommendation rail.
//
// The idea: we never ASK the customer what they want. We WATCH which hotels
// they open. As they hop from property to property we infer whether they are
// leaning price-sensitive (each click cheaper than the last) or quality-seeking
// (each click higher-rated), and quietly re-rank the next set of suggestions to
// match — plus a per-card reason ("₹700 cheaper", "★ Higher rated").
//
// Pure client util. Falls back to a neutral 50/50 profile with no trail.
// ═══════════════════════════════════════════════════════════════════════════

export type HotelSig = {
  id: string;
  price?: number;      // cheapest room / from-price
  rating?: number;     // avgRating
  type?: string;       // property_type
};

const KEY = "sb_hotel_trail_v1";
const MAX = 8;

/** Record that the customer opened a hotel detail page. Keeps the last MAX,
 *  de-duped (a re-open moves it to the end). Best-effort — never throws. */
export function recordHotelView(sig: HotelSig, now?: number) {
  if (typeof window === "undefined" || !sig || !sig.id) return;
  try {
    const trail: HotelSig[] = JSON.parse(localStorage.getItem(KEY) || "[]");
    const filtered = Array.isArray(trail) ? trail.filter((t) => t && t.id !== sig.id) : [];
    filtered.push({ id: sig.id, price: sig.price, rating: sig.rating, type: sig.type });
    localStorage.setItem(KEY, JSON.stringify(filtered.slice(-MAX)));
  } catch { /* ignore */ }
}

export function getTrail(): HotelSig[] {
  if (typeof window === "undefined") return [];
  try {
    const t = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(t) ? t : [];
  } catch { return []; }
}

export type Affinity = { priceWeight: number; ratingWeight: number };

/** Infer how much the customer values a cheaper price vs. a higher rating from
 *  the direction of their click trail. Weights sum to 1; neutral 0.5/0.5 when
 *  there isn't enough signal. */
export function getAffinity(trail: HotelSig[] = getTrail()): Affinity {
  if (!trail || trail.length < 2) return { priceWeight: 0.5, ratingWeight: 0.5 };
  let priceSignal = 0;
  let ratingSignal = 0;
  for (let i = 1; i < trail.length; i++) {
    const prev = trail[i - 1];
    const cur = trail[i];
    if (prev.price != null && cur.price != null && prev.price !== cur.price) {
      priceSignal += cur.price < prev.price ? 1 : -1; // moved cheaper ⇒ price-sensitive
    }
    if (prev.rating != null && cur.rating != null && prev.rating !== cur.rating) {
      ratingSignal += cur.rating > prev.rating ? 1 : -1; // moved higher-rated ⇒ quality
    }
  }
  const p = Math.max(0.15, Math.min(0.85, 0.5 + priceSignal * 0.12));
  const r = Math.max(0.15, Math.min(0.85, 0.5 + ratingSignal * 0.12));
  const sum = p + r || 1;
  return { priceWeight: p / sum, ratingWeight: r / sum };
}

export type Candidate = {
  id: string;
  fromPrice?: number;
  avgRating?: number;
  propertyType?: string;
};

export type Ranked<T> = T & { _score: number; _reason?: string };

/**
 * Rank same-city candidates for the "More stays" rail:
 *   1. SAME property_type as the one the customer is viewing comes first
 *      (strict preference — the rule the owner asked for).
 *   2. Within that, order by the customer's inferred price/quality affinity.
 *   3. Tag each with a human reason vs. the CURRENT hotel (cheaper / higher
 *      rated / great value) so the card can say WHY it's a good alternative.
 */
export function rankCandidates<T extends Candidate>(
  candidates: T[],
  ctx: { propertyType?: string; currentPrice?: number; currentRating?: number; affinity?: Affinity }
): Ranked<T>[] {
  const aff = ctx.affinity || getAffinity();
  const prices = candidates.map((c) => c.fromPrice).filter((n): n is number => Number.isFinite(n) && (n as number) > 0);
  const minP = prices.length ? Math.min(...prices) : 0;
  const maxP = prices.length ? Math.max(...prices) : 0;
  const spanP = Math.max(1, maxP - minP);

  const ranked: Ranked<T>[] = candidates.map((c) => {
    const typeMatch = ctx.propertyType && c.propertyType && c.propertyType === ctx.propertyType ? 1 : 0;
    // Price score: cheaper = higher (0..1), weighted by inferred price sensitivity.
    const priceScore = c.fromPrice ? (maxP - c.fromPrice) / spanP : 0.5;
    // Rating score: normalise 3.0..5.0 → 0..1.
    const ratingScore = c.avgRating ? Math.max(0, Math.min(1, (c.avgRating - 3) / 2)) : 0.4;
    const affScore = aff.priceWeight * priceScore + aff.ratingWeight * ratingScore;
    // Same-type dominates (+2), then the affinity blend.
    const _score = typeMatch * 2 + affScore;

    // Reason vs the hotel they're currently on — pick the strongest angle.
    let _reason: string | undefined;
    const cheaperBy = ctx.currentPrice && c.fromPrice && c.fromPrice < ctx.currentPrice
      ? ctx.currentPrice - c.fromPrice : 0;
    const higherRated = ctx.currentRating && c.avgRating && c.avgRating > ctx.currentRating;
    if (aff.priceWeight >= aff.ratingWeight && cheaperBy > 0) {
      _reason = `₹${cheaperBy.toLocaleString("en-IN")} cheaper`;
    } else if (higherRated) {
      _reason = "★ Higher rated";
    } else if (cheaperBy > 0) {
      _reason = `₹${cheaperBy.toLocaleString("en-IN")} cheaper`;
    } else if (typeMatch) {
      _reason = "Same style";
    }
    return { ...c, _score, _reason };
  });

  ranked.sort((a, b) => b._score - a._score);
  return ranked;
}
