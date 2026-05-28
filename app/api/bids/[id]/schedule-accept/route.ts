// Schedule a bid for auto-acceptance after the tier-based delay window.
// Called after Razorpay succeeds for an above-floor bid. The cron + the
// /trigger-accept endpoint both flip status PENDING -> ACCEPTED once
// auto_accept_at is reached.
//
// POST /api/bids/:id/schedule-accept
//   body: { tier: "PREMIUM" | "STRONG" | "NORMAL" | "CAUTIOUS" | "LOWBALL" | "NEW",
//           autoAcceptMs: number  // explicit override from lib/bidder-score.ts }
//
// LOWBALL → auto_accept_at left NULL (manual hotel review).

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, userFromReq } from "@/lib/sb";

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = userFromReq(req);
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const bidId = params.id;
  if (!bidId) return NextResponse.json({ error: "bidId required" }, { status: 400 });

  try {
    const { tier, autoAcceptMs } = await req.json();
    if (!tier) return NextResponse.json({ error: "tier required" }, { status: 400 });

    // LOWBALL bids skip auto-accept entirely
    const patch: Record<string, any> = { bidder_tier: tier };
    if (tier !== "LOWBALL" && typeof autoAcceptMs === "number" && isFinite(autoAcceptMs)) {
      patch.auto_accept_at = new Date(Date.now() + autoAcceptMs).toISOString();
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
    return NextResponse.json({ ok: true, bid: (data as any[])[0] || null });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
