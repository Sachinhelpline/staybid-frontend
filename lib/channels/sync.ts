// v315 — Channel Manager Phase 1: the shared iCal IMPORT engine.
//
// ONE code path for both the manual "Sync now" route and the scheduled cron
// (/api/cron/channel-sync). Professional-CM guarantees baked in:
//
//   • RECONCILIATION — a VEVENT that disappears from the OTA feed is a
//     cancellation → its imported room_block is DELETED (future dates only),
//     releasing inventory. The pre-v315 importer was append-only, so a
//     cancelled OTA booking blocked the room forever.
//   • Idempotent by (feedId, externalRef = VEVENT UID).
//   • Per-fetch timeout — Node fetch has NO default timeout; a hung OTA
//     server must not stall the cron batch (v241.24/.27 discipline).
//   • SSRF guard on partner-supplied feed URLs.
//   • consecutiveFailures counter → autoSync pauses after 10 straight fails
//     (with a human-readable note in lastSyncError).
//   • Every run writes a channel_sync_logs row (best-effort, never throws).
//   • Graceful degrade: if the v315 columns aren't applied yet, the feed
//     PATCH retries with the legacy column subset.
//
import { SB_URL, SB_H, SB_H_REPRESENT, genId } from "@/lib/sb-server";
import { parseICal, toISODate, unitsFreeForRange, unitDoubleBooked } from "@/lib/availability";
import { queueNotification } from "@/lib/notify-server";

const FETCH_TIMEOUT_MS = 8_000;
const AUTO_PAUSE_AFTER_FAILURES = 10;
const MAX_EVENTS_PER_FEED = 500; // sanity cap — no real room calendar has more
const DELETE_CHUNK = 50;

export interface SyncResult {
  ok: boolean;
  feedId: string;
  provider?: string;
  status: "ok" | "empty" | "error";
  totalEvents: number;
  imported: number;
  removed: number;
  skipped: number;
  error?: string;
  durationMs: number;
}

/** SSRF guard — partner-supplied URLs must be public http(s) hosts. */
export function isSafeFeedUrl(raw: string): { ok: boolean; reason?: string } {
  let u: URL;
  try {
    u = new URL(String(raw || ""));
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "URL must be http(s)" };
  }
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, reason: "Internal hosts are not allowed" };
  }
  if (host.startsWith("[") || host.includes(":")) {
    return { ok: false, reason: "IPv6 literals are not allowed" };
  }
  const ip4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ip4) {
    const a = Number(ip4[1]);
    const b = Number(ip4[2]);
    if (
      a === 0 || a === 127 || a === 10 ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 169 && b === 254)
    ) {
      return { ok: false, reason: "Private IP ranges are not allowed" };
    }
  }
  return { ok: true };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)
    ),
  ]);
}

/** PATCH the ota_feeds row; retry with the legacy column subset if the v315
 *  columns aren't provisioned yet. Never throws. */
async function markFeed(feedId: string, patch: Record<string, any>): Promise<void> {
  const url = `${SB_URL}/rest/v1/ota_feeds?id=eq.${encodeURIComponent(feedId)}`;
  try {
    const r = await fetch(url, { method: "PATCH", headers: SB_H, body: JSON.stringify(patch) });
    if (r.ok) return;
    // legacy fallback — strip v315-only columns
    const legacy: Record<string, any> = {};
    for (const k of ["lastSyncAt", "lastSyncStatus", "lastSyncError", "lastEventCount"]) {
      if (k in patch) legacy[k] = patch[k];
    }
    await fetch(url, { method: "PATCH", headers: SB_H, body: JSON.stringify(legacy) }).catch(() => {});
  } catch { /* best-effort */ }
}

/** Best-effort audit-log row. Never throws. */
async function writeLog(entry: Record<string, any>): Promise<void> {
  try {
    await fetch(`${SB_URL}/rest/v1/channel_sync_logs`, {
      method: "POST",
      headers: SB_H,
      body: JSON.stringify({ id: genId("csl"), ...entry }),
    });
  } catch { /* table may not exist yet — fine */ }
}

