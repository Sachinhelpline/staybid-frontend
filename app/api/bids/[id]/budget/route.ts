import { NextRequest, NextResponse } from "next/server";
import { authUserId, sbSelect, sbUpdate } from "@/lib/sb-server";

// Per-flow timers — must match /api/bids/place
const NEGOTIATE_MS = 3 * 3600_000;
const PLACE_MS     = 1 * 3600_000;
const ACCEPTED_PAY_MS = 15 * 60_000;
const expiresAtFor = (flow?: string) =>
  new Date(Date.now() + (flow === "place" ? PLACE_MS : NEGOTIATE_MS)).toISOString();
const acceptedExpiry = () => new Date(Date.now() + ACCEPTED_PAY_MS).toISOString();
const snap100 = (n: number) => Math.max(100, Math.round(n / 100) * 100);

// PATCH /api/bids/:id/budget — update the per-night amount on an active bid.
//
// v196 — when the bid is part of a /bid broadcast (flow="place" with a shared
// requestId), the update FANS OUT to every sibling bid the same customer
// placed under that requestId. Per hotel: amount = min(newBudget, room.mrp)
// clamped to room.floorPrice, snapped to ₹100. Sibling hotels whose floor
// fits inside the new budget AUTO-ACCEPT (status='ACCEPTED' + 15-min pay
// window) — same Sachin price-rule that /api/bids/place v196 wires at insert.
//
// Negotiate (single hotel) keeps single-bid update + COUNTER→PENDING reset.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const customerId = authUserId(req);
  if (!customerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const newBudget = Number(body?.amount);
  const flow = body?.flow as "place" | "negotiate" | undefined;
  if (!Number.isFinite(newBudget) || newBudget <= 0) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  const bids = await sbSelect(`bids?id=eq.${id}&select=*`);
  const source = bids[0];
  if (!source) return NextResponse.json({ error: "Bid not found" }, { status: 404 });
  if (source.customerId !== customerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!["PENDING", "COUNTER"].includes(source.status)) {
    return NextResponse.json(
      { error: `Cannot update a ${String(source.status).toLowerCase()} bid` },
      { status: 400 }
    );
  }

  // Fan-out scope. /bid broadcasts share one requestId across N hotels in the
  // same city — Sachin asked for "budget update sab jangha automatic". Update
  // every sibling that's still actionable (PENDING or COUNTER).
  const fanOut = flow === "place" && !!source.requestId;
  let siblings: any[] = [source];
  if (fanOut) {
    const all = await sbSelect(
      `bids?customerId=eq.${customerId}&requestId=eq.${source.requestId}&status=in.(PENDING,COUNTER)&select=*`
    );
    if (all.length) siblings = all;
  }

  const roomIds = Array.from(new Set(siblings.map((b: any) => b.roomId).filter(Boolean)));
  const rooms = roomIds.length
    ? await sbSelect(`rooms?id=in.(${roomIds.join(",")})&select=id,floorPrice,mrp`)
    : [];
  const roomById = new Map(rooms.map((r: any) => [r.id, r]));

  const updates: any[] = [];
  let autoAcceptedCount = 0;

  for (const b of siblings) {
    const room = roomById.get(b.roomId);
    const floor = Number(room?.floorPrice || 0);
    const mrp = Number(room?.mrp || newBudget * 2);

    // Per-hotel amount: ceiling at MRP, floor at room floor, snapped to ₹100.
    // For Negotiate (no fan-out) we honour newBudget verbatim — the customer's
    // intent is the absolute amount on a single bid.
    const desired = fanOut ? Math.min(newBudget, mrp) : newBudget;
    const newAmount = floor > 0
      ? Math.max(floor, snap100(desired))
      : snap100(desired);

    // Floor guard. For Negotiate, the floor was already enforced at place
    // time; we only ever clamp UP here. For /bid fan-out, if newBudget is
    // below this hotel's floor we leave that sibling at floor (it stays
    // PENDING — hotel still has the option to counter).
    if (floor && newAmount < floor) continue;

    const eligible = floor > 0 && newAmount >= floor;
    const willAutoAccept = fanOut && eligible;

    const patch: any = {
      amount: newAmount,
      expiresAt: willAutoAccept ? acceptedExpiry() : expiresAtFor(flow),
    };
    if (willAutoAccept) {
      patch.status = "ACCEPTED";
      patch.counterAmount = null;
    } else if (b.status === "COUNTER") {
      // COUNTER → PENDING re-pitch so the hotel re-evaluates the new amount.
      patch.status = "PENDING";
      patch.counterAmount = null;
    }

    try {
      const updated = await sbUpdate("bids", `id=eq.${b.id}`, patch);
      updates.push({
        bidId: b.id,
        hotelId: b.hotelId,
        amount: newAmount,
        status: patch.status || b.status,
        autoAccepted: willAutoAccept,
      });
      if (willAutoAccept) autoAcceptedCount++;
    } catch {
      // Skip individual failures so a single bad row doesn't kill the fan-out.
    }
  }

  return NextResponse.json({
    bids: updates,
    source: id,
    autoAcceptedCount,
    fanOut,
  });
}
