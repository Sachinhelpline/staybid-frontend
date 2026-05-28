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

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
      `${SB_URL}/rest/v1/bids?id=eq.${encodeURIComponent(bidId)}&status=eq.PENDING&select=*`,
      { method: "PATCH", headers: SB_H, body: JSON.stringify({ status: "ACCEPTED" }) }
    );
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      return NextResponse.json({ error: d?.message || "Update failed" }, { status: 500 });
    }
    const updated = ((await r.json().catch(() => [])) as any[])[0];

    // Phase 7: fire confirmation email asynchronously. Best-effort —
    // failure doesn't block the accept.
    (async () => {
      try {
        const rUser = await fetch(
          `${SB_URL}/rest/v1/users?id=eq.${encodeURIComponent(user.id)}&select=email,name,phone`,
          { headers: SB_READ }
        );
        const userRow = ((await rUser.json().catch(() => [])) as any[])[0];
        if (!userRow?.email || !updated) return;

        const rHotel = await fetch(
          `${SB_URL}/rest/v1/hotels?id=eq.${encodeURIComponent(updated.hotelId)}&select=name,city`,
          { headers: SB_READ }
        );
        const hotel = ((await rHotel.json().catch(() => [])) as any[])[0];

        const rRoom = await fetch(
          `${SB_URL}/rest/v1/rooms?id=eq.${encodeURIComponent(updated.roomId)}&select=type,name`,
          { headers: SB_READ }
        );
        const room = ((await rRoom.json().catch(() => [])) as any[])[0];

        const rReq = await fetch(
          `${SB_URL}/rest/v1/bid_requests?id=eq.${encodeURIComponent(updated.requestId || "")}&select=checkIn,checkOut,guests`,
          { headers: SB_READ }
        );
        const reqRow = ((await rReq.json().catch(() => [])) as any[])[0];

        const checkIn  = reqRow?.checkIn  || new Date().toISOString();
        const checkOut = reqRow?.checkOut || new Date(Date.now() + 86400000).toISOString();
        const nights   = Math.max(1, Math.ceil((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000));

        const origin = req.nextUrl?.origin || "https://www.staybids.in";
        await fetch(`${origin}/api/email/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: userRow.email,
            bookingDetails: {
              bookingId: updated.id,
              hotelName: hotel?.name || "Your hotel",
              roomType:  room?.name || room?.type || "Room",
              checkIn, checkOut,
              guests: reqRow?.guests || 2,
              nights,
              amount: Number(updated.amount || 0) * nights,
              city: hotel?.city,
            },
          }),
        });
      } catch { /* fire-and-forget */ }
    })();

    return NextResponse.json({ ok: true, bid: updated || null });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
