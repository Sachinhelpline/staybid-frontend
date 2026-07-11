// v316 — Channel Manager Phase 2: recent sync-log viewer.
//
// GET ?hotelId=...&limit=20  → the hotel's most recent channel_sync_logs rows.
// Owner ∪ operated scoped (Circle partners included). Degrades gracefully if
// the channel_sync_logs table isn't provisioned yet ({ logs: [] }).
//
import { NextRequest, NextResponse } from "next/server";
import { sbSelect } from "@/lib/sb-server";
import { partnerHotelScope } from "@/lib/partner/hotel-scope";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const scope = await partnerHotelScope(req);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const hotelId = url.searchParams.get("hotelId") || "";
  if (!hotelId) return NextResponse.json({ error: "hotelId required" }, { status: 400 });
  if (!scope.hotelIds.includes(hotelId))
    return NextResponse.json({ error: "Not your hotel" }, { status: 403 });

  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  try {
    const logs = await sbSelect(
      `channel_sync_logs?hotel_id=eq.${encodeURIComponent(hotelId)}&select=*&order=created_at.desc&limit=${limit}`
    );
    return NextResponse.json({ logs: Array.isArray(logs) ? logs : [] });
  } catch {
    return NextResponse.json({ logs: [] });
  }
}
