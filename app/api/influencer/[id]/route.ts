import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" };

function decodeJwt(t: string) {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()); }
  catch { return null; }
}

// `id` here can be either the influencer row id (`inf_...`) or the user_id.
async function findOne(id: string) {
  const byId = await fetch(`${SB_URL}/rest/v1/influencers?id=eq.${encodeURIComponent(id)}&select=*`, { headers: SB_H })
    .then(r => r.json()).catch(() => []);
  if (Array.isArray(byId) && byId[0]) return byId[0];
  const byUser = await fetch(`${SB_URL}/rest/v1/influencers?user_id=eq.${encodeURIComponent(id)}&select=*`, { headers: SB_H })
    .then(r => r.json()).catch(() => []);
  return Array.isArray(byUser) ? byUser[0] : null;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const inf = await findOne(params.id);
  if (!inf) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ influencer: inf });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = decodeJwt(token);
  if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const inf = await findOne(params.id);
  if (!inf) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (inf.user_id !== payload.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const map: Record<string, string> = {
    bio: "bio",
    interests: "interests",
    location: "location",
    bankAccountNumber: "bank_account_number",
    bankName: "bank_name",
    ifscCode: "ifsc_code",
    totalFollowers: "total_followers",
    agreementAccepted: "agreement_accepted",
  };
  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  for (const [k, col] of Object.entries(map)) {
    if (body[k] !== undefined) updates[col] = body[k];
  }

  const upd = await fetch(`${SB_URL}/rest/v1/influencers?id=eq.${inf.id}`, {
    method: "PATCH", headers: SB_H, body: JSON.stringify(updates),
  });
  if (!upd.ok) return NextResponse.json({ error: "Update failed", detail: await upd.text() }, { status: 500 });
  const row = await upd.json().catch(() => []);
  return NextResponse.json({ influencer: Array.isArray(row) ? row[0] : row, saved: true });
}
