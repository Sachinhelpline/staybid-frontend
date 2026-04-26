// Flash deal auto-pricing engine.
// Iterates active flash_deals and applies the drop/rise rules from the spec.

import { sbInsert, sbSelect, sbUpdate, SB } from "@/lib/onboard/supabase-admin";
import { getVacancyRate } from "./engine";

const RAILWAY = "https://staybid-live-production.up.railway.app";

async function bookingsSinceForRoom(roomId: string, since: string | null): Promise<number> {
  const sinceISO = since || new Date(Date.now() - 24 * 3600_000).toISOString();
  try {
    const url = `${SB.url}/rest/v1/bids?roomId=eq.${roomId}&status=eq.ACCEPTED&createdAt=gte.${sinceISO}&select=id`;
    const r = await fetch(url, { headers: { apikey: SB.key, Authorization: `Bearer ${SB.key}` } });
    const arr = await r.json();
    return Array.isArray(arr) ? arr.length : 0;
  } catch { return 0; }
}

export async function processFlashDeals(): Promise<{ scanned: number; updated: number; details: any[] }> {
  const nowIso = new Date().toISOString();
  const deals = await sbSelect<any>(
    "flash_deals",
    `isActive=eq.true&validUntil=gt.${encodeURIComponent(nowIso)}&order=createdAt.desc&limit=200`
  );

  const details: any[] = [];
  let updated = 0;

  for (const deal of deals) {
    const dropInterval = Number(deal.drop_interval_mins) || 30;
    const dropAmount   = Number(deal.drop_amount) || 50;
    const riseTrigger  = Number(deal.rise_trigger_pct) || 60;
    const startPrice   = Number(deal.start_price) || Number(deal.aiPrice);
    const lastDropAt   = deal.last_drop_at || deal.createdAt;
    const minutesSinceDrop = (Date.now() - new Date(lastDropAt).getTime()) / 60_000;

    const bookingsSince = await bookingsSinceForRoom(deal.roomId, lastDropAt);
    const vacancy = await getVacancyRate(deal.hotelId);

    let newPrice: number | null = null;
    let reason = "";

    // Rule: no bookings + interval elapsed → drop
    if (bookingsSince === 0 && minutesSinceDrop >= dropInterval) {
      const candidate = Math.max(Number(deal.aiPrice) - dropAmount, Number(deal.floorPrice));
      if (candidate < Number(deal.aiPrice)) {
        newPrice = candidate;
        reason = "no_booking_drop";
      }
    }
    // Rule: filling fast → raise (capped at start_price)
    else if (vacancy < riseTrigger && Number(deal.aiPrice) < startPrice) {
      const candidate = Math.min(Number(deal.aiPrice) * 1.08, startPrice);
      if (candidate > Number(deal.aiPrice)) {
        newPrice = Math.round(candidate);
        reason = "demand_rise";
      }
    }

    if (newPrice && newPrice !== Number(deal.aiPrice)) {
      try {
        await sbUpdate("flash_deals", `id=eq.${deal.id}`, {
          aiPrice: newPrice,
          last_drop_at: new Date().toISOString(),
        });
        await sbInsert("price_history", {
          flash_deal_id: deal.id,
          hotel_id: deal.hotelId,
          room_id: deal.roomId,
          old_price: Number(deal.aiPrice),
          new_price: newPrice,
          reason,
          triggered_by: "ai",
        });
        updated++;
        details.push({ dealId: deal.id, oldPrice: Number(deal.aiPrice), newPrice, reason });
      } catch (e: any) {
        details.push({ dealId: deal.id, error: e?.message });
      }
    }
  }

  return { scanned: deals.length, updated, details };
}
