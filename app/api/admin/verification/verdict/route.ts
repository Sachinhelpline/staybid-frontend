import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { requestId, verdict, notes, refundAmount } = body;

  if (!requestId || !verdict) {
    return NextResponse.json({ error: "requestId and verdict required" }, { status: 400 });
  }

  const patchRes = await fetch(`${SB_URL}/rest/v1/vp_requests?id=eq.${requestId}`, {
    method: "PATCH",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      status: verdict,
      adminNotes: notes || null,
      reviewedAt: new Date().toISOString(),
      refundAmount: refundAmount || 0,
    }),
  });

  const data = patchRes.ok ? await patchRes.json() : null;
  return NextResponse.json({ ok: patchRes.ok, request: data?.[0] || null });
}
