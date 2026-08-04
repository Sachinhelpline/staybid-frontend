// v726 — OTA "always cheapest" guard for owner-set FLAT prices (server-only).
//
// A per-unit `hotel_room_units.price_override` (Circle owner's flat guest price)
// bypasses the pricing spine entirely, so the spine's competitor-undercut cap
// never runs on it — an owner could silently price a unit ABOVE the OTA and
// break StayBid's "always the cheapest" promise. This clamps an owner-set flat
// price to competitor_min × (1 − COMPETITOR_UNDERCUT) when a competitor price is
// known, but NEVER below the room's own floor (the owner never sells below cost).
//
// Fail-open: no competitor data / any error → the price is returned UNCHANGED
// (so on the overwhelming majority of rooms, where competitor_min is null, the
// behaviour is byte-identical to before). Pure read; writes nothing.

import { SB_URL, SB_READ } from "@/lib/sb";
import { COMPETITOR_UNDERCUT } from "@/lib/pricing/spine";

export interface OtaCapResult {
  price: number;            // the (possibly clamped) price to store
  capped: boolean;          // true when the input was lowered to the OTA cap
  cap: number | null;       // competitor_min × 0.95 (null when unknown)
  floor: number | null;     // the room's floorPrice (owner cost lower bound)
  competitorMin: number | null;
}

export async function otaCapPrice(roomId: string, price: number): Promise<OtaCapResult> {
  const base: OtaCapResult = { price, capped: false, cap: null, floor: null, competitorMin: null };
  if (!roomId || !Number.isFinite(price) || price <= 0) return base;
  try {
    const cr = await fetch(
      `${SB_URL}/rest/v1/room_pricing_config?room_id=eq.${encodeURIComponent(roomId)}&select=competitor_min&limit=1`,
      { headers: SB_READ, cache: "no-store" },
    );
    const comp = cr.ok ? Number((await cr.json().catch(() => []))?.[0]?.competitor_min) : NaN;
    if (!Number.isFinite(comp) || comp <= 0) return base; // no OTA reference → never clamp

    let floor = 0;
    try {
      const fr = await fetch(
        `${SB_URL}/rest/v1/rooms?id=eq.${encodeURIComponent(roomId)}&select=floorPrice&limit=1`,
        { headers: SB_READ, cache: "no-store" },
      );
      floor = fr.ok ? Number((await fr.json().catch(() => []))?.[0]?.floorPrice) || 0 : 0;
    } catch { /* floor unknown → 0 lower bound */ }

    const cap = Math.round(comp * (1 - COMPETITOR_UNDERCUT));
    if (price <= cap) return { ...base, cap, floor, competitorMin: comp }; // already cheaper than OTA
    const capped = Math.max(floor, cap);   // stay below OTA, but never below cost
    if (capped >= price) return { ...base, cap, floor, competitorMin: comp }; // cost ≥ price → can't lower
    return { price: capped, capped: true, cap, floor, competitorMin: comp };
  } catch {
    return base; // fail-open — a pricing hiccup must never block a legit list action
  }
}
