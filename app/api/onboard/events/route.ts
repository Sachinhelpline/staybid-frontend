import { NextResponse } from "next/server";
import { requireOnboardUser } from "@/lib/onboard/jwt";
import { sbInsert, sbSelect } from "@/lib/onboard/supabase-admin";

// POST /api/onboard/events  { event, hotel_id?, payload? } → audit log
// GET  /api/onboard/events?hotelId=... → recent events for this user/hotel
export async function POST(req: Request) {
  try {
    const claims = requireOnboardUser(req);
    const body = await req.json();
    if (!body.event) return NextResponse.json({ error: "event required" }, { status: 400 });
    const row = await sbInsert("onboarding_events", {
      user_id: claims.sub,
      hotel_id: body.hotel_id || null,
      agent_code: (claims as any).agentCode || null,
      event: String(body.event).slice(0, 80),
      payload: body.payload || null,
      ip_address: (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null,
      user_agent: req.headers.get("user-agent") || null,
    });
    return NextResponse.json({ ok: true, event: row });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "event log failed" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const claims = requireOnboardUser(req);
    const hotelId = new URL(req.url).searchParams.get("hotelId");
    let q = `user_id=eq.${claims.sub}&order=created_at.desc&limit=100`;
    if (hotelId) q = `hotel_id=eq.${encodeURIComponent(hotelId)}&order=created_at.desc&limit=100`;
    const rows = await sbSelect<any>("onboarding_events", q);
    return NextResponse.json({ events: rows });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "events fetch failed" }, { status: 500 });
  }
}
