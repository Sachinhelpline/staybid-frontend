import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const status = searchParams.get("status");
  let q = "complaints?select=*&order=createdAt.desc&limit=200";
  if (type && type !== "all") q += `&type=eq.${type}`;
  if (status && status !== "all") q += `&status=eq.${status}`;
  const res = await fetch(`${SB_URL}/rest/v1/${q}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  const data = res.ok ? await res.json() : [];
  return NextResponse.json({ complaints: data, total: data.length });
}
