// v374 — Model 3 LIVE mode: owner manages PENDING live bids on their lots.
//   GET  → pending ('active'/'countered') live bids across the owner's lots.
//   POST → { bidId, action: 'accept'|'reject'|'counter', counterPerRoomPerNight? }.
//     accept  → bid accepted (decided_by=owner) + pay window + mint the award
//               (agent then pays via the existing awards/pay path).
//     reject  → bid rejected.
//     counter → owner offers a different per-room-per-night; the agent accepts it
//               via bids/accept-counter (which re-prices + mints the award).
// Partner-scoped: the owner can only touch bids on lots for hotels they manage.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";
import { partnerHotelScope } from "@/lib/partner/hotel-scope";
import { resolveAuctionConfig } from "@/lib/trade/config";
import { livePayDeadline } from "@/lib/trade/live-auction";
import { createLiveAward } from "@/lib/trade/live-award";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const scope = await partnerHotelScope(req);
  if (!scope) return NextResponse.json({ error: "Partner auth required." }, { status: 401 });
  if (!scope.hotelIds.length) return NextResponse.json({ bids: [] });

  // The owner's live lots.
  const hotelIn = scope.hotelIds.map((i) => encodeURIComponent(i)).join(",");
  const lr = await fetch(
    `${SB_URL}/rest/v1/auction_lots?hotel_id=in.(${hotelIn})&sale_mode=eq.live&select=id,hotel_id,room_id,category,city,month_key,min_bid_per_room_night,autopilot_mode&limit=200`,
    { headers: SB_READ, cache: "no-store" },
  );
  const lots = lr.ok ? await lr.json().catch(() => []) : [];
  const lotById: Record<string, any> = {};
  (Array.isArray(lots) ? lots : []).forEach((l: any) => { lotById[l.id] = l; });
  const lotIds = Object.keys(lotById);
  if (!lotIds.length) return NextResponse.json({ bids: [] });

  const lotIn = lotIds.map((i) => encodeURIComponent(i)).join(",");
  const br = await fetch(
    `${SB_URL}/rest/v1/auction_bids?lot_id=in.(${lotIn})&status=in.(active,countered)&select=*&order=created_at.desc&limit=200`,
    { headers: SB_READ, cache: "no-store" },
  );
  const bids = br.ok ? await br.json().catch(() => []) : [];
  const enriched = (Array.isArray(bids) ? bids : []).map((b: any) => ({ ...b, lot: lotById[b.lot_id] || null }));
  return NextResponse.json({ bids: enriched });
}

export async function POST(req: NextRequest) {
  const scope = await partnerHotelScope(req);
  if (!scope) return NextResponse.json({ error: "Partner auth required." }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const bidId = String(body.bidId || "").trim();
  const action = String(body.action || "").trim();
  if (!bidId || !["accept", "reject", "counter"].includes(action)) {
    return NextResponse.json({ error: "bidId + valid action required." }, { status: 400 });
  }

  // Load the bid + its lot; verify ownership + live + pending.
  const bidR = await fetch(`${SB_URL}/rest/v1/auction_bids?id=eq.${encodeURIComponent(bidId)}&select=*&limit=1`, { headers: SB_READ, cache: "no-store" });
  const [bid] = bidR.ok ? await bidR.json().catch(() => []) : [];
  if (!bid) return NextResponse.json({ error: "Bid not found." }, { status: 404 });
  if (!["active", "countered"].includes(bid.status)) return NextResponse.json({ error: `Bid is ${bid.status}.` }, { status: 409 });

  const lotR = await fetch(`${SB_URL}/rest/v1/auction_lots?id=eq.${encodeURIComponent(bid.lot_id)}&select=*&limit=1`, { headers: SB_READ, cache: "no-store" });
  const [lot] = lotR.ok ? await lotR.json().catch(() => []) : [];
  if (!lot || lot.sale_mode !== "live") return NextResponse.json({ error: "Lot not found or not live." }, { status: 404 });
  if (!scope.hotelIds.includes(String(lot.hotel_id))) return NextResponse.json({ error: "You don't manage this lot." }, { status: 403 });

  const nowMs = Date.now();
  const patch = (fields: any, guardStatus = bid.status) =>
    fetch(`${SB_URL}/rest/v1/auction_bids?id=eq.${encodeURIComponent(bidId)}&status=eq.${encodeURIComponent(guardStatus)}`, {
      method: "PATCH", headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
    });

  if (action === "reject") {
    await patch({ status: "rejected", decided_by: "owner" });
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  if (action === "counter") {
    const cpn = Math.round(Number(body.counterPerRoomPerNight) || 0);
    const floor = Number(lot.min_bid_per_room_night) || 0;
    if (cpn < floor) return NextResponse.json({ error: `Counter below the floor (₹${floor}/room/night).` }, { status: 400 });
    await patch({ status: "countered", counter_per_room_per_night: cpn, decided_by: "owner" });
    return NextResponse.json({ ok: true, status: "countered", counterPerRoomPerNight: cpn });
  }

  // accept — freeze the pay window, mark accepted, mint the award.
  const cfg = await resolveAuctionConfig();
  const payDeadlineIso = livePayDeadline(nowMs, cfg.livePayWindowHours);
  const r = await patch({ status: "accepted", accepted_at: new Date(nowMs).toISOString(), pay_deadline_at: payDeadlineIso, decided_by: "owner" });
  const rows = r.ok ? await r.json().catch(() => []) : [];
  const accepted = Array.isArray(rows) ? rows[0] : null;
  if (!accepted) return NextResponse.json({ ok: true, alreadyProcessed: true });

  let awardId: string | null = null;
  try { const award = await createLiveAward(accepted, lot, cfg); awardId = award?.id || null; }
  catch { /* best-effort — award mint retried when the agent opens pay */ }

  return NextResponse.json({ ok: true, status: "accepted", awardId, payDeadlineAt: payDeadlineIso });
}