// ── Phase 4: partner notifications ─────────────────────────────────────────
// Every OTA feed belongs to a hotel; notify whoever manages it — the classic
// owner (hotels.ownerId) AND any unit-owner/operator (hotel_room_units.
// owner_user_id) so Circle/host-circle partners get channel alerts too.
// notification_queue rows are in_app-always (+ env-flagged sms/whatsapp/email);
// entirely best-effort — never blocks or breaks a sync.

/** Distinct user ids that manage this hotel (owner ∪ operator). */
async function ownerUserIds(hotelId: string): Promise<string[]> {
  const ids = new Set<string>();
  if (!hotelId) return [];
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/hotels?id=eq.${encodeURIComponent(hotelId)}&select=ownerId`,
      { headers: SB_H }
    );
    const rows = await r.json().catch(() => []);
    if (Array.isArray(rows) && rows[0]?.ownerId) ids.add(String(rows[0].ownerId));
  } catch { /* ignore */ }
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/hotel_room_units?hotelId=eq.${encodeURIComponent(hotelId)}` +
        `&owner_user_id=not.is.null&select=owner_user_id`,
      { headers: SB_H }
    );
    const rows = await r.json().catch(() => []);
    if (Array.isArray(rows)) rows.forEach((x: any) => { if (x.owner_user_id) ids.add(String(x.owner_user_id)); });
  } catch { /* ignore */ }
  return Array.from(ids);
}

/** Queue a channel notification to every manager of the hotel. Best-effort. */
async function notifyOwners(
  hotelId: string,
  template: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const owners = await ownerUserIds(hotelId);
    for (const uid of owners) {
      await queueNotification({ userId: uid, template, payload });
    }
  } catch { /* never break a sync on a notification failure */ }
}

