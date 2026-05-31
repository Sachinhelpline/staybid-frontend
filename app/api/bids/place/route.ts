import { NextRequest, NextResponse } from "next/server";
import { authUserId, authPayload, ensureUser, sbSelect, sbInsert, genId } from "@/lib/sb-server";
import { ACCEPTED_UNPAID_WINDOW_MS } from "@/lib/bid-expiry";
import { resolveAutoAction, extractPreferredPrice, counterBandForVacancy, AUTO_COUNTER_WINDOW_MS, type AutoAction } from "@/lib/autopilot";
import { loadServerScore, loadAutopilotMode } from "@/lib/autopilot-server";
import { unitsFreeForRange, toISODate } from "@/lib/availability";
import { resolveSpinePrices } from "@/lib/pricing/read-spine";
import { logPricingDecision } from "@/lib/pricing/decision-log";

// v241.26 / v248 — the auto-accept + auto-counter decision is fully server-
// side + tamper-proof: tier comes from loadServerScore (canonical
// computeBidderScore on the customer's last 10 bids — matches the customer
// confidence chip, can't be spoofed), mode from loadAutopilotMode (hotels.
// autopilot_mode), and resolveAutoAction (lib/autopilot) maps them to
// accept / counter / manual. NEW bidders + LOWBALL history + hybrid-low-tier
// all fall through to manual partner review — never a client-trusted flip.

// v200 — One active bid per (customer × HOTEL). Per-flow timers:
//   • Negotiate (1:1 single hotel)    → 3h
//   • /bid      (1:N reverse auction) → 1h
const NEGOTIATE_MS = 3 * 3600_000;
const PLACE_MS     = 1 * 3600_000;
const expiresAtFor = (flow?: string) =>
  new Date(Date.now() + (flow === "place" ? PLACE_MS : NEGOTIATE_MS)).toISOString();

