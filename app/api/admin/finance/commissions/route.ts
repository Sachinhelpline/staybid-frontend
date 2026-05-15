// GET /api/admin/finance/commissions
//
// v126 — Real data wire-up. Previously queried `bookings` table which is
// effectively empty in this codebase (CLAUDE.md confirms /api/bookings/my
// synthesizes from accepted bids). Result: every hotel showed ₹0 GMV.
//
// Truth lives in:
//   - `bids` where status IN (ACCEPTED, CONFIRMED, CHECKED_IN, CHECKED_OUT)
//   - `bid_paid_amounts.paid_total` (authoritative Razorpay paid amount)
//   - `hotel_commission_rules` (per-hotel override, this era) or platform
//      default `commission_rules` where scope='global'
//
// Output shape preserved so the existing /admin/finance UI keeps working.

import { NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";

export const dynamic = "force-dynamic";

const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

const ACCEPTED_STATUSES = new Set(["ACCEPTED", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"]);

// Default platform commission % if no global commission_rules.platformPct exists.
const DEFAULT_PLATFORM_PCT = 5;

export async function GET() {
  const [hotels, bids, paidRows, hotelRules, globalRule] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/hotels?select=id,name,city,ownerId`, { headers: SB_H })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []),
    fetch(`${SB_URL}/rest/v1/bids?select=id,hotelId,amount,status,createdAt&limit=5000`, { headers: SB_H })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []),
    fetch(`${SB_URL}/rest/v1/bid_paid_amounts?select=bid_id,paid_total,hotel_id,paid_at`, { headers: SB_H })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []),
    fetch(
      `${SB_URL}/rest/v1/hotel_commission_rules?select=hotel_id,platform_pct,active&active=eq.true`,
      { headers: SB_H },
    )
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []),
    fetch(
      `${SB_URL}/rest/v1/commission_rules?select=scope,slabs,loyalty_bonuses&scope=eq.global&active=eq.true&limit=1`,
      { headers: SB_H },
    )
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []),
  ]);

  const paidByBidId: Record<string, number> = {};
  for (const p of (paidRows as any[])) {
    if (p.bid_id) paidByBidId[p.bid_id] = Number(p.paid_total) || 0;
  }

  // Map per-hotel commission % overrides
  const hotelPctByHotelId: Record<string, number> = {};
  for (const r of (hotelRules as any[])) {
    if (r.hotel_id && r.platform_pct != null) hotelPctByHotelId[r.hotel_id] = Number(r.platform_pct);
  }
  // Global default fallback — if commission_rules has a `platformPct` in the first slab, use it; else DEFAULT_PLATFORM_PCT.
  const globalPlatformPct = (() => {
    try {
      const slabs = (globalRule as any[])[0]?.slabs;
      if (Array.isArray(slabs) && slabs.length && slabs[0]?.platformPct != null) return Number(slabs[0].platformPct);
    } catch {}
    return DEFAULT_PLATFORM_PCT;
  })();

  const acceptedBids = (bids as any[]).filter((b) => ACCEPTED_STATUSES.has(b.status));

  const ledger = (hotels as any[]).map((h: any) => {
    const myBids = acceptedBids.filter((b) => b.hotelId === h.id);
    const gmv = myBids.reduce((s: number, b: any) => {
      // Prefer authoritative bid_paid_amounts.paid_total when present
      const paid = paidByBidId[b.id];
      return s + (paid != null ? paid : Number(b.amount) || 0);
    }, 0);
    const commissionPct = hotelPctByHotelId[h.id] ?? globalPlatformPct;
    const commissionEarned = Math.round((gmv * commissionPct) / 100);
    return {
      hotelId: h.id,
      hotelName: h.name,
      city: h.city || "—",
      bookings: myBids.length,
      gmv,
      commissionPct,
      commissionEarned,
      netPayout: gmv - commissionEarned,
    };
  })
  .sort((a: any, b: any) => b.gmv - a.gmv);

  return NextResponse.json({
    ledger,
    total: ledger.length,
    totals: {
      gmv: ledger.reduce((s, r) => s + r.gmv, 0),
      commission: ledger.reduce((s, r) => s + r.commissionEarned, 0),
      netPayout: ledger.reduce((s, r) => s + r.netPayout, 0),
      bookings: ledger.reduce((s, r) => s + r.bookings, 0),
    },
  });
}
