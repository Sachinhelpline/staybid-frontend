import { NextRequest, NextResponse } from "next/server";

const RAILWAY = "https://staybid-live-production.up.railway.app";
const SB_URL  = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
const SB_H    = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" };

function decodeJwt(t: string) {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"), "base64").toString()); }
  catch { return null; }
}

// POST /api/partner/bids/:id — body: { action: "accept"|"counter"|"reject", counterAmount?, message? }
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = decodeJwt(token);
  if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const { action, counterAmount, message } = await req.json();
  const bidId = params.id;

  // Try Railway first
  try {
    const endpoint = action === "accept" ? "accept" : action === "counter" ? "counter" : "reject";
    const body = action === "counter"
      ? JSON.stringify({ counterAmount: parseFloat(counterAmount), message })
      : message ? JSON.stringify({ message }) : "{}";

    const res = await fetch(`${RAILWAY}/api/bids/${bidId}/${endpoint}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return NextResponse.json(await res.json());
  } catch { /* fall through */ }

  // Fallback: Supabase direct update
  const statusMap: Record<string, string> = { accept: "ACCEPTED", counter: "COUNTER", reject: "REJECTED" };
  const updateData: Record<string, any> = { status: statusMap[action] || "PENDING" };
  if (action === "counter" && counterAmount) updateData.counterAmount = parseFloat(counterAmount);
  if (message) updateData.hotelMessage = message;

  const res = await fetch(`${SB_URL}/rest/v1/bids?id=eq.${bidId}`, {
    method: "PATCH", headers: SB_H, body: JSON.stringify(updateData),
  });
  if (!res.ok) return NextResponse.json({ error: "Update failed" }, { status: 500 });
  const updated = await res.json().catch(() => []);
  return NextResponse.json({ bid: updated[0] || { id: bidId, ...updateData }, ok: true });
}
