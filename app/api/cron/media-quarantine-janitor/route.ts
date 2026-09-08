// POST /api/cron/media-quarantine-janitor — SEC-00B-P1G-2 DORMANT quarantine
// storage janitor. Authenticated cron request → dormant activation gate
// (MEDIA_QUARANTINE_JANITOR_ENABLED) → service-role-only store → ONE P1G-1 claim
// → validate → delete exact object → explicit ack → P1G-1 complete → COUNTS only.
//
// AUTH: the shared `cronAuthGuard` (Authorization: Bearer <CRON_SECRET> ONLY —
// no ?token=, no x-cron-secret, no admin bypass, no public fallback). Auth runs
// BEFORE any janitor work / feature flag / store / network.
//
// POST ONLY — no GET is exported: this endpoint performs destructive cleanup and
// no scheduler is registered yet (transport/method is a later, independently
// reviewed decision). The route reads NO request JSON and NO query values — the
// janitor takes zero caller-supplied authority (time / batch / bucket / key).
// The worker stays dormant behind MEDIA_QUARANTINE_JANITOR_ENABLED; this route
// does not set/change any environment variable.
import { NextResponse } from "next/server";
import { cronAuthGuard } from "@/lib/cron/auth";
import { runQuarantineJanitor } from "@/lib/social/quarantine-janitor";
import { createQuarantineJanitorStore } from "@/lib/social/quarantine-janitor-store";

export const runtime = "nodejs"; // service-role key is server-only; never edge
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  // 1) Cron authentication FIRST — short-circuit before any side effect.
  const denied = cronAuthGuard(req);
  if (denied) return denied;

  // 2..5) Dormant gate → store configured → claim/validate/delete/complete.
  const result = await runQuarantineJanitor({
    store: createQuarantineJanitorStore(),
    env: process.env,
  });

  if (result.status === "disabled") {
    return NextResponse.json({ error: "media_quarantine_janitor_disabled" }, { status: 503 });
  }
  if (result.status === "unconfigured") {
    return NextResponse.json({ error: "media_quarantine_janitor_unconfigured" }, { status: 503 });
  }
  if (result.status === "service_unavailable") {
    return NextResponse.json({ error: "media_quarantine_janitor_service_unavailable" }, { status: 503 });
  }

  // COUNTS ONLY — no session id / object key / bucket / provider detail.
  return NextResponse.json({ ok: true, ...result.counts }, { status: 200 });
}
