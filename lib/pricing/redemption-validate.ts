// ─────────────────────────────────────────────────────────────────────────────
// Server-validated redemption discount (v531) — shared by every customer
// money-in enforcement path (flash, book-now, negotiate, upgrade, accepted-bid).
//
// Computes the ₹ discount a user is ACTUALLY entitled to, with NO side effects
// (the real debit / single-use mark still happens post-payment in
// /api/redemption/apply). Mirrors that route's checks exactly:
//   • coupon — must be owned by the user, active, unexpired, coupon/voucher kind
//   • wallet — clamped to the user's real wallet_credits.balance_inr
//
// Validating (not trusting) the claimed discount is what makes the enforcement
// tamper-safe: a fake or unowned coupon validates to ₹0, so a claimed discount
// can never shrink the enforced charge below what the user truly owns.
//
// Server-only. Never throws — any lookup gap contributes ₹0.
// ─────────────────────────────────────────────────────────────────────────────
import { sbSelect } from "@/lib/onboard/supabase-admin";
import { applyCodeToBooking, normalizeCodeInput } from "@/lib/redemption";

const enc = (s: string) => encodeURIComponent(s);

export async function resolveValidatedDiscount(opts: {
  userId: string | null;
  couponCode?: string | null;
  walletCreditInr?: number | null;
  cap: number; // the total the discount applies against (discount can't exceed this)
}): Promise<number> {
  const userId = opts.userId || "";
  const cap = Math.max(0, Number(opts.cap) || 0);
  if (!userId || cap <= 0) return 0;

  let discount = 0;

  // ── coupon: owned + active + unexpired + coupon/voucher kind ──
  const codeRaw = String(opts.couponCode || "");
  if (codeRaw) {
    try {
      const code = normalizeCodeInput(codeRaw);
      const rows = await sbSelect<any>("redemption_codes", `code=eq.${enc(code)}&select=*`);
      const c = rows?.[0];
      if (c && c.user_id === userId) {
        const willApply = applyCodeToBooking(
          { kind: c.kind, value_inr: c.value_inr, status: c.status, expires_at: c.expires_at },
          { bookingTotalInr: cap },
        );
        const d = willApply && (willApply as any).ok ? Number((willApply as any).discountInr || 0) : 0;
        if (d > 0) discount += Math.min(d, cap);
      }
    } catch { /* invalid coupon → ₹0 */ }
  }

  // ── wallet: clamp to the real balance and the remaining total ──
  const wantWallet = Math.max(0, Number(opts.walletCreditInr) || 0);
  if (wantWallet > 0) {
    try {
      const wcRows = await sbSelect<any>(
        "wallet_credits",
        `user_id=eq.${enc(userId)}&select=balance_inr`,
      );
      const bal = Number(wcRows?.[0]?.balance_inr) || 0;
      const remaining = Math.max(0, cap - discount);
      discount += Math.min(wantWallet, bal, remaining);
    } catch { /* wallet unreadable → ₹0 */ }
  }

  return discount;
}
