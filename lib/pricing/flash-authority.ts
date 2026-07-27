// ─────────────────────────────────────────────────────────────────────────────
// Flash-deal SERVER authority (v529) — the tamper-safe per-night floor.
//
// The customer UI computes a flash price live from the spine + the discount
// ladder (lib/pricing/flash-ladder). That number is client-computed, so on its
// own it is not trustworthy for money: a scripted request could send a lower
// per-night price. This module re-derives the SAME number on the server so a
// checkout route can reject any flash bid whose per-night amount is materially
// below the honest floor.
//
// It mirrors the client exactly (app/hotels/[id]/page.tsx flash block):
//   • live  = the room's spine livePrice for the check-in date
//   • tier  = the room's rank within its hotel (cheapest floorPrice = 0)
//   • floor = computeFlashLadder(...).flash (already clamped to the effective
//             flash floor: owner's flashFloorPrice, else live × 55%)
//   • the headline room can legitimately sit BELOW the ladder when the cron has
//     dropped the stored flash_deals.aiPrice, so the authoritative minimum is
//     min(storedAiPrice, ladderFlash) — matching the UI's min(lockedDeal, ladder).
//
// Server-only (reads Supabase). Returns null on ANY gap (no room, no spine,
// error) so the caller FAILS OPEN — a pricing hiccup must never block a legit
// booking (the same discipline as the availability guards).
// ─────────────────────────────────────────────────────────────────────────────
import { sbSelect } from "@/lib/onboard/supabase-admin";
import { resolveSpinePrices } from "./read-spine";
import { computeFlashLadder, tierRanks } from "./flash-ladder";

const enc = (s: string) => encodeURIComponent(s);

export interface FlashAuthority {
  perNight: number;   // the authoritative minimum flash price / room / night
  ladderFlash: number;
  live: number;
}

/**
 * Resolve the authoritative flash floor (₹/room/night) for a room on a date.
 * Returns null when it can't be computed → caller should fail OPEN.
 */
export async function resolveFlashFloorPerNight(opts: {
  roomId: string;
  checkInISO: string;
}): Promise<FlashAuthority | null> {
  const roomId = String(opts.roomId || "");
  if (!roomId) return null;
  const day =
    String(opts.checkInISO || "").slice(0, 10) ||
    new Date().toISOString().slice(0, 10);

  try {
    // ── the room + its hotel siblings (for the cheapest→priciest tier rank) ──
    const roomRows = await sbSelect<any>(
      "rooms",
      `id=eq.${enc(roomId)}&select=id,hotelId,floorPrice,flashFloorPrice`,
    );
    const room = roomRows[0];
    if (!room) return null;

    let siblings: any[] = [room];
    try {
      const sib = await sbSelect<any>(
        "rooms",
        `hotelId=eq.${enc(String(room.hotelId))}&select=id,floorPrice`,
      );
      if (Array.isArray(sib) && sib.length) siblings = sib;
    } catch { /* fall back to the single room */ }

    const ranks = tierRanks(
      siblings.map((r: any) => ({ id: String(r.id), floorPrice: Number(r.floorPrice) || 0 })),
    );
    const tierIndex = ranks[roomId] ?? 0;

    // ── the room's live spine price for the check-in date ──
    const spine = await resolveSpinePrices([roomId], day);
    const live = Number(spine[roomId]?.livePrice) || 0;

    const ladderFlash = computeFlashLadder({
      live,
      tierIndex,
      ownerFlashFloor: Number(room.flashFloorPrice) || 0,
    }).flash;

    // ── the stored active deal price (headline room), if any ──
    let storedAi = 0;
    try {
      const fd = await sbSelect<any>(
        "flash_deals",
        `roomId=eq.${enc(roomId)}&isActive=eq.true&select=aiPrice&order=createdAt.desc&limit=1`,
      );
      storedAi = Number(fd?.[0]?.aiPrice) || 0;
    } catch { /* optional — upgrades have no deal row */ }

    // Uniform rule (matches the UI): a genuinely-lower stored deal wins via min;
    // otherwise the ladder floor governs.
    const perNight =
      ladderFlash > 0
        ? (storedAi > 0 ? Math.min(storedAi, ladderFlash) : ladderFlash)
        : storedAi;

    if (!(perNight > 0)) return null;
    return { perNight, ladderFlash, live };
  } catch {
    return null;
  }
}
