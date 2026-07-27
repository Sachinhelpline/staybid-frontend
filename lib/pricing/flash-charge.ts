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
import { applyCodeToBooking, normalizeCodeInput } from "@/lib/redemption";

const enc = (s: string) => encodeURIComponent(s);
const EXTRA_ADULT_RATE = 500; // must match app/hotels/[id]/page.tsx flash extras
const CHILD_RATE = 200;

export interface FlashOrderCharge {
  charge: number;      // authoritative full-payment charge (post validated discount)
  grandTotal: number;  // pre-discount authoritative total
  perNight: number;
  discount: number;    // validated redemption actually allowed
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
    try {
      const rc = await sbSelect<any>("rooms", `id=eq.${enc(roomId)}&select=capacity`);
      capacity = Number(rc?.[0]?.capacity) || 2;
    } catch { /* default 2 */ }
    const extraAdults = Math.max(0, adults - capacity);
    const extras = extraAdults * EXTRA_ADULT_RATE * nights + children * CHILD_RATE * nights;

    const grandTotal = base + extras;

    // ── validated redemption (NO side effects — real debit is post-payment) ──
    let discount = 0;
    const userId = opts.userId || "";
    if (userId) {
      // coupon — owned + active + unexpired + coupon/voucher kind
      const codeRaw = String(opts.couponCode || "");
      if (codeRaw) {
        try {
          const code = normalizeCodeInput(codeRaw);
          const rows = await sbSelect<any>("redemption_codes", `code=eq.${enc(code)}&select=*`);
          const c = rows?.[0];
          if (c && c.user_id === userId) {
            const willApply = applyCodeToBooking(
              { kind: c.kind, value_inr: c.value_inr, status: c.status, expires_at: c.expires_at },
              { bookingTotalInr: grandTotal },
            );
            const d = willApply && (willApply as any).ok ? Number((willApply as any).discountInr || 0) : 0;
            if (d > 0) discount += Math.min(d, grandTotal);
          }
        } catch { /* invalid coupon → contributes ₹0 */ }
      }
      // wallet — clamp to the user's real balance and the remaining total
      const wantWallet = Math.max(0, Number(opts.walletCreditInr) || 0);
      if (wantWallet > 0) {
        try {
          const wcRows = await sbSelect<any>(
            "wallet_credits",
            `user_id=eq.${enc(userId)}&select=balance_inr`,
          );
          const bal = Number(wcRows?.[0]?.balance_inr) || 0;
          const remaining = Math.max(0, grandTotal - discount);
          discount += Math.min(wantWallet, bal, remaining);
        } catch { /* wallet unreadable → contributes ₹0 */ }
      }
    }

    const charge = Math.max(0, grandTotal - discount);
    return { charge, grandTotal, perNight, discount };
  } catch {
    return null;
  }
}
