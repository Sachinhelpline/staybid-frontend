// S2 (design: CIRCLE-SETTLEMENT-ATTRIBUTION-DESIGN.md) — Circle guest-booking
// SETTLEMENT reconciler. RECORDS the owed obligation; moves NO money.
//
// Why a cron (not a booking-verify hook): the confirmed `bookings` row is created
// by the Railway backend (into the same Supabase), and there is no in-repo
// booking-confirm hook. So this reconciler scans confirmed, paid bookings and
// writes the per-payee owed `settlement_ledger` rows using the shared, verified
// attribution resolver (lib/circle/attribution.ts). Two idempotent passes:
//
//   1) SETTLE   — for each confirmed/paid, non-cancelled booking, resolve the
//                 payee PER NIGHT (block investor_user_id → unit owner_user_id →
//                 hotel/StayBid-ops), keep the Circle-attributed nights, pro-rate
//                 the paid amount, and INSERT one owed row per payee
//                 (kind='guest_booking', ref_id='<bookingId>:<payeeId>',
//                 payout_status='owed'). Idempotent via uniq_settlement_kind_ref.
//                 StayBid-retained nights (sentinel owner / classic hotel) get NO
//                 row — those stay on the existing hotel settlement (owner
//                 decision 2). The fee (12% default) is FROZEN on each row.
//   2) REVERSE  — for each now-cancelled/refunded booking, flip its still-`owed`
//                 guest_booking rows to `cancelled` (never claw back a paid row
//                 here — that's a payout-phase concern).
//
// Records obligations only. owed→paid + money-out (RazorpayX/Route) is S3
// (Railway/admin). Consistent with every other Circle money path (no auto money-out).
//
// Auth mirrors the other crons (?token= / Bearer CRON_SECRET / adm_ token).
// Register on cron-job.org: */30 * * * * →
//   https://www.staybids.in/api/cron/circle-settlement?token=staybid-cron-dev

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";
import {
  enumerateNights, resolveNightlyPayees, payeeNightCounts,
  CIRCLE_BOOKING_FEE_PCT_DEFAULT, type BlockOverlay,
} from "@/lib/circle/attribution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const MAX_PER_PASS = 200;
const LOOKBACK_DAYS = 120; // only reconcile recent/active stays (bounded scan)

async function authorized(req: NextRequest): Promise<boolean> {
  const qToken = new URL(req.url).searchParams.get("token");
  if (qToken && qToken === (process.env.CRON_TOKEN || "staybid-cron-dev")) return true;
  const cronAuth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && cronAuth === `Bearer ${process.env.CRON_SECRET}`) return true;
  const adminTok = req.headers.get("x-admin-token");
  if (adminTok && adminTok.startsWith("adm_")) return true;
  return false;
}

const csv = (xs: string[]) => xs.map((x) => encodeURIComponent(x)).join(",");
const round0 = (n: any) => Math.round(Number(n) || 0);
async function getJson(url: string): Promise<any[]> {
  try { const r = await fetch(url, { headers: SB_H }); const j = r.ok ? await r.json().catch(() => []) : []; return Array.isArray(j) ? j : []; }
  catch { return []; }
}

