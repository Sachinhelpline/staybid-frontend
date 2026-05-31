// Schedule a bid for auto-acceptance after the tier-based delay window.
// Called after Razorpay succeeds for an above-floor Negotiate / simple Bid.
// The cron + the /trigger-accept endpoint both flip status PENDING -> ACCEPTED
// once auto_accept_at is reached.
//
// POST /api/bids/:id/schedule-accept
//   body: { tier?, autoAcceptMs? }   ← ADVISORY ONLY (legacy / UI hint)
//
// v248 — Server-side enforcement (tamper-proof). The route NO LONGER trusts
// the client-supplied tier / autoAcceptMs. It recomputes the customer's tier
// (loadServerScore) + reads the hotel's autopilot_mode (loadAutopilotMode) and
// runs resolveAutoAcceptMs — so a crafted request can't force an auto-accept on
// a Manual / Hybrid hotel. manual mode + hybrid-low-tier + LOWBALL history all
// resolve to Infinity → auto_accept_at left NULL → bid waits for the partner.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, userFromReq } from "@/lib/sb";
import { resolveAutoAcceptMs } from "@/lib/autopilot";
import { loadServerScore, loadAutopilotMode } from "@/lib/autopilot-server";

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = userFromReq(req);
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const bidId = params.id;
  if (!bidId) return NextResponse.json({ error: "bidId required" }, { status: 400 });

  try {
    // Read the bid (ownership + hotel) — never trust the body for these.
    const rRead = await fetch(
      `${SB_URL}/rest/v1/bids?id=eq.${encodeURIComponent(bidId)}&customerId=eq.${encodeURIComponent(user.id)}&select=id,hotelId,status`,
      { headers: SB_H, cache: "no-store" },
    );
    const rows = await rRead.json().catch(() => []);
    const theBid = (rows as any[])[0];
    if (!theBid) return NextResponse.json({ error: "Bid not found" }, { status: 404 });

    // Recompute tier + mode server-side (tamper-proof) and resolve the window.
    const score = await loadServerScore(user.id);
    const mode = await loadAutopilotMode(theBid.hotelId);
    const ms = resolveAutoAcceptMs(score.tier, score.autoAcceptMs, mode);

    const patch: Record<string, any> = { bidder_tier: score.tier };
    if (Number.isFinite(ms)) {
      patch.auto_accept_at = new Date(Date.now() + ms).toISOString();
    }

    const r = await fetch(
      `${SB_URL}/rest/v1/bids?id=eq.${encodeURIComponent(bidId)}&customerId=eq.${encodeURIComponent(user.id)}`,
      { method: "PATCH", headers: SB_H, body: JSON.stringify(patch) }
    );
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      return NextResponse.json({ error: d?.message || "Schedule failed" }, { status: 500 });
    }
    const data = await r.json().catch(() => []);
    return NextResponse.json({
      ok: true,
      tier: score.tier,
      mode,
      scheduled: Number.isFinite(ms),
      bid: (data as any[])[0] || null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