// v200 — Returns the conflicting active bid (PENDING / COUNTER / unpaid
// ACCEPTED) on THIS SAME hotel, or null. Per Sachin's confirmed rule
// (2026-05-24): one active bid per (customer × hotel). Different hotels
// in the same city are OK — a /bid broadcast still works because we
// exempt same-requestId.
//
// `currentRequestId` is the requestId attached to the incoming placeBid. /bid
// broadcasts N hotels in one city under ONE bid_request — so all N share the
// same requestId. We treat same-requestId rows as the same logical bid and
// skip them, so a single /bid submit doesn't 409 itself across its own
// per-hotel calls. A new /bid run (new requestId) does 409 against the
// still-active prior bid ON THE SAME hotel, which is the desired guard.
//
// We DROP the `expiresAt > now()` filter that was in v195 — stale ACCEPTED-
// unpaid bids (past 15-min payment window) had `expiresAt` in the past, so
// the old query silently returned no conflict and the customer could
// place duplicates (Sachin SS1/SS2 showed 4 stacked ACCEPTED on the same
// hotel). New rule: trust the STATUS column; the row stays ACCEPTED until
// either paid (bookings.paidAmount > 0) OR cron sweeps it to EXPIRED.
// While ACCEPTED-unpaid, no new bids on the same hotel can be placed.
//
// v236 — Apply per-status time-based filters so a STALE PENDING / COUNTER
// / ACCEPTED-unpaid bid (past its window) NEVER triggers a ghost conflict.
// Sachin's 2-screenshot report (2026-05-27): /bid Dhanaulti showed
// "You already have an active bid in Dhanaulti" while /my-bids showed
// ZERO bids. Root cause: v193 server cron `mark_stale_pending_bids`
// flips PENDING > 6h to EXPIRED in DB, AND v234 client filter in
// /my-bids hides PENDING > 6h client-side. BUT this conflict-check
// trusted STATUS only (v200 contract). If the cron is delayed or
// missed a window, the bid stays PENDING in DB → conflict check sees
// it → /my-bids client filter hides it → user sees a ghost conflict
// they can't action. v236 closes the gap: same per-status windows as
// `lib/bid-expiry.ts` applied here at conflict-check time. The cron
// is still the DB-truth path; this is the second line of defence.
//
// Windows (matching lib/bid-expiry.ts):
//   • PENDING with auto_accept_at → expire 15 min past scheduled accept
//   • PENDING with expiresAt      → server stamp (1h place / 3h negotiate)
//   • PENDING legacy              → 1h or 3h derived from message; 6h cap
//   • COUNTER                     → 60 min after updatedAt
//   • ACCEPTED + unpaid           → 15 min after acceptedAt
const ONE_MIN_MS = 60_000;
const ONE_HOUR_MS = 60 * ONE_MIN_MS;
function isBidStale(b: any): boolean {
  const now = Date.now();
  const status = String(b?.status || "").toUpperCase();
  if (status === "COUNTER") {
    const t = b?.updatedAt ? new Date(b.updatedAt).getTime()
            : b?.createdAt ? new Date(b.createdAt).getTime()
            : 0;
    return t > 0 && now > t + 60 * ONE_MIN_MS;
  }
  if (status === "ACCEPTED") {
    // v236.1 — expiresAt is the authoritative window for ACCEPTED-
    // unpaid bids (set by /api/bids/place on auto-accept to
    // acceptedAt + 15min; set by partner accept to now() + window).
    // The bids table has NO acceptedAt or updatedAt columns
    // (verified via information_schema 2026-05-27); the runtime
    // fallback chain is kept defensively in case those columns
    // are added in a future migration.
    if (b?.expiresAt) {
      const t = new Date(b.expiresAt).getTime();
      if (!Number.isNaN(t)) return now > t;
    }
    const t = b?.acceptedAt ? new Date(b.acceptedAt).getTime()
            : b?.updatedAt  ? new Date(b.updatedAt).getTime()
            : b?.createdAt  ? new Date(b.createdAt).getTime()
            : 0;
    return t > 0 && now > t + ACCEPTED_UNPAID_WINDOW_MS;
  }
  if (status === "PENDING") {
    if (b?.auto_accept_at) {
      const t = new Date(b.auto_accept_at).getTime();
      // v241.22 — auto_accept_at + 15min grace stays as-is (this is
      // the legacy fixed grace for missed crons, distinct from the
      // ACCEPTED-unpaid pay window). Auto-accept itself runs at
      // auto_accept_at; the +15min is just slack.
      if (!Number.isNaN(t)) return now > t + 15 * ONE_MIN_MS;
    }
    if (b?.expiresAt) {
      const t = new Date(b.expiresAt).getTime();
      if (!Number.isNaN(t)) return now > t;
    }
    // Legacy: derive window from createdAt + flow detection. 6h hard cap
    // matches v193 server cron `mark_stale_pending_bids`.
    const created = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (!created) return false;
    const age = now - created;
    const msg = String(b?.message || "");
    const isPlace = /\bGuest bid\b/i.test(msg) || /max ₹/i.test(msg);
    const flowCap = isPlace ? 1 * ONE_HOUR_MS : 3 * ONE_HOUR_MS;
    return age > Math.min(flowCap, 6 * ONE_HOUR_MS);
  }
  return false;
}

