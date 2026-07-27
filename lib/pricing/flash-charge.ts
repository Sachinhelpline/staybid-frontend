// ─────────────────────────────────────────────────────────────────────────────
// Flash-deal SERVER charge (v530) — the authoritative full-payment amount.
//
// The generic /api/razorpay/order route trusts the client `amount`. For a flash
// FULL-payment order we instead re-compute the charge here, entirely from the
// source of truth, so a scripted client can't pay ₹1 for a confirmed booking:
//
//   charge = authoritative flash price × nights × rooms
//          + server-priced extras (extra adults, children)
//          − server-VALIDATED coupon / wallet discount
//
// The redemption is VALIDATED but NOT debited here (ownership + balance checked
// exactly as /api/redemption/apply does) — the existing post-payment
// applyRedemption still performs the real debit / single-use mark. Validating
// (not trusting) the discount is what stops a tamper: a fake or unowned coupon
// validates to ₹0, so the floor stays at full price.
//
// Server-only. Returns null on ANY gap so the caller FAILS OPEN — a pricing
// hiccup must never block a legit booking (same discipline as the availability
// guards and the v529 per-night floor).
// ─────────────────────────────────────────────────────────────────────────────
import { sbSelect } from "@/lib/onboard/supabase-admin";
import { resolveFlashFloorPerNight } from "./flash-authority";
import { resolveValidatedDiscount } from "./redemption-validate";

const enc = (s: string) => encodeURIComponent(s);
const EXTRA_ADULT_RATE = 500; // must match app/hotels/[id]/page.tsx flash extras
const CHILD_RATE = 200;

export interface FlashOrderCharge {
  charge: number;      // authoritative full-payment charge (post validated discount)
  grandTotal: number;  // pre-discount authoritative total
  perNight: number;
  discount: number;    // validated redemption actually allowed
  hotelId?: string;    // for the hold-deposit tier lookup
}

export async function resolveFlashOrderCharge(opts: {
  userId: string | null;
  roomId: string;
  checkInISO: string;
  nights: number;
  rooms: number;
  adults: number;
  children: number;
  couponCode?: string | null;
  walletCreditInr?: number | null;
}): Promise<FlashOrderCharge | null> {
  const roomId = String(opts.roomId || "");
  if (!roomId) return null;
  const nights = Math.max(1, Math.floor(Number(opts.nights) || 1));
  const rooms = Math.max(1, Math.floor(Number(opts.rooms) || 1));
  const adults = Math.max(1, Math.floor(Number(opts.adults) || 1));
  const children = Math.max(0, Math.floor(Number(opts.children) || 0));

  try {
    // ── authoritative per-night flash price (same engine the UI + v529 use) ──
    const authority = await resolveFlashFloorPerNight({ roomId, checkInISO: opts.checkInISO });
    if (!authority || !(authority.perNight > 0)) return null;
    const perNight = authority.perNight;
    const base = perNight * nights * rooms;

    // ── extras (mirror the client: baseCapacity = room.capacity || 2) ──
    let capacity = 2;
    let hotelId: string | undefined;
    try {
      const rc = await sbSelect<any>("rooms", `id=eq.${enc(roomId)}&select=capacity,hotelId`);
      capacity = Number(rc?.[0]?.capacity) || 2;
      hotelId = rc?.[0]?.hotelId ? String(rc[0].hotelId) : undefined;
    } catch { /* default 2 */ }
    const extraAdults = Math.max(0, adults - capacity);
    const extras = extraAdults * EXTRA_ADULT_RATE * nights + children * CHILD_RATE * nights;

    const grandTotal = base + extras;

    // ── validated redemption (NO side effects — real debit is post-payment) ──
    const discount = await resolveValidatedDiscount({
      userId: opts.userId,
      couponCode: opts.couponCode,
      walletCreditInr: opts.walletCreditInr,
      cap: grandTotal,
    });

    const charge = Math.max(0, grandTotal - discount);
    return { charge, grandTotal, perNight, discount, hotelId };
  } catch {
    return null;
  }
}
