// POST /api/redemption/apply
//
// Called by the hotel/[id] bid handlers AFTER the bid row is created. Atomic-ish:
//   • Coupon kind → mark redemption_codes row used (used_on_bid_id = bidId)
//   • Wallet credit kind → debit wallet_credits + write ledger row
//
// Body:
//   { bidId, couponCode?, walletCreditInr? }
//
// Returns the rows it wrote so the UI can update wallet balance / show
// "applied" confirmation. Idempotent within reason — re-applying the same
// code to the same bidId is a no-op (status already 'used').

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ, userFromReq } from "@/lib/sb";
import { normalizeCodeInput } from "@/lib/redemption";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const u = userFromReq(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const bidId: string | undefined = body?.bidId;
  const couponRaw: string | undefined = body?.couponCode;
  const walletCreditInr: number = Number(body?.walletCreditInr || 0);

  if (!bidId) return NextResponse.json({ error: "bidId required" }, { status: 400 });
  if (!couponRaw && !walletCreditInr) return NextResponse.json({ error: "Nothing to apply" }, { status: 400 });

  const result: any = { ok: true, bidId };

  // ─── Coupon path ────────────────────────────────────────────────────────
  if (couponRaw) {
    const code = normalizeCodeInput(couponRaw);
    const rows = await fetch(
      `${SB_URL}/rest/v1/redemption_codes?code=eq.${encodeURIComponent(code)}&select=*`,
      { headers: SB_READ },
    ).then((r) => r.json()).catch(() => []);
    const c: any = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!c) return NextResponse.json({ error: "Coupon not found" }, { status: 404 });
    if (c.user_id !== u.id) return NextResponse.json({ error: "Coupon belongs to another user" }, { status: 403 });
    if (c.status === "used" && c.used_on_bid_id === bidId) {
      // Idempotent — same code already applied to same bid
      result.coupon = c;
    } else {
      if (c.status !== "active") return NextResponse.json({ error: `Coupon is ${c.status}` }, { status: 400 });
      if (new Date(c.expires_at).getTime() < Date.now()) {
        return NextResponse.json({ error: "Coupon expired" }, { status: 400 });
      }
      if (c.kind !== "coupon" && c.kind !== "voucher") {
        return NextResponse.json({ error: "This code can't be applied at checkout" }, { status: 400 });
      }
      const upd = await fetch(`${SB_URL}/rest/v1/redemption_codes?id=eq.${encodeURIComponent(c.id)}`, {
        method: "PATCH",
        headers: { ...SB_H, Prefer: "return=representation" },
        body: JSON.stringify({ status: "used", used_at: new Date().toISOString(), used_on_bid_id: bidId }),
      });
      if (!upd.ok) {
        const txt = await upd.text().catch(() => "");
        return NextResponse.json({ error: "Failed to mark coupon used", details: txt }, { status: 500 });
      }
      const updated = await upd.json().catch(() => null);
      result.coupon = Array.isArray(updated) ? updated[0] : updated;
    }
    result.couponDiscountInr = Number(result.coupon.value_inr || 0);
  }

  // ─── Wallet credit path ─────────────────────────────────────────────────
  if (walletCreditInr > 0) {
    const wcRes = await fetch(
      `${SB_URL}/rest/v1/wallet_credits?user_id=eq.${encodeURIComponent(u.id)}&select=*`,
      { headers: SB_READ },
    ).then((r) => r.json()).catch(() => []);
    const wc: any = Array.isArray(wcRes) && wcRes[0] ? wcRes[0] : null;
    if (!wc) return NextResponse.json({ error: "No wallet credit balance" }, { status: 400 });
    const available = Number(wc.balance_inr || 0);
    const debit = Math.min(walletCreditInr, available);
    if (debit <= 0) return NextResponse.json({ error: "Wallet credit balance is zero" }, { status: 400 });

    const newBal = available - debit;
    const upd = await fetch(`${SB_URL}/rest/v1/wallet_credits?user_id=eq.${encodeURIComponent(u.id)}`, {
      method: "PATCH",
      headers: SB_H,
      body: JSON.stringify({
        balance_inr: newBal,
        lifetime_debited: Number(wc.lifetime_debited || 0) + debit,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!upd.ok) {
      const txt = await upd.text().catch(() => "");
      return NextResponse.json({ error: "Failed to debit wallet credit", details: txt }, { status: 500 });
    }
    await fetch(`${SB_URL}/rest/v1/wallet_credit_history`, {
      method: "POST",
      headers: SB_H,
      body: JSON.stringify({
        user_id: u.id,
        delta_inr: -debit,
        type: "debit_on_booking",
        reason: "Applied wallet credit to booking",
        source_type: "bid",
        source_id: bidId,
        balance_after: newBal,
      }),
    }).catch(() => {});
    result.walletCreditApplied = debit;
    result.walletBalanceAfter = newBal;
  }

  return NextResponse.json(result);
}
