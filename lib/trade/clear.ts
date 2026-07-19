// ============================================================================
// v361 — Model 3 auction CLEARING engine (pure, deterministic, clash-free).
//
// A lot offers `numRooms` identical rooms for a month. Agents bid on segments
// (full month / a week / weekends) at a price PER ROOM PER NIGHT, each wanting
// up to `roomsWanted` rooms. We clear so that:
//   • Highest ₹/room/night wins first (best price discovery for the owner).
//   • A bid is awarded as many of its wanted rooms as can be given CLASH-FREE
//     for ALL its nights (partial rooms allowed; 0 → lost).
//   • No physical room-slot is ever double-booked for overlapping nights
//     (guaranteed by construction — per-slot night calendars).
//
// This is greedy weighted interval packing: not theoretically revenue-optimal
// (that's NP-hard) but transparent, deterministic and always clash-free — the
// right trade-off for a monthly wholesale auction.
// ============================================================================

export type ClearBid = {
  id: string;
  perRoomPerNight: number;
  roomsWanted: number;
  nights: string[];       // exact ISO nights this bid covers
  createdAt?: string;     // tie-break
};

export type ClearResult = {
  bidId: string;
  roomsAwarded: number;
  slots: number[];        // logical room-slot indexes assigned (0..numRooms-1)
};

// Deterministic ranking: higher ₹/night → more nights → earlier bid → id.
export function rankBids(bids: ClearBid[]): ClearBid[] {
  return [...bids].sort((a, b) => {
    if (b.perRoomPerNight !== a.perRoomPerNight) return b.perRoomPerNight - a.perRoomPerNight;
    if (b.nights.length !== a.nights.length) return b.nights.length - a.nights.length;
    const ca = a.createdAt || "", cb = b.createdAt || "";
    if (ca !== cb) return ca < cb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function clearLot(numRooms: number, bids: ClearBid[]): ClearResult[] {
  const slots: Array<Set<string>> = Array.from({ length: Math.max(0, numRooms) }, () => new Set<string>());
  const out: ClearResult[] = [];

  for (const bid of rankBids(bids)) {
    const used: number[] = [];
    const want = Math.max(0, Math.floor(bid.roomsWanted));
    for (let need = 0; need < want; need++) {
      // find a slot NOT yet used by this bid that is free for ALL its nights
      let picked = -1;
      for (let s = 0; s < slots.length; s++) {
        if (used.includes(s)) continue;
        if (bid.nights.every((d) => !slots[s].has(d))) { picked = s; break; }
      }
      if (picked < 0) break;              // no more clash-free rooms for this bid
      bid.nights.forEach((d) => slots[picked].add(d));
      used.push(picked);
    }
    out.push({ bidId: bid.id, roomsAwarded: used.length, slots: used });
  }
  return out;
}
