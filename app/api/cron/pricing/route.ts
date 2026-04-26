import { NextResponse } from "next/server";
import { sbSelect } from "@/lib/onboard/supabase-admin";
import { scrapeAndPersist } from "@/lib/pricing/scraper";
import { recalculateRoomPrice } from "@/lib/pricing/engine";
import { processFlashDeals } from "@/lib/pricing/flash";

// GET /api/cron/pricing  — single endpoint Vercel Cron hits hourly.
// Runs (in order):
//   1. scrape competitor prices for every active hotel
//   2. recalculate price for every room
//   3. process active flash deals (drop / rise)
//
// Add to vercel.json:
//   { "crons": [ { "path": "/api/cron/pricing", "schedule": "0 */2 * * *" } ] }
//
// Token-protected via CRON_SECRET so a random hit doesn't trigger heavy work.
export const maxDuration = 60;
export const runtime = "nodejs";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") || req.headers.get("x-cron-secret") || "";
  const expected = process.env.CRON_SECRET || "staybid-cron-dev";
  if (token !== expected) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const t0 = Date.now();
  const out: any = { scraped: 0, recalculated: 0, flashUpdated: 0, errors: [] };

  // 1. Scrape every active hotel
  try {
    const hotels = await sbSelect<any>("hotels", `select=id&status=neq.suspended&limit=200`);
    for (const h of hotels) {
      try { await scrapeAndPersist(h.id); out.scraped++; }
      catch (e: any) { out.errors.push({ hotel: h.id, step: "scrape", error: e?.message }); }
    }
  } catch (e: any) { out.errors.push({ step: "list_hotels", error: e?.message }); }

  // 2. Recalculate every room
  try {
    const rooms = await sbSelect<any>("rooms", `select=id&limit=500`);
    for (const r of rooms) {
      try { await recalculateRoomPrice(r.id); out.recalculated++; }
      catch (e: any) { out.errors.push({ room: r.id, step: "recalc", error: e?.message }); }
    }
  } catch (e: any) { out.errors.push({ step: "list_rooms", error: e?.message }); }

  // 3. Flash deal drop / rise
  try {
    const fd = await processFlashDeals();
    out.flashUpdated = fd.updated;
    out.flashScanned = fd.scanned;
  } catch (e: any) { out.errors.push({ step: "flash", error: e?.message }); }

  out.elapsedMs = Date.now() - t0;
  return NextResponse.json(out);
}
