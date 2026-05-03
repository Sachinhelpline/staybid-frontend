import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ, userFromReq } from "@/lib/sb";

export async function GET(req: NextRequest) {
  const u = userFromReq(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [walletRes, histRes] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/user_points?user_id=eq.${encodeURIComponent(u.id)}&select=*`, { headers: SB_READ }).then(r => r.json()).catch(() => []),
    fetch(`${SB_URL}/rest/v1/points_history?user_id=eq.${encodeURIComponent(u.id)}&select=*&order=created_at.desc&limit=10`, { headers: SB_READ }).then(r => r.json()).catch(() => []),
  ]);

  let wallet = Array.isArray(walletRes) && walletRes[0] ? walletRes[0] : null;
  if (!wallet) {
    const ins = await fetch(`${SB_URL}/rest/v1/user_points`, {
      method: "POST", headers: SB_H,
      body: JSON.stringify({ user_id: u.id, balance: 0, lifetime_earned: 0, lifetime_redeemed: 0, tier: "silver" }),
    });
    const created = ins.ok ? await ins.json().catch(() => null) : null;
    wallet = Array.isArray(created) ? created[0] : created || { user_id: u.id, balance: 0, lifetime_earned: 0, lifetime_redeemed: 0, tier: "silver" };
  }

  return NextResponse.json({ wallet, recent: Array.isArray(histRes) ? histRes : [] });
}
