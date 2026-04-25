// POST /api/events/track
// Fire-and-forget analytics sink. Accepts an array of event objects so clients
// can batch via sendBeacon on page-unload without blocking.
//
// Events map to the discovery funnel:
//   app_open | hotel_view | swipe_next | swipe_detail | dwell |
//   click_book | click_bid | booking_success | mode_toggle
//
// Writes to `app_events` if the table exists; otherwise silently no-ops.
// This keeps the client code identical whether analytics is wired up or not,
// and lets us flip on the table without redeploying.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, authPayload } from "@/lib/sb-server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch {}
  const events = Array.isArray(body?.events) ? body.events : [];
  if (events.length === 0) return NextResponse.json({ ok: true, count: 0 });

  const payload = authPayload(req);
  const userId = payload?.id || payload?.user_id || payload?.sub || null;
  const ua = req.headers.get("user-agent") || "";
  const now = new Date().toISOString();

  const rows = events.slice(0, 50).map((e: any) => ({
    id: `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    userId: userId || null,
    sessionId: String(e.sessionId || ""),
    type: String(e.type || "unknown").slice(0, 40),
    hotelId: e.hotelId || null,
    roomId: e.roomId || null,
    meta: e.meta && typeof e.meta === "object" ? e.meta : null,
    ua,
    createdAt: e.ts || now,
  }));

  // Best-effort insert — missing table isn't fatal
  try {
    await fetch(`${SB_URL}/rest/v1/app_events`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "return=minimal" },
      body: JSON.stringify(rows),
    });
  } catch {}
  return NextResponse.json({ ok: true, count: rows.length });
}
