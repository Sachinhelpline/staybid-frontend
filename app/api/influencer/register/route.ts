import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";


const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" };

function decodeJwt(t: string) {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()); }
  catch { return null; }
}

export async function POST(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = decodeJwt(token);
  // Accept both StayBid backend tokens (HS256, payload.id) AND Firebase
  // tokens (RS256, payload.sub / payload.user_id). Without this fallback,
  // every customer who logged in via Google/Facebook hit "Invalid token"
  // when trying to register on Creator Hub.
  const userId: string | undefined = payload?.id || payload?.user_id || payload?.sub;
  if (!userId) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const row = {
    user_id: userId,
    bio: body.bio || null,
    interests: Array.isArray(body.interests) ? body.interests : [],
    location: body.location || null,
    bank_account_number: body.bankAccountNumber || null,
    bank_name: body.bankName || null,
    ifsc_code: body.ifscCode || null,
    agreement_accepted: !!body.agreementAccepted,
    total_followers: Number(body.totalFollowers) || 0,
    status: "pending",
  };

  const existing = await fetch(`${SB_URL}/rest/v1/influencers?user_id=eq.${encodeURIComponent(userId)}&select=id`, { headers: SB_H })
    .then(r => r.json()).catch(() => []);
  if (Array.isArray(existing) && existing[0]) {
    const upd = await fetch(`${SB_URL}/rest/v1/influencers?id=eq.${existing[0].id}`, {
      method: "PATCH", headers: SB_H, body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
    }).then(r => r.json()).catch(() => null);
    return NextResponse.json({ influencer: Array.isArray(upd) ? upd[0] : upd, updated: true });
  }

  const ins = await fetch(`${SB_URL}/rest/v1/influencers`, { method: "POST", headers: SB_H, body: JSON.stringify(row) });
  if (!ins.ok) return NextResponse.json({ error: "Insert failed", detail: await ins.text() }, { status: 500 });
  const created = await ins.json().catch(() => null);
  const inf = Array.isArray(created) ? created[0] : created;

  if (inf?.id) {
    await fetch(`${SB_URL}/rest/v1/influencer_stats`, {
      method: "POST", headers: SB_H, body: JSON.stringify({ influencer_id: inf.id }),
    }).catch(() => {});
  }

  return NextResponse.json({ influencer: inf, created: true });
}
