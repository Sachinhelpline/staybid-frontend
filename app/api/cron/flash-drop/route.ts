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

import { NextResponse } from "next/server";
import { sbSelect } from "@/lib/onboard/supabase-admin";
import { recalculateRoomPrice } from "@/lib/pricing/engine";
import { processFlashDeals } from "@/lib/pricing/flash";

export const maxDuration = 30;
export const runtime = "nodejs";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") || req.headers.get("x-cron-secret") || "";
  const expected = process.env.CRON_SECRET || "staybid-cron-dev";
  if (token !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const t0 = Date.now();
  const out: any = { recalculated: 0, flashUpdated: 0, flashScanned: 0, errors: [] };

  // 1. Recalculate every room — purely DB-bound. Should complete in <2s for
  //    38 rooms. We run them in parallel batches of 5 so a single slow room
  //    doesn't block the others.
  try {
    const rooms = await sbSelect<any>("rooms", `select=id&limit=500`);
    const BATCH = 5;
    for (let i = 0; i < rooms.length; i += BATCH) {
      const slice = rooms.slice(i, i + BATCH);
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

  // 2. Flash deal drop / rise
  try {
    const fd = await processFlashDeals();
    out.flashUpdated = fd.updated;
    out.flashScanned = fd.scanned;
  } catch (e: any) {
    out.errors.push({ step: "flash", error: e?.message });
  }

  out.elapsedMs = Date.now() - t0;
  return NextResponse.json(out);
}
