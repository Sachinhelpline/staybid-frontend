// v317 — Channel Manager Phase 3: test-connection endpoint.
//
// Resolves the ONE adapter for (ota, mode) and runs its testConnection. iCal
// mode validates a feed URL (or reports live). API mode reports honest
// "configured · awaiting connector". Best-effort updates the connection's
// health_status so the console cards reflect the last test. Owner ∪ operated
// scoped (Circle partners included).
//
import { NextRequest, NextResponse } from "next/server";
import { sbSelect, SB_URL, SB_H, genId } from "@/lib/sb-server";
import { partnerHotelScope } from "@/lib/partner/hotel-scope";
import { getAdapter, type ChannelMode } from "@/lib/channels/adapters";

export const dynamic = "force-dynamic";

const MODES = new Set<ChannelMode>(["ical", "api", "manual"]);

export async function POST(req: NextRequest) {
  const scope = await partnerHotelScope(req);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const hotelId = String(body.hotelId || "");
  const ota = String(body.ota || "").toLowerCase();
  const mode = String(body.mode || "ical").toLowerCase() as ChannelMode;

  if (!hotelId || !ota) return NextResponse.json({ error: "hotelId, ota required" }, { status: 400 });
  if (!scope.hotelIds.includes(hotelId))
    return NextResponse.json({ error: "Not your hotel" }, { status: 403 });
  if (!MODES.has(mode)) return NextResponse.json({ error: `Unknown mode "${mode}"` }, { status: 400 });

  const adapter = getAdapter(ota, mode);
  let result;
  try {
    result = await adapter.testConnection({
      ota,
      mode,
      hotelId,
      apiKey: body.apiKey ?? null,
      apiSecret: body.apiSecret ?? null,
      propertyId: body.propertyId ?? null,
      endpointUrl: body.endpointUrl ?? null,
    });
  } catch (e: any) {
    result = { ok: false, state: "error" as const, message: e?.message || "Test failed" };
  }

  // Best-effort: reflect the last test on the connection card. If a connection
  // row already exists (auto-linked on feed add), patch it; otherwise upsert a
  // configured row so the console has something to show.
  const health = result.state === "live" ? "ok" : result.state === "configured" ? "warning" : "error";
  try {
    await fetch(`${SB_URL}/rest/v1/channel_connections?on_conflict=hotel_id,ota`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        id: genId("chn"),
        hotel_id: hotelId,
        ota,
        mode,
        status: result.state === "live" ? "active" : "configured",
        health_status: health,
        last_health_at: new Date().toISOString(),
        updated_by: scope.userId,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch { /* table may be unprovisioned — the test result still returns */ }

  return NextResponse.json(result);
}

// Convenience GET for a plain iCal-URL check (used by the "test before add"
// flow) without touching connection rows.
export async function GET(req: NextRequest) {
  const scope = await partnerHotelScope(req);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const hotelId = url.searchParams.get("hotelId") || "";
  const ota = (url.searchParams.get("ota") || "other").toLowerCase();
  const feedUrl = url.searchParams.get("url") || "";
  if (!hotelId || !feedUrl) return NextResponse.json({ error: "hotelId, url required" }, { status: 400 });
  if (!scope.hotelIds.includes(hotelId))
    return NextResponse.json({ error: "Not your hotel" }, { status: 403 });

  const adapter = getAdapter(ota, "ical");
  const result = await adapter
    .testConnection({ ota, mode: "ical", hotelId, endpointUrl: feedUrl })
    .catch((e: any) => ({ ok: false, state: "error" as const, message: e?.message || "Test failed" }));
  return NextResponse.json(result);
}
