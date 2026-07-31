// Cron endpoint — fires the post-stay "share your trip" nudge.
//
// Finds users with bookings that checked out 24-48h ago and queues a
// notification + records an inspiration_nudges row (idempotent via the
// uniq_insp_user_booking_type unique index added in Phase 1).
//
// Schedule (cron-job.org):
//   GET https://staybids.in/api/cron/post-stay-nudge?token=<CRON_SECRET>
//   Frequency: every 1 day (any time after midnight IST)
//
// Auth — matches the other crons.
//
// No reward credit at this step — just the nudge. Phase 6's
// view-milestone-rewards cron handles the ₹50 / ₹200 wallet credits
// AFTER the user has actually posted and the post has earned views.
import { NextRequest, NextResponse } from "next/server";
import { cronAuthGuard } from "@/lib/cron/auth";
import { SB_URL, SB_KEY } from "@/lib/sb";
import { queueNotification } from "@/lib/notify-server";

const HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const READ_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };


// Window: checkOut between 24h ago and 48h ago. Far enough that the
// guest has settled at home and is reviewing photos; close enough that
// the trip is still fresh. Configurable via env vars without redeploy.
const WINDOW_FROM_MS =
  parseInt(process.env.POST_STAY_NUDGE_FROM_HOURS || "48", 10) * 3_600_000;
const WINDOW_TO_MS =
  parseInt(process.env.POST_STAY_NUDGE_TO_HOURS || "24", 10) * 3_600_000;

const MAX_PER_RUN = 500;

