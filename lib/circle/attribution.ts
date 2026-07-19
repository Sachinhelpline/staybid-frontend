// StayBid Circle — money ATTRIBUTION resolver (design: CIRCLE-SETTLEMENT-ATTRIBUTION-DESIGN.md).
//
// The single source of truth for "who earns a given unit-night". Pure + read-only:
// given a booked (unit, date-range) plus the pre-loaded inventory rows, it resolves
// a payee PER NIGHT by precedence:
//
//   1. an inventory_blocks overlay (owned/listed) covering that unit + date
//        → payee = investor_user_id  — the TRANSFERABLE commercial right.
//   2. else hotel_room_units.owner_user_id                — the physical owner.
//   3. else the hotel owner (hotels.ownerId), unless it's a Circle-ops sentinel
//        (STAYBID_CIRCLE_OPS / hco_<propId>) → payee = null (StayBid retains).
//
// SEBI-safe by construction: step 1 reads the transferable investor_user_id and
// NEVER the frozen owner_user_id, so a resold block's earnings follow the block
// while the physical ownership stamp stays put.
//
// This module writes NOTHING. It is consumed by the (read-only) projected-earnings
// preview today, and — once the settlement phase (S2) is approved — by the owed
// settlement writer (authoritative in Railway). Keep it pure.

import { STAYBID_CIRCLE_OPS } from "@/lib/circle/provision";

// Illustrative platform fee for the PROJECTED-earnings preview only. The real,
// committed guest-booking fee is an owner decision resolved in the settlement
// phase (S2) — never treat this as the charged fee. Centralised so S2 swaps one place.
export const CIRCLE_BOOKING_FEE_PCT_DEFAULT = 12;

export type PayeeSource = "block" | "unit" | "hotel";
export type NightPayee = { date: string; payeeUserId: string | null; source: PayeeSource };

export type BlockOverlay = {
  investor_user_id: string;
  date_from: string; // YYYY-MM-DD (inclusive)
  date_to: string;   // YYYY-MM-DD (EXCLUSIVE — the check-out night is not owned)
  status: string;
};

export type ResolveCtx = {
  blocks: BlockOverlay[];                 // inventory_blocks on THIS unit (any status; filtered here)
  ownerUserId: string | null;            // hotel_room_units.owner_user_id
  hotelOwnerId: string | null;           // hotels.ownerId
  hotelOwnerType?: string | null;        // hotels.owner_type (host_circle / staybid_operated / …)
};

const D = (s: any) => String(s || "").slice(0, 10);

// A Circle-ops sentinel owner is not a real person → StayBid retains (no external payee).
export function isSentinelOwner(id: string | null | undefined): boolean {
  const v = String(id || "");
  return !v || v === STAYBID_CIRCLE_OPS || v.startsWith("hco_");
}

// Enumerate the OCCUPIED nights of a stay: [checkIn, checkOut) — the check-out day
// is a departure, never an owned night. Returns YYYY-MM-DD strings, UTC-safe.
export function enumerateNights(checkIn: string, checkOut: string): string[] {
  const a = new Date(`${D(checkIn)}T00:00:00Z`).getTime();
  const b = new Date(`${D(checkOut)}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return [];
  const out: string[] = [];
  for (let t = a; t < b; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  // Guard against a pathological range blowing up (max ~1 year of nights).
  return out.slice(0, 366);
}

// Resolve the payee for every night of a booking on one unit. Pure.
export function resolveNightlyPayees(nights: string[], ctx: ResolveCtx): NightPayee[] {
  // Only owned/listed blocks are live commercial rights; ignore pending/expired/etc.
  const liveBlocks = (ctx.blocks || []).filter((b) => ["owned", "listed"].includes(String(b.status)));
  return nights.map((date) => {
    // 1) commercial-right overlay (the transferable right) — first covering block wins.
    const covering = liveBlocks.find((b) => D(b.date_from) <= date && date < D(b.date_to));
    if (covering && covering.investor_user_id) {
      return { date, payeeUserId: String(covering.investor_user_id), source: "block" };
    }
    // 2) physical unit owner.
    if (ctx.ownerUserId && !isSentinelOwner(ctx.ownerUserId)) {
      return { date, payeeUserId: String(ctx.ownerUserId), source: "unit" };
    }
    // 3) hotel owner, unless it's a Circle-ops sentinel → StayBid retains (null).
    return { date, payeeUserId: isSentinelOwner(ctx.hotelOwnerId) ? null : String(ctx.hotelOwnerId), source: "hotel" };
  });
}

// Aggregate a night→payee list into per-payee night COUNTS (skips StayBid-retained nights).
export function payeeNightCounts(nights: NightPayee[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of nights) {
    if (!n.payeeUserId) continue;
    out[n.payeeUserId] = (out[n.payeeUserId] || 0) + 1;
  }
  return out;
}

// Owner net for a payee's nights, given the booking's per-night rate and a fee %.
// net = ratePerNight × nights × (1 − fee). Pure arithmetic; no rounding surprises.
export function ownerNet(ratePerNight: number, nights: number, feePct: number): number {
  const gross = Math.max(0, Math.round(ratePerNight) * Math.max(0, nights));
  return Math.round(gross * (1 - Math.max(0, Math.min(100, feePct)) / 100));
}