async function findActiveBidOnHotel(
  customerIds: string[],
  hotelId: string,
  currentRequestId?: string | null,
): Promise<any | null> {
  if (!customerIds.length || !hotelId) return null;
  const ids = customerIds.join(",");
  const bids = await sbSelect(
    // v236.1 — Only request columns that exist on bids (verified
    // 2026-05-27 via information_schema.columns). `acceptedAt` +
    // `updatedAt` do NOT exist on this table; requesting them causes
    // PostgREST to 400 → empty array → conflict check broken → user
    // can place duplicate bids (worse than the ghost-conflict bug
    // v236 was fixing). The runtime isBidStale() fallback chain
    // handles missing fields by falling through to `createdAt`.
    `bids?customerId=in.(${ids})&hotelId=eq.${hotelId}&status=in.(PENDING,COUNTER,ACCEPTED)&select=id,hotelId,roomId,requestId,status,amount,counterAmount,expiresAt,createdAt,auto_accept_at,message`
  );
  if (!bids.length) return null;

  // ACCEPTED only locks while there's no paid booking yet.
  const acceptedIds = bids.filter((b: any) => b.status === "ACCEPTED").map((b: any) => b.id);
  let paidByBidId = new Map<string, number>();
  if (acceptedIds.length) {
    const bks = await sbSelect(
      `bookings?bidId=in.(${acceptedIds.join(",")})&select=bidId,paidAmount`
    );
    paidByBidId = new Map(bks.map((b: any) => [b.bidId, Number(b.paidAmount || 0)]));
  }

  let hotelMeta: any = null;
  for (const b of bids) {
    if (b.status === "ACCEPTED" && (paidByBidId.get(b.id) || 0) > 0) continue;
    if (currentRequestId && b.requestId && b.requestId === currentRequestId) continue;
    // v236 — skip stale bids that the cron hasn't swept yet.
    if (isBidStale(b)) continue;
    if (!hotelMeta) {
      const hotels = await sbSelect(`hotels?id=eq.${hotelId}&select=id,name,city`);
      hotelMeta = hotels[0] || { id: hotelId, name: "this hotel", city: "" };
    }
    return {
      bidId:         b.id,
      hotelId:       b.hotelId,
      hotelName:     hotelMeta.name || "this hotel",
      city:          hotelMeta.city || "",
      status:        b.status,
      amount:        b.amount,
      counterAmount: b.counterAmount,
      expiresAt:     b.expiresAt,
    };
  }
  return null;
}

