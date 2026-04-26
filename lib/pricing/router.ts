// Bid router — auto-accept at/above floor with a humanising delay; otherwise
// silently escalate to the hotel owner. The customer sees "Hotel accepted" or
// "Waiting for hotel" — never the underlying decision logic or floor price.

import { sbInsert, sbSelect } from "@/lib/onboard/supabase-admin";
import { ensurePricingConfig } from "./engine";

export type BidRoute = "auto_accept" | "escalate_to_hotel";

const HUMAN_DELAY_MIN = 1000;   // 1s
const HUMAN_DELAY_MAX = 4000;   // 4s

export async function routeBid(opts: {
  bidId: string;
  bookingId?: string;
  hotelId: string;
  roomId: string;
  bidAmount: number;
}): Promise<{
  decision: BidRoute;
  humanDelayMs: number;
  floorPrice: number;
}> {
  const config = await ensurePricingConfig(opts.roomId);
  const floor = Number(config.floor_price);

  const decision: BidRoute = opts.bidAmount >= floor ? "auto_accept" : "escalate_to_hotel";
  const humanDelayMs = Math.floor(HUMAN_DELAY_MIN + Math.random() * (HUMAN_DELAY_MAX - HUMAN_DELAY_MIN));

  await sbInsert("bid_decisions", {
    bid_id: opts.bidId,
    booking_id: opts.bookingId || null,
    hotel_id: opts.hotelId,
    room_id: opts.roomId,
    bid_amount: opts.bidAmount,
    floor_price: floor,
    decision,
    escalated_at: decision === "escalate_to_hotel" ? new Date().toISOString() : null,
  });

  return { decision, humanDelayMs, floorPrice: floor };
}

export async function recordHotelDecision(bidId: string, decision: "accepted" | "rejected" | "countered") {
  // Find the most recent bid_decisions row for this bid
  const rows = await sbSelect<any>("bid_decisions", `bid_id=eq.${bidId}&order=created_at.desc&limit=1`);
  const r = rows[0];
  if (!r) return;
  await fetch(
    `https://uxxhbdqedazpmvbvaosh.supabase.co/rest/v1/bid_decisions?id=eq.${r.id}`,
    {
      method: "PATCH",
      headers: { apikey: (await import("@/lib/onboard/supabase-admin")).SB.key, Authorization: `Bearer ${(await import("@/lib/onboard/supabase-admin")).SB.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ hotel_decision: decision }),
    }
  );
}
