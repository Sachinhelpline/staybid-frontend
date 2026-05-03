import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

function decodeJwt(t: string) {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()); }
  catch { return null; }
}

export async function GET(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ influencer: null, registered: false });
  const payload = decodeJwt(token);
  if (!payload?.id) return NextResponse.json({ influencer: null, registered: false });

  const rows = await fetch(`${SB_URL}/rest/v1/influencers?user_id=eq.${encodeURIComponent(payload.id)}&select=*`, { headers: SB_H })
    .then(r => r.json()).catch(() => []);
  const inf = Array.isArray(rows) && rows[0] ? rows[0] : null;
  return NextResponse.json({ influencer: inf, registered: !!inf });
}
