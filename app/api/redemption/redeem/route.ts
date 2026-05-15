// POST /api/redemption/redeem
//
// Atomic-ish redemption flow:
//   1. Resolve user + rule
//   2. Validate (tier / balance / monthly cap)
//   3. Debit user_points + write points_history (-delta)
//   4. Generate unique code + barcode_value
//   5. Insert redemption_codes row
//   6. For wallet_credit kind: also credit wallet_credits + write wallet_credit_history
//
// Server-side trust: we never read points/tier from the request body —
// always from `user_points`. The kind/value also come from `redemption_rules`,
// not the body (so a tampered request can't redeem ₹10000 voucher for 1 pt).

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ, userFromReq } from "@/lib/sb";
import {
  generateCouponCode,
  generateBarcodeValue,
  canUserRedeem,
  tierForBalance,
  type RedemptionRule,
  type Tier,
} from "@/lib/redemption";

export const dynamic = "force-dynamic";

async function countThisMonthForRule(userId: string, ruleId: string): Promise<number> {
  const firstOfMonth = new Date();
  firstOfMonth.setUTCDate(1);
  firstOfMonth.setUTCHours(0, 0, 0, 0);
  const since = firstOfMonth.toISOString();
  const r = await fetch(
    `${SB_URL}/rest/v1/redemption_codes?user_id=eq.${encodeURIComponent(userId)}&rule_id=eq.${encodeURIComponent(ruleId)}&issued_at=gte.${encodeURIComponent(since)}&select=id`,
    { headers: { ...SB_READ, Prefer: "count=exact" } },
  );
  const rangeHeader = r.headers.get("content-range") || "";
  const total = Number(rangeHeader.split("/")[1] || 0);
  return Number.isFinite(total) ? total : 0;
}

