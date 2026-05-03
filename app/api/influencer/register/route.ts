import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" };

function decodeJwt(t: string) {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()); }
  catch { return null; }
}

export async function POST(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = decodeJwt(token);
  if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const row = {
    user_id: payload.id,
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

  const existing = await fetch(`${SB_URL}/rest/v1/influencers?user_id=eq.${encodeURIComponent(payload.id)}&select=id`, { headers: SB_H })
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
