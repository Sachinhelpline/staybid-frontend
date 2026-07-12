// v315 — Channel Manager Phase 1: OTA iCal feed CRUD (hardened).
// v326 — Channel Manager Phase B: per-unit OTA/Airbnb cross-listing.
//
// Every method now scopes through partnerUnitScope (owned ∪ operated, at UNIT
// granularity — StayBid Circle investors included) and enforces:
//   • provider whitelist
//   • SSRF-safe http(s) feed URL
//   • the room actually belongs to the hotel
//   • server-generated id (sbInsert never generated one)
//   • PER-UNIT access — a unit-scoped investor may only create/read/patch/delete
//     feeds attached to a unit they own; the classic full-hotel owner manages
//     hotel-level AND any unit-level feed.
// POST also runs an immediate first sync so the partner sees a live result.
//
import { NextRequest, NextResponse } from "next/server";
import { sbSelect, sbInsert, SB_URL, SB_H, genId } from "@/lib/sb-server";
import { partnerUnitScope, canManageUnitRow, isUnitScoped } from "@/lib/partner/hotel-scope";
import { syncFeed, isSafeFeedUrl } from "@/lib/channels/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PROVIDERS = new Set([
  "booking", "airbnb", "mmt", "goibibo", "agoda",
  "expedia", "tripadvisor", "hostelworld", "vrbo", "other",
]);