/** The specific owner of a physical unit (v326 per-unit targeting). */
async function unitOwnerId(unitId: string): Promise<string | null> {
  if (!unitId) return null;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/hotel_room_units?id=eq.${encodeURIComponent(unitId)}&select=owner_user_id`,
      { headers: SB_H }
    );
    const rows = await r.json().catch(() => []);
    const o = Array.isArray(rows) && rows[0]?.owner_user_id ? String(rows[0].owner_user_id) : null;
    return o;
  } catch { return null; }
}

/**
 * v326 — notify the right people for a feed event.
 * A per-unit feed (feed.unitId) notifies just that unit's owner (the investor);
 * a hotel-level feed notifies every manager (owner ∪ operators). Best-effort.
 */
async function notifyForFeed(
  feed: any,
  template: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    if (feed?.unitId) {
      const owner = await unitOwnerId(String(feed.unitId));
      if (owner) { await queueNotification({ userId: owner, template, payload }); return; }
    }
    await notifyOwners(String(feed?.hotelId || ""), template, payload);
  } catch { /* never break a sync on a notification failure */ }
}

const OVERBOOK_CHECK_CAP = 8; // bound the extra availability reads per sync

/**
 * Sync one ota_feeds row: fetch → parse → insert new events → reconcile
 * (delete future-dated blocks whose UID vanished = OTA cancellations).
 */
export async function syncFeed(
  feed: any,
  triggeredBy: "manual" | "cron" | "system"
): Promise<SyncResult> {
  const started = Date.now();
  const nowIso = new Date().toISOString();
  const base: SyncResult = {
    ok: false,
    feedId: String(feed?.id || ""),
    provider: feed?.provider,
    status: "error",
    totalEvents: 0,
    imported: 0,
    removed: 0,
    skipped: 0,
    durationMs: 0,
  };

  const fail = async (reason: string): Promise<SyncResult> => {
    const failures = (Number(feed?.consecutiveFailures) || 0) + 1;
    let error = reason;
    const patch: Record<string, any> = {
      lastSyncAt: nowIso,
      lastSyncStatus: "error",
      consecutiveFailures: failures,
    };
    let paused = false;
    if (failures >= AUTO_PAUSE_AFTER_FAILURES) {
      patch.autoSync = false;
      paused = true;
      error = `${reason} · auto-sync paused after ${failures} straight failures — fix the URL and resume the feed`;
    }
    patch.lastSyncError = error;
    await markFeed(base.feedId, patch);
    if (paused && feed?.hotelId) {
      await notifyForFeed(feed, "channel_feed_paused", {
        provider: feed?.provider || null,
        hotelId: feed.hotelId,
        feedId: base.feedId,
        unitId: feed?.unitId || null,
        error,
      });
    }
    await writeLog({
      hotel_id: feed?.hotelId || "",
      feed_id: base.feedId,
      connection_id: feed?.connectionId || null,
      provider: feed?.provider || null,
      direction: "import",
      status: "error",
      error,
      duration_ms: Date.now() - started,
      triggered_by: triggeredBy,
    });
    return { ...base, error, durationMs: Date.now() - started };
  };

  if (!feed?.id || !feed?.icalUrl) return fail("Feed row is missing id/icalUrl");

  const safe = isSafeFeedUrl(feed.icalUrl);
  if (!safe.ok) return fail(`Unsafe feed URL: ${safe.reason}`);

  // 1) Fetch the OTA's iCal feed (bounded)
  let text = "";
  try {
    const r = await withTimeout(
      fetch(feed.icalUrl, {
        headers: { "User-Agent": "StayBid-Sync/2.0 (+https://www.staybids.in)" },
        cache: "no-store",
        redirect: "follow",
      }),
      FETCH_TIMEOUT_MS,
      "iCal fetch"
    );
    if (!r.ok) return fail(`OTA server returned HTTP ${r.status}`);
    text = await withTimeout(r.text(), FETCH_TIMEOUT_MS, "iCal body read");
  } catch (e: any) {
    return fail(`iCal fetch failed: ${e?.message || "network error"}`);
  }

  // A transient error page must NEVER drive reconciliation (it would wipe
  // every imported block). Only a genuine VCALENDAR document proceeds.
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    return fail("Response is not an iCal feed (no BEGIN:VCALENDAR)");
  }

  // 2) Parse VEVENTs
  const valid = parseICal(text)
    .filter((e) => e.uid && e.start && e.end && e.start < e.end)
    .slice(0, MAX_EVENTS_PER_FEED);
  base.totalEvents = valid.length;

  // 3) Existing imported blocks for this feed (id + UID + dates)
  let existing: any[] = [];
  try {
    const r = await withTimeout(
      fetch(
        `${SB_URL}/rest/v1/room_blocks?feedId=eq.${encodeURIComponent(feed.id)}&select=id,externalRef,toDate,source`,
        { headers: SB_H }
      ),
      FETCH_TIMEOUT_MS,
      "existing blocks read"
    );
    const rows = await r.json().catch(() => []);
    if (Array.isArray(rows)) existing = rows;
  } catch (e: any) {
    return fail(`Could not read existing blocks: ${e?.message || "error"}`);
  }
  const existingUids = new Set(
    existing.map((x: any) => String(x.externalRef || "")).filter(Boolean)
  );

  // 4) Insert NEW events (idempotent by UID)
  const toInsert = valid
    .filter((e) => !existingUids.has(String(e.uid)))
    .map((e) => ({
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
      // v326 — a per-unit feed pins its imported holds to the exact physical
      // unit, so unitDoubleBooked can catch the same room sold on two OTAs.
      // Hotel-level feeds omit it (category-level, unchanged).
      ...(feed.unitId ? { assignedUnitId: String(feed.unitId) } : {}),
    }))
    .filter((r) => r.fromDate < r.toDate);

  if (toInsert.length) {
    try {
      const r = await withTimeout(
        fetch(`${SB_URL}/rest/v1/room_blocks`, {
          method: "POST",
          headers: SB_H_REPRESENT,
          body: JSON.stringify(toInsert),
        }),
        FETCH_TIMEOUT_MS,
        "block insert"
      );
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json().catch(() => []);
      base.imported = Array.isArray(j) ? j.length : toInsert.length;
    } catch (e: any) {
      return fail(`Import insert failed: ${e?.message || "error"}`);
    }
  }

  // 5) RECONCILE — OTA cancellations. A UID present in room_blocks but absent
  //    from the live feed means the OTA booking was cancelled/changed. Remove
  //    ONLY our own imported (source=ota_ical) FUTURE-dated blocks; past stays
  //    remain as history.
  const feedUids = new Set(valid.map((e) => String(e.uid)));
  const today = toISODate(new Date());
  const toRemove = existing.filter(
    (x: any) =>
      x.source === "ota_ical" &&
      x.externalRef &&
      !feedUids.has(String(x.externalRef)) &&
      String(x.toDate || "") >= today
  );
  if (toRemove.length) {
    try {
      for (let i = 0; i < toRemove.length; i += DELETE_CHUNK) {
        const ids = toRemove
          .slice(i, i + DELETE_CHUNK)
          .map((x: any) => encodeURIComponent(x.id))
          .join(",");
        const r = await withTimeout(
          fetch(`${SB_URL}/rest/v1/room_blocks?id=in.(${ids})&source=eq.ota_ical`, {
            method: "DELETE",
            headers: SB_H,
          }),
          FETCH_TIMEOUT_MS,
          "cancellation delete"
        );
        if (r.ok) base.removed += Math.min(DELETE_CHUNK, toRemove.length - i);
      }
    } catch { /* partial removal is fine — next run converges */ }
  }

  base.skipped = Math.max(0, base.totalEvents - base.imported);
  base.status = base.totalEvents > 0 ? "ok" : "empty";
  base.ok = true;
  base.durationMs = Date.now() - started;

  await markFeed(base.feedId, {
    lastSyncAt: nowIso,
    lastSyncStatus: base.status,
    lastSyncError: null,
    lastEventCount: base.totalEvents,
    consecutiveFailures: 0,
    lastImportedCount: base.imported,
    lastRemovedCount: base.removed,
  });
  await writeLog({
    hotel_id: feed.hotelId || "",
    feed_id: base.feedId,
    connection_id: feed.connectionId || null,
    provider: feed.provider || null,
    direction: "import",
    status: base.status,
    events_total: base.totalEvents,
    blocks_added: base.imported,
    blocks_removed: base.removed,
    duration_ms: base.durationMs,
    triggered_by: triggeredBy,
  });

  // ── Phase 4 notifications — only fire on a REAL change. Idempotent imports
  //    mean a steady feed adds/removes 0 on repeat syncs, so this is naturally
  //    debounced (no spam every 15-min cron tick). Best-effort, never throws. ──
  if (feed.hotelId && base.imported > 0) {
    await notifyForFeed(feed, "channel_reservation_imported", {
      provider: feed.provider || null,
      hotelId: feed.hotelId,
      unitId: feed.unitId || null,
      count: base.imported,
    });
    // Bounded overbooking check on the just-imported blocks — the exact moment
    // an OTA booking can push a room past capacity. One aggregated alert per
    // sync-with-conflict (not per block). Capped + best-effort.
    //
    // v326 — a per-unit feed (feed.unitId) checks whether the SAME physical
    // unit is now sold twice (unitDoubleBooked); a hotel-level feed keeps the
    // category-capacity check (unitsFreeForRange).
    try {
      let overCount = 0;
      let firstRoom = "";
      for (const b of toInsert.slice(0, OVERBOOK_CHECK_CAP)) {
        let conflict = false;
        if (feed.unitId) {
          conflict = await unitDoubleBooked({
            hotelId: String(feed.hotelId),
            unitId: String(feed.unitId),
            from: String(b.fromDate),
            to: String(b.toDate),
          }).catch(() => false);
        } else {
          const cap = await unitsFreeForRange({
            hotelId: String(feed.hotelId),
            roomId: String(b.roomId),
            from: String(b.fromDate),
            to: String(b.toDate),
          }).catch(() => null);
          conflict = !!(cap && cap.occupied > cap.capacity);
        }
        if (conflict) {
          overCount++;
          if (!firstRoom) firstRoom = String(b.roomId);
        }
      }
      if (overCount > 0) {
        await notifyForFeed(feed, "channel_overbooking", {
          provider: feed.provider || null,
          hotelId: feed.hotelId,
          conflicts: overCount,
          roomId: firstRoom,
          unitId: feed.unitId || null,
          perUnit: !!feed.unitId,
        });
      }
    } catch { /* best-effort */ }
  }
  if (feed.hotelId && base.removed > 0) {
    await notifyForFeed(feed, "channel_reservation_cancelled", {
      provider: feed.provider || null,
      hotelId: feed.hotelId,
      unitId: feed.unitId || null,
      count: base.removed,
    });
  }

  return base;
}
