// v315 — Channel Manager Phase 1: OTA iCal feed CRUD (hardened).
//
// Pre-v315 this route accepted ANY decoded JWT with no hotel-ownership check.
// Now every method scopes through lib/partner/hotel-scope (owned ∪ operated —
// StayBid Circle partners included) and validates:
//   • provider whitelist
//   • SSRF-safe http(s) feed URL
//   • the room actually belongs to the hotel
//   • server-generated id (sbInsert never generated one)
// POST also runs an immediate first sync so the partner sees a live result.
// NEW: PATCH — pause/resume auto-sync, rename, change interval.
//
import { NextRequest, NextResponse } from "next/server";
import { sbSelect, sbInsert, SB_URL, SB_H, genId } from "@/lib/sb-server";
import { partnerHotelScope } from "@/lib/partner/hotel-scope";
import { syncFeed, isSafeFeedUrl } from "@/lib/channels/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PROVIDERS = new Set([
  "booking", "airbnb", "mmt", "goibibo", "agoda",
  "expedia", "tripadvisor", "hostelworld", "vrbo", "other",
]);

export async function GET(req: NextRequest) {
  const scope = await partnerHotelScope(req);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const hotelId = new URL(req.url).searchParams.get("hotelId") || "";
  if (!hotelId) return NextResponse.json({ error: "hotelId required" }, { status: 400 });
  if (!scope.hotelIds.includes(hotelId))
    return NextResponse.json({ error: "Not your hotel" }, { status: 403 });

  try {
    const feeds = await sbSelect(
      `ota_feeds?hotelId=eq.${encodeURIComponent(hotelId)}&select=*&order=createdAt.desc`
    );
    return NextResponse.json({ feeds: Array.isArray(feeds) ? feeds : [] });
  } catch (e: any) {
    return NextResponse.json({ feeds: [], warning: e?.message });
  }
}

export async function POST(req: NextRequest) {
  const scope = await partnerHotelScope(req);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const { hotelId, roomId, icalUrl, label } = body;
  const provider = String(body.provider || "").toLowerCase();

  if (!hotelId || !roomId || !provider || !icalUrl)
    return NextResponse.json({ error: "hotelId, roomId, provider, icalUrl required" }, { status: 400 });
  if (!scope.hotelIds.includes(hotelId))
    return NextResponse.json({ error: "Not your hotel" }, { status: 403 });
  if (!PROVIDERS.has(provider))
    return NextResponse.json({ error: `Unknown provider "${provider}"` }, { status: 400 });

  const safe = isSafeFeedUrl(icalUrl);
  if (!safe.ok) return NextResponse.json({ error: safe.reason }, { status: 400 });

  // Integrity: the room must belong to this hotel
  const room = await sbSelect(
    `rooms?id=eq.${encodeURIComponent(roomId)}&hotelId=eq.${encodeURIComponent(hotelId)}&select=id`
  ).catch(() => []);
  if (!room?.[0])
    return NextResponse.json({ error: "Room does not belong to this hotel" }, { status: 400 });

  const intervalMin = Math.min(1440, Math.max(15, Number(body.syncIntervalMin) || 30));
  const row: any = {
    id: genId("feed"),
    hotelId,
    roomId,
    provider,
    icalUrl: String(icalUrl).trim(),
    label: label || provider,
    active: true,
  };
  // v315 columns — included when provisioned; retried without them otherwise
  const v315Cols = { autoSync: true, syncIntervalMin: intervalMin, consecutiveFailures: 0 };

  let feed: any = null;
  try {
    feed = await sbInsert("ota_feeds", { ...row, ...v315Cols });
  } catch {
    try {
      feed = await sbInsert("ota_feeds", row); // legacy-column fallback
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || "Failed to save feed" }, { status: 500 });
    }
  }

  // Immediate first sync — the partner sees a live result right away.
  let firstSync: any = null;
  try { firstSync = await syncFeed(feed, "manual"); } catch { /* non-blocking */ }

  // Auto-link a channel_connections row (mode=ical) so the Channel Manager
  // console shows this OTA as an active iCal channel. Best-effort, additive.
  try {
    await fetch(`${SB_URL}/rest/v1/channel_connections?on_conflict=hotel_id,ota`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        id: genId("chn"),
        hotel_id: hotelId,
        ota: provider,
        mode: "ical",
        label: label || provider,
        status: "active",
        health_status: firstSync?.ok ? (firstSync.status === "error" ? "error" : "ok") : "warning",
        last_health_at: new Date().toISOString(),
        updated_by: scope.userId,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch { /* table may be unprovisioned — fine */ }

  return NextResponse.json({ ok: true, feed, firstSync });
}

export async function PATCH(req: NextRequest) {
  const scope = await partnerHotelScope(req);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const existing = await sbSelect(
    `ota_feeds?id=eq.${encodeURIComponent(id)}&select=id,hotelId`
  ).catch(() => []);
  if (!existing?.[0]) return NextResponse.json({ error: "Feed not found" }, { status: 404 });
  if (!scope.hotelIds.includes(existing[0].hotelId))
    return NextResponse.json({ error: "Not your feed" }, { status: 403 });

  const patch: Record<string, any> = {};
  if (typeof body.active === "boolean") patch.active = body.active;
  if (typeof body.autoSync === "boolean") {
    patch.autoSync = body.autoSync;
    if (body.autoSync) patch.consecutiveFailures = 0; // resume clears the pause counter
  }
  if (typeof body.label === "string" && body.label.trim()) patch.label = body.label.trim();
  if (body.syncIntervalMin != null) {
    patch.syncIntervalMin = Math.min(1440, Math.max(15, Number(body.syncIntervalMin) || 30));
  }
  if (!Object.keys(patch).length)
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  try {
    const r = await fetch(`${SB_URL}/rest/v1/ota_feeds?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: SB_H,
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error(await r.text());
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const scope = await partnerHotelScope(req);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Ownership check BEFORE the destructive cascade (pre-v315 had none)
  const existing = await sbSelect(
    `ota_feeds?id=eq.${encodeURIComponent(id)}&select=id,hotelId`
  ).catch(() => []);
  if (!existing?.[0]) return NextResponse.json({ error: "Feed not found" }, { status: 404 });
  if (!scope.hotelIds.includes(existing[0].hotelId))
    return NextResponse.json({ error: "Not your feed" }, { status: 403 });

  try {
    await fetch(`${SB_URL}/rest/v1/ota_feeds?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: SB_H,
    });
    // Cascade: remove ONLY the blocks this feed imported
    await fetch(
      `${SB_URL}/rest/v1/room_blocks?feedId=eq.${encodeURIComponent(id)}&source=eq.ota_ical`,
      { method: "DELETE", headers: SB_H }
    ).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Delete failed" }, { status: 500 });
  }
}
