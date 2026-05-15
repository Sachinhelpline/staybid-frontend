// GET /api/redemption/codes
//
// Returns the signed-in user's redemption codes — active first, then used
// and expired. Optional ?status=active|used|expired query filter.
//
// Side-effect: auto-flips status=active rows whose expires_at < now() to
// status=expired (lazy housekeeping — saves running a cron). Best-effort.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ, userFromReq } from "@/lib/sb";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const u = userFromReq(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const status = req.nextUrl.searchParams.get("status") || "";
  let q = `${SB_URL}/rest/v1/redemption_codes?user_id=eq.${encodeURIComponent(u.id)}&select=*&order=issued_at.desc&limit=200`;
  if (status === "active") q += "&status=eq.active";
  if (status === "used") q += "&status=eq.used";
  if (status === "expired") q += "&status=eq.expired";

  const codes = await fetch(q, { headers: SB_READ })
    .then((r) => r.json())
    .catch(() => []);
  const list: any[] = Array.isArray(codes) ? codes : [];

  // Lazy expiry sweep — fire-and-forget for rows that are still 'active'
  // but past expires_at.
  const now = Date.now();
  const toExpire = list
    .filter((c) => c.status === "active" && new Date(c.expires_at).getTime() < now)
    .map((c) => c.id);
  if (toExpire.length) {
    fetch(`${SB_URL}/rest/v1/redemption_codes?id=in.(${toExpire.join(",")})`, {
      method: "PATCH",
      headers: SB_H,
      body: JSON.stringify({ status: "expired" }),
    }).catch(() => {});
    for (const c of list) if (toExpire.includes(c.id)) c.status = "expired";
  }

  // Also surface the wallet_credits balance — the /my-codes UI shows it
  // alongside active codes since it's the same redemption family.
  const wcRes = await fetch(
    `${SB_URL}/rest/v1/wallet_credits?user_id=eq.${encodeURIComponent(u.id)}&select=*`,
    { headers: SB_READ },
  ).then((r) => r.json()).catch(() => []);
  const wallet = Array.isArray(wcRes) && wcRes[0] ? wcRes[0] : { balance_inr: 0, lifetime_credited: 0, lifetime_debited: 0 };

  return NextResponse.json({ codes: list, walletCredit: wallet });
}
