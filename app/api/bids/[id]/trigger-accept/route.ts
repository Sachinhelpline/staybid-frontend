// Client-side trigger for auto-accept — fires when the customer is
// watching the countdown on /my-bids and the timer hits 0. Validates
// that the bid is past its auto_accept_at and still PENDING before
// flipping to ACCEPTED. Idempotent — running it twice is a no-op.
//
// This complements the 5-min Vercel Cron — worst case the cron picks
// up missed bids, but premium bidders see "Auto-confirmed!" within 1s
// of the timer hitting 0 on their own tab.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ, userFromReq } from "@/lib/sb";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = userFromReq(req);
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const bidId = params.id;
  if (!bidId) return NextResponse.json({ error: "bidId required" }, { status: 400 });

  try {
    // Read the bid to validate eligibility
    const readUrl = `${SB_URL}/rest/v1/bids?id=eq.${encodeURIComponent(bidId)}&customerId=eq.${encodeURIComponent(user.id)}&select=id,status,auto_accept_at,bidder_tier`;
    const rRead = await fetch(readUrl, { headers: SB_READ });
    const rows = await rRead.json().catch(() => []);
    const bid = (rows as any[])[0];
    if (!bid) return NextResponse.json({ error: "Bid not found" }, { status: 404 });
    if (bid.status !== "PENDING") {
      return NextResponse.json({ ok: true, idempotent: true, status: bid.status });
    }
    if (!bid.auto_accept_at) {
      return NextResponse.json({ error: "Bid not eligible for auto-accept" }, { status: 400 });
    }
    if (new Date(bid.auto_accept_at).getTime() > Date.now()) {
      return NextResponse.json({ error: "Auto-accept window not reached yet" }, { status: 409 });
    }

    // Flip to ACCEPTED
    const r = await fetch(
      `${SB_URL}/rest/v1/bids?id=eq.${encodeURIComponent(bidId)}&status=eq.PENDING`,
      { method: "PATCH", headers: SB_H, body: JSON.stringify({ status: "ACCEPTED" }) }
    );
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      return NextResponse.json({ error: d?.message || "Update failed" }, { status: 500 });
    }
    const data = await r.json().catch(() => []);
    return NextResponse.json({ ok: true, bid: (data as any[])[0] || null });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
