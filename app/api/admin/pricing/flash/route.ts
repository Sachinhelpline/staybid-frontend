import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

export async function GET() {
  const res = await fetch(`${SB_URL}/rest/v1/flash_deals?select=*&order=createdAt.desc&limit=200`, { headers: H });
  const data = res.ok ? await res.json() : [];
  return NextResponse.json({ deals: data });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(`${SB_URL}/rest/v1/flash_deals`, {
    method: "POST",
    headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  const data = res.ok ? await res.json() : null;
  return NextResponse.json({ ok: res.ok, deal: data?.[0] || null });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const res = await fetch(`${SB_URL}/rest/v1/flash_deals?id=eq.${id}`, { method: "DELETE", headers: H });
  return NextResponse.json({ ok: res.ok });
}
