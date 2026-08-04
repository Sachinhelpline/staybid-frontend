import { NextResponse } from "next/server";
import { cronAuthGuard } from "@/lib/cron/auth";
import { sbSelect, SB } from "@/lib/onboard/supabase-admin";
import { computeRoomDatePrice } from "@/lib/pricing/spine";
import { resolveEngineConfig } from "@/lib/pricing/engine-config-store";

// ════════════════════════════════════════════════════════════════
// v165 Phase A — pricing-spine recompute cron.
//
// For every room × the next HORIZON_DAYS dates, computes the unified
// spine prices (live / bid-floor / flash) and upserts them into
// `room_date_price`. This is the single source of truth Phase C will
// wire the hotel page / /bid / flash to.
//
// PURELY ADDITIVE — nothing reads `room_date_price` yet, so a failure
// here cannot break any user-facing flow; it just leaves the cache
// stale. The existing `/api/cron/pricing` engine is untouched.
//
// Schedule on cron-job.org (Vercel's 2-cron Hobby cap is already used
// by /api/cron/pricing + /api/cron/lifecycle):
//   GET /api/cron/price-spine?token=<CRON_SECRET>   — hourly
//
// Token-protected so a random hit doesn't trigger the batch work.
// ════════════════════════════════════════════════════════════════
export const maxDuration = 60;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HORIZON_DAYS = 75;   // how far ahead to price (nobody books past this)
const UPSERT_BATCH = 500;  // rows per PostgREST upsert call

const OCCUPIED_STATUSES = ["ACCEPTED", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"];

function dayStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function upsertRows(rows: any[]): Promise<number> {
  let done = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const chunk = rows.slice(i, i + UPSERT_BATCH);
    const res = await fetch(`${SB.url}/rest/v1/room_date_price`, {
      method: "POST",
      headers: {
        apikey: SB.key,
        Authorization: `Bearer ${SB.key}`,
        "Content-Type": "application/json",
        // PK is (room_id, date) → merge-duplicates upserts on it.
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw new Error(`upsert failed: ${res.status} ${await res.text()}`);
    done += chunk.length;
  }
  return done;
}

export async function GET(req: Request) {
  const authFail = cronAuthGuard(req);
  if (authFail) return authFail;

  const t0 = Date.now();
  const out: any = { rooms: 0, dates: HORIZON_DAYS, rowsWritten: 0, errors: [] };

  try {
    // ── 0. Admin-tuned pricing-engine config (fail-open to hardcoded
    //       defaults). Loaded ONCE per run and passed into every compute so
    //       the WRITTEN prices reflect the admin's tuning. ─────────────────
    const engineCfg = await resolveEngineConfig();

    // ── 1. Load hotels (id → city) ──────────────────────────────────
    const hotels = await sbSelect<any>("hotels", `select=id,city&limit=500`);
    const cityOf: Record<string, string> = {};
    for (const h of hotels) cityOf[h.id] = h.city || "";

    // ── 2. Load rooms ───────────────────────────────────────────────
    const rooms = await sbSelect<any>(
      "rooms",
      `select=id,hotelId,floorPrice,mrp,flashFloorPrice,quantity&limit=2000`
    );
    out.rooms = rooms.length;
    if (rooms.length === 0) {
      out.elapsedMs = Date.now() - t0;
      return NextResponse.json({ ...out, note: "no rooms" });
    }

    // ── 3. Competitor min per room (from the existing pricing engine) ─
    const compRows = await sbSelect<any>(
      "room_pricing_config",
      `select=room_id,competitor_min&limit=2000`
    ).catch(() => []);
    const compOf: Record<string, number | null> = {};
    for (const c of compRows) {
      const v = Number(c.competitor_min);
      if (v > 0) compOf[c.room_id] = v;
    }

    // ── 4. Hotel total units + occupied-bid windows for per-date
    //       vacancy. One bids query, then everything is in-memory. ────
    const unitsOf: Record<string, number> = {};
    for (const r of rooms) {
      unitsOf[r.hotelId] = (unitsOf[r.hotelId] || 0) + (Number(r.quantity) || 1);
    }
    const todayStr = dayStr(new Date());
    const bids = await sbSelect<any>(
      "bids",
      `select=hotelId,checkIn,checkOut,status&status=in.(${OCCUPIED_STATUSES.join(",")})` +
        `&checkOut=gte.${todayStr}&limit=5000`
    ).catch(() => []);
    // bidsByHotel[hotelId] = [{ ci: ms, co: ms }]
    const bidsByHotel: Record<string, { ci: number; co: number }[]> = {};
    for (const b of bids) {
      const ci = Date.parse(b.checkIn);
      const co = Date.parse(b.checkOut);
      if (!Number.isFinite(ci) || !Number.isFinite(co)) continue;
      (bidsByHotel[b.hotelId] ||= []).push({ ci, co });
    }

    // ── 5. Build the date list (next HORIZON_DAYS, from today) ──────
    const base = new Date();
    base.setHours(12, 0, 0, 0);
    const dates: { iso: string; ms: number }[] = [];
    for (let i = 0; i < HORIZON_DAYS; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      dates.push({ iso: dayStr(d), ms: d.getTime() });
    }

    // ── 6. Compute every (room, date) row ───────────────────────────
    const rows: any[] = [];
    for (const r of rooms) {
      const city = cityOf[r.hotelId] || "";
      const totalUnits = Math.max(1, unitsOf[r.hotelId] || 1);
      const hotelBids = bidsByHotel[r.hotelId] || [];
      for (const dt of dates) {
        // occupied units on this date = overlapping accepted bids
        let occupied = 0;
        for (const w of hotelBids) {
          if (w.ci <= dt.ms && dt.ms < w.co) occupied++;
        }
        const vacancyRatio = Math.min(1, occupied / totalUnits);
        const spine = computeRoomDatePrice({
          floorPrice: Number(r.floorPrice) || 0,
          mrp: Number(r.mrp) || 0,
          flashFloorPrice: Number(r.flashFloorPrice) || 0,
          city,
          date: dt.iso,
          vacancyRatio,
          competitorMin: compOf[r.id] ?? null,
          engineCfg,
        });
        rows.push({
          room_id: r.id,
          hotel_id: r.hotelId,
          date: dt.iso,
          base_rate: spine.baseRate,
          live_price: spine.livePrice,
          bid_floor: spine.bidFloor,
          flash_price: spine.flashPrice,
          flash_floor: spine.flashFloor,
          competitor_min: spine.competitorMin,
          vacancy_ratio: spine.vacancyRatio,
          demand_score: spine.demandScore,
          factors: spine.factors,
          computed_at: new Date().toISOString(),
        });
      }
    }

    // ── 7. Upsert in batches ────────────────────────────────────────
    out.rowsWritten = await upsertRows(rows);
  } catch (e: any) {
    out.errors.push(e?.message || String(e));
  }

  out.elapsedMs = Date.now() - t0;
  const status = out.errors.length && out.rowsWritten === 0 ? 500 : 200;
  return NextResponse.json(out, { status });
}
