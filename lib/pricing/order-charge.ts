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
import { computeHoldAmount, DEFAULT_HOLD_TIERS, type HoldTier } from "@/lib/hold-amount";

const enc = (s: string) => encodeURIComponent(s);
const HOLD_CONFIG_GLOBAL = "_global_defaults";

function nightsBetween(ci: any, co: any): number {
  const a = Date.parse(String(ci || "").slice(0, 10));
  const b = Date.parse(String(co || "").slice(0, 10));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

/** The hotel's admin-configured hold tiers (per-hotel ?? global ?? default) —
 *  the SAME rule set in the admin "Hold Payment Config" page. */
export async function resolveHoldTiers(hotelId?: string | null): Promise<HoldTier[]> {
  try {
    const [hotelRows, globalRows] = await Promise.all([
      hotelId
        ? sbSelect<any>("hotel_hold_config", `hotel_id=eq.${enc(String(hotelId))}&select=tier_overrides`)
        : Promise.resolve([] as any[]),
      sbSelect<any>("hotel_hold_config", `hotel_id=eq.${enc(HOLD_CONFIG_GLOBAL)}&select=tier_overrides`),
    ]);
    const ov = hotelRows?.[0]?.tier_overrides ?? globalRows?.[0]?.tier_overrides ?? null;
    if (Array.isArray(ov) && ov.length) return ov as HoldTier[];
  } catch { /* fall through to default */ }
  return DEFAULT_HOLD_TIERS;
}

/** The admin-configured hold DEPOSIT (₹) owed for a booking total — the exact
 *  number the customer UI shows (computeHoldAmount over the hotel's tiers). */
export async function resolveHoldDeposit(total: number, hotelId?: string | null): Promise<number> {
  const t = Math.max(0, Number(total) || 0);
  if (t <= 0) return 0;
  return computeHoldAmount(t, await resolveHoldTiers(hotelId));
}

/** Authoritative full-payment charge for paying/accepting an existing bid. */
export async function resolveBidOrderCharge(opts: {
  bidId: string;
  userId: string | null;
  couponCode?: string | null;
  walletCreditInr?: number | null;
}): Promise<{ charge: number; hotelId?: string } | null> {
  const bidId = String(opts.bidId || "");
  if (!bidId) return null;
  try {
    const bids = await sbSelect<any>(
      "bids",
      `id=eq.${enc(bidId)}&select=amount,counterAmount,numRooms,requestId,hotelId`,
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
    return { charge: Math.max(0, base - discount), hotelId: b.hotelId ? String(b.hotelId) : undefined };
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
}): Promise<{ minCharge: number; hotelId?: string } | null> {
  const roomId = String(opts.roomId || "");
  if (!roomId) return null;
  const nights = Math.max(1, Math.floor(Number(opts.nights) || 1));
  const rooms = Math.max(1, Math.floor(Number(opts.rooms) || 1));
  try {
    const rc = await sbSelect<any>("rooms", `id=eq.${enc(roomId)}&select=floorPrice,hotelId`);
    const floor = Number(rc?.[0]?.floorPrice) || 0;
    if (!(floor > 0)) return null;
    const base = floor * nights * rooms;
    const discount = await resolveValidatedDiscount({
      userId: opts.userId,
      couponCode: opts.couponCode,
      walletCreditInr: opts.walletCreditInr,
      cap: base,
    });
    return { minCharge: Math.max(0, base - discount), hotelId: rc?.[0]?.hotelId ? String(rc[0].hotelId) : undefined };
  } catch {
    return null;
  }
}

/**
 * Authoritative BALANCE for settling a held bid (v532).
 *
 * expectedBalance = finalTotal − serverDeposit, where
 *   finalTotal    = authoritative room base − the redemption ACTUALLY applied
 *                   to this bid (reconstructed from server records, NOT the
 *                   client — so a coupon/wallet balance never false-rejects)
 *   serverDeposit = computeHoldAmount(finalTotal, the hotel's real tiers)
 *
 * Returns null on any gap → caller FAILS OPEN.
 */
export async function resolveBalanceCharge(opts: {
  bidId: string;
}): Promise<{ balance: number } | null> {
  const bidId = String(opts.bidId || "");
  if (!bidId) return null;
  try {
    const bids = await sbSelect<any>(
      "bids",
      `id=eq.${enc(bidId)}&select=amount,counterAmount,numRooms,requestId,hotelId`,
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
      } catch { /* default 1 */ }
    }
    const base = perNight * nights * numRooms;

    // Redemption ACTUALLY applied to this bid, from server-written records
    // (applyRedemption): the coupon marked used_on_bid_id, and the wallet
    // debit ledger keyed on source_id. Trustworthy (server-written), so
    // subtracting it means a legit coupon/wallet balance never false-rejects.
    let appliedRedemption = 0;
    try {
      const coupons = await sbSelect<any>(
        "redemption_codes",
        `used_on_bid_id=eq.${enc(bidId)}&select=value_inr`,
      );
      for (const c of coupons || []) appliedRedemption += Number(c?.value_inr) || 0;
    } catch { /* none */ }
    try {
      const wh = await sbSelect<any>(
        "wallet_credit_history",
        `source_id=eq.${enc(bidId)}&type=eq.debit_on_booking&select=delta_inr`,
      );
      for (const w of wh || []) appliedRedemption += Math.abs(Number(w?.delta_inr) || 0);
    } catch { /* none */ }

    const finalTotal = Math.max(0, base - appliedRedemption);

    // The hotel's real hold tiers → the admin-configured deposit.
    const tiers = await resolveHoldTiers(b.hotelId);
    const deposit = computeHoldAmount(finalTotal, tiers);
    const balance = Math.max(0, finalTotal - deposit);
    return { balance };
  } catch {
    return null;
  }
}
