import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ, userFromReq } from "@/lib/sb";

export async function POST(req: NextRequest) {
  const u = userFromReq(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const points = Number(body?.points);
  if (!points || points <= 0) return NextResponse.json({ error: "Points must be positive" }, { status: 400 });

  const cur = await fetch(`${SB_URL}/rest/v1/user_points?user_id=eq.${encodeURIComponent(u.id)}&select=*`, { headers: SB_READ })
    .then(r => r.json()).catch(() => []);
  const wallet = Array.isArray(cur) && cur[0] ? cur[0] : null;
  if (!wallet) return NextResponse.json({ error: "No points wallet found" }, { status: 404 });
  if (wallet.balance < points) return NextResponse.json({ error: "Insufficient balance" }, { status: 400 });

  const newBalance = wallet.balance - points;
  const upd = await fetch(`${SB_URL}/rest/v1/user_points?user_id=eq.${encodeURIComponent(u.id)}`, {
    method: "PATCH", headers: SB_H,
    body: JSON.stringify({
      balance: newBalance,
      lifetime_redeemed: (wallet.lifetime_redeemed || 0) + points,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!upd.ok) return NextResponse.json({ error: "Update failed" }, { status: 500 });

  await fetch(`${SB_URL}/rest/v1/points_history`, {
    method: "POST", headers: SB_H,
    body: JSON.stringify({
      user_id: u.id, delta: -points, type: "redeemed",
      reason: body.reason || "User redemption",
      source_type: body.sourceType || "redemption",
      source_id: body.sourceId || null,
      balance_after: newBalance,
    }),
  }).catch(() => {});

  return NextResponse.json({ wallet: { ...wallet, balance: newBalance }, redeemed: points });
}
