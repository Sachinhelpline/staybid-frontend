// SINGLE SOURCE OF TRUTH for "starting from" / minimum displayed price
// across the entire app. Every customer-facing surface MUST use this.
//
// Inputs:
//   hotel.rooms     — array of { floorPrice, mrp? }
//   hotel.flashDeals (optional) — array of active flash deals { aiPrice, dealPrice? }
//
// Output: a single number, or null if nothing is bookable yet.
//
// Surfaces using this:
//   - /             (home page "Top Stays Right Now")
//   - /hotels       (Compare listing)
//   - /discover     (Explore reels)
//   - /hotels/[id]  (detail page "Starting from" badge)

export type MinPriceInputs = {
  rooms?: Array<{ floorPrice?: number | string | null; mrp?: number | string | null }>;
  flashDeals?: Array<{ aiPrice?: number | string | null; dealPrice?: number | string | null }>;
};

export function computeMinPrice(h: MinPriceInputs): number | null {
  const fps = (h.rooms || [])
    .map((r) => Number(r?.floorPrice))
    .filter((n) => Number.isFinite(n) && n > 0);
  const dps = (h.flashDeals || [])
    .map((d) => Number(d?.aiPrice ?? d?.dealPrice))
    .filter((n) => Number.isFinite(n) && n > 0);

  const all = [...fps, ...dps];
  return all.length ? Math.min(...all) : null;
}

export function formatINR(n: number | null | undefined): string {
  if (!n || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN");
}