export async function POST(req: NextRequest) {
  const customerId = authUserId(req);
  if (!customerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const p = authPayload(req);
  await ensureUser(customerId, p?.phone, p?.name);

  const body = await req.json().catch(() => ({}));
  const { hotelId, roomId, amount, requestId, dealId, message, flow, numRooms, guests } = body || {};

  if (!hotelId || !roomId || !amount) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // v241 — Customer's numRooms for THIS hotel. Schema CHECK 1–10.
  // Defaults to 1 when caller omits the field (Book Now / Flash flows).
  // The customer's intent for the WHOLE broadcast is on
  // `bid_requests.numRoomsRequested`; this is the per-bid resolved value.
  const numRoomsClamped = Math.max(1, Math.min(10, Math.floor(Number(numRooms) || 1)));
  // v241 — guests resolves from body first; fall back to the linked
  // bid_request row so legacy hotel-page callers (Negotiate / Book Now)
  // that send only `requestId` still get capacityMismatch flagged
  // correctly. Cheap single-row REST lookup; only fires when body omits.
  let guestsClamped = Math.max(1, Math.floor(Number(guests) || 0));
  if (!guestsClamped && requestId) {
    try {
      const reqRows = await sbSelect(`bid_requests?id=eq.${requestId}&select=guests,"numRoomsRequested"`);
      if (reqRows[0]) {
        guestsClamped = Math.max(1, Math.floor(Number(reqRows[0].guests) || 1));
      }
    } catch { /* non-blocking */ }
  }
  if (!guestsClamped) guestsClamped = 1;

  // Floor-price check (skipped when dealId is present). Floor stays
  // per-room-per-night — amount × nights × numRooms is the final
  // charge, but the floor compares 1:1 against amount.
  if (!dealId) {
    const rooms = await sbSelect(`rooms?id=eq.${roomId}&select=floorPrice`);
    const floor = rooms[0]?.floorPrice;
    if (floor && Number(amount) < Number(floor)) {
      return NextResponse.json(
        { error: `Amount too low. Minimum: ₹${floor}` },
        { status: 400 }
      );
    }
  }

  // v241 — Inventory + capacity resolution against THIS hotel's actual
  // room row. `rooms.quantity` is what the partner configured for total
  // units of this category; `rooms.capacity` is guests-per-unit (default
  // 2 from partner panel). Two checks:
  //   1. INVENTORY — if numRoomsClamped > quantity, the hotel literally
  //      doesn't have that many of this category. Return 409 with the
  //      configured quantity so the customer can adjust.
  //   2. CAPACITY MISMATCH — flag-only (no rejection) when guests >
  //      capacity × numRooms. Partner inbox surfaces yellow chip; hotel
  //      decides counter-with-more-rooms or accept-anyway.
  // Skip on dealId-bypass flows (flash) — those have their own
  // hotel_room_units availability path.
  let capacityMismatch = false;
  if (!dealId) {
    const roomRows = await sbSelect(`rooms?id=eq.${roomId}&select=capacity,quantity,type,name`);
    const roomRow = roomRows[0];
    const roomCapacity = Number(roomRow?.capacity || 2);
    const roomQuantity = roomRow?.quantity == null ? null : Number(roomRow.quantity);
    const roomLabel = roomRow?.name || roomRow?.type || "this room";

    if (roomQuantity != null && numRoomsClamped > roomQuantity) {
      return NextResponse.json(
        {
          error: `This hotel has only ${roomQuantity} ${roomLabel} room${roomQuantity === 1 ? "" : "s"} available. Reduce your room count or pick a different hotel.`,
          maxAvailable: roomQuantity,
        },
        { status: 409 }
      );
    }

    // v247 — DATE-AWARE oversell guard. The static quantity check above only
    // asks "does the hotel own this many of the category?" — it ignores other
    // stays on the SAME dates. unitsFreeForRange counts units actually FREE
    // across the requested nights (capacity = hotel_room_units, else
    // rooms.quantity; occupied = Σ numRooms of accepted/confirmed/checked-in
    // bids + room_blocks). Reject if fewer than numRooms are free. The date
    // range lives on the linked bid_request (the hotel-page Book Now /
    // Negotiate flows always create one first). FAIL OPEN on any gap — no
    // requestId, missing dates, no capacity signal, or any error — so a
    // legit booking is NEVER blocked by an availability hiccup.
    if (requestId) {
      try {
        const reqRows = await sbSelect(`bid_requests?id=eq.${requestId}&select=checkIn,checkOut`);
        const ci = reqRows[0]?.checkIn ? toISODate(reqRows[0].checkIn) : null;
        const co = reqRows[0]?.checkOut ? toISODate(reqRows[0].checkOut) : null;
        if (ci && co && ci < co) {
          const avail = await unitsFreeForRange({ hotelId, roomId, from: ci, to: co });
          if (avail && avail.free < numRoomsClamped) {
            return NextResponse.json(
              {
                error: avail.free <= 0
                  ? `${roomLabel} is fully booked for these dates. Try different dates or another room.`
                  : `Only ${avail.free} ${roomLabel} room${avail.free === 1 ? "" : "s"} left for these dates. Reduce your room count.`,
                maxAvailable: avail.free,
              },
              { status: 409 }
            );
          }
        }
      } catch { /* fail open — never block on an availability error */ }
    }

    capacityMismatch = guestsClamped > roomCapacity * numRoomsClamped;
  }

  // v200 — Pre-flight: 409 if customer already has an active bid on THIS
  // hotel. Skipped for flash-deal bookings — those are instant-purchase,
  // not bids. Per-hotel rule (was per-city in v195) — customer can bid on
  // different hotels in the same city, but only one bid per hotel.
  if (!dealId) {
    const conflict = await findActiveBidOnHotel([customerId], hotelId, requestId);
    if (conflict) {
      return NextResponse.json(
        {
          error: `You already have an active bid on ${conflict.hotelName}. Update its budget instead of placing a new one.`,
          conflict,
        },
        { status: 409 }
      );
    }
  }

  try {
    // v196 Sachin-rule: for /bid (flow="place") broadcasts, hotels whose floor
    // is at or below the customer's offer auto-accept INSTANTLY — the user
    // explicitly asked for this ("jish hotel ne auto accept hui hai unke price
    // rule ke according"). This overrides the v130 "let competition settle"
    // design — Sachin owns the product decision. Negotiate (single hotel) keeps
    // its existing schedule-accept lifecycle via /api/bids/[id]/schedule-accept.
    // We re-read the floor here (not from the earlier check) so dealId-bypass
    // bids never auto-accept (their floor check was skipped).
    // v196 / v241.26 / v248 — unified, mode-aware auto-action. Decides
    // accept / counter / manual server-side for every non-flash bid:
    //   • /bid (flow="place") at/above floor → instant ACCEPT per mode
    //     (auto=yes · hybrid=PREMIUM/STRONG · manual=no · LOWBALL=no). v196
    //     instant-confirm behaviour preserved, now mode-respecting (v241.26).
    //   • Negotiate below-floor (amount clamped to floor, real intent in the
    //     "preferred price" message token) near the floor → auto-COUNTER at
    //     floor (v248). Deep lowballs + manual mode + low tier → stays PENDING
    //     for the partner. The hotel-page above-floor Negotiate path keeps its
    //     deferred schedule-accept lifecycle and is NOT instant-accepted here.
    // We re-read the floor here so dealId-bypass (flash) bids never auto-act.
    let status = "PENDING";
    let counterAmount: number | null = null;
    // v249.1 — AI pricing data foundation. We capture the EPHEMERAL spine
    // snapshot + decision context here (it's recomputed daily by the cron, so
    // unreconstructable later), then log it fire-and-forget AFTER the bid
    // insert. The outcome (accepted/paid) is NOT copied — Phase-2 training
    // joins this row to bids on bid_id. Nothing here can block/break a bid.
    const pd: Record<string, any> = {};
    if (!dealId) {
      const rooms = await sbSelect(`rooms?id=eq.${roomId}&select=floorPrice`);
      // v248 Layer 1 — the autopilot accept/counter threshold is the DYNAMIC
      // pricing-spine bid-floor for the bid's check-in date (demand + occupancy
      // yield + competitor-undercut already baked in), NOT the static
      // rooms.floorPrice. So accept + counter become demand-aware: peak dates
      // lift the floor (margin protected), soft/empty dates drop it (rooms fill).
      // The counter amount is this same floor → still margin-safe (never below
      // the spine minimum). Falls back to the static floor if the spine is
      // unreachable, so a bid is NEVER blocked by a pricing hiccup.
      const staticFloor = Number(rooms[0]?.floorPrice || 0);
      pd.staticFloor = staticFloor || null;
      let floor = staticFloor;
      // v249 Layer 2 — occupancy of the bid's check-in date. Tunes WHO gets an
      // auto-counter (empty date → wider band, fills the room; tight date →
      // no auto-counter). null when the spine is unreachable → default band.
      let vacancyRatio: number | null = null;
      try {
        let ciDay: string | null = null;
        if (requestId) {
          const rq = await sbSelect(`bid_requests?id=eq.${requestId}&select=checkIn`);
          ciDay = rq[0]?.checkIn ? toISODate(rq[0].checkIn) : null;
        }
        const day = ciDay || new Date().toISOString().slice(0, 10);
        pd.checkIn = ciDay;
        const spine = await resolveSpinePrices([roomId], day);
        const sp = spine[roomId];
        const bf = Number(sp?.bidFloor || 0);
        if (bf > 0) floor = Math.round(bf);
        const vr = sp?.vacancyRatio;
        if (typeof vr === "number" && Number.isFinite(vr)) vacancyRatio = vr;
        if (sp) {
          // v249.1 — full spine snapshot for the pricing data foundation.
          pd.spineFloor = Number(sp.bidFloor) || null;
          pd.spineLive = Number(sp.livePrice) || null;
          pd.spineFlash = Number(sp.flashPrice) || null;
          pd.spineBase = Number(sp.baseRate) || null;
          pd.competitorMin = sp.competitorMin ?? null;
          pd.demandScore = Number(sp.demandScore) || null;
          pd.spineSource = sp.source || null;
          pd.factors = Array.isArray(sp.factors) ? sp.factors : null;
        }
      } catch { /* spine unreachable → static floor + default band (never block a bid) */ }
      pd.vacancyRatio = vacancyRatio;
      // Real intent: below-floor Negotiate bids stash the true price in the
      // message; every other flow's intent IS the submitted amount.
      const intent = extractPreferredPrice(message) ?? Number(amount);
      pd.intent = Number.isFinite(intent) ? intent : null;

      // Only two cases can auto-act: /bid (flow="place") at/above floor →
      // instant accept, OR any below-floor-intent bid → auto-counter. Skip
      // the tier/mode lookups otherwise (Book Now / above-floor Negotiate stay
      // PENDING here — Book Now accepts via its own path, Negotiate schedules).
      const eligibleForAuto =
        floor > 0 && ((flow === "place" && intent >= floor) || intent < floor);
      let action: AutoAction = { kind: "manual" };
      if (eligibleForAuto) {
        const score = await loadServerScore(customerId);
        const mode = await loadAutopilotMode(hotelId);
        const band = counterBandForVacancy(vacancyRatio);
        pd.tier = score.tier;
        pd.mode = mode;
        pd.band = band;
        action = resolveAutoAction({
          intent,
          floor,
          tier: score.tier,
          baseMs: score.autoAcceptMs,
          mode,
          // v249 Layer 2 — empty date widens the counter band (0.78), nearly
          // full closes it (1.0). Counter amount stays = floor (margin-safe).
          counterBandMin: band,
        });
      }
      pd.action = action.kind;

      if (intent < floor && action.kind === "counter") {
        // Below-floor near-floor → auto-counter at floor (any flow). The
        // customer responds via the existing /my-bids COUNTER card.
        status = "COUNTER";
        counterAmount = action.counterAmount;
      } else if (flow === "place" && intent >= floor && action.kind === "accept") {
        // /bid instant accept (v196 rule, now mode-aware). Negotiate/Book-Now
        // above-floor stay PENDING here → their schedule-accept lifecycle runs.
        status = "ACCEPTED";
      }
    }

    const bid = await sbInsert("bids", {
      id: genId("bid"),
      customerId,
      hotelId,
      roomId,
      amount: Number(amount),
      requestId: requestId || null,
      status,
      message: message || null,
      // ACCEPTED/COUNTER both open a pay/response window (the DB trigger
      // re-stamps ACCEPTED to the per-hotel window). COUNTER → 60-min UX
      // window. PENDING keeps its per-flow timer.
      ...(counterAmount != null ? { counterAmount } : {}),
      expiresAt:
        status === "ACCEPTED"
          ? new Date(Date.now() + ACCEPTED_UNPAID_WINDOW_MS).toISOString()
          : status === "COUNTER"
            ? new Date(Date.now() + AUTO_COUNTER_WINDOW_MS).toISOString()
            : expiresAtFor(flow),
      isBestDeal: false,
      // v241 — multi-room support. Denormalized so /api/bids/my doesn't
      // need a join + /my-bids charge math reads it directly.
      numRooms: numRoomsClamped,
      capacityMismatch,
    });
    // v249.1 — AI pricing data foundation. Fire-and-forget; never awaited into
    // the response, never throws. Captures the decision context for Phase-2
    // model training. Outcome is read live from `bids` via bid_id, not copied.
    void logPricingDecision({
      bidId: bid?.id,
      requestId: requestId || null,
      hotelId,
      roomId,
      customerId,
      flow: flow || null,
      checkIn: pd.checkIn ?? null,
      numRooms: numRoomsClamped,
      bidAmount: Number(amount),
      intentAmount: pd.intent ?? null,
      staticFloor: pd.staticFloor ?? null,
      spineFloor: pd.spineFloor ?? null,
      spineLive: pd.spineLive ?? null,
      spineFlash: pd.spineFlash ?? null,
      spineBase: pd.spineBase ?? null,
      competitorMin: pd.competitorMin ?? null,
      vacancyRatio: pd.vacancyRatio ?? null,
      demandScore: pd.demandScore ?? null,
      spineSource: pd.spineSource ?? (dealId ? "none" : null),
      bidderTier: pd.tier ?? null,
      autopilotMode: pd.mode ?? null,
      counterBand: pd.band ?? null,
      decidedAction: pd.action ?? (dealId ? "flash" : "manual"),
      decidedStatus: status,
      counterAmount: counterAmount ?? null,
      factors: pd.factors ?? null,
      meta: dealId ? { dealId } : null,
    });
    return NextResponse.json({
      bid,
      autoAccepted: status === "ACCEPTED",
      autoCountered: status === "COUNTER",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Bid failed" }, { status: 500 });
  }
}
