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
//   • TIME_BUDGET_MS guard aborts gracefully at 50 sec so the response
//     always returns within the platform limit even if the workload
//     grows. Partial completion is fine — cron-job.org will pick up
//     the rest on its next scheduled hit (15-30 min later).
//   • Flash deals processed in PARALLEL batches of 5 instead of
//     sequential. With N deals each making 4 DB roundtrips, sequential
//     was the silent killer on slow Supabase windows.

import { NextResponse } from "next/server";
import { sbSelect } from "@/lib/onboard/supabase-admin";
import { recalculateRoomPrice } from "@/lib/pricing/engine";
import { processFlashDeals } from "@/lib/pricing/flash";

export const maxDuration = 60;
export const runtime = "nodejs";

const TIME_BUDGET_MS = 50_000;          // abort before maxDuration triggers
const ROOM_BATCH = 5;
const ROOM_RECALC_BUDGET_MS = 35_000;   // leave ≥15s for flash deals

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") || req.headers.get("x-cron-secret") || "";
  const expected = process.env.CRON_SECRET || "staybid-cron-dev";
  if (token !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

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
          try { await recalculateRoomPrice(r.id); out.recalculated++; }
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
