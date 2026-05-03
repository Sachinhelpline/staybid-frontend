import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ, userFromReq } from "@/lib/sb";

// Records a click/signup/bid event for a referral code AND increments the
// denormalised counter on influencer_referral_codes. Public — accepts anon
// users (the user_id is null for them).
export async function POST(req: NextRequest) {
  const u = userFromReq(req);
  const body = await req.json().catch(() => ({}));
  const code = String(body?.code || "").trim();
  const event_type = String(body?.eventType || "click").trim();
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });

  const codeRows = await fetch(
    `${SB_URL}/rest/v1/influencer_referral_codes?code=eq.${encodeURIComponent(code)}&select=id,influencer_id,clicks_count,conversions_count`,
    { headers: SB_READ }
  ).then(r => r.json()).catch(() => []);
  const codeRow = Array.isArray(codeRows) && codeRows[0] ? codeRows[0] : null;
  if (!codeRow) return NextResponse.json({ error: "Unknown code" }, { status: 404 });

  await fetch(`${SB_URL}/rest/v1/referral_events`, {
    method: "POST", headers: SB_H,
    body: JSON.stringify({
      code,
      influencer_id: codeRow.influencer_id,
      event_type,
      user_id: u?.id || null,
      target_type: body.targetType || null,
      target_id: body.targetId || null,
      ip: req.headers.get("x-forwarded-for") || null,
      user_agent: req.headers.get("user-agent") || null,
    }),
  }).catch(() => {});

  // Bump counters
  const updates: any = {};
  if (event_type === "click")               updates.clicks_count      = (codeRow.clicks_count || 0) + 1;
  if (event_type === "bid" || event_type === "booking") updates.conversions_count = (codeRow.conversions_count || 0) + 1;

  if (Object.keys(updates).length) {
    await fetch(`${SB_URL}/rest/v1/influencer_referral_codes?id=eq.${codeRow.id}`, {
      method: "PATCH", headers: SB_H, body: JSON.stringify(updates),
    }).catch(() => {});
  }

  return NextResponse.json({ tracked: true, eventType: event_type, influencerId: codeRow.influencer_id });
}
