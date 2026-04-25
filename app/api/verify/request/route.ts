import { NextResponse } from "next/server";
import { sbInsert, sbSelect, sbUpdate, SB } from "@/lib/onboard/supabase-admin";
import { generateVerificationCode } from "@/lib/verify/codes";
import { durationForTier, normaliseTier, SLA_HOURS, Tier } from "@/lib/verify/tiers";

// POST /api/verify/request   { bookingId, bidId?, tier?, customerId, hotelId }
// Customer-initiated: creates a vp_request (or returns the existing pending one).
// Auth: caller must include `Authorization: Bearer <customer JWT>` (legacy
// Railway customer token works — we trust it; payload.id must match customerId).
function decodeJwt(t: string): any {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"), "base64").toString()); }
  catch { return null; }
}

export async function POST(req: Request) {
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const payload = decodeJwt(token);
    if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const body = await req.json();
    const { bookingId, bidId, hotelId } = body;
    if (!bookingId || !hotelId) return NextResponse.json({ error: "bookingId + hotelId required" }, { status: 400 });

    // Pull customer tier from users table (defaults to silver)
    let tier: Tier = "silver";
    try {
      const r = await fetch(`${SB.url}/rest/v1/users?id=eq.${payload.id}&select=tier`, { headers: { apikey: SB.key, Authorization: `Bearer ${SB.key}` } });
      const us = await r.json();
      if (Array.isArray(us) && us[0]?.tier) tier = normaliseTier(us[0].tier);
    } catch {}
    if (body.tier) tier = normaliseTier(body.tier); // explicit override

    // Reuse pending request if one exists (idempotent)
    const existing = await sbSelect<any>(
      "vp_requests",
      `booking_id=eq.${encodeURIComponent(bookingId)}&customer_id=eq.${payload.id}&status=in.(pending,uploaded)&order=created_at.desc&limit=1`
    );
    if (existing[0]) {
      return NextResponse.json({ request: existing[0], existed: true });
    }

    const code = generateVerificationCode();
    const requiredSecs = durationForTier(tier);
    const dueBy = new Date(Date.now() + SLA_HOURS[tier] * 3600_000).toISOString();

    const row = await sbInsert("vp_requests", {
      booking_id: bookingId,
      bid_id: bidId || null,
      hotel_id: hotelId,
      customer_id: payload.id,
      tier,
      required_secs: requiredSecs,
      verification_code: code,
      status: "pending",
      due_by: dueBy,
    });
    return NextResponse.json({ request: row });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "request failed" }, { status: 500 });
  }
}
