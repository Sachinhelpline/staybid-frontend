// Fetches an iCal feed (Booking.com / Airbnb / GoIbibo / MMT / Agoda)
// and imports VEVENTs into room_blocks as source='ota_ical'.
// Deduped by externalRef (VEVENT UID) + feedId, so repeated sync is idempotent.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_H_REPRESENT, decodeJwt } from "@/lib/sb-server";
import { parseICal, toISODate } from "@/lib/availability";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function auth(req: NextRequest): { userId?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub };
}

async function markFeed(feedId: string, patch: any) {
  await fetch(`${SB_URL}/rest/v1/ota_feeds?id=eq.${feedId}`, {
    method: "PATCH",
    headers: SB_H,
    body: JSON.stringify(patch),
  }).catch(() => {});
}

export async function POST(req: NextRequest) {
  const { userId } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const { feedId } = body;
  if (!feedId) return NextResponse.json({ error: "feedId required" }, { status: 400 });

  // 1. Load feed row
  let feed: any = null;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/ota_feeds?id=eq.${feedId}&select=*`, { headers: SB_H });
    const j = await r.json();
    feed = Array.isArray(j) ? j[0] : null;
  } catch {}
  if (!feed) return NextResponse.json({ error: "Feed not found" }, { status: 404 });

  // 2. Fetch iCal URL
  let text = "";
  try {
    const r = await fetch(feed.icalUrl, {
      headers: { "User-Agent": "StayBid-Sync/1.0" },
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    text = await r.text();
  } catch (e: any) {
    await markFeed(feedId, {
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: "error",
      lastSyncError: e?.message || "fetch failed",
    });
    return NextResponse.json({ error: "iCal fetch failed: " + (e?.message || "") }, { status: 502 });
  }

  // 3. Parse VEVENTs
  const events = parseICal(text);
  const valid = events.filter(e => e.start && e.end);

  // 4. Load existing blocks for this feed (to skip existing UIDs)
  let existingUids = new Set<string>();
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/room_blocks?feedId=eq.${feedId}&select=externalRef`,
      { headers: SB_H }
    );
    const rows = await r.json();
    if (Array.isArray(rows)) rows.forEach((x: any) => x.externalRef && existingUids.add(x.externalRef));
  } catch {}

  // 5. Insert new events
  const toInsert = valid
    .filter(e => e.uid && !existingUids.has(e.uid))
    .map(e => ({
      hotelId: feed.hotelId,
      roomId: feed.roomId,
      fromDate: toISODate(e.start!),
      toDate: toISODate(e.end!),
      source: "ota_ical",
      provider: feed.provider,
      feedId: feed.id,
      externalRef: e.uid,
      note: e.summary || `${feed.provider} booking`,
      guestName: e.summary || null,
    }))
    .filter(r => r.fromDate < r.toDate); // skip malformed

  let imported = 0;
  if (toInsert.length) {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/room_blocks`, {
        method: "POST",
        headers: SB_H_REPRESENT,
        body: JSON.stringify(toInsert),
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      imported = Array.isArray(j) ? j.length : 0;
    } catch (e: any) {
      await markFeed(feedId, {
        lastSyncAt: new Date().toISOString(),
        lastSyncStatus: "error",
        lastSyncError: "insert failed: " + (e?.message || ""),
      });
      return NextResponse.json({ error: "Import failed: " + (e?.message || "") }, { status: 500 });
    }
  }

  await markFeed(feedId, {
    lastSyncAt: new Date().toISOString(),
    lastSyncStatus: valid.length ? "ok" : "empty",
    lastSyncError: null,
    lastEventCount: valid.length,
  });

  return NextResponse.json({
    ok: true,
    totalEvents: valid.length,
    imported,
    skipped: valid.length - imported,
  });
}
