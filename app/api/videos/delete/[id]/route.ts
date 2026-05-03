import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

function decodeJwt(t: string) {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()); }
  catch { return null; }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = decodeJwt(token);
  if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const cur = await fetch(`${SB_URL}/rest/v1/hotel_videos?id=eq.${encodeURIComponent(params.id)}&select=uploaded_by`, { headers: SB_H })
    .then(r => r.json()).catch(() => []);
  const row = Array.isArray(cur) && cur[0] ? cur[0] : null;
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.uploaded_by !== payload.id && payload.role !== "admin" && payload.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const del = await fetch(`${SB_URL}/rest/v1/hotel_videos?id=eq.${encodeURIComponent(params.id)}`, { method: "DELETE", headers: SB_H });
  if (!del.ok) return NextResponse.json({ error: "Delete failed", detail: await del.text() }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
