// Flash deal upgrade: extra rooms and/or extra nights beyond the 1-room/1-night default.
//
// GET  → live availability check: returns { unitsTotal, unitsFree, feasible, needsApproval }
//        for a roomId across [fromDate, toDate).
// POST → actually reserves the extra scope. If enough units are free, auto-creates
//        room_blocks at the multiplied flash price (source='manual', note='Flash upgrade').
//        If not, still writes a PENDING room_block so the hotel owner sees the request
//        in their dashboard and can approve/deny.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, decodeJwt } from "@/lib/sb-server";
import { getOccupations } from "@/lib/availability";

export const dynamic = "force-dynamic";

function auth(req: NextRequest): { userId?: string; phone?: string; name?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub, phone: p?.phone, name: p?.name };
}

async function checkFeasibility(params: { hotelId: string; roomId: string; fromDate: string; toDate: string; wantedQty: number }) {
  const { hotelId, roomId, fromDate, toDate, wantedQty } = params;
  // 1) Pull total physical units in this room category
  let unitsTotal = 0;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/hotel_room_units?hotelId=eq.${hotelId}&roomId=eq.${roomId}&status=eq.active&select=id`,
      { headers: SB_H }
    );
    const j = await r.json();
    unitsTotal = Array.isArray(j) ? j.length : 0;
  } catch {}

  // 2) Count occupied units in the window (each occupation takes 1 unit — per-unit tracking)
  const occs = await getOccupations({ hotelId, roomId, from: fromDate, to: toDate });
  const occupiedUnits = new Set(occs.map(o => o.assignedUnitId).filter(Boolean));
  // If occs exist without unit assignment, conservatively treat each as 1 unit used
  const unassignedOccs = occs.filter(o => !o.assignedUnitId).length;
  const used = occupiedUnits.size + unassignedOccs;

  const unitsFree = Math.max(0, unitsTotal - used);
  return {
    unitsTotal,
    unitsFree,
    feasible: unitsFree >= wantedQty,
    needsApproval: unitsFree < wantedQty,
  };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const hotelId  = url.searchParams.get("hotelId");
  const roomId   = url.searchParams.get("roomId");
  const fromDate = url.searchParams.get("fromDate");
  const toDate   = url.searchParams.get("toDate");
  const qty      = Math.max(1, parseInt(url.searchParams.get("qty") || "1", 10));
  if (!hotelId || !roomId || !fromDate || !toDate) {
    return NextResponse.json({ error: "hotelId, roomId, fromDate, toDate required" }, { status: 400 });
  }
  try {
    const r = await checkFeasibility({ hotelId, roomId, fromDate, toDate, wantedQty: qty });
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "availability check failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { userId, phone, name } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const { hotelId, roomId, fromDate, toDate, qty, pricePerNight, guestName, guestPhone, note, razorpayPaymentId } = body;
  if (!hotelId || !roomId || !fromDate || !toDate || !qty) {
    return NextResponse.json({ error: "hotelId, roomId, fromDate, toDate, qty required" }, { status: 400 });
  }

  try {
    const feas = await checkFeasibility({ hotelId, roomId, fromDate, toDate, wantedQty: Number(qty) });

    // Each extra room becomes its own room_block row (keeps inventory math honest).
    // source='manual' + note encodes whether it's auto-approved or pending owner review.
    const rows: any[] = [];
    for (let i = 0; i < Number(qty); i++) {
      rows.push({
        hotelId, roomId, fromDate, toDate,
        source: "manual",
        guestName: guestName || name || "Flash deal guest",
        guestPhone: guestPhone || phone || null,
        amount: pricePerNight != null ? Number(pricePerNight) : null,
        note: feas.feasible
          ? `Flash deal upgrade · ${qty} room(s) · auto-approved${razorpayPaymentId ? ` · Razorpay: ${razorpayPaymentId}` : ""}`
          : `PENDING APPROVAL · Flash deal upgrade · ${qty} room(s) requested · ${note || ""}${razorpayPaymentId ? ` · Razorpay: ${razorpayPaymentId}` : ""}`,
        createdBy: userId,
      });
    }

    const r = await fetch(`${SB_URL}/rest/v1/room_blocks`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify(rows),
    });
    const inserted = await r.json();
    if (!r.ok) throw new Error(typeof inserted === "string" ? inserted : inserted?.message || "Insert failed");

    return NextResponse.json({
      ok: true,
      autoApproved: feas.feasible,
      needsApproval: feas.needsApproval,
      unitsFree: feas.unitsFree,
      unitsTotal: feas.unitsTotal,
      blocks: inserted,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "upgrade failed" }, { status: 500 });
  }
}