export async function POST(req: NextRequest) {
  const u = userFromReq(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ruleId: string | undefined = body?.ruleId || body?.rule_id;
  const ruleSlug: string | undefined = body?.slug;
  if (!ruleId && !ruleSlug) return NextResponse.json({ error: "ruleId or slug required" }, { status: 400 });

  // 1. Resolve rule
  const ruleQuery = ruleId
    ? `id=eq.${encodeURIComponent(ruleId)}`
    : `slug=eq.${encodeURIComponent(ruleSlug!)}`;
  const ruleRes = await fetch(
    `${SB_URL}/rest/v1/redemption_rules?${ruleQuery}&active=eq.true&select=*`,
    { headers: SB_READ },
  ).then((r) => r.json()).catch(() => []);
  const rule: RedemptionRule | undefined = Array.isArray(ruleRes) ? ruleRes[0] : undefined;
  if (!rule) return NextResponse.json({ error: "Reward not found or inactive" }, { status: 404 });

  // 2. Resolve user points wallet (auto-create if missing — same as /api/points GET)
  let walletRes = await fetch(
    `${SB_URL}/rest/v1/user_points?user_id=eq.${encodeURIComponent(u.id)}&select=*`,
    { headers: SB_READ },
  ).then((r) => r.json()).catch(() => []);
  let pointsWallet: any = Array.isArray(walletRes) && walletRes[0] ? walletRes[0] : null;
  if (!pointsWallet) {
    const ins = await fetch(`${SB_URL}/rest/v1/user_points`, {
      method: "POST",
      headers: SB_H,
      body: JSON.stringify({ user_id: u.id, balance: 0, lifetime_earned: 0, lifetime_redeemed: 0, tier: "silver" }),
    });
    const created = ins.ok ? await ins.json().catch(() => null) : null;
    pointsWallet = Array.isArray(created) ? created[0] : created;
  }
  const pointsBalance = Number(pointsWallet?.balance || 0);
  const lifetimeEarned = Number(pointsWallet?.lifetime_earned || 0);
  const userTier: Tier = tierForBalance(lifetimeEarned);

  // 3. Validate
  const monthlyCount = await countThisMonthForRule(u.id, rule.id);
  const v = canUserRedeem({ rule, pointsBalance, userTier, monthlyCount });
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  // 4. Debit points
  const newBalance = pointsBalance - rule.points_cost;
  const newLifetimeRedeemed = Number(pointsWallet?.lifetime_redeemed || 0) + rule.points_cost;
  const updRes = await fetch(
    `${SB_URL}/rest/v1/user_points?user_id=eq.${encodeURIComponent(u.id)}`,
    {
      method: "PATCH",
      headers: SB_H,
      body: JSON.stringify({
        balance: newBalance,
        lifetime_redeemed: newLifetimeRedeemed,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  if (!updRes.ok) {
    const txt = await updRes.text().catch(() => "");
    return NextResponse.json({ error: "Failed to debit points", details: txt }, { status: 500 });
  }
  await fetch(`${SB_URL}/rest/v1/points_history`, {
    method: "POST",
    headers: SB_H,
    body: JSON.stringify({
      user_id: u.id,
      delta: -rule.points_cost,
      type: "redeemed",
      reason: rule.title,
      source_type: "redemption_rule",
      source_id: rule.id,
      balance_after: newBalance,
    }),
  }).catch(() => {});

  // 5. Generate + insert code (retry on UNIQUE violation up to 3x — collisions
  // are vanishingly rare with 31^8 ≈ 8.5e11 space, but worth being safe).
  const expiresAt = new Date(Date.now() + rule.validity_days * 24 * 60 * 60 * 1000).toISOString();
  let inserted: any = null;
  for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
    const code = generateCouponCode("STAY");
    const barcode = generateBarcodeValue();
    const ins = await fetch(`${SB_URL}/rest/v1/redemption_codes`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify({
        code,
        barcode_value: barcode,
        user_id: u.id,
        rule_id: rule.id,
        rule_slug: rule.slug,
        kind: rule.kind,
        title: rule.title,
        value_inr: Number(rule.value_inr || 0),
        points_spent: rule.points_cost,
        status: "active",
        expires_at: expiresAt,
      }),
    });
    if (ins.ok) {
      const arr = await ins.json().catch(() => null);
      inserted = Array.isArray(arr) ? arr[0] : arr;
      break;
    }
    // Unique-violation retry. Anything else, log and bail.
    const errTxt = await ins.text().catch(() => "");
    if (!/duplicate|unique/i.test(errTxt)) {
      return NextResponse.json({ error: "Failed to issue code", details: errTxt }, { status: 500 });
    }
  }
  if (!inserted) return NextResponse.json({ error: "Failed to issue unique code after retries" }, { status: 500 });

  // 6. Wallet credit kinds — also top up wallet_credits + ledger
  if (rule.kind === "wallet_credit" && Number(rule.value_inr) > 0) {
    // Upsert wallet_credits row
    const wcRes = await fetch(
      `${SB_URL}/rest/v1/wallet_credits?user_id=eq.${encodeURIComponent(u.id)}&select=*`,
      { headers: SB_READ },
    ).then((r) => r.json()).catch(() => []);
    const existing: any = Array.isArray(wcRes) && wcRes[0] ? wcRes[0] : null;
    const credit = Number(rule.value_inr);
    if (existing) {
      const newBal = Number(existing.balance_inr) + credit;
      await fetch(`${SB_URL}/rest/v1/wallet_credits?user_id=eq.${encodeURIComponent(u.id)}`, {
        method: "PATCH",
        headers: SB_H,
        body: JSON.stringify({
          balance_inr: newBal,
          lifetime_credited: Number(existing.lifetime_credited) + credit,
          updated_at: new Date().toISOString(),
        }),
      }).catch(() => {});
      await fetch(`${SB_URL}/rest/v1/wallet_credit_history`, {
        method: "POST",
        headers: SB_H,
        body: JSON.stringify({
          user_id: u.id,
          delta_inr: credit,
          type: "credit_from_points",
          reason: `Redeemed: ${rule.title}`,
          source_type: "redemption_code",
          source_id: inserted.id,
          balance_after: newBal,
        }),
      }).catch(() => {});
    } else {
      await fetch(`${SB_URL}/rest/v1/wallet_credits`, {
        method: "POST",
        headers: SB_H,
        body: JSON.stringify({
          user_id: u.id,
          balance_inr: credit,
          lifetime_credited: credit,
          lifetime_debited: 0,
        }),
      }).catch(() => {});
      await fetch(`${SB_URL}/rest/v1/wallet_credit_history`, {
        method: "POST",
        headers: SB_H,
        body: JSON.stringify({
          user_id: u.id,
          delta_inr: credit,
          type: "credit_from_points",
          reason: `Redeemed: ${rule.title}`,
          source_type: "redemption_code",
          source_id: inserted.id,
          balance_after: credit,
        }),
      }).catch(() => {});
    }
  }

  return NextResponse.json({
    ok: true,
    code: inserted,
    wallet: { balance: newBalance, lifetime_redeemed: newLifetimeRedeemed },
    rule,
  });
}
