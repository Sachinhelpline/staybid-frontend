import { NextResponse } from "next/server";
import { routeBid } from "@/lib/pricing/router";

// POST /api/pricing/bid-route
//   { bidId, hotelId, roomId, bidAmount, bookingId? }
// Returns the routing decision + a humanising delay the client should respect
// before showing "Hotel accepted" / "Waiting for hotel" — never reveals the
// floor price or the underlying logic to the customer.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.bidId || !body.hotelId || !body.roomId || body.bidAmount == null) {
      return NextResponse.json({ error: "bidId, hotelId, roomId, bidAmount required" }, { status: 400 });
    }
    const r = await routeBid({
      bidId: body.bidId,
      bookingId: body.bookingId,
      hotelId: body.hotelId,
      roomId: body.roomId,
      bidAmount: Number(body.bidAmount),
    });
    // Strip floor_price from the response — the caller is the customer side.
    const { floorPrice: _f, ...safe } = r as any;
    return NextResponse.json({
      decision: safe.decision,
      humanDelayMs: safe.humanDelayMs,
      // Customer-facing copy only — no AI/floor mention.
      customerMessage: safe.decision === "auto_accept"
        ? "Hotel ne aapki booking accept kar li! 🎉"
        : "Waiting for hotel confirmation…",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "route failed" }, { status: 500 });
  }
}
