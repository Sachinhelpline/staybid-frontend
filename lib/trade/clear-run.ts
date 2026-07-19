// ============================================================================
// v361 — Model 3 auction clearing RUNNER (server-side, idempotent).
// Loads a lot's ACTIVE bids, runs the pure clash-free engine, writes
// auction_awards (idempotent via uniq_auction_award_bid), updates each bid to
// won/partial/lost, and flips the lot to awarded/closed. Settlement to the owner
// happens later when the WINNER pays the balance (mirrors b2b: money moves on
// the buyer's payment, not at clearing).
// ============================================================================
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";
import { genId } from "@/lib/sb-server";
import { resolveAuctionConfig } from "@/lib/trade/config";
import { clearLot, type ClearBid } from "@/lib/trade/clear";

export async function clearLotDb(lot: any): Promise<{ ok: boolean; awards: number; losers: number; reason?: string }> {
  // Load ACTIVE bids for this lot.
  const br = await fetch(
    `${SB_URL}/rest/v1/auction_bids?lot_id=eq.${encodeURIComponent(lot.id)}&status=eq.active&select=*&order=per_room_per_night.desc&limit=1000`,
    { headers: SB_READ, cache: "no-store" },
  );
  const bids: any[] = br.ok ? await br.json().catch(() => []) : [];

  if (!bids.length) {
    await fetch(`${SB_URL}/rest/v1/auction_lots?id=eq.${encodeURIComponent(lot.id)}&status=eq.open`, {
      method: "PATCH", headers: { ...SB_H, Prefer: "return=minimal" },
      body: JSON.stringify({ status: "closed", updated_at: new Date().toISOString() }),
    }).catch(() => {});
    return { ok: true, awards: 0, losers: 0, reason: "no_bids" };
  }

  const cfg = await resolveAuctionConfig();
  const clearBids: ClearBid[] = bids.map((b) => ({
    id: b.id, perRoomPerNight: Number(b.per_room_per_night) || 0,
    roomsWanted: Number(b.rooms_wanted) || 0,
    nights: Array.isArray(b.night_dates) ? b.night_dates : [],
    createdAt: b.created_at,
  }));
  const results = clearLot(Number(lot.num_rooms) || 0, clearBids);
  const byId: Record<string, { roomsAwarded: number }> = {};
  results.forEach((r) => { byId[r.bidId] = { roomsAwarded: r.roomsAwarded }; });

  const nowIso = new Date().toISOString();
  const payWindowCloseAt = new Date(Date.now() + cfg.payWindowHours * 3_600_000).toISOString();
  let awardCount = 0, loserCount = 0;

  for (const b of bids) {
    const roomsAwarded = byId[b.id]?.roomsAwarded || 0;
    const nights = Array.isArray(b.night_dates) ? b.night_dates : [];
    const perNight = Number(b.per_room_per_night) || 0;
    const origDeposit = Number(b.deposit_amount) || 0;

    if (roomsAwarded > 0) {
      const base = Math.round(perNight * nights.length * roomsAwarded);
      const buyerFee = Math.round(base * cfg.buyerPremiumPct / 100);
      const sellerFee = Math.round(base * cfg.sellerFeePct / 100);
      const sellerNet = base - sellerFee;
      const platformFee = buyerFee + sellerFee;
      const depositApplied = Math.min(origDeposit, Math.round(base * cfg.depositPct / 100));
      const amountDue = Math.max(0, base + buyerFee - depositApplied);
      const status = roomsAwarded >= (Number(b.rooms_wanted) || 0) ? "won" : "partial";
      const excessRefund = Math.max(0, origDeposit - depositApplied);

      // Award (idempotent: one per bid).
      await fetch(`${SB_URL}/rest/v1/auction_awards?on_conflict=bid_id`, {
        method: "POST", headers: { ...SB_H, Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({
          id: genId("aw"), lot_id: lot.id, bid_id: b.id, agent_user_id: b.agent_user_id, agent_id: b.agent_id,
          owner_user_id: lot.owner_user_id, hotel_id: lot.hotel_id, room_id: lot.room_id, city: lot.city, month_key: lot.month_key,
          segment_label: b.segment_label, night_dates: nights, rooms_awarded: roomsAwarded,
          per_room_per_night: perNight, base_total: base, buyer_fee: buyerFee, seller_fee: sellerFee,
          seller_net: sellerNet, platform_fee: platformFee, amount_due: amountDue, deposit_applied: depositApplied,
          status: "awarded", pay_window_close_at: payWindowCloseAt,
          metadata: { deposit_pct: cfg.depositPct, buyer_premium_pct: cfg.buyerPremiumPct, seller_fee_pct: cfg.sellerFeePct, excess_deposit_refund: excessRefund, hotel_name: lot.metadata?.hotel_name, room_img: lot.metadata?.room_img },
          updated_at: nowIso,
        }),
      }).catch(() => {});

      // Update the bid (guard: only from active).
      await fetch(`${SB_URL}/rest/v1/auction_bids?id=eq.${encodeURIComponent(b.id)}&status=eq.active`, {
        method: "PATCH", headers: { ...SB_H, Prefer: "return=minimal" },
        body: JSON.stringify({ status, rooms_awarded: roomsAwarded, updated_at: nowIso,
          metadata: { ...(b.metadata || {}), excess_deposit_refund: excessRefund } }),
      }).catch(() => {});
      awardCount++;
    } else {
      // Loser — EMD refund owed (processed by admin/ops; never auto money-out here).
      await fetch(`${SB_URL}/rest/v1/auction_bids?id=eq.${encodeURIComponent(b.id)}&status=eq.active`, {
        method: "PATCH", headers: { ...SB_H, Prefer: "return=minimal" },
        body: JSON.stringify({ status: "lost", updated_at: nowIso,
          metadata: { ...(b.metadata || {}), emd_refund: "owed", emd_refund_amount: origDeposit } }),
      }).catch(() => {});
      loserCount++;
    }
  }

  // Flip the lot (guard: only from open).
  await fetch(`${SB_URL}/rest/v1/auction_lots?id=eq.${encodeURIComponent(lot.id)}&status=eq.open`, {
    method: "PATCH", headers: { ...SB_H, Prefer: "return=minimal" },
    body: JSON.stringify({ status: "awarded", updated_at: nowIso }),
  }).catch(() => {});

  return { ok: true, awards: awardCount, losers: loserCount };
}
