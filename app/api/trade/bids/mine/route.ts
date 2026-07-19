// v361 — Model 3: an agent's own bids (active/won/lost/…), newest first, with
// lot context side-loaded (no FK embeds). Requires a signed-in agent.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";
import { tradeAgentFromReq } from "@/lib/trade/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await tradeAgentFromReq(req);
  if (!auth) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const agentUserId = auth.user.id;

  const r = await fetch(
    `${SB_URL}/rest/v1/auction_bids?agent_user_id=eq.${encodeURIComponent(agentUserId)}&status=in.(active,won,partial,lost,refunded)&select=*&order=created_at.desc&limit=200`,
    { headers: SB_READ, cache: "no-store" },
  );
  const bids = r.ok ? await r.json().catch(() => []) : [];

  // Side-load lots for display.
  const lotIds = Array.from(new Set((Array.isArray(bids) ? bids : []).map((b: any) => b.lot_id).filter(Boolean)));
  const lotById: Record<string, any> = {};
  if (lotIds.length) {
    try {
      const idIn = lotIds.map((i) => encodeURIComponent(i)).join(",");
      const lr = await fetch(`${SB_URL}/rest/v1/auction_lots?id=in.(${idIn})&select=id,category,city,month_key,metadata,min_bid_per_room_night&limit=300`, { headers: SB_READ, cache: "no-store" });
      if (lr.ok) { (await lr.json().catch(() => [])).forEach((l: any) => { lotById[l.id] = l; }); }
    } catch { /* best-effort */ }
  }
  const enriched = (Array.isArray(bids) ? bids : []).map((b: any) => ({ ...b, lot: lotById[b.lot_id] || null }));
  return NextResponse.json({ bids: enriched });
}
