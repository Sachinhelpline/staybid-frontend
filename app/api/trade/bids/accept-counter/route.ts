// v374 — Model 3 LIVE mode: agent ACCEPTS the owner's counter offer. The bid
// must be 'countered' with a counter_per_room_per_night ≥ floor. We re-price the
// bid at the counter (tamper-safe — the price comes from the bid row the owner
// set, never the client), flip it to 'accepted', open a fresh pay window, and
// mint the award so the agent can pay via the existing awards/pay path.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";
import { requireApprovedAgent } from "@/lib/trade/auth";
import { resolveAuctionConfig } from "@/lib/trade/config";
import { livePayDeadline } from "@/lib/trade/live-auction";
import { createLiveAward } from "@/lib/trade/live-award";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const gate = await requireApprovedAgent(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const agentUserId = gate.auth.user.id;

  let body: any = {};
  try { body = await req.json(); } catch {}
  const bidId = String(body.bidId || "").trim();
  if (!bidId) return NextResponse.json({ error: "bidId required." }, { status: 400 });

  const bidR = await fetch(`${SB_URL}/rest/v1/auction_bids?id=eq.${encodeURIComponent(bidId)}&select=*&limit=1`, { headers: SB_READ, cache: "no-store" });
  const [bid] = bidR.ok ? await bidR.json().catch(() => []) : [];
  if (!bid) return NextResponse.json({ error: "Bid not found." }, { status: 404 });
  if (bid.agent_user_id !== agentUserId) return NextResponse.json({ error: "Not your bid." }, { status: 403 });
  if (bid.status !== "countered") return NextResponse.json({ error: `Bid is ${bid.status}.` }, { status: 409 });

  const lotR = await fetch(`${SB_URL}/rest/v1/auction_lots?id=eq.${encodeURIComponent(bid.lot_id)}&select=*&limit=1`, { headers: SB_READ, cache: "no-store" });
  const [lot] = lotR.ok ? await lotR.json().catch(() => []) : [];
  if (!lot || lot.sale_mode !== "live") return NextResponse.json({ error: "Lot not found or not live." }, { status: 404 });
  if (lot.status !== "open" || new Date(lot.window_close_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: "Bidding has closed for this lot." }, { status: 409 });
  }

  const counter = Math.round(Number(bid.counter_per_room_per_night) || 0);
  const floor = Number(lot.min_bid_per_room_night) || 0;
  if (counter < floor || counter <= 0) return NextResponse.json({ error: "Counter offer is no longer valid." }, { status: 409 });

  const rooms = Math.max(1, Math.round(Number(bid.rooms_wanted) || 1));
  const nights = Math.max(1, Math.round(Number(bid.nights) || 1));
  const perRoomBid = counter * nights;
  const baseTotal = perRoomBid * rooms;

  const cfg = await resolveAuctionConfig();
  const payDeadlineIso = livePayDeadline(Date.now(), cfg.livePayWindowHours);

  // 3-key guard flip (id + agent + status=countered) — re-price at the counter.
  const r = await fetch(
    `${SB_URL}/rest/v1/auction_bids?id=eq.${encodeURIComponent(bidId)}&agent_user_id=eq.${encodeURIComponent(agentUserId)}&status=eq.countered`,
    { method: "PATCH", headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify({
        status: "accepted", per_room_per_night: counter, per_room_bid: perRoomBid,
        accepted_at: new Date().toISOString(), pay_deadline_at: payDeadlineIso, decided_by: "agent_counter_accept",
        metadata: { ...(bid.metadata || {}), base_total: baseTotal, counter_accepted: true },
        updated_at: new Date().toISOString(),
      }) },
  );
  const rows = r.ok ? await r.json().catch(() => []) : [];
  const accepted = Array.isArray(rows) ? rows[0] : null;
  if (!accepted) return NextResponse.json({ ok: true, alreadyProcessed: true });

  let awardId: string | null = null;
  try { const award = await createLiveAward(accepted, lot, cfg); awardId = award?.id || null; }
  catch { /* best-effort */ }

  return NextResponse.json({ ok: true, status: "accepted", awardId, payDeadlineAt: payDeadlineIso });
}
