import { NextResponse } from "next/server";
import { requireOnboardUser } from "@/lib/onboard/jwt";
import { sbInsert, sbSelect } from "@/lib/onboard/supabase-admin";
import { CONSENT_ITEMS, REQUIRED_CONSENT_KEYS, CURRENT_VERSION, type ConsentKey } from "@/lib/onboard/legal";

// GET  /api/onboard/consents?hotelId=... → latest grant state per consent_key
// POST /api/onboard/consents             → append consent grants (ledger)
//        Body: { hotel_id?, consents: { [key]: boolean } }
export async function GET(req: Request) {
  try {
    const claims = requireOnboardUser(req);
    const hotelId = new URL(req.url).searchParams.get("hotelId");
    let q = `user_id=eq.${claims.sub}&order=created_at.desc&limit=200`;
    if (hotelId) q = `user_id=eq.${claims.sub}&hotel_id=eq.${encodeURIComponent(hotelId)}&order=created_at.desc&limit=200`;
    const rows = await sbSelect<any>("onboarding_consents", q);
    // collapse to latest state per key
    const latest: Record<string, boolean> = {};
    for (const r of rows) if (!(r.consent_key in latest)) latest[r.consent_key] = !!r.granted;
    const allRequiredGranted = REQUIRED_CONSENT_KEYS.every((k) => latest[k] === true);
    return NextResponse.json({ items: CONSENT_ITEMS, state: latest, allRequiredGranted, version: CURRENT_VERSION });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "consents fetch failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const claims = requireOnboardUser(req);
    const body = await req.json();
    const consents = (body.consents || {}) as Record<string, boolean>;
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
    const ua = req.headers.get("user-agent") || null;

    const validKeys = new Set(CONSENT_ITEMS.map((c) => c.key));
    const rows: any[] = [];
    for (const [key, granted] of Object.entries(consents)) {
      if (!validKeys.has(key as ConsentKey)) continue;
      rows.push({
        user_id: claims.sub,
        hotel_id: body.hotel_id || null,
        consent_key: key,
        granted: !!granted,
        version: CURRENT_VERSION,
        ip_address: ip,
        user_agent: ua,
      });
    }
    for (const r of rows) { try { await sbInsert("onboarding_consents", r); } catch {} }

    const missing = REQUIRED_CONSENT_KEYS.filter((k) => consents[k] !== true);
    return NextResponse.json({ ok: missing.length === 0, recorded: rows.length, missingRequired: missing });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "auth required" }, { status: 401 });
    return NextResponse.json({ error: e?.message || "consents save failed" }, { status: 500 });
  }
}
