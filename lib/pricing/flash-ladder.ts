// ─────────────────────────────────────────────────────────────────────────────
// Flash-deal discount ladder + dynamic flash floor (v526, Phase 2)
//
// Single source of truth for HOW DEEP a flash discount goes per room and WHERE
// it bottoms out — shared by the flash feed (app/api/flash/near) and the hotel
// detail page so the number is identical on every surface.
//
// The model (owner-approved):
//   • Each room's flash price = its LIVE dynamic price − a discount %.
//   • The discount gets DEEPER for higher room categories (the "upgrade
//     incentive": a pricier room shows a bigger % off so a guest is pulled up
//     into it instead of it sitting empty at 0% off). Tier 0 = the cheapest
//     room (base deal), each step up adds FLASH_TIER_STEP.
//   • Vacancy is NOT double-counted here: the live price already carries the
//     dynamic engine's occupancy multiplier (more empty ⇒ lower live ⇒ lower
//     flash), so the ladder stays a clean, deterministic function of tier.
//   • The price never drops below a FLASH FLOOR: the owner's manually-set
//     `flashFloorPrice` (rooms / room_date_overrides) wins when present and
//     sane; otherwise a dynamic fraction of the live price guarantees there is
//     always real discount headroom (fixes "floor == live ⇒ 0% off").
//
// Pure + isomorphic (no DB, no env) so it runs identically on the server feed
// and the client hotel page.
// ─────────────────────────────────────────────────────────────────────────────
import { snap100 } from "@/lib/price-snap";

export const FLASH_BASE_DISCOUNT = 0.20;   // base 20% off the live price (cheapest / base room)
export const FLASH_TIER_STEP     = 0.10;   // +10% deeper per category up → 1st upgrade ~30% ("almost double"), a real pull to upgrade
export const FLASH_MAX_DISCOUNT  = 0.40;   // hard cap so a deal never looks fake / never below cost
export const FLASH_FLOOR_FRACTION = 0.55;  // dynamic flash floor = live × 55% when the owner hasn't set one

/** Discount fraction (0..1) for a room at `tierIndex` (0 = cheapest/base room). */
export function flashDiscountForTier(tierIndex: number): number {
  const d = FLASH_BASE_DISCOUNT + Math.max(0, tierIndex) * FLASH_TIER_STEP;
  return Math.min(FLASH_MAX_DISCOUNT, d);
}

/**
 * Effective flash floor for a room. The OWNER's manual floor wins when it is
 * set and genuinely below the live price; otherwise a dynamic fraction of the
 * live price guarantees discount headroom.
 */
export function effectiveFlashFloor(live: number, ownerFlashFloor?: number | null): number {
  const owner = Number(ownerFlashFloor) || 0;
  if (owner > 0 && owner < live) return snap100(owner);
  return snap100(live * FLASH_FLOOR_FRACTION);
}

/**
 * The full per-room flash computation.
 * @returns flash (₹100-snapped), floor (the effective flash floor), and the
 *          realized discount % vs the live price after the floor clamp.
 */
export function computeFlashLadder(opts: {
  live: number;                       // the room's live dynamic price (spine livePrice)
  tierIndex: number;                  // 0 = cheapest room, 1 = next category up, …
  ownerFlashFloor?: number | null;    // rooms.flashFloorPrice (owner's manual minimum), if any
}): { flash: number; floor: number; discountPct: number } {
  const live = Number(opts.live) || 0;
  if (live <= 0) return { flash: 0, floor: 0, discountPct: 0 };
  const disc  = flashDiscountForTier(opts.tierIndex);
  const floor = effectiveFlashFloor(live, opts.ownerFlashFloor);
  let flash = snap100(live * (1 - disc));
  if (flash < floor) flash = floor;   // never below the flash floor
  if (flash > live)  flash = live;     // never above market
  const realized = Math.max(0, Math.round((1 - flash / live) * 100));
  return { flash, floor, discountPct: realized };
}

/**
 * Rank a hotel's rooms cheapest→priciest and return roomId → tierIndex.
 * The cheapest room (usually the base flash deal) is tier 0.
 */
export function tierRanks(rooms: Array<{ id: string; floorPrice?: number | null }>): Record<string, number> {
  const sorted = rooms
    .filter((r) => r && r.id)
    .slice()
    .sort((a, b) => (Number(a.floorPrice) || 0) - (Number(b.floorPrice) || 0));
  const out: Record<string, number> = {};
  sorted.forEach((r, i) => { out[String(r.id)] = i; });
  return out;
}
