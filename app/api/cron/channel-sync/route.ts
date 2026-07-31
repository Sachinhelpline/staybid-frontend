// v315 — Channel Manager Phase 1: scheduled OTA feed sync.
//
// THE piece that turns the iCal importer from "fire-once-on-demand" into a
// real channel manager: every 15 min (cron-job.org) this sweeps all active
// auto-sync feeds whose lastSyncAt is older than their per-feed interval and
// runs the SAME shared engine the manual route uses (reconciliation incl.).
//
// Discipline (v241.24/.27): internal budget ≤24s so cron-job.org's ~30s
// client timeout never fires; parallel batches; per-feed fetch timeout lives
// inside syncFeed. Partial completion is safe — the next run converges.
//
// Auth (matches /api/cron/expire-holds): ?token= OR Bearer CRON_SECRET.
//
// cron-job.org schedule: */15 * * * *  →
//   https://www.staybids.in/api/cron/channel-sync?token=<CRON_SECRET>
//
import { NextRequest, NextResponse } from "next/server";
import { cronAuthGuard } from "@/lib/cron/auth";
import { sbSelect } from "@/lib/sb-server";
import { syncFeed, SyncResult } from "@/lib/channels/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TIME_BUDGET_MS = 24_000;
const BATCH = 5;
const MAX_FEEDS_PER_RUN = 40;


/** ota_feeds timestamps may come back tz-less (timestamp without time zone)
 *  — parse as UTC, same trap as the v241.26 parseDbTime fix. */
function parseDbTs(v: any): number {
  const s = String(v || "");
  if (!s) return 0;
  const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(s);
  const t = Date.parse(hasTz ? s : s + "Z");
  return Number.isFinite(t) ? t : 0;
}

async function run(req: NextRequest) {
  {
    const authFail = cronAuthGuard(req);
    if (authFail) return authFail;
  }const started = Date.now();

  let feeds: any[] = [];
  try {
    const rows = await sbSelect(`ota_feeds?active=eq.true&select=*&limit=500`);
    if (Array.isArray(rows)) feeds = rows;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "feed read failed" }, { status: 500 });
  }

  const now = Date.now();
  const due = feeds
    .filter((f) => {
      if (f.autoSync === false) return false; // paused (column absent = pre-v315 = treat as on)
      const intervalMs = Math.min(1440, Math.max(15, Number(f.syncIntervalMin) || 30)) * 60_000;
      const last = parseDbTs(f.lastSyncAt);
      return !last || now - last >= intervalMs;
    })
    // oldest-synced first so nothing starves
    .sort((a, b) => parseDbTs(a.lastSyncAt) - parseDbTs(b.lastSyncAt))
    .slice(0, MAX_FEEDS_PER_RUN);

  let synced = 0;
  let failed = 0;
  let imported = 0;
  let removed = 0;
  let skippedDueToBudget = 0;
  const results: Array<Pick<SyncResult, "feedId" | "status" | "imported" | "removed" | "error">> = [];

  for (let i = 0; i < due.length; i += BATCH) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      skippedDueToBudget = due.length - i;
      break;
    }
    const batch = due.slice(i, i + BATCH);
    const settled = await Promise.all(
      batch.map((f) =>
        syncFeed(f, "cron").catch(
          (e): SyncResult => ({
            ok: false,
            feedId: String(f.id),
            status: "error",
            totalEvents: 0,
            imported: 0,
            removed: 0,
            skipped: 0,
            error: e?.message || "sync threw",
            durationMs: 0,
          })
        )
      )
    );
    settled.forEach((r) => {
      if (r.ok) { synced++; imported += r.imported; removed += r.removed; }
      else failed++;
      results.push({ feedId: r.feedId, status: r.status, imported: r.imported, removed: r.removed, error: r.error });
    });
  }

  return NextResponse.json({
    ok: true,
    feedsActive: feeds.length,
    due: due.length,
    synced,
    failed,
    imported,
    removed,
    skippedDueToBudget,
    durationMs: Date.now() - started,
    results,
  });
}

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
