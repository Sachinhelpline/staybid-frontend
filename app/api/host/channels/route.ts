import { NextResponse } from "next/server";
import { SB_URL, SB_READ, userFromReq } from "@/lib/sb";
import { HOST_CHANNELS } from "@/lib/host/modules";

export const dynamic = "force-dynamic";

// GET /api/host/channels — supported OTA catalog + the caller's connections.
export async function GET(req: Request) {
  const user = userFromReq(req);

  let connections: any[] = [];
  if (user?.id) {
    try {
      const r = await fetch(
        `${SB_URL}/rest/v1/host_channels?user_id=eq.${encodeURIComponent(user.id)}`
          + `&select=id,channel,property_ref,listing_url,status,last_sync_at,created_at`
          + `&order=created_at.desc`,
        { headers: SB_READ, cache: "no-store" },
      );
      if (r.ok) connections = await r.json();
    } catch { /* connections are best-effort */ }
  }

  return NextResponse.json({ channels: HOST_CHANNELS, connections });
}
