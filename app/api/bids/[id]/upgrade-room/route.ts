import { NextRequest, NextResponse } from "next/server";
import { authUserId, sbSelect, sbUpdate } from "@/lib/sb-server";
import { isBidPayWindowOpen } from "@/lib/bid-expiry";

// v198 — Swap an ACCEPTED bid's roomId to a different room in the SAME
// hotel after the customer pays the delta. Customer is funnelled here
// from the "💎 Upgrade to {Room}" CTA on /hotels/[id] room cards when
// they have an active accepted bid on a different room of the same
// hotel. Razorpay charges only the delta × nights on the client; this
// route just records the swap + appends an audit note to the bid's
// message field.
//
// Contract:
//   - Customer must own the bid (customerId match)
//   - Bid must be ACCEPTED (no upgrades on PENDING/COUNTER/REJECTED)
//   - newRoomId must belong to the SAME hotel as the bid
//   - newAmount must be >= current amount (no downgrades via this route)
//
// What changes on success:
//   - bids.roomId   → newRoomId
//   - bids.amount   → newAmount (per-night)
//   - bids.message  → suffixed with `[Upgrade: <fromName> → <toName>;
//     delta ₹X paid via <paymentId>]` so partner panel + admin ledger
//     can see the trail in plain text
//
// Cross-surface sync: customer-side /my-bids polls /api/bids/my every
// 30 s; /hotels/[id] does the same; partner panel /api/partner/bids
// reads live from the same row. All three pick up the swap with no
// extra wiring.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const customerId = authUserId(req);
  if (!customerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const newRoomId = String(body?.newRoomId || "").trim();
  const newAmount = Number(body?.newAmount);
  const paymentId = String(body?.paymentId || "").trim();
  const deltaPaid = Number(body?.deltaPaid || 0);

  if (!newRoomId) return NextResponse.json({ error: "newRoomId required" }, { status: 400 });
  if (!Number.isFinite(newAmount) || newAmount <= 0) {
    return NextResponse.json({ error: "newAmount required" }, { status: 400 });
  }

  const bids = await sbSelect(`bids?id=eq.${id}&select=*`);
  const bid = bids[0];
  if (!bid) return NextResponse.json({ error: "Bid not found" }, { status: 404 });
  if (bid.customerId !== customerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (bid.status !== "ACCEPTED") {
    return NextResponse.json(
      { error: `Cannot upgrade a ${String(bid.status).toLowerCase()} bid` },
      { status: 400 }
    );
  }
  // v241.26 — defense-in-depth: never upgrade an ACCEPTED bid whose pay window
  // has closed. The upgrade only charges the delta and leaves the accepted
  // amount "due at My Bids"; if the window is shut that anchor can't be paid,
  // so the upgrade would strand the customer's delta payment. The client gates
  // this too (before Razorpay), so a 400 here only catches stale/ direct calls.
  if (!isBidPayWindowOpen(bid)) {
    return NextResponse.json(
      { error: "This bid's payment window has closed. Place a new bid to reserve the room." },
      { status: 400 }
    );
  }
  if (String(bid.roomId) === newRoomId) {
    return NextResponse.json({ error: "Already on this room" }, { status: 400 });
  }
  if (Number(bid.amount) > newAmount) {
    return NextResponse.json({ error: "newAmount cannot be lower than current accepted amount" }, { status: 400 });
  }

  // Verify the target room belongs to the SAME hotel as the bid.
  // v241 — also pull capacity + quantity for inventory + mismatch re-check.
  const targetRooms = await sbSelect(`rooms?id=eq.${newRoomId}&select=id,hotelId,name,type,floorPrice,capacity,quantity`);
  const targetRoom = targetRooms[0];
  if (!targetRoom) return NextResponse.json({ error: "Target room not found" }, { status: 404 });
  if (String(targetRoom.hotelId) !== String(bid.hotelId)) {
    return NextResponse.json({ error: "Room belongs to a different hotel" }, { status: 400 });
  }

  // v241 — preserve numRooms from the existing bid; re-validate inventory
  // + capacity against the new room. If the target category has fewer
  // units than the bid asks for, 409. Capacity mismatch flag re-derived.
  const existingNumRooms = Math.max(1, Math.min(10, Number(bid.numRooms || 1)));
  const targetQuantity = targetRoom.quantity == null ? null : Number(targetRoom.quantity);
  if (targetQuantity != null && existingNumRooms > targetQuantity) {
    return NextResponse.json(
      {
        error: `Upgrade room has only ${targetQuantity} unit${targetQuantity === 1 ? "" : "s"} — your bid needs ${existingNumRooms}.`,
        maxAvailable: targetQuantity,
      },
      { status: 409 }
    );
  }
  // Re-derive capacityMismatch from the existing bid's guests (joined
  // via bid_requests.guests since the bids row itself doesn't store guests).
  let upgradedCapacityMismatch = false;
  try {
    const req = bid.requestId
      ? await sbSelect(`bid_requests?id=eq.${bid.requestId}&select=guests`)
      : null;
    const guests = Math.max(1, Number(req?.[0]?.guests || 1));
    const cap = Number(targetRoom.capacity || 2);
    upgradedCapacityMismatch = guests > cap * existingNumRooms;
  } catch { /* non-blocking */ }

  // Best-effort source-room name (audit only).
  let fromName = "previous room";
  try {
    const src = await sbSelect(`rooms?id=eq.${bid.roomId}&select=name,type`);
    if (src[0]) fromName = src[0].name || src[0].type || fromName;
  } catch {}
  const toName = targetRoom.name || targetRoom.type || "upgraded room";

  const auditNote = ` [Upgrade: ${fromName} → ${toName}; delta ₹${deltaPaid} paid via ${paymentId || "wallet_only"}]`;
  const newMessage = String(bid.message || "") + auditNote;

  try {
    const updated = await sbUpdate(
      "bids",
      `id=eq.${id}`,
      {
        roomId: newRoomId,
        amount: newAmount,
        message: newMessage,
        // v241 — numRooms preserved verbatim; only capacityMismatch
        // re-derived against the new room.capacity.
        capacityMismatch: upgradedCapacityMismatch,
      }
    );
    return NextResponse.json({
      bid: updated,
      upgraded: true,
      fromRoomName: fromName,
      toRoomName: toName,
      deltaPaid,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Upgrade failed" }, { status: 500 });
  }
}
