import { NextResponse } from "next/server";
import { resolveSpinePrices } from "@/lib/pricing/read-spine";

// ════════════════════════════════════════════════════════════════
// v166 Phase C — pricing-spine reader API.
//
// POST { roomIds: string[], date: "yyyy-mm-dd" }
//   → { prices: { [roomId]: { livePrice, bidFloor, flashPrice, ... } } }
//
// The single endpoint client surfaces (/bid, hotel page, flash) call
// to get a room's spine price. Always 200 — on any failure it returns
// an empty `prices` map so the caller falls back to its own logic and
// nothing breaks.
// ════════════════════════════════════════════════════════════════
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const roomIds: string[] = Array.isArray(body?.roomIds)
      ? body.roomIds.filter((x: any) => typeof x === "string" && x).slice(0, 100)
      : [];
    const date: string =
      String(body?.date || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
    if (roomIds.length === 0) return NextResponse.json({ prices: {}, date });
    const prices = await resolveSpinePrices(roomIds, date);
    return NextResponse.json({ prices, date });
  } catch (e: any) {
    return NextResponse.json({ prices: {}, error: e?.message || "spine error" });
  }
}
