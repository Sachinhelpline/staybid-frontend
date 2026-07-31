// v319 — Channel Manager Phase 5: admin "Set up sync" for host channel requests.
//
// A /host/channels request (host_channels row) is a lead: a partner asks
// StayBid to wire their OTA. This turns that request into a real channel:
//   1. resolve the requester's hotel(s) (owner ∪ operated)
//   2. create a channel_connections row (mode=ical if the listing URL is a safe
//      iCal http(s) feed, else mode=api "awaiting connector")
//   3. if iCal + the hotel has a room → create an ota_feeds row + run first sync
//   4. auto-grant the `channels` subscription service to that hotel (free) so the
//      partner's Channel Manager tab unlocks
//   5. flip host_channels.status → connected
//
// If the requester owns/operates MORE than one hotel, the endpoint returns
// { needsHotel:true, hotels:[…] } so the admin picks which one, then re-calls
// with hotelId. Auth: requireVerifiedAdmin. Audit-logged. Best-effort per step.
//
import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin, auditIdentity } from "@/lib/admin/verify";
import { SB_URL, SB_H, genId } from "@/lib/sb-server";
import { logAdminAction } from "@/lib/admin/audit";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { resolveOperatedHotelIds } from "@/lib/partner/operator-access";
import { isSafeFeedUrl, syncFeed } from "@/lib/channels/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const REST = `${SB_URL}/rest/v1`;

