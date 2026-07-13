// v315 — Channel Manager Phase 1: manual "Sync now" (hardened).
//
// Thin wrapper over the shared engine in lib/channels/sync — the SAME code
// path the cron uses, so manual + scheduled runs can never drift.
// Pre-v315 this route accepted any JWT and never reconciled cancellations.
// Response contract preserved for the dashboard ({ok,totalEvents,imported,
// skipped}) + new `removed` count (OTA cancellations released).
//
import { NextRequest, NextResponse } from "next/server";
import { sbSelect } from "@/lib/sb-server";
import { partnerUnitScope, canManageUnitRow } from "@/lib/partner/hotel-scope";
import { syncFeed } from "@/lib/channels/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  // v326 — per-unit scope: a unit-scoped investor can only sync feeds on a
  // unit they own; the classic full-hotel owner syncs everything.
  const scope = await partnerUnitScope(req);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const feedId = String(body.feedId || "");
  if (!feedId) return NextResponse.json({ error: "feedId required" }, { status: 400 });

  const rows = await sbSelect(
    `ota_feeds?id=eq.${encodeURIComponent(feedId)}&select=*`
  ).catch(() => []);
  const feed = rows?.[0];
  if (!feed) return NextResponse.json({ error: "Feed not found" }, { status: 404 });
  if (!canManageUnitRow(scope, feed.hotelId, feed.unitId ?? null))
    return NextResponse.json({ error: "Not your feed" }, { status: 403 });

  const result = await syncFeed(feed, "manual");
  if (!result.ok) {
    return NextResponse.json({ error: result.error || "Sync failed", ...result }, { status: 502 });
  }
  return NextResponse.json(result);
}
