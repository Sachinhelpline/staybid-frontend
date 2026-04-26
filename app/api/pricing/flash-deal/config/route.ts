import { NextResponse } from "next/server";
import { sbUpdate } from "@/lib/onboard/supabase-admin";

// POST /api/pricing/flash-deal/config
//   { dealId, dropIntervalMins?, dropAmount?, riseTriggerPct?, startPrice? }
// Hotel-only: configure auto-drop / auto-rise behaviour for an existing deal.
function decodeJwt(t: string): any {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"), "base64").toString()); }
  catch { return null; }
}

export async function POST(req: Request) {
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const payload = decodeJwt(token);
    if (!payload?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json();
    if (!body.dealId) return NextResponse.json({ error: "dealId required" }, { status: 400 });
    const patch: any = { last_drop_at: new Date().toISOString() };
    if (body.dropIntervalMins) patch.drop_interval_mins = Number(body.dropIntervalMins);
    if (body.dropAmount)       patch.drop_amount        = Number(body.dropAmount);
    if (body.riseTriggerPct)   patch.rise_trigger_pct   = Number(body.riseTriggerPct);
    if (body.startPrice)       patch.start_price        = Number(body.startPrice);
    const upd = await sbUpdate("flash_deals", `id=eq.${body.dealId}`, patch);
    return NextResponse.json({ deal: Array.isArray(upd) ? upd[0] : upd });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "config failed" }, { status: 500 });
  }
}
