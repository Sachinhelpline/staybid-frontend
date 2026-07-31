// GET /api/cron/flash-drop
//
// v126.4 — FAST cron for sub-hourly flash deal drops + room AI recalc.
// Skips the slow competitor-scraping step that lives in /api/cron/pricing —
// that's still run daily via Vercel cron for fresh competitor benchmarks.
//
// Typical runtime: 3-8 seconds (vs 60-150s for the full pricing cron).
// Designed to be hit every 15-30 min by cron-job.org without timing out.
//
// Steps:
//   1. Recalculate every room (math + DB only, no network)
//   2. Process active flash deals (drop / rise based on intervals)
//
// Same token gate as the slow cron, so admin can flip cron-job.org
// without rotating secrets.
//
// v241.24 — Hardened against timeouts:
//   • maxDuration bumped 30 → 60 sec (Vercel Pro / Hobby tolerance)
//   • Flash deals + room recalc processed in PARALLEL batches.
//
// v241.27 — Fix recurring cron-job.org "Timeout" emails. Root cause: the
// internal budgets (35s recalc / 50s total) were set ABOVE cron-job.org's
// ~30s HTTP client timeout, so cron-job.org gave up and reported "Timeout"
// while the Vercel function kept running to 50s. With 64 rooms × ~6
// sequential DB roundtrips each and only 5-way parallelism, a slow Supabase
// window pushed the recalc past 30s. Three changes keep the response well
// inside cron-job.org's window:
//   • Budgets lowered below ~30s: total 24s, recalc 17s (≥7s left for flash
//     deals + serialising the response). Partial completion is fine — recalc
//     is idempotent and the next 15-30 min run picks up the rest.
//   • Parallelism raised 5 → 10 so all 64 rooms normally finish in ~12-17s.
//   • Per-room timeout so a single hung query (fetch has no default timeout
//     in Node) can't stall its whole batch.
// NOT caused by the v241.26 bid/accept work — flash-drop is a separate path.

import { NextResponse } from "next/server";
import { cronAuthGuard } from "@/lib/cron/auth";
import { sbSelect } from "@/lib/onboard/supabase-admin";
import { recalculateRoomPrice } from "@/lib/pricing/engine";
import { processFlashDeals } from "@/lib/pricing/flash";

export const maxDuration = 60;
export const runtime = "nodejs";

const TIME_BUDGET_MS = 24_000;          // return INSIDE cron-job.org's ~30s HTTP timeout
const ROOM_BATCH = 10;                  // 64 rooms → ~7 batches
const ROOM_RECALC_BUDGET_MS = 17_000;   // leave ≥7s for flash deals + response
const PER_ROOM_TIMEOUT_MS = 4_000;      // one hung query must not stall its batch

// Bound a promise so a single slow/hung DB roundtrip can't blow the budget.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms)),
  ]);
}

export async function GET(req: Request) {
  const authFail = cronAuthGuard(req);
  if (authFail) return authFail;

  const t0 = Date.now();
  const out: any = {
    recalculated: 0,
    flashUpdated: 0,
    flashScanned: 0,
    skippedDueToBudget: 0,
    errors: [] as any[],
  };
  const budgetRemaining = () => TIME_BUDGET_MS - (Date.now() - t0);

  // 1. Recalculate every room — purely DB-bound. Should complete in <2s for
  //    38 rooms. We run them in parallel batches so a single slow room
  //    doesn't block the others. v241.24 — guard per batch with
  //    ROOM_RECALC_BUDGET_MS so we always leave time for flash deals.
  try {
    const rooms = await sbSelect<any>("rooms", `select=id&limit=500`);
    for (let i = 0; i < rooms.length; i += ROOM_BATCH) {
      if (Date.now() - t0 > ROOM_RECALC_BUDGET_MS) {
        out.skippedDueToBudget = rooms.length - i;
        break;
      }
      const slice = rooms.slice(i, i + ROOM_BATCH);
      await Promise.all(
        slice.map(async (r: any) => {
          try { await withTimeout(recalculateRoomPrice(r.id), PER_ROOM_TIMEOUT_MS); out.recalculated++; }
          catch (e: any) { out.errors.push({ room: r.id, error: e?.message }); }
        }),
      );
    }
  } catch (e: any) {
    out.errors.push({ step: "list_rooms", error: e?.message });
  }

  // 2. Flash deal drop / rise — only if there's budget remaining.
  if (budgetRemaining() > 5_000) {
    try {
      const fd = await processFlashDeals();
      out.flashUpdated = fd.updated;
      out.flashScanned = fd.scanned;
    } catch (e: any) {
      out.errors.push({ step: "flash", error: e?.message });
    }
  } else {
    out.errors.push({ step: "flash", error: "skipped — budget exhausted" });
  }

  out.elapsedMs = Date.now() - t0;
  return NextResponse.json(out);
}
