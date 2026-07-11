// v319 — Channel Manager Phase 5: admin channel-health console.
//
// GET  → every ota_feeds row + channel_connections row across all hotels,
//        with hotel names side-loaded (no PostgREST FK embed) and a health
//        rollup (ok / error / paused / stale). Admin-wide observability for
//        the unified Channel Manager.
// POST {feedId} → force a re-sync of one feed through the SAME shared engine
//        (lib/channels/sync.ts syncFeed) the partner + cron use. Audit-logged.
//
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H } from "@/lib/sb-server";
import { adminFromReq, logAdminAction } from "@/lib/admin/audit";
import { syncFeed } from "@/lib/channels/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const REST = `${SB_URL}/rest/v1`;
// A feed that hasn't synced in > STALE_MS but is still active is "stale".
const STALE_MS = 90 * 60 * 1000; // 90 min (6× the 15-min cron cadence)

async function sbGet(path: string): Promise<any[]> {
  try {
    const r = await fetch(`${REST}/${path}`, { headers: SB_H, cache: "no-store" });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

/** Tolerant tz-defensive parse — ota_feeds.lastSyncAt is `timestamp` (no tz). */
function parseTs(v: any): number {
  if (!v) return 0;
  let s = String(v);
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += "Z";
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function feedHealth(f: any, now: number): "ok" | "error" | "paused" | "stale" | "idle" {
  if (f.active === false) return "paused";
  if (f.autoSync === false) return "paused";
  if (String(f.lastSyncStatus || "") === "error") return "error";
  const last = parseTs(f.lastSyncAt);
  if (!last) return "idle"; // never synced yet
  if (now - last > STALE_MS) return "stale";
  return "ok";
}

export async function GET(req: NextRequest) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [feeds, connections] = await Promise.all([
    sbGet(`ota_feeds?select=*&order=createdAt.desc&limit=500`),
    sbGet(`channel_connections?select=*&order=updated_at.desc&limit=500`),
  ]);

  // hotel names — manual side-load (no FK embed)
  const hotelIds = Array.from(
    new Set(
      [
        ...feeds.map((f: any) => String(f.hotelId || "")),
        ...connections.map((c: any) => String(c.hotel_id || "")),
      ].filter(Boolean)
    )
  );
  const nameOf: Record<string, string> = {};
  if (hotelIds.length) {
    const rows = await sbGet(
      `hotels?id=in.(${hotelIds.map((i) => encodeURIComponent(i)).join(",")})&select=id,name,city`
    );
    rows.forEach((h: any) => {
      nameOf[h.id] = h.name || h.id;
    });
  }

  const now = Date.now();
  const summary = { total: feeds.length, ok: 0, error: 0, paused: 0, stale: 0, idle: 0 };
  const feedRows = feeds.map((f: any) => {
    const health = feedHealth(f, now);
    summary[health] = (summary[health] || 0) + 1;
    return {
      id: f.id,
      hotelId: f.hotelId,
      hotelName: nameOf[f.hotelId] || f.hotelId,
      roomId: f.roomId,
      provider: (f.provider || "other").toLowerCase(),
      label: f.label || null,
      active: f.active !== false,
      autoSync: f.autoSync !== false,
      health,
      lastSyncAt: f.lastSyncAt || null,
      lastSyncStatus: f.lastSyncStatus || null,
      lastSyncError: f.lastSyncError || null,
      lastEventCount: f.lastEventCount ?? null,
      lastImportedCount: f.lastImportedCount ?? null,
      lastRemovedCount: f.lastRemovedCount ?? null,
      consecutiveFailures: f.consecutiveFailures ?? 0,
      syncIntervalMin: f.syncIntervalMin ?? null,
    };
  });

  const connRows = connections.map((c: any) => ({
    id: c.id,
    hotelId: c.hotel_id,
    hotelName: nameOf[c.hotel_id] || c.hotel_id,
    ota: (c.ota || "other").toLowerCase(),
    mode: c.mode || "ical",
    label: c.label || null,
    status: c.status || null,
    healthStatus: c.health_status || null,
    lastHealthAt: c.last_health_at || null,
    note: c.note || null,
  }));

  return NextResponse.json({ summary, feeds: feedRows, connections: connRows });
}

export async function POST(req: NextRequest) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  const feedId = String(body.feedId || "");
  if (!feedId) return NextResponse.json({ error: "feedId required" }, { status: 400 });

  const rows = await sbGet(`ota_feeds?id=eq.${encodeURIComponent(feedId)}&select=*`);
  const feed = rows[0];
  if (!feed) return NextResponse.json({ error: "Feed not found" }, { status: 404 });

  const result = await syncFeed(feed, "manual").catch((e: any) => ({
    ok: false,
    feedId,
    status: "error" as const,
    totalEvents: 0,
    imported: 0,
    removed: 0,
    skipped: 0,
    error: e?.message || "Sync failed",
    durationMs: 0,
  }));

  logAdminAction({
    admin,
    action: "channel_feed_resync",
    targetType: "channel_feed",
    targetId: feedId,
  } as any);

  return NextResponse.json({ ok: result.ok, result });
}
