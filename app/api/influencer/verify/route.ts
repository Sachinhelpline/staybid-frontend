import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" };

function decodeJwt(t: string) {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()); }
  catch { return null; }
}

// Marks aadhaar/pan verification flags. Real KYC integration is out of scope —
// this records the verification result coming from an upstream KYC provider
// (admin-triggered for now).
export async function POST(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = decodeJwt(token);
  if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const targetUserId = body.userId || payload.id;

  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  if (typeof body.aadhaarVerified === "boolean") updates.aadhaar_verified = body.aadhaarVerified;
  if (typeof body.panVerified === "boolean")     updates.pan_verified     = body.panVerified;
  if (typeof body.verificationTier === "number") updates.verification_tier = body.verificationTier;
  if (typeof body.status === "string")           updates.status            = body.status;

  const upd = await fetch(`${SB_URL}/rest/v1/influencers?user_id=eq.${encodeURIComponent(targetUserId)}`, {
    method: "PATCH", headers: SB_H, body: JSON.stringify(updates),
  });
  if (!upd.ok) return NextResponse.json({ error: "Verify failed", detail: await upd.text() }, { status: 500 });
  const row = await upd.json().catch(() => []);
  return NextResponse.json({ influencer: Array.isArray(row) ? row[0] : row, saved: true });
}
