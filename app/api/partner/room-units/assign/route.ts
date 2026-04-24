// Assign a specific room unit (numbered room) to a bid or walk-in block.
// Creates/updates the mapping row; does NOT modify existing bids/room_blocks data
// beyond setting the assignedUnitId/Number fields on room_blocks.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_H_REPRESENT, decodeJwt } from "@/lib/sb-server";

export const dynamic = "force-dynamic";

function auth(req: NextRequest): { userId?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub };
}

export async function POST(req: NextRequest) {
  const { userId } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const { bidId, blockId, unitId } = body;
  if (!unitId || (!bidId && !blockId)) {
    return NextResponse.json({ error: "unitId + (bidId|blockId) required" }, { status: 400 });
  }

  // Look up unit to get its number
  let unit: any = null;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/hotel_room_units?id=eq.${unitId}&select=*`, { headers: SB_H });
    const j = await r.json();
    unit = Array.isArray(j) ? j[0] : null;
  } catch {}
  if (!unit) return NextResponse.json({ error: "Unit not found" }, { status: 404 });

  try {
    if (bidId) {
      // Upsert bid_unit_assignments
      await fetch(`${SB_URL}/rest/v1/bid_unit_assignments?on_conflict=bidId`, {
        method: "POST",
        headers: { ...SB_H, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          bidId,
          unitId,
          unitNumber: unit.roomNumber,
          assignedBy: userId,
        }),
      });
    }
    if (blockId) {
      await fetch(`${SB_URL}/rest/v1/room_blocks?id=eq.${blockId}`, {
        method: "PATCH",
        headers: SB_H_REPRESENT,
        body: JSON.stringify({ assignedUnitId: unitId, assignedUnitNumber: unit.roomNumber }),
      });
    }
    return NextResponse.json({ ok: true, unit });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { userId } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const bidId = url.searchParams.get("bidId");
  const blockId = url.searchParams.get("blockId");
  if (!bidId && !blockId) return NextResponse.json({ error: "bidId|blockId required" }, { status: 400 });

  try {
    if (bidId) {
      await fetch(`${SB_URL}/rest/v1/bid_unit_assignments?bidId=eq.${bidId}`, {
        method: "DELETE", headers: SB_H,
      });
    }
    if (blockId) {
      await fetch(`${SB_URL}/rest/v1/room_blocks?id=eq.${blockId}`, {
        method: "PATCH",
        headers: SB_H,
        body: JSON.stringify({ assignedUnitId: null, assignedUnitNumber: null }),
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
