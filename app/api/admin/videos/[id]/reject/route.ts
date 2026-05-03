import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" };

function decodeJwt(t: string) {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()); }
  catch { return null; }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  const payload = token ? decodeJwt(token) : null;
  const verifierId = payload?.id || "admin";

  const body = await req.json().catch(() => ({}));
  const reason = (body?.reason || "").toString().trim() || "Did not meet content guidelines";

  const upd = await fetch(`${SB_URL}/rest/v1/hotel_videos?id=eq.${encodeURIComponent(params.id)}`, {
    method: "PATCH", headers: SB_H,
    body: JSON.stringify({
      verification_status: "rejected",
      verified_by: verifierId,
      verified_at: new Date().toISOString(),
      rejection_reason: reason,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!upd.ok) return NextResponse.json({ error: "Reject failed", detail: await upd.text() }, { status: 500 });
  const row = await upd.json().catch(() => []);
  return NextResponse.json({ video: Array.isArray(row) ? row[0] : row, rejected: true });
}
