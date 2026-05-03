import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
const SB_H  = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" };

function decodeJwt(t: string) {
  try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()); }
  catch { return null; }
}

// Records metadata for a video already uploaded to Supabase Storage (or any
// CDN). Client-side upload happens via the storage SDK, then the resulting
// public URL is sent here. Mirrors the vp_videos / hotel_images pattern.
export async function POST(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payload = decodeJwt(token);
  if (!payload?.id) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (!body.hotelId || !body.videoUrl) {
    return NextResponse.json({ error: "hotelId and videoUrl are required" }, { status: 400 });
  }

  const row = {
    hotel_id:           String(body.hotelId),
    room_id:            body.roomId ? String(body.roomId) : null,
    room_type:          body.roomType || null,
    title:              body.title || null,
    s3_url:             String(body.videoUrl),
    thumbnail_url:      body.thumbnailUrl || null,
    duration_seconds:   body.durationSeconds != null ? Number(body.durationSeconds) : null,
    quality:            body.quality || "sd",
    size_bytes:         body.sizeBytes != null ? Number(body.sizeBytes) : null,
    verification_status: "pending",
    uploaded_by:        payload.id,
  };

  const ins = await fetch(`${SB_URL}/rest/v1/hotel_videos`, { method: "POST", headers: SB_H, body: JSON.stringify(row) });
  if (!ins.ok) return NextResponse.json({ error: "Insert failed", detail: await ins.text() }, { status: 500 });
  const created = await ins.json().catch(() => null);
  return NextResponse.json({ video: Array.isArray(created) ? created[0] : created, created: true });
}
