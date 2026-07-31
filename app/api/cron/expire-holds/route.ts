// Cron endpoint — sweeps expired holds + acceptance windows.
//
// Set up as a Vercel Cron (vercel.json) OR external scheduler (cron-job.org,
// EasyCron, GitHub Actions). Recommended frequency: every 1 minute for the
// acceptance-window timer, every 5-10 min works too if you accept a small
// post-expiry grace.
//
// Auth — supports two patterns:
//   1) Vercel Cron native — req.headers.get("authorization") === Bearer CRON_SECRET
//   2) Admin manual trigger — req.headers.get("x-admin-token") === sb_admin_token
//                              (any admin from a logged-in session can hit it)
//
// Returns the row counts touched so the caller can log/alert if it's stuck.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";



async function authorized(req: NextRequest): Promise<boolean> {
  // Pattern 1: ?token=... query param — matches the other crons in vercel.json
  const { searchParams } = new URL(req.url);
  const qToken = searchParams.get("token");
  const expectedToken = process.env.CRON_TOKEN || "staybid-cron-dev";
  if (qToken && qToken === expectedToken) return true;

  // Pattern 2: Vercel's native cron bearer
  const cronAuth = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && cronAuth === `Bearer ${cronSecret}`) return true;

  // Pattern 3: Admin manual trigger from /admin/holds page

  return false;
}

async function runRpc() {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/mark_expired_holds`, {
    method: "POST",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d?.message || `RPC failed with ${r.status}`);
  }
  return r.json();
}

// v193 — mirrors lib/bid-expiry.ts. Flips DB rows for stale PENDING bids
// so the row state matches what the customer / partner already see hidden
// at the client filter. Best-effort: a failure here MUST NOT break the
// main hold/window sweep — return zeros instead of throwing.
//
// v229 — Now also returns counter_expired (stale COUNTER >6h past expiresAt)
// from the same RPC. Schema-compatible — extra column is additive.
async function runStalePendingBidsRpc(): Promise<{ unscheduled_expired: number; scheduled_expired: number; counter_expired: number }> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/mark_stale_pending_bids`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    if (!r.ok) return { unscheduled_expired: 0, scheduled_expired: 0, counter_expired: 0 };
    const rows = await r.json().catch(() => []);
    const row = Array.isArray(rows) ? rows[0] : rows;
    return {
      unscheduled_expired: Number(row?.unscheduled_expired || 0),
      scheduled_expired:   Number(row?.scheduled_expired   || 0),
      counter_expired:     Number(row?.counter_expired     || 0),
    };
  } catch {
    return { unscheduled_expired: 0, scheduled_expired: 0, counter_expired: 0 };
  }
}

