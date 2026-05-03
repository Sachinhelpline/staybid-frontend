import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ, userFromReq } from "@/lib/sb";

// Attributes an existing bid_request to an influencer via referral code.
// Idempotent: only writes if bid_requests.influencer_id is currently null.
// Frontend calls this immediately after createBidRequest if a referral cookie
// is present.
export async function POST(req: NextRequest) {
  const u = userFromReq(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const requestId = String(body?.requestId || "").trim();
  const code      = String(body?.code || "").trim();
  if (!requestId || !code) return NextResponse.json({ error: "requestId and code required" }, { status: 400 });

  const codeRows = await fetch(
    `${SB_URL}/rest/v1/influencer_referral_codes?code=eq.${encodeURIComponent(code)}&select=id,influencer_id`,
    { headers: SB_READ }
  ).then(r => r.json()).catch(() => []);
  const codeRow = Array.isArray(codeRows) && codeRows[0] ? codeRows[0] : null;
  if (!codeRow) return NextResponse.json({ error: "Unknown code" }, { status: 404 });

  const cur = await fetch(
    `${SB_URL}/rest/v1/bid_requests?id=eq.${encodeURIComponent(requestId)}&select=id,influencer_id,customerId`,
    { headers: SB_READ }
  ).then(r => r.json()).catch(() => []);
  const reqRow = Array.isArray(cur) && cur[0] ? cur[0] : null;
  if (!reqRow) return NextResponse.json({ error: "bid_request not found" }, { status: 404 });
  if (reqRow.influencer_id) {
    return NextResponse.json({ alreadyAttributed: true, influencerId: reqRow.influencer_id });
  }

  await fetch(`${SB_URL}/rest/v1/bid_requests?id=eq.${encodeURIComponent(requestId)}`, {
    method: "PATCH", headers: SB_H, body: JSON.stringify({ influencer_id: codeRow.influencer_id }),
  }).catch(() => {});

  await fetch(`${SB_URL}/rest/v1/referral_events`, {
    method: "POST", headers: SB_H,
    body: JSON.stringify({
      code, influencer_id: codeRow.influencer_id,
      event_type: "bid", user_id: u.id,
      target_type: "bid_request", target_id: requestId,
    }),
  }).catch(() => {});

  // Bump conversions counter (read-then-write — Supabase REST has no atomic increment)
  const cnt = await fetch(`${SB_URL}/rest/v1/influencer_referral_codes?id=eq.${codeRow.id}&select=conversions_count`, { headers: SB_READ })
    .then(r => r.json()).catch(() => []);
  const cur2 = Array.isArray(cnt) && cnt[0] ? Number(cnt[0].conversions_count || 0) : 0;
  await fetch(`${SB_URL}/rest/v1/influencer_referral_codes?id=eq.${codeRow.id}`, {
    method: "PATCH", headers: SB_H, body: JSON.stringify({ conversions_count: cur2 + 1 }),
  }).catch(() => {});

  return NextResponse.json({ attributed: true, influencerId: codeRow.influencer_id });
}
