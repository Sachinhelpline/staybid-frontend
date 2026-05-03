import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";

// Admin grant or deduct. Accepts a signed delta. Caller MUST be the admin
// panel (gated at app/admin/layout.tsx); the route trusts the panel and does
// not re-verify role to keep parity with other /api/admin/* routes.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const userId = String(body?.userId || "").trim();
  const delta  = Number(body?.delta);
  if (!userId || !Number.isFinite(delta) || delta === 0) {
    return NextResponse.json({ error: "userId and non-zero delta required" }, { status: 400 });
  }

  const cur = await fetch(`${SB_URL}/rest/v1/user_points?user_id=eq.${encodeURIComponent(userId)}&select=*`, { headers: SB_READ })
    .then(r => r.json()).catch(() => []);
  let wallet = Array.isArray(cur) && cur[0] ? cur[0] : null;

  if (!wallet) {
    const ins = await fetch(`${SB_URL}/rest/v1/user_points`, {
      method: "POST", headers: SB_H,
      body: JSON.stringify({ user_id: userId, balance: 0, lifetime_earned: 0, lifetime_redeemed: 0, tier: "silver" }),
    });
    const created = ins.ok ? await ins.json().catch(() => null) : null;
    wallet = Array.isArray(created) ? created[0] : created;
    if (!wallet) return NextResponse.json({ error: "Wallet create failed" }, { status: 500 });
  }

  const newBalance = (wallet.balance || 0) + delta;
  if (newBalance < 0) return NextResponse.json({ error: "Adjustment would result in negative balance" }, { status: 400 });

  const updPayload: any = {
    balance: newBalance,
    updated_at: new Date().toISOString(),
  };
  if (delta > 0) updPayload.lifetime_earned    = (wallet.lifetime_earned || 0) + delta;
  if (delta < 0) updPayload.lifetime_redeemed  = (wallet.lifetime_redeemed || 0) + Math.abs(delta);

  const upd = await fetch(`${SB_URL}/rest/v1/user_points?user_id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH", headers: SB_H, body: JSON.stringify(updPayload),
  });
  if (!upd.ok) return NextResponse.json({ error: "Update failed" }, { status: 500 });

  await fetch(`${SB_URL}/rest/v1/points_history`, {
    method: "POST", headers: SB_H,
    body: JSON.stringify({
      user_id: userId, delta, type: "adjusted",
      reason: body.reason || "Admin adjustment",
      source_type: "admin",
      balance_after: newBalance,
    }),
  }).catch(() => {});

  return NextResponse.json({ wallet: { ...wallet, balance: newBalance }, delta });
}
