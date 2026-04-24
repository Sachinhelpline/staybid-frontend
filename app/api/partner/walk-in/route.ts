// Partner creates a walk-in booking (customer who walks in without online reservation).
// Inserts into room_blocks with source='walk_in'. Immediately blocks the room dates
// across the entire system (customer hotel page, availability API, calendar).
import { NextRequest, NextResponse } from "next/server";
import { sbInsert, decodeJwt, SB_URL, SB_H } from "@/lib/sb-server";

export const dynamic = "force-dynamic";

function auth(req: NextRequest): { userId?: string; phone?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub, phone: p?.phone || req.headers.get("x-phone") || "" };
}

export async function POST(req: NextRequest) {
  const { userId } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}

  const { hotelId, roomId, fromDate, toDate, guestName, guestPhone, guestEmail, amount, note, assignedUnitId, assignedUnitNumber } = body;
  if (!hotelId || !roomId || !fromDate || !toDate) {
    return NextResponse.json({ error: "hotelId, roomId, fromDate, toDate required" }, { status: 400 });
  }
  if (toDate <= fromDate) {
    return NextResponse.json({ error: "toDate must be after fromDate" }, { status: 400 });
  }

  try {
    const row = await sbInsert("room_blocks", {
      hotelId, roomId,
      fromDate, toDate,
      source: "walk_in",
      guestName: guestName || "Walk-in guest",
      guestPhone: guestPhone || null,
      guestEmail: guestEmail || null,
      amount: amount != null ? Number(amount) : null,
      note: note || null,
      createdBy: userId,
      assignedUnitId: assignedUnitId || null,
      assignedUnitNumber: assignedUnitNumber || null,
    });
    return NextResponse.json({ ok: true, block: row });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to create walk-in" }, { status: 500 });
  }
}

// Cancel a walk-in (or any block)
export async function DELETE(req: NextRequest) {
  const { userId } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    const r = await fetch(`${SB_URL}/rest/v1/room_blocks?id=eq.${id}`, { method: "DELETE", headers: SB_H });
    if (!r.ok) throw new Error(await r.text());
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to cancel" }, { status: 500 });
  }
}
