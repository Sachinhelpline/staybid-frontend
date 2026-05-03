import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

// Public list endpoint: only approved videos are returned by default. Pass
// ?status=all|pending|approved|rejected to filter (admin / partner usage).
export async function GET(req: NextRequest, { params }: { params: { hotelId: string } }) {
  const status = req.nextUrl.searchParams.get("status") || "approved";
  const filter = status === "all" ? "" : `&verification_status=eq.${encodeURIComponent(status)}`;
  const res = await fetch(
    `${SB_URL}/rest/v1/hotel_videos?hotel_id=eq.${encodeURIComponent(params.hotelId)}${filter}&select=*&order=created_at.desc&limit=100`,
    { headers: SB_H }
  );
  const data = res.ok ? await res.json() : [];
  return NextResponse.json({ videos: Array.isArray(data) ? data : [], total: Array.isArray(data) ? data.length : 0 });
}
