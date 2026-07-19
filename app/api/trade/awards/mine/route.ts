// v361 — Model 3: an agent's AWARDS (won lots to pay + issued vouchers).
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";
import { tradeAgentFromReq } from "@/lib/trade/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await tradeAgentFromReq(req);
  if (!auth) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const r = await fetch(
    `${SB_URL}/rest/v1/auction_awards?agent_user_id=eq.${encodeURIComponent(auth.user.id)}&select=*&order=created_at.desc&limit=200`,
    { headers: SB_READ, cache: "no-store" },
  );
  const awards = r.ok ? await r.json().catch(() => []) : [];
  return NextResponse.json({ awards });
}