async function sbGet(path: string): Promise<any[]> {
  try {
    const r = await fetch(`${REST}/${path}`, { headers: SB_H, cache: "no-store" });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

/** Hotels the requester owns (hotels.ownerId) ∪ operates (unit ownership). */
async function requesterHotels(userId: string): Promise<{ id: string; name: string; city?: string }[]> {
  const ownerIds = await resolveOwnerIdsCrossPool(userId).catch(() => [userId]);
  const set = new Set<string>();
  if (ownerIds.length) {
    const owned = await sbGet(
      `hotels?ownerId=in.(${ownerIds.map((i) => encodeURIComponent(i)).join(",")})&select=id,name,city`
    );
    owned.forEach((h: any) => { if (h?.id) set.add(String(h.id)); });
    const operated = await resolveOperatedHotelIds(ownerIds).catch(() => []);
    operated.forEach((id) => set.add(id));
  }
  const ids = Array.from(set);
  if (!ids.length) return [];
  const rows = await sbGet(
    `hotels?id=in.(${ids.map((i) => encodeURIComponent(i)).join(",")})&select=id,name,city`
  );
  return rows.map((h: any) => ({ id: h.id, name: h.name || h.id, city: h.city }));
}

export async function POST(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const channelRequestId = String(body.channelRequestId || "");
  const chosenHotelId = String(body.hotelId || "");
  if (!channelRequestId) return NextResponse.json({ error: "channelRequestId required" }, { status: 400 });

  // 1) load the request
  const reqRows = await sbGet(
    `host_channels?id=eq.${encodeURIComponent(channelRequestId)}&select=*`
  );
  const cr = reqRows[0];
  if (!cr) return NextResponse.json({ error: "Channel request not found" }, { status: 404 });
  const ota = String(cr.channel || "other").toLowerCase();
  const listingUrl = String(cr.listing_url || "").trim();

  // 2) resolve the requester's hotels
  if (!cr.user_id) return NextResponse.json({ error: "Request has no user — cannot resolve a hotel" }, { status: 400 });
  const hotels = await requesterHotels(String(cr.user_id));
  if (hotels.length === 0) {
    return NextResponse.json(
      { error: "Requester has no onboarded/operated hotel yet — provision one first." },
      { status: 400 }
    );
  }
  let hotelId = chosenHotelId;
  if (!hotelId) {
    if (hotels.length === 1) hotelId = hotels[0].id;
    else return NextResponse.json({ needsHotel: true, hotels });
  }
  if (!hotels.some((h) => h.id === hotelId)) {
    return NextResponse.json({ error: "Chosen hotel is not owned/operated by the requester" }, { status: 400 });
  }
  const hotelName = hotels.find((h) => h.id === hotelId)?.name || hotelId;

  // 3) decide the connection mode from the listing URL
  const icalOk = listingUrl ? isSafeFeedUrl(listingUrl).ok : false;
  const mode = icalOk ? "ical" : "api";

  // 4) upsert the channel_connections row
  let connection: any = null;
  try {
    const r = await fetch(`${REST}/channel_connections?on_conflict=hotel_id,ota`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        id: genId("chn"),
        hotel_id: hotelId,
        ota,
        mode,
        label: cr.property_ref || ota,
        endpoint_url: icalOk ? listingUrl : (listingUrl || null),
        status: mode === "ical" ? "active" : "configured",
        health_status: mode === "ical" ? "warning" : "configured",
        last_health_at: new Date().toISOString(),
        note: `Set up by admin from host request ${channelRequestId}`,
        updated_by: admin.id || "admin",
        updated_at: new Date().toISOString(),
      }),
    });
    const j = await r.json().catch(() => null);
    connection = Array.isArray(j) ? j[0] : j;
  } catch { /* table may be unprovisioned — still flip the request status below */ }

  // 5) iCal → create a feed on the hotel's first room + first sync
  let feed: any = null;
  let firstSync: any = null;
  if (icalOk) {
    const rooms = await sbGet(
      `rooms?hotelId=eq.${encodeURIComponent(hotelId)}&select=id&order=createdAt.asc&limit=1`
    );
    const roomId = rooms[0]?.id;
    if (roomId) {
      const feedRow: any = {
        id: genId("feed"),
        hotelId,
        roomId,
        provider: ota,
        icalUrl: listingUrl,
        label: cr.property_ref || ota,
        active: true,
        autoSync: true,
        syncIntervalMin: 30,
        consecutiveFailures: 0,
      };
      try {
        const ir = await fetch(`${REST}/ota_feeds`, {
          method: "POST",
          headers: { ...SB_H, Prefer: "return=representation" },
          body: JSON.stringify(feedRow),
        });
        const ij = await ir.json().catch(() => null);
        feed = Array.isArray(ij) ? ij[0] : ij;
        if (feed?.id) {
          try { firstSync = await syncFeed(feed, "manual"); } catch { /* non-blocking */ }
        }
      } catch { /* legacy-column or unprovisioned — skip feed, connection still made */ }
    }
  }

  // 6) auto-grant the `channels` subscription service (free) so the partner's
  //    Channel Manager tab unlocks. Best-effort; deliberate admin action.
  let serviceGranted = false;
  try {
    const gr = await fetch(`${REST}/hotel_services?on_conflict=hotel_id,service_key`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        id: genId("svc"),
        hotel_id: hotelId,
        service_key: "channels",
        status: "active",
        access_type: "free",
        granted_by: admin.id || "admin",
        note: "Auto-granted with admin channel setup",
        updated_at: new Date().toISOString(),
      }),
    });
    serviceGranted = gr.ok;
  } catch { /* best-effort */ }

  // 7) flip the host_channels request → connected
  try {
    await fetch(`${REST}/host_channels?id=eq.${encodeURIComponent(channelRequestId)}`, {
      method: "PATCH",
      headers: SB_H,
      body: JSON.stringify({
        status: "connected",
        last_sync_at: firstSync?.ok ? new Date().toISOString() : cr.last_sync_at || null,
        notes: `Connected to ${hotelName} (${mode}) by admin`,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch { /* ignore */ }

  logAdminAction({
    admin,
    action: "host_channel_setup",
    targetType: "channel",
    targetId: `${channelRequestId}:${hotelId}:${mode}`,
  } as any);

  return NextResponse.json({
    ok: true,
    hotelId,
    hotelName,
    mode,
    connection,
    feed,
    firstSync,
    serviceGranted,
  });
}
