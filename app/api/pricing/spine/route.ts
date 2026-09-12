import { NextResponse } from "next/server";
import { resolveSpinePrices, resolveSpinePricesRange } from "@/lib/pricing/read-spine";

// ════════════════════════════════════════════════════════════════
// v166 Phase C — pricing-spine reader API.
//
// POST { roomIds: string[], date: "yyyy-mm-dd" }
//   → { prices: { [roomId]: { livePrice, bidFloor, flashPrice, ... } } }
//
// v750 (PRICE-CONSISTENCY-01) — BATCH variant (backward-compatible):
// POST { roomIds: string[], dates: string[] }
//   → { pricesByDate: { [date]: { [roomId]: { livePrice, demandScore, ... } } } }
// Lets the hotel-detail calendar read the SAME canonical spine livePrice for a
// whole month in ONE request (no per-day request storm). The single-`date`
// shape above is UNCHANGED — a caller that sends `date` (and no `dates[]`) gets
// byte-identical behaviour.
//
// The single endpoint client surfaces (/bid, hotel page, flash) call
// to get a room's spine price. Always 200 — on any failure it returns
// an empty map so the caller falls back to its own logic and nothing breaks.
// ════════════════════════════════════════════════════════════════
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const roomIds: string[] = Array.isArray(body?.roomIds)
      ? body.roomIds.filter((x: any) => typeof x === "string" && x).slice(0, 100)
      : [];

    // ── BATCH path: many dates in one call (calendar). Only taken when the
    //    caller explicitly sends a non-empty `dates[]`. ──────────────────────
    const dates: string[] = Array.isArray(body?.dates)
      ? body.dates.filter((x: any) => typeof x === "string" && x).slice(0, 62)
      : [];
    if (dates.length > 0) {
      if (roomIds.length === 0) return NextResponse.json({ pricesByDate: {}, dates });
      const pricesByDate = await resolveSpinePricesRange(roomIds, dates);
      return NextResponse.json({ pricesByDate, dates });
    }

    // ── SINGLE-date path (unchanged). ──────────────────────────────────────
    const date: string =
      String(body?.date || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
    if (roomIds.length === 0) return NextResponse.json({ prices: {}, date });
    const prices = await resolveSpinePrices(roomIds, date);
    return NextResponse.json({ prices, date });
  } catch (e: any) {
    return NextResponse.json({ prices: {}, error: e?.message || "spine error" });
  }
}
