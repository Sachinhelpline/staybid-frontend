// v374 — Model 3 LIVE mode: place a bid (NO EMD, autopilot-governed).
// An approved agent bids on a single always-open (sale_mode='live') lot. We
// RE-VALIDATE + RE-PRICE server-side (client never sets ₹): per-room-per-night
// must be ≥ the lot floor, rooms ≤ the lot's num_rooms, and the segment nights
// are recomputed from the lot's own month range. No payment here — the lot's
// autopilot decides:
//   • auto            → accepted instantly.
//   • hybrid          → accepted if bid ≥ floor × liveHybridAcceptRatio, else pending.
//   • manual          → pending (owner accepts / counters / declines).
// An ACCEPTED bid gets a pay-window deadline; the agent pays later from their
// dashboard (bids that pay reserve physical units then, mirroring award-pay).
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";
import { genId } from "@/lib/sb-server";
import { requireApprovedAgent } from "@/lib/trade/auth";
import { resolveAuctionConfig } from "@/lib/trade/config";
import { segmentNights, type SegmentType } from "@/lib/trade/auction-engine";
import { evaluateLiveBid, livePayDeadline, normalizeAutopilotMode } from "@/lib/trade/live-auction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const gate = await requireApprovedAgent(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error, registered: gate.registered }, { status: gate.status });
  const agent = gate.auth.agent!;
  const agentUserId = gate.auth.user.id;

  let body: any = {};
  try { body = await req.json(); } catch {}
  const lotId = String(body.lotId || "").trim();
  const segType = String(body.segmentType || "").trim() as SegmentType;
  const weekIndex = body.weekIndex != null ? Number(body.weekIndex) : undefined;
  const perNight = Math.round(Number(body.perRoomPerNight) || 0);
  const rooms = Math.round(Number(body.roomsWanted) || 0);
  if (!lotId) return NextResponse.json({ error: "Missing lotId." }, { status: 400 });

  const cfg = await resolveAuctionConfig();
  const nowMs = Date.now();

  // Load + validate the lot (must be a LIVE, open lot).
  const lr = await fetch(`${SB_URL}/rest/v1/auction_lots?id=eq.${encodeURIComponent(lotId)}&select=*&limit=1`, { headers: SB_READ, cache: "no-store" });
  const [lot] = lr.ok ? await lr.json().catch(() => []) : [];
  if (!lot) return NextResponse.json({ error: "This lot is no longer available." }, { status: 404 });
  if (lot.sale_mode !== "live") return NextResponse.json({ error: "This lot is a sealed auction — use the sealed bid flow." }, { status: 409 });
  if (lot.status !== "open" || new Date(lot.window_close_at).getTime() <= nowMs) {
    return NextResponse.json({ error: "Bidding has closed for this lot." }, { status: 409 });
  }
  if (rooms < 1 || rooms > Number(lot.num_rooms)) {
    return NextResponse.json({ error: `Rooms must be 1–${lot.num_rooms}.` }, { status: 400 });
  }
  const floor = Number(lot.min_bid_per_room_night) || 0;
  if (perNight < floor) {
    return NextResponse.json({ error: `Bid below the floor (₹${floor}/room/night).` }, { status: 400 });
  }

  // One live bid per agent per lot at a time (no stacking while one is pending
  // or accepted-unpaid). A won/rejected/expired bid frees them to bid again.
  try {
    const er = await fetch(
      `${SB_URL}/rest/v1/auction_bids?lot_id=eq.${encodeURIComponent(lotId)}&agent_user_id=eq.${encodeURIComponent(agentUserId)}` +
        `&status=in.(active,accepted)&select=id&limit=1`,
      { headers: SB_READ, cache: "no-store" },
    );
    if (er.ok) { const rows = await er.json().catch(() => []); if (Array.isArray(rows) && rows.length) {
      return NextResponse.json({ error: "You already have a live bid on this lot. Cancel or wait for a decision first." }, { status: 409 });
    } }
  } catch { /* fail open — the guard is a convenience, not a money gate */ }

  // Recompute the segment nights from the lot's own month range (tamper-safe).
  const range = {
    monthKey: lot.month_key, monthStart: String(lot.month_start).slice(0, 10), monthEnd: String(lot.month_end).slice(0, 10),
    nights: Math.round((new Date(lot.month_end).getTime() - new Date(lot.month_start).getTime()) / 86_400_000),
  };
  const seg = segmentNights(range, segType, weekIndex);
  if (!seg || !seg.nights) return NextResponse.json({ error: "Invalid segment selection." }, { status: 400 });

  const perRoomBid = perNight * seg.nights;          // per room for the whole segment
  const baseTotal = perRoomBid * rooms;              // full bid base (no fees at bid time)

  // Autopilot decision (same engine the client previewed).
  const mode = normalizeAutopilotMode(lot.autopilot_mode);
  const decision = evaluateLiveBid({ perRoomPerNight: perNight, floor, mode, hybridAcceptRatio: cfg.liveHybridAcceptRatio });
  if (decision.kind === "reject") {
    return NextResponse.json({ error: `Bid below the floor (₹${floor}/room/night).` }, { status: 400 });
  }

  const accepted = decision.kind === "accept";
  const acceptedAtIso = accepted ? new Date(nowMs).toISOString() : null;
  const payDeadlineIso = accepted ? livePayDeadline(nowMs, cfg.livePayWindowHours) : null;

  const row = {
    id: genId("abid"),
    lot_id: lot.id, agent_user_id: agentUserId, agent_id: agent.id,
    segment_type: seg.type, segment_label: seg.label,
    date_from: seg.dates[0], date_to: seg.dates[seg.dates.length - 1],
    night_dates: seg.dates, nights: seg.nights,
    per_room_bid: perRoomBid, per_room_per_night: perNight, rooms_wanted: rooms,
    deposit_amount: 0,                                 // LIVE mode: no EMD
    status: accepted ? "accepted" : "active",
    accepted_at: acceptedAtIso,
    pay_deadline_at: payDeadlineIso,
    decided_by: accepted ? "autopilot" : null,
    metadata: {
      sale_mode: "live", base_total: baseTotal, autopilot_mode: mode,
      hotel_id: lot.hotel_id, room_id: lot.room_id, city: lot.city, month_key: lot.month_key,
    },
  };
  const wr = await fetch(`${SB_URL}/rest/v1/auction_bids`, {
    method: "POST", headers: { ...SB_H, Prefer: "return=representation" }, body: JSON.stringify(row),
  });
  if (!wr.ok) {
    const t = await wr.text();
    return NextResponse.json({ error: "Could not record the bid.", detail: t }, { status: 500 });
  }
  const [saved] = await wr.json().catch(() => []);

  return NextResponse.json({
    ok: true,
    status: row.status,
    accepted,
    bid: saved || row,
    payDeadlineAt: payDeadlineIso,
    message: accepted
      ? `Accepted! Pay ${payDeadlineIso ? "before your window closes" : "soon"} to lock the inventory.`
      : "Bid placed — the owner will accept, counter, or decline shortly.",
  });
}
