// ─────────────────────────────────────────────────────────────────────────────
// Customer order charge (v531) — server-authoritative amounts for the NON-flash
// customer money-in flows, so /api/razorpay/order can stop trusting the client.
//
// Two shapes, mirroring how the price is known:
//   • resolveBidOrderCharge   — pay/accept an EXISTING bid. The authoritative
//       per-night is already in the `bids` row (counterAmount ?? amount); nights
//       come from the linked bid_request, rooms from bids.numRooms. Exact.
//   • resolveInstantOrderCharge — Book Now / Upgrade / Negotiate, which have no
//       row at order time. The authoritative FLOOR is the room's floorPrice ×
//       nights × rooms. Book Now/Upgrade charge ≈ this; Negotiate charges ≥ it —
//       so this is a MINIMUM the paid amount must clear.
//
// Both subtract a server-validated redemption discount (shared helper) and are
// used only to REJECT materially-low amounts. Server-only. Return null on any
// gap → the caller FAILS OPEN (never block a legit booking on a pricing hiccup).
// ─────────────────────────────────────────────────────────────────────────────
import { sbSelect } from "@/lib/onboard/supabase-admin";
import { resolveValidatedDiscount } from "./redemption-validate";

const enc = (s: string) => encodeURIComponent(s);

function nightsBetween(ci: any, co: any): number {
  const a = Date.parse(String(ci || "").slice(0, 10));
  const b = Date.parse(String(co || "").slice(0, 10));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

/** Authoritative full-payment charge for paying/accepting an existing bid. */
export async function resolveBidOrderCharge(opts: {
  bidId: string;
  userId: string | null;
  couponCode?: string | null;
  walletCreditInr?: number | null;
}): Promise<{ charge: number } | null> {
  const bidId = String(opts.bidId || "");
  if (!bidId) return null;
  try {
    const bids = await sbSelect<any>(
      "bids",
      `id=eq.${enc(bidId)}&select=amount,counterAmount,numRooms,requestId`,
    );
    const b = bids?.[0];
    if (!b) return null;
    const perNight = Number(b.counterAmount) || Number(b.amount) || 0;
    if (!(perNight > 0)) return null;
    const numRooms = Math.max(1, Math.floor(Number(b.numRooms) || 1));

    let nights = 1;
    if (b.requestId) {
      try {
        const rr = await sbSelect<any>(
          "bid_requests",
          `id=eq.${enc(String(b.requestId))}&select=checkIn,checkOut`,
        );
        const n = nightsBetween(rr?.[0]?.checkIn, rr?.[0]?.checkOut);
        if (n > 0) nights = n;
      } catch { /* default 1 night */ }
    }

    const base = perNight * nights * numRooms;
    const discount = await resolveValidatedDiscount({
      userId: opts.userId,
      couponCode: opts.couponCode,
      walletCreditInr: opts.walletCreditInr,
      cap: base,
    });
    return { charge: Math.max(0, base - discount) };
  } catch {
    return null;
  }
}

/** Authoritative MINIMUM charge for a fresh Book Now / Upgrade / Negotiate. */
export async function resolveInstantOrderCharge(opts: {
  userId: string | null;
  roomId: string;
  nights: number;
  rooms: number;
  couponCode?: string | null;
  walletCreditInr?: number | null;
}): Promise<{ minCharge: number } | null> {
  const roomId = String(opts.roomId || "");
  if (!roomId) return null;
  const nights = Math.max(1, Math.floor(Number(opts.nights) || 1));
  const rooms = Math.max(1, Math.floor(Number(opts.rooms) || 1));
  try {
    const rc = await sbSelect<any>("rooms", `id=eq.${enc(roomId)}&select=floorPrice`);
    const floor = Number(rc?.[0]?.floorPrice) || 0;
    if (!(floor > 0)) return null;
    const base = floor * nights * rooms;
    const discount = await resolveValidatedDiscount({
      userId: opts.userId,
      couponCode: opts.couponCode,
      walletCreditInr: opts.walletCreditInr,
      cap: base,
    });
    return { minCharge: Math.max(0, base - discount) };
  } catch {
    return null;
  }
}
