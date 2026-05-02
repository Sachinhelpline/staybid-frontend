import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

export async function GET() {
  const res = await fetch(`${SB_URL}/rest/v1/payouts?select=*&order=createdAt.desc&limit=200`, { headers: H });
  const data = res.ok ? await res.json() : [];
  return NextResponse.json({ payouts: data });
}

export async function POST(req: NextRequest) {
  const { hotelId, amount, period, notes } = await req.json();
  if (!hotelId || !amount) return NextResponse.json({ error: "hotelId and amount required" }, { status: 400 });
  const payload = {
    hotelId,
    amount: Number(amount),
    period: period || new Date().toISOString().slice(0, 7),
    status: "pending",
    notes: notes || null,
    createdAt: new Date().toISOString(),
  };
  const res = await fetch(`${SB_URL}/rest/v1/payouts`, {
    method: "POST",
    headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  return NextResponse.json({ ok: res.ok, payout: res.ok ? (await res.json())[0] : null });
}

export async function PATCH(req: NextRequest) {
  const { payoutId, status, txnRef } = await req.json();
  if (!payoutId || !status) return NextResponse.json({ error: "payoutId and status required" }, { status: 400 });
  const res = await fetch(`${SB_URL}/rest/v1/payouts?id=eq.${payoutId}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ status, txnRef: txnRef || null, paidAt: status === "paid" ? new Date().toISOString() : null }),
  });
  return NextResponse.json({ ok: res.ok });
}