// v229 — Flips ACCEPTED bids to EXPIRED when their bid_acceptance_window
// is expired/cancelled AND no payment landed. The window-sweep alone wasn't
// enough — bids.status='ACCEPTED' rows hung around forever showing "Pay Now"
// in /my-bids long after the 15-min window died. See
// mark_orphaned_accepted_bids() in migration v229_bid_washout_completeness.
async function runOrphanedAcceptedBidsRpc(): Promise<{ orphaned_expired: number }> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/mark_orphaned_accepted_bids`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    if (!r.ok) return { orphaned_expired: 0 };
    const rows = await r.json().catch(() => []);
    const row = Array.isArray(rows) ? rows[0] : rows;
    return { orphaned_expired: Number(row?.orphaned_expired || 0) };
  } catch {
    return { orphaned_expired: 0 };
  }
}

// Phase 8: send confirmation emails for bids the RPC just flipped to
// ACCEPTED. Looks for bids that were ACCEPTED within the last cron-window
// interval, joined with user email + hotel/room/dates for the template.
// Best-effort — errors here don't break the cron response.
async function sendEmailsForRecentlyAccepted(origin: string, sinceMs: number) {
  try {
    const sinceIso = new Date(Date.now() - sinceMs).toISOString();
    // Look for bids that auto-accepted recently AND haven't had email logged.
    // We use auto_accept_at as the trigger time (set when scheduled). The
    // RPC just flipped status=PENDING -> ACCEPTED for these.
    const r = await fetch(
      `${SB_URL}/rest/v1/bids?status=eq.ACCEPTED&auto_accept_at=gte.${encodeURIComponent(sinceIso)}&auto_accept_at=lte.${encodeURIComponent(new Date().toISOString())}&select=*&limit=50`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    if (!r.ok) return { emails_sent: 0 };
    const bids: any[] = await r.json().catch(() => []);
    let sent = 0;
    for (const bid of bids) {
      try {
        const rUser = await fetch(
          `${SB_URL}/rest/v1/users?id=eq.${encodeURIComponent(bid.customerId)}&select=email,name,phone`,
          { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
        );
        const userRow = ((await rUser.json().catch(() => [])) as any[])[0];
        if (!userRow?.email) continue;

        const rHotel = await fetch(
          `${SB_URL}/rest/v1/hotels?id=eq.${encodeURIComponent(bid.hotelId)}&select=name,city`,
          { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
        );
        const hotel = ((await rHotel.json().catch(() => [])) as any[])[0];

        const rRoom = await fetch(
          `${SB_URL}/rest/v1/rooms?id=eq.${encodeURIComponent(bid.roomId)}&select=type,name`,
          { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
        );
        const room = ((await rRoom.json().catch(() => [])) as any[])[0];

        const rReq = await fetch(
          `${SB_URL}/rest/v1/bid_requests?id=eq.${encodeURIComponent(bid.requestId || "")}&select=checkIn,checkOut,guests`,
          { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
        );
        const reqRow = ((await rReq.json().catch(() => [])) as any[])[0];

        const checkIn  = reqRow?.checkIn  || new Date().toISOString();
        const checkOut = reqRow?.checkOut || new Date(Date.now() + 86400000).toISOString();
        const nights   = Math.max(1, Math.ceil((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000));

        await fetch(`${origin}/api/email/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: userRow.email,
            bookingDetails: {
              bookingId: bid.id,
              hotelName: hotel?.name || "Your hotel",
              roomType:  room?.name || room?.type || "Room",
              checkIn, checkOut,
              guests: reqRow?.guests || 2,
              nights,
              amount: Number(bid.amount || 0) * nights,
              city: hotel?.city,
            },
          }),
        });
        sent += 1;
      } catch { /* skip this bid, continue */ }
    }
    return { emails_sent: sent };
  } catch {
    return { emails_sent: 0 };
  }
}

// Cron runs every 5 min — look 6 min back to give a small overlap window.
const EMAIL_LOOKBACK_MS = 6 * 60 * 1000;

async function runAll(origin: string) {
  const rpcResult = await runRpc();
  // v193 — also sweep stale PENDING (and v229 also COUNTER) bids.
  // Independent of the hold/window RPC; failures swallowed inside.
  const stalePendingResult = await runStalePendingBidsRpc();
  // v229 — orphaned ACCEPTED-unpaid bids whose acceptance_window expired.
  // bids.status='ACCEPTED' rows would otherwise sit forever showing "Pay
  // Now" in /my-bids even though the 15-min window is dead.
  const orphanedAcceptedResult = await runOrphanedAcceptedBidsRpc();
  // Only sweep emails if the RPC actually flipped bids in this run
  if ((rpcResult as any)?.bids_accepted > 0) {
    const emailResult = await sendEmailsForRecentlyAccepted(origin, EMAIL_LOOKBACK_MS);
    return { ...rpcResult, ...stalePendingResult, ...orphanedAcceptedResult, ...emailResult };
  }
  return { ...rpcResult, ...stalePendingResult, ...orphanedAcceptedResult, emails_sent: 0 };
}

export async function GET(req: NextRequest) {
  if (!await authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const origin = req.nextUrl?.origin || "https://www.staybids.in";
    const result = await runAll(origin);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// POST allows the same — admin button calls POST so the action isn't cached.
export async function POST(req: NextRequest) {
  if (!await authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const origin = req.nextUrl?.origin || "https://www.staybids.in";
    const result = await runAll(origin);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
