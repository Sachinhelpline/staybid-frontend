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
const OCCUPANCY_PAGE_SIZE = 500;  // deterministic pagination window size

const OCCUPIED_STATUSES = ["ACCEPTED", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"];

// Pure occupancy calculation helper — testable in isolation.
// Returns SUM(bid.numRooms) for all bids overlapping the given date.
// A bid overlaps [date, date+1) if bid.checkIn <= date AND date < bid.checkOut.
export function calculateOccupancyForDate(
  windows: Array<{ ci: number; co: number; numRooms: number }>,
  dateMs: number
): number {
  let occupied = 0;
  for (const w of windows) {
    if (w.ci <= dateMs && dateMs < w.co) {
      occupied += w.numRooms;
    }
  }
  return occupied;
}

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
    //       vacancy. Load bids with FK-joined bid_requests for dates,
    //       then everything is in-memory. FAIL-CLOSED on integrity failure. ──
    const unitsOf: Record<string, number> = {};
    for (const r of rooms) {
      unitsOf[r.hotelId] = (unitsOf[r.hotelId] || 0) + (Number(r.quantity) || 1);
    }
    const todayStr = dayStr(new Date());
    const today = Date.parse(todayStr);

    // Preflight integrity check: fail-closed if any occupied-status bid has no requestId.
    // This prevents silent occupancy undercounting BEFORE we load occupancy windows.
    const orphanedBids = await sbSelect<any>(
      "bids",
      `select=id&status=in.(${OCCUPIED_STATUSES.join(",")})&requestId=is.null&limit=1`
    );
    if (orphanedBids.length > 0) {
      throw new Error(`Occupancy integrity violation: occupied bid ${orphanedBids[0].id} has no requestId`);
    }

    // Load bids with their linked bid_requests via FK embedding, with deterministic pagination.
    // Use !inner syntax to enforce INNER join semantics (not LEFT join default).
    // Filter bid_requests.checkOut >= today at database level to avoid silent truncation.
    // Pagination: load in bounded pages, ordered by bid ID for determinism.
    const bidsByHotel: Record<string, { ci: number; co: number; numRooms: number }[]> = {};
    let pageOffset = 0;
    let hasMore = true;

    while (hasMore) {
      const bidsWithRequests = await sbSelect<any>(
        "bids",
        `select=id,hotelId,requestId,status,numRooms,bid_requests!inner(id,checkIn,checkOut)` +
          `&status=in.(${OCCUPIED_STATUSES.join(",")})` +
          `&bid_requests.checkOut=gte.${todayStr}` +
          `&order=id.asc` +
          `&limit=${OCCUPANCY_PAGE_SIZE}` +
          `&offset=${pageOffset}`
      ).catch(() => []);

      if (bidsWithRequests.length === 0) {
        hasMore = false;
        break;
      }

      for (const b of bidsWithRequests) {
        if (!b.requestId || !b.bid_requests) {
          throw new Error(`Occupancy integrity violation: bid ${b.id} missing requestId or bid_requests (should not reach here after preflight)`);
        }

        const req = b.bid_requests;
        const ci = Date.parse(req.checkIn);
        const co = Date.parse(req.checkOut);

        if (!Number.isFinite(ci) || !Number.isFinite(co)) {
          throw new Error(`Occupancy date parse failure: bid ${b.id} checkIn=${req.checkIn} checkOut=${req.checkOut}`);
        }

        // Redundant check (database already filtered checkOut >= today), kept for safety.
        if (co <= today) continue;

        // Normalize numRooms: default 1 for legacy bids, but prevent non-positive values.
        const numRooms = Math.max(1, Number(b.numRooms) || 1);
        (bidsByHotel[b.hotelId] ||= []).push({ ci, co, numRooms });
      }

      if (bidsWithRequests.length < OCCUPANCY_PAGE_SIZE) {
        hasMore = false;
      } else {
        pageOffset += OCCUPANCY_PAGE_SIZE;
      }
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
        // occupied units on this date = SUM(bid.numRooms for overlapping bids)
        // This accounts for multi-room bids; single-room bids default to numRooms=1.
        const occupied = calculateOccupancyForDate(hotelBids, dt.ms);
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