/** Fetch a physical unit + its owning hotel/room. null if not found. */
async function loadUnit(unitId: string): Promise<{ id: string; hotelId: string; roomId: string; owner: string | null; status: string } | null> {
  try {
    const rows = await sbSelect(
      `hotel_room_units?id=eq.${encodeURIComponent(unitId)}&select=id,hotelId,roomId,owner_user_id,status`
    );
    const u = Array.isArray(rows) ? rows[0] : null;
    if (!u) return null;
    return { id: String(u.id), hotelId: String(u.hotelId), roomId: String(u.roomId), owner: u.owner_user_id ? String(u.owner_user_id) : null, status: String(u.status || "") };
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const scope = await partnerUnitScope(req);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const hotelId = new URL(req.url).searchParams.get("hotelId") || "";
  if (!hotelId) return NextResponse.json({ error: "hotelId required" }, { status: 400 });
  if (!scope.hotelIds.includes(hotelId))
    return NextResponse.json({ error: "Not your hotel" }, { status: 403 });

  const unitScoped = isUnitScoped(scope, hotelId);

  // Units for the picker: investor sees their own; full-hotel owner sees all.
  let units: Array<{ id: string; roomId: string; roomNumber?: string }> = [];
  if (unitScoped) {
    units = scope.ownedUnitsByHotel[hotelId] || [];
  } else {
    try {
      const rows = await sbSelect(
        `hotel_room_units?hotelId=eq.${encodeURIComponent(hotelId)}&status=eq.active&select=id,roomId,roomNumber&order=roomNumber.asc`
      );
      if (Array.isArray(rows)) units = rows.map((u: any) => ({ id: String(u.id), roomId: String(u.roomId), roomNumber: u.roomNumber != null ? String(u.roomNumber) : undefined }));
    } catch { /* ignore — picker just shows nothing */ }
  }

  try {
    const feeds = await sbSelect(
      `ota_feeds?hotelId=eq.${encodeURIComponent(hotelId)}&select=*&order=createdAt.desc`
    );
    const all = Array.isArray(feeds) ? feeds : [];
    // A unit-scoped investor only sees the feeds they can manage.
    const visible = all.filter((f: any) => canManageUnitRow(scope, hotelId, f.unitId ?? null));
    return NextResponse.json({ feeds: visible, unitScoped, units });
  } catch (e: any) {
    return NextResponse.json({ feeds: [], unitScoped, units, warning: e?.message });
  }
}

export async function POST(req: NextRequest) {
  const scope = await partnerUnitScope(req);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const { hotelId, icalUrl, label } = body;
  let roomId = body.roomId;
  const unitId = body.unitId ? String(body.unitId) : null;
  const provider = String(body.provider || "").toLowerCase();

  if (!hotelId || !provider || !icalUrl)
    return NextResponse.json({ error: "hotelId, provider, icalUrl required" }, { status: 400 });
  if (!scope.hotelIds.includes(hotelId))
    return NextResponse.json({ error: "Not your hotel" }, { status: 403 });
  if (!PROVIDERS.has(provider))
    return NextResponse.json({ error: `Unknown provider "${provider}"` }, { status: 400 });

  const safe = isSafeFeedUrl(icalUrl);
  if (!safe.ok) return NextResponse.json({ error: safe.reason }, { status: 400 });

  const unitScoped = isUnitScoped(scope, hotelId);

  // ── Per-unit resolution ──────────────────────────────────────────────
  if (unitScoped && !unitId)
    return NextResponse.json({ error: "Pick which of your rooms this feed is for" }, { status: 400 });

  if (unitId) {
    // Feed is attached to a specific physical unit — validate it hard.
    if (!canManageUnitRow(scope, hotelId, unitId))
      return NextResponse.json({ error: "That room is not yours" }, { status: 403 });
    const unit = await loadUnit(unitId);
    if (!unit || unit.hotelId !== hotelId)
      return NextResponse.json({ error: "Unit does not belong to this hotel" }, { status: 400 });
    // The unit dictates the room category — never trust a mismatched roomId.
    roomId = unit.roomId;
  } else {
    // Hotel-level feed (classic owner). The room must belong to the hotel.
    if (!roomId) return NextResponse.json({ error: "roomId required" }, { status: 400 });
    const room = await sbSelect(
      `rooms?id=eq.${encodeURIComponent(roomId)}&hotelId=eq.${encodeURIComponent(hotelId)}&select=id`
    ).catch(() => []);
    if (!room?.[0])
      return NextResponse.json({ error: "Room does not belong to this hotel" }, { status: 400 });
  }

  const intervalMin = Math.min(1440, Math.max(15, Number(body.syncIntervalMin) || 30));
  const row: any = {
    id: genId("feed"),
    hotelId,
    roomId,
    provider,
    icalUrl: String(icalUrl).trim(),
    label: label || provider,
    active: true,
    unitId, // v326 — NULL = hotel-level (zero regression)
  };
  const v315Cols = { autoSync: true, syncIntervalMin: intervalMin, consecutiveFailures: 0 };

  let feed: any = null;
  try {
    feed = await sbInsert("ota_feeds", { ...row, ...v315Cols });
  } catch {
    try {
      feed = await sbInsert("ota_feeds", row); // legacy-column fallback
    } catch {
      try {
        // eldest fallback — no unitId column yet (pre-v326 DB)
        const { unitId: _drop, ...legacy } = row;
        feed = await sbInsert("ota_feeds", legacy);
      } catch (e: any) {
        return NextResponse.json({ error: e?.message || "Failed to save feed" }, { status: 500 });
      }
    }
  }

  // Immediate first sync — the partner sees a live result right away.
  let firstSync: any = null;
  try { firstSync = await syncFeed(feed, "manual"); } catch { /* non-blocking */ }

  // Auto-link a channel_connections row ONLY for HOTEL-LEVEL feeds. The
  // connections table is keyed unique on (hotel_id, ota); two investors' feeds
  // for the same OTA on the same hotel would collide — so per-unit feeds live
  // purely as ota_feeds rows (channel_connections.unit_id is reserved for a
  // future admin per-unit connector).
  if (!unitId) {
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
  }

  return NextResponse.json({ ok: true, feed, firstSync });
}

export async function PATCH(req: NextRequest) {
  const scope = await partnerUnitScope(req);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const existing = await sbSelect(
    `ota_feeds?id=eq.${encodeURIComponent(id)}&select=id,hotelId,unitId`
  ).catch(() => []);
  if (!existing?.[0]) return NextResponse.json({ error: "Feed not found" }, { status: 404 });
  if (!canManageUnitRow(scope, existing[0].hotelId, existing[0].unitId ?? null))
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
  const scope = await partnerUnitScope(req);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Ownership check BEFORE the destructive cascade (pre-v315 had none)
  const existing = await sbSelect(
    `ota_feeds?id=eq.${encodeURIComponent(id)}&select=id,hotelId,unitId`
  ).catch(() => []);
  if (!existing?.[0]) return NextResponse.json({ error: "Feed not found" }, { status: 404 });
  if (!canManageUnitRow(scope, existing[0].hotelId, existing[0].unitId ?? null))
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
