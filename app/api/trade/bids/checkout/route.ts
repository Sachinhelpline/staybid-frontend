// v361 — Model 3: sealed-bid CHECKOUT. An approved agent submits a bundle of
// bids (one per lot+segment). We RE-VALIDATE and RE-PRICE every line server-side
// (client never sets ₹): each per-room-per-night bid must be ≥ the lot floor,
// rooms ≤ the lot's num_rooms, and the segment nights are recomputed from the
// lot's own month range. EMD deposit = depositPct% of the bid base, frozen onto
// each bid. ONE Razorpay order for the SUM of deposits; N pending_payment
// auction_bids tagged with that order id. The sibling verify activates them.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";
import { genId } from "@/lib/sb-server";
import { requireApprovedAgent } from "@/lib/trade/auth";
import { resolveAuctionConfig } from "@/lib/trade/config";
import { segmentNights, bidCostPreview, type SegmentType } from "@/lib/trade/auction-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLIC_KEY_ID = "rzp_live_SfFAsbYjbHfztd";
const MAX_ITEMS = 20;
const RZP_MAX_RUPEES = 500_000;

export async function POST(req: NextRequest) {
  const gate = await requireApprovedAgent(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error, registered: gate.registered }, { status: gate.status });
  const agent = gate.auth.agent!;
  const agentUserId = gate.auth.user.id;

  let body: any = {};
  try { body = await req.json(); } catch {}
  const rawItems: any[] = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) return NextResponse.json({ error: "No bids in the bundle." }, { status: 400 });
  if (rawItems.length > MAX_ITEMS) return NextResponse.json({ error: `Max ${MAX_ITEMS} bids per bundle.` }, { status: 400 });

  const cfg = await resolveAuctionConfig();
  const nowMs = Date.now();

  // Load each lot & build a validated, server-priced bid row.
  const prepared: any[] = [];
  for (const it of rawItems) {
    const lotId = String(it.lotId || "").trim();
    const segType = String(it.segmentType || "").trim() as SegmentType;
    const weekIndex = it.weekIndex != null ? Number(it.weekIndex) : undefined;
    const perNight = Math.round(Number(it.perRoomPerNight) || 0);
    const rooms = Math.round(Number(it.roomsWanted) || 0);
    if (!lotId) return NextResponse.json({ error: "Missing lotId." }, { status: 400 });

    const lr = await fetch(`${SB_URL}/rest/v1/auction_lots?id=eq.${encodeURIComponent(lotId)}&select=*&limit=1`, { headers: SB_READ, cache: "no-store" });
    const [lot] = lr.ok ? await lr.json().catch(() => []) : [];
    if (!lot) return NextResponse.json({ error: "A lot is no longer available." }, { status: 404 });
    if (lot.status !== "open" || new Date(lot.window_close_at).getTime() <= nowMs) {
      return NextResponse.json({ error: `Bidding closed for ${lot.category || lot.room_id}.` }, { status: 409 });
    }
    if (rooms < 1 || rooms > Number(lot.num_rooms)) {
      return NextResponse.json({ error: `Rooms must be 1–${lot.num_rooms} for ${lot.category || lot.room_id}.` }, { status: 400 });
    }
    if (perNight < Number(lot.min_bid_per_room_night)) {
      return NextResponse.json({ error: `Bid below floor (₹${lot.min_bid_per_room_night}/night) for ${lot.category || lot.room_id}.` }, { status: 400 });
    }

    const range = {
      monthKey: lot.month_key, monthStart: String(lot.month_start).slice(0, 10), monthEnd: String(lot.month_end).slice(0, 10),
      nights: Math.round((new Date(lot.month_end).getTime() - new Date(lot.month_start).getTime()) / 86_400_000),
    };
    const seg = segmentNights(range, segType, weekIndex);
    if (!seg || !seg.nights) return NextResponse.json({ error: "Invalid segment selection." }, { status: 400 });

    const { baseTotal, deposit, perRoomBid } = bidCostPreview({ perRoomPerNight: perNight, nights: seg.nights, rooms, depositPct: cfg.depositPct });
    if (deposit <= 0) return NextResponse.json({ error: "Bid amount too small." }, { status: 400 });

    prepared.push({
      id: genId("abid"), lot, seg, perNight, rooms, baseTotal, deposit, perRoomBid,
    });
  }

  const depositTotal = prepared.reduce((s, p) => s + p.deposit, 0);
  if (depositTotal < 1) return NextResponse.json({ error: "Deposit total is empty." }, { status: 422 });
  if (depositTotal > RZP_MAX_RUPEES) return NextResponse.json({ error: "Bundle too large for one payment — split it." }, { status: 400 });

  // ONE Razorpay order for the whole bundle's deposits.
  const origin = new URL(req.url).origin;
  let rzp: any = null;
  try {
    const orderRes = await fetch(`${origin}/api/razorpay/order`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: depositTotal, receipt: `auc_${agentUserId}`.slice(0, 40), notes: { kind: "auction_emd", count: String(prepared.length), agentId: agent.id } }),
    });
    rzp = await orderRes.json().catch(() => ({}));
    if (!orderRes.ok || !rzp?.id) return NextResponse.json({ error: rzp?.error || "Could not start payment." }, { status: 502 });
  } catch { return NextResponse.json({ error: "Payment gateway unreachable." }, { status: 502 }); }

  // Write N pending_payment bids tagged with the order id.
  const rows = prepared.map((p) => ({
    id: p.id, lot_id: p.lot.id, agent_user_id: agentUserId, agent_id: agent.id,
    segment_type: p.seg.type, segment_label: p.seg.label,
    date_from: p.seg.dates[0], date_to: p.seg.dates[p.seg.dates.length - 1],
    night_dates: p.seg.dates, nights: p.seg.nights,
    per_room_bid: p.perRoomBid, per_room_per_night: p.perNight, rooms_wanted: p.rooms,
    deposit_amount: p.deposit, status: "pending_payment", razorpay_order_id: rzp.id,
    metadata: { base_total: p.baseTotal, deposit_pct: cfg.depositPct, hotel_id: p.lot.hotel_id, room_id: p.lot.room_id, city: p.lot.city, month_key: p.lot.month_key },
  }));
  const wr = await fetch(`${SB_URL}/rest/v1/auction_bids`, {
    method: "POST", headers: { ...SB_H, Prefer: "return=minimal" }, body: JSON.stringify(rows),
  });
  if (!wr.ok) {
    const t = await wr.text();
    return NextResponse.json({ error: "Could not record bids.", detail: t }, { status: 500 });
  }

  return NextResponse.json({
    ok: true, orderId: rzp.id, amountPaise: Math.round(depositTotal * 100), amountRupees: depositTotal,
    keyId: PUBLIC_KEY_ID, count: prepared.length,
    prefill: { name: agent.agency_name || agent.name, email: agent.email },
  });
}