async function run(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const feePct = CIRCLE_BOOKING_FEE_PCT_DEFAULT;
  const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const OK = "status=not.in.(CANCELLED,cancelled,REFUNDED,refunded,FAILED,failed,PENDING,pending)";

  // Candidate confirmed/paid bookings (recent), + recently-cancelled for reversal.
  const [confirmed, cancelled] = await Promise.all([
    getJson(`${SB_URL}/rest/v1/bookings?paidAmount=gt.0&${OK}&checkOut=gte.${sinceIso}&select=id,bidId,checkIn,checkOut,paidAmount,numRooms&order=checkOut.desc&limit=${MAX_PER_PASS}`),
    getJson(`${SB_URL}/rest/v1/bookings?status=in.(CANCELLED,cancelled,REFUNDED,refunded)&checkOut=gte.${sinceIso}&select=id&limit=${MAX_PER_PASS}`),
  ]);

  // ── Pass 2 (REVERSE) first — cheap, and keeps a re-confirmed booking from being
  //    stuck cancelled if it flips back (settle pass re-inserts, ignore-dupes). ──
  let reversed = 0;
  const cancelledIds = cancelled.map((b) => String(b.id));
  for (const bid of cancelledIds) {
    try {
      // Match on metadata->>bookingId (exact) rather than ref_id LIKE — a
      // booking id could contain SQL-LIKE metacharacters (_ / %) that would
      // make a `like.<id>:*` pattern match unrelated rows. return=representation
      // so `reversed` counts rows actually flipped, not bookings processed.
      const r = await fetch(
        `${SB_URL}/rest/v1/settlement_ledger?kind=eq.guest_booking&payout_status=eq.owed&metadata->>bookingId=eq.${encodeURIComponent(bid)}`,
        { method: "PATCH", headers: { ...SB_H, Prefer: "return=representation" },
          body: JSON.stringify({ payout_status: "cancelled", updated_at: new Date().toISOString() }) },
      );
      if (r.ok) { const rows = await r.json().catch(() => []); reversed += Array.isArray(rows) ? rows.length : 0; }
    } catch { /* best-effort */ }
  }

  // ── Pass 1 (SETTLE) ──
  const bidIds = Array.from(new Set(confirmed.map((b) => String(b.bidId)).filter((x) => x && x !== "null")));
  const bids = bidIds.length
    ? await getJson(`${SB_URL}/rest/v1/bids?id=in.(${csv(bidIds)})&select=id,assignedUnitId,numRooms&limit=1000`)
    : [];
  const bidById: Record<string, any> = {}; bids.forEach((b) => { bidById[String(b.id)] = b; });

  const unitIds = Array.from(new Set(bids.map((b) => String(b.assignedUnitId)).filter((x) => x && x !== "null")));
  const [units, blocks] = await Promise.all([
    unitIds.length ? getJson(`${SB_URL}/rest/v1/hotel_room_units?id=in.(${csv(unitIds)})&select=id,hotelId,owner_user_id&limit=1000`) : Promise.resolve([]),
    unitIds.length ? getJson(`${SB_URL}/rest/v1/inventory_blocks?unit_id=in.(${csv(unitIds)})&status=in.(owned,listed)&select=unit_id,investor_user_id,date_from,date_to,status&limit=2000`) : Promise.resolve([]),
  ]);
  const unitById: Record<string, any> = {}; units.forEach((u) => { unitById[String(u.id)] = u; });
  const hotelIds = Array.from(new Set(units.map((u) => String(u.hotelId)).filter(Boolean)));
  const hotels = hotelIds.length ? await getJson(`${SB_URL}/rest/v1/hotels?id=in.(${csv(hotelIds)})&select=id,ownerId,owner_type&limit=1000`) : [];
  const hotelById: Record<string, any> = {}; hotels.forEach((h) => { hotelById[String(h.id)] = h; });
  const blocksByUnit: Record<string, BlockOverlay[]> = {};
  blocks.forEach((b) => {
    (blocksByUnit[String(b.unit_id)] ||= []).push({ investor_user_id: String(b.investor_user_id), date_from: String(b.date_from), date_to: String(b.date_to), status: String(b.status) });
  });

  let settledRows = 0, settledBookings = 0;
  const nowIso = new Date().toISOString();
  for (const bk of confirmed) {
    if (cancelledIds.includes(String(bk.id))) continue; // don't settle a cancelled one
    const bid = bidById[String(bk.bidId)];
    const unitId = bid ? String(bid.assignedUnitId || "") : "";
    if (!unitId || unitId === "null") continue;         // not a Circle unit-attributed booking
    const unit = unitById[unitId];
    const hotel = unit ? hotelById[String(unit.hotelId)] : null;

    const nights = enumerateNights(String(bk.checkIn), String(bk.checkOut));
    if (!nights.length) continue;
    const resolved = resolveNightlyPayees(nights, {
      blocks: blocksByUnit[unitId] || [],
      ownerUserId: unit?.owner_user_id ? String(unit.owner_user_id) : null,
      hotelOwnerId: hotel?.ownerId ? String(hotel.ownerId) : null,
      hotelOwnerType: hotel?.owner_type || null,
    });
    const counts = payeeNightCounts(resolved); // { payeeId: nights } — StayBid-retained nights excluded
    const payees = Object.keys(counts);
    if (!payees.length) continue;               // fully StayBid-retained → no owed row (decision 2)

    // paidAmount covers ALL rooms of the booking, but only the single
    // `assignedUnitId` (= one room) is attributed here. Divide by numRooms so
    // the unit's owner is credited exactly ONE room's share — never the whole
    // multi-room payment (the other rooms sit on other units / StayBid).
    const rooms = Math.max(1, round0(bk.numRooms) || 1);
    const paid = round0(round0(bk.paidAmount) / rooms);
    const totalNights = nights.length;
    let wroteAny = false;
    const setlIds: string[] = [];
    for (const payee of payees) {
      const myNights = counts[payee];
      const gross = round0(paid * (myNights / totalNights));
      const platformFee = round0(gross * (feePct / 100));
      const net = gross - platformFee;
      const refId = `${bk.id}:${payee}`;
      const setlId = `setl_gb_${bk.id}_${payee}`.slice(0, 190);
      setlIds.push(setlId);
      try {
        const r = await fetch(`${SB_URL}/rest/v1/settlement_ledger`, {
          method: "POST",
          headers: { ...SB_H, Prefer: "resolution=ignore-duplicates,return=minimal" },
          body: JSON.stringify({
            id: setlId,
            kind: "guest_booking",
            ref_id: refId,
            payee_user_id: payee,
            gross_amount: gross,
            platform_fee: platformFee,
            net_amount: net,
            payout_status: "owed",
            metadata: { bookingId: String(bk.id), unitId, nights: myNights, totalNights, feePct, paidAmount: paid, numRooms: rooms },
            created_at: nowIso,
            updated_at: nowIso,
          }),
        });
        if (r.ok) { settledRows += 1; wroteAny = true; }
      } catch { /* best-effort per row */ }
    }
    // REVIVE: this booking is confirmed again — if a prior cancellation flipped
    // its rows to `cancelled`, the ignore-duplicates INSERT above is a no-op on
    // them, so flip those exact rows back to `owed`. Only touches `cancelled`
    // rows (never a `paid`/`paying` one), so it can't resurrect a settled payout.
    if (setlIds.length) {
      try {
        await fetch(`${SB_URL}/rest/v1/settlement_ledger?id=in.(${setlIds.map(encodeURIComponent).join(",")})&payout_status=eq.cancelled`, {
          method: "PATCH", headers: { ...SB_H, Prefer: "return=minimal" },
          body: JSON.stringify({ payout_status: "owed", updated_at: nowIso }),
        });
      } catch { /* best-effort revive */ }
    }
    if (wroteAny) settledBookings += 1;
  }

  return NextResponse.json({
    ok: true,
    scannedConfirmed: confirmed.length,
    scannedCancelled: cancelled.length,
    settledBookings,
    settledRows,
    reversed,
    feePct,
    note: "Owed obligations recorded/reversed only. Payout execution (owed→paid + money-out) is S3.",
  });
}

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