async function sweep(): Promise<{
  scanned_bookings: number;
  scanned_bids: number;
  nudged: number;
  skipped_dupes: number;
  errors: string[];
}> {
  const now = Date.now();
  const fromIso = new Date(now - WINDOW_FROM_MS).toISOString(); // older bound
  const toIso = new Date(now - WINDOW_TO_MS).toISOString(); // newer bound
  const errors: string[] = [];

  // Source 1: bookings table — straightforward checkOut column
  const bookingsRes = await fetch(
    `${SB_URL}/rest/v1/bookings` +
      `?status=eq.CHECKED_OUT` +
      `&checkOut=gte.${encodeURIComponent(fromIso)}` +
      `&checkOut=lt.${encodeURIComponent(toIso)}` +
      `&select=id,customerId,hotelId,checkOut` +
      `&limit=${MAX_PER_RUN}`,
    { headers: READ_HEADERS, cache: "no-store" }
  );
  const bookings = (bookingsRes.ok ? await bookingsRes.json().catch(() => []) : []) as any[];

  // Source 2: bids with status='CHECKED_OUT' — need bid_requests join for checkOut
  const bidsRes = await fetch(
    `${SB_URL}/rest/v1/bids` +
      `?status=eq.CHECKED_OUT` +
      `&select=id,customerId,hotelId,requestId` +
      `&limit=${MAX_PER_RUN}`,
    { headers: READ_HEADERS, cache: "no-store" }
  );
  const allBids = (bidsRes.ok ? await bidsRes.json().catch(() => []) : []) as any[];

  // Hydrate bid_requests in batch to get checkOut
  const reqIds = Array.from(new Set(allBids.map((b) => b.requestId).filter(Boolean)));
  let bidsInWindow: any[] = [];
  if (reqIds.length) {
    const rr = await fetch(
      `${SB_URL}/rest/v1/bid_requests?id=in.(${reqIds.map(encodeURIComponent).join(",")})&select=id,checkOut`,
      { headers: READ_HEADERS, cache: "no-store" }
    );
    const reqRows = (rr.ok ? await rr.json().catch(() => []) : []) as any[];
    const byId = new Map(reqRows.map((r: any) => [r.id, r]));
    const fromMs = now - WINDOW_FROM_MS;
    const toMs = now - WINDOW_TO_MS;
    bidsInWindow = allBids
      .map((b) => {
        const r = byId.get(b.requestId);
        if (!r?.checkOut) return null;
        const co = Date.parse(r.checkOut);
        if (!Number.isFinite(co) || co < fromMs || co >= toMs) return null;
        return {
          id: b.id,
          customerId: b.customerId,
          hotelId: b.hotelId,
          checkOut: r.checkOut,
          source: "bid" as const,
        };
      })
      .filter(Boolean) as any[];
  }

  // Merge sources; dedupe by (user, booking-or-bid-id)
  const eligible = [
    ...bookings.map((b) => ({
      id: b.id,
      customerId: b.customerId,
      hotelId: b.hotelId,
      source: "booking" as const,
    })),
    ...bidsInWindow.map((b) => ({
      id: b.id,
      customerId: b.customerId,
      hotelId: b.hotelId,
      source: "bid" as const,
    })),
  ];

  // Side-load hotel names for the notification payload
  const hotelIds = Array.from(new Set(eligible.map((e) => e.hotelId).filter(Boolean)));
  const hotelById = new Map<string, { id: string; name?: string }>();
  if (hotelIds.length) {
    const hr = await fetch(
      `${SB_URL}/rest/v1/hotels?id=in.(${hotelIds.map(encodeURIComponent).join(",")})&select=id,name`,
      { headers: READ_HEADERS, cache: "no-store" }
    );
    if (hr.ok) {
      const arr = (await hr.json().catch(() => [])) as any[];
      arr.forEach((h: any) => hotelById.set(h.id, h));
    }
  }

  let nudged = 0;
  let skippedDupes = 0;

  for (const row of eligible) {
    if (!row.customerId || !row.id) continue;
    try {
      // INSERT into inspiration_nudges; uniq_insp_user_booking_type
      // unique index on (user_id, COALESCE(booking_id,''), nudge_type)
      // catches duplicates. Use Prefer: resolution=ignore-duplicates so
      // a dupe is a no-op, not a 409.
      const nudgeRow = {
        user_id: row.customerId,
        booking_id: row.id,
        hotel_id: row.hotelId,
        nudge_type: "post_stay_share",
        status: "SENT",
        metadata: { source: row.source, fired_by: "cron/post-stay-nudge" },
      };
      const ins = await fetch(`${SB_URL}/rest/v1/inspiration_nudges`, {
        method: "POST",
        headers: {
          ...HEADERS,
          Prefer: "return=representation,resolution=ignore-duplicates",
        },
        body: JSON.stringify([nudgeRow]),
      });
      if (!ins.ok) {
        errors.push(
          `Nudge insert ${row.id}: ${ins.status} ${await ins.text().catch(() => "")}`
        );
        continue;
      }
      const arr = (await ins.json().catch(() => [])) as any[];
      if (!arr[0]) {
        // Duplicate — already nudged for this (user, booking). Skip notif.
        skippedDupes += 1;
        continue;
      }

      // Queue the user-facing notification (in_app + Phase 6 paste will
      // add whatsapp/sms once template is registered on Railway).
      const hotel = hotelById.get(row.hotelId);
      // Fans out to enabled channels (in_app today; +sms/+whatsapp once the
      // paid-plan flag is on — "share your trip" reminder is a prime SMS use).
      await queueNotification({
        userId: row.customerId,
        template: "post_stay_nudge",
        payload: { booking_id: row.id, hotel_id: row.hotelId, hotel_name: hotel?.name || null },
      });
      nudged += 1;
    } catch (e: any) {
      errors.push(`Row ${row.id}: ${e?.message || String(e)}`);
    }
  }

  return {
    scanned_bookings: bookings.length,
    scanned_bids: bidsInWindow.length,
    nudged,
    skipped_dupes: skippedDupes,
    errors,
  };
}

export async function GET(req: NextRequest) {
  {
    const authFail = cronAuthGuard(req);
    if (authFail) return authFail;
  }
  const started = Date.now();
  const result = await sweep();
  return NextResponse.json({
    ok: true,
    duration_ms: Date.now() - started,
    window_hours: { from: WINDOW_FROM_MS / 3_600_000, to: WINDOW_TO_MS / 3_600_000 },
    ...result,
  });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
