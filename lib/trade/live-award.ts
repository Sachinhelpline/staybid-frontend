// v374 — Model 3 LIVE mode: turn an ACCEPTED live bid into an auction_award.
// The whole point: once a live bid is accepted (by autopilot at place time, or
// by the owner later), we mint an `auction_awards` row in status='awarded' with
// the frozen settlement figures + a pay-window close. From there the agent uses
// the EXISTING, already-verified award money path unchanged:
//   awards/pay → awards/verify (4-key idempotent → voucher_issued + settlement)
//   → awards/[id]/enable-selling (operator scope + holds).
// No EMD is ever taken on a live bid, so deposit_applied = 0 and
// amount_due = base + buyer premium.
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";
import { genId } from "@/lib/sb-server";
import type { AuctionConfig } from "@/lib/trade/config";

// Pure settlement math for a live award (client preview == server == settlement).
export function liveAwardFigures(baseTotal: number, cfg: AuctionConfig) {
  const base = Math.max(0, Math.round(Number(baseTotal) || 0));
  const buyerFee = Math.round((base * cfg.buyerPremiumPct) / 100);
  const sellerFee = Math.round((base * cfg.sellerFeePct) / 100);
  const sellerNet = Math.max(0, base - sellerFee);
  const platformFee = buyerFee + sellerFee;
  const amountDue = base + buyerFee; // no EMD on a live bid
  return { base, buyerFee, sellerFee, sellerNet, platformFee, amountDue };
}

// Idempotent: create (or return the existing) award for an accepted live bid.
// Relies on uniq_auction_award_bid (one award per bid). Returns the award row.
export async function createLiveAward(bid: any, lot: any, cfg: AuctionConfig): Promise<any | null> {
  const bidId = String(bid.id);
  const rooms = Math.max(0, Math.round(Number(bid.rooms_wanted) || 0));
  const perNight = Math.round(Number(bid.per_room_per_night) || 0);
  const baseTotal = Math.round(Number(bid?.metadata?.base_total) || Number(bid.per_room_bid) * rooms || 0);
  const nights: string[] = Array.isArray(bid.night_dates) ? bid.night_dates : [];
  const fig = liveAwardFigures(baseTotal, cfg);
  const payClose = bid.pay_deadline_at || new Date(Date.now() + (cfg.livePayWindowHours > 0 ? cfg.livePayWindowHours : 24) * 3_600_000).toISOString();

  const row = {
    id: genId("awd"), lot_id: String(lot.id), bid_id: bidId,
    agent_user_id: String(bid.agent_user_id), agent_id: bid.agent_id || null,
    owner_user_id: String(lot.owner_user_id), hotel_id: String(lot.hotel_id), room_id: String(lot.room_id),
    city: lot.city || null, month_key: lot.month_key || null,
    segment_label: bid.segment_label || null, night_dates: nights, rooms_awarded: rooms,
    per_room_per_night: perNight, base_total: fig.base,
    buyer_fee: fig.buyerFee, seller_fee: fig.sellerFee, seller_net: fig.sellerNet, platform_fee: fig.platformFee,
    amount_due: fig.amountDue, deposit_applied: 0, amount_paid: 0,
    pay_window_close_at: payClose, status: "awarded",
    metadata: { sale_mode: "live", source: "live_accept" },
  };

  const wr = await fetch(`${SB_URL}/rest/v1/auction_awards`, {
    method: "POST", headers: { ...SB_H, Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify(row),
  });
  if (wr.ok) {
    const rows = await wr.json().catch(() => []);
    if (Array.isArray(rows) && rows.length) return rows[0];
  }
  // Conflict (award already exists for this bid) → read it back.
  const er = await fetch(`${SB_URL}/rest/v1/auction_awards?bid_id=eq.${encodeURIComponent(bidId)}&select=*&limit=1`, { headers: SB_READ, cache: "no-store" });
  const [existing] = er.ok ? await er.json().catch(() => []) : [];
  return existing || null;
}
