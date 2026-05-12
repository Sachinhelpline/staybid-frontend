// POST /api/attribution/record
// Body: { bidId, hotelId, customerId?, paidTotal?, flow?, dealId?,
//         source, creatorUserId?, creatorHandle?, creatorType?, videoId? }
//
// Writes / upserts a bid_attributions row. Idempotent — re-posting the same
// bidId updates the existing row (used when paid_total or flow change after
// the initial write, e.g. Hold balance settle).
//
// Also auto-creates an influencer_commissions row when source="creator"
// AND creator_user_id maps to a registered influencer with status='active'.
// Tier 3 (Elite) creators earn 15%, everyone else 12%.
import { NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";
import {
  DEFAULT_RULE,
  computeCommission,
  type CommissionRule,
} from "@/lib/commission";

async function sbSelect(path: string) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_READ, cache: "no-store" });
  if (!r.ok) return [];
  return r.json().catch(() => []);
}

// ── v95 helpers: resolve the effective rule + the creator's monthly
//                volume + consecutive-months tally for loyalty bonus.
// All three helpers degrade gracefully — if the new commission_rules /
// creator_commission_history tables don't exist yet (migration not applied)
// we fall back to DEFAULT_RULE + monthlyBookings=1 + consecutiveMonths=0.
async function resolveRule(creatorId: string | null): Promise<CommissionRule> {
  if (creatorId) {
    const override = await sbSelect(
      `commission_rules?scope=eq.creator&active=eq.true&creator_id=eq.${encodeURIComponent(creatorId)}&select=*&limit=1`
    );
    const row = Array.isArray(override) && override[0] ? override[0] : null;
    if (row?.slabs) {
      return {
        id: row.id, scope: "creator", creator_id: creatorId,
        slabs: row.slabs, loyaltyBonuses: row.loyalty_bonuses || [],
        note: row.note, updatedAt: row.updated_at,
      };
    }
  }
  const global = await sbSelect(
    `commission_rules?scope=eq.global&active=eq.true&select=*&limit=1`
  );
  const g = Array.isArray(global) && global[0] ? global[0] : null;
  if (g?.slabs) {
    return {
      id: g.id, scope: "global",
      slabs: g.slabs, loyaltyBonuses: g.loyalty_bonuses || [],
      note: g.note, updatedAt: g.updated_at,
    };
  }
  return DEFAULT_RULE;
}

// Returns the # of creator-attributed bookings this calendar month for
// the given creator (by influencer id OR creator_user_id, whichever was
// passed at attribution time). Counts the row being written too, so a
// brand-new creator's first booking returns 1.
async function monthlyBookingsFor(creatorId: string | null, creatorUserId: string | null): Promise<number> {
  if (!creatorId && !creatorUserId) return 1;
  const start = new Date();
  start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
  const sinceIso = start.toISOString();
  const filter = creatorId
    ? `creator_id=eq.${encodeURIComponent(creatorId)}`
    : `creator_user_id=eq.${encodeURIComponent(creatorUserId!)}`;
  const rows = await sbSelect(
    `bid_attributions?${filter}&created_at=gte.${encodeURIComponent(sinceIso)}&select=bid_id&limit=2000`
  );
  // +1 for this booking (the row is written below, so the count returned
  // here is "before insert" — see the call site for the increment).
  return (Array.isArray(rows) ? rows.length : 0) + 1;
}

// Walks the last N calendar months back from the current month, counting
// how many consecutive months the creator's tracked slab.minBookings was
// >= the current slab's minBookings (i.e. "didn't drop below"). Returns 0
// when the creator has no history yet.
async function consecutiveMonthsAtSlab(creatorId: string | null, currentSlabMin: number): Promise<number> {
  if (!creatorId) return 0;
  const rows = await sbSelect(
    `creator_commission_history?creator_id=eq.${encodeURIComponent(creatorId)}&select=year,month,slab_min&order=year.desc,month.desc&limit=12`
  );
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  // We expect rows in {year, month, slab_min} shape sorted desc. Walk in
  // calendar order; count how many of the IMMEDIATELY PREVIOUS months
  // (last month, month-before-that, …) had slab_min >= currentSlabMin.
  const now = new Date();
  let consecutive = 0;
  for (let i = 1; i <= 12; i++) {
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const ty = target.getUTCFullYear(), tm = target.getUTCMonth() + 1;
    const r = rows.find((x: any) => x.year === ty && x.month === tm);
    if (!r) break;                                  // gap → streak broken
    if ((r.slab_min || 0) < currentSlabMin) break;  // dropped below → streak broken
    consecutive += 1;
  }
  return consecutive;
}

// Upserts THIS calendar month's snapshot for the creator after the
// commission has been computed. Idempotent — re-running with the same
// inputs is safe (it's keyed on creator_id+year+month).
async function upsertMonthSnapshot(args: {
  creatorId: string;
  monthlyBookings: number;
  slabMin: number | null;
  slabMax: number | null;
  slabPct: number;
  loyaltyPct: number;
  totalPct: number;
  bookingAmount: number;
  commissionAmount: number;
}) {
  const now = new Date();
  const year = now.getUTCFullYear(), month = now.getUTCMonth() + 1;

  // Read existing row so we can add the new booking's amount to the
  // running monthly totals rather than overwrite.
  const existing = await sbSelect(
    `creator_commission_history?creator_id=eq.${encodeURIComponent(args.creatorId)}&year=eq.${year}&month=eq.${month}&select=gmv,commission_total&limit=1`
  );
  const ex = Array.isArray(existing) && existing[0] ? existing[0] : null;
  const newGmv = Number(ex?.gmv || 0) + (args.bookingAmount || 0);
  const newComm = Number(ex?.commission_total || 0) + (args.commissionAmount || 0);

  const row = {
    creator_id:        args.creatorId,
    year, month,
    bookings_count:    args.monthlyBookings,
    slab_min:          args.slabMin,
    slab_max:          args.slabMax,
    slab_pct:          args.slabPct,
    loyalty_pct:       args.loyaltyPct,
    total_pct:         args.totalPct,
    gmv:               Math.round(newGmv * 100) / 100,
    commission_total:  Math.round(newComm * 100) / 100,
    computed_at:       new Date().toISOString(),
  };

  if (ex) {
    await fetch(
      `${SB_URL}/rest/v1/creator_commission_history?creator_id=eq.${encodeURIComponent(args.creatorId)}&year=eq.${year}&month=eq.${month}`,
      { method: "PATCH", headers: SB_H, body: JSON.stringify(row) }
    ).catch(() => {});
  } else {
    await fetch(`${SB_URL}/rest/v1/creator_commission_history`, {
      method: "POST", headers: SB_H, body: JSON.stringify(row),
    }).catch(() => {});
  }
}

export async function POST(req: Request) {
  try {
    const b = await req.json();
    if (!b.bidId || !b.hotelId) {
      return NextResponse.json({ error: "bidId + hotelId required" }, { status: 400 });
    }

    const source = String(b.source || "direct");
    let creatorId: string | null = null;
    let commissionPct: number | null = null;
    let commissionAmount: number | null = null;
    let commissionMeta: any = null;

    // v95 — Resolve influencer registration → compute slab + loyalty %.
    // The flat 12% / 15% Elite from v94 is replaced with an admin-editable
    // tiered system (commission_rules + creator_commission_history).
    // Per-creator override beats the global default; default falls back to
    // DEFAULT_RULE if commission_rules table doesn't exist yet.
    if (source === "creator" && b.creatorUserId) {
      const rows = await sbSelect(
        `influencers?user_id=eq.${encodeURIComponent(b.creatorUserId)}&select=id,status,total_earnings`
      );
      const inf = Array.isArray(rows) && rows[0] ? rows[0] : null;
      if (inf && inf.status === "active") {
        creatorId = inf.id;
        if (b.paidTotal != null) {
          const rule = await resolveRule(creatorId);
          const monthly = await monthlyBookingsFor(creatorId, b.creatorUserId);
          // pick the slab BEFORE consecutive-months lookup so we know the
          // floor min to compare against history.
          const sortedSlabs = [...(rule.slabs || [])].sort((a, b) => a.minBookings - b.minBookings);
          const matched = sortedSlabs.find(s => monthly >= s.minBookings && monthly <= s.maxBookings)
                       || (monthly > (sortedSlabs[sortedSlabs.length - 1]?.maxBookings ?? 0) ? sortedSlabs[sortedSlabs.length - 1] : null);
          const currentSlabMin = matched?.minBookings ?? 0;
          const consec = await consecutiveMonthsAtSlab(creatorId, currentSlabMin);
          const c = computeCommission({
            rule,
            monthlyBookings: monthly,
            consecutiveMonths: consec,
            bookingAmount: Number(b.paidTotal || 0),
          });
          commissionPct = c.totalPct > 0 ? c.totalPct / 100 : null;
          commissionAmount = c.commissionAmount > 0 ? c.commissionAmount : null;
          commissionMeta = {
            slab: c.slab,
            basePct: c.basePct,
            loyaltyPct: c.loyaltyPct,
            totalPct: c.totalPct,
            monthlyBookings: monthly,
            consecutiveMonths: consec,
            ruleId: rule.id,
            ruleScope: rule.scope,
          };
        }
      }
    }

    const row = {
      bid_id:            b.bidId,
      hotel_id:          b.hotelId,
      customer_id:       b.customerId || null,
      source,
      creator_id:        creatorId,
      creator_user_id:   b.creatorUserId || null,
      creator_handle:    b.creatorHandle || null,
      creator_type:      b.creatorType || null,
      video_id:          b.videoId || null,
      flow:              b.flow || null,
      deal_id:           b.dealId || null,
      paid_total:        b.paidTotal != null ? Number(b.paidTotal) : null,
      commission_pct:    commissionPct,
      commission_amount: commissionAmount,
      // v95 — preserve the slab + loyalty + rule snapshot at write time so
      // admins can audit how a particular commission was computed (slab
      // changes after the fact don't rewrite past commissions).
      metadata:          commissionMeta ? { ...(b.metadata || {}), commission: commissionMeta } : (b.metadata || null),
    };

    // Upsert: PATCH if existing, else POST.
    const existing = await sbSelect(`bid_attributions?bid_id=eq.${encodeURIComponent(b.bidId)}&select=bid_id`);
    if (Array.isArray(existing) && existing[0]) {
      await fetch(`${SB_URL}/rest/v1/bid_attributions?bid_id=eq.${encodeURIComponent(b.bidId)}`, {
        method: "PATCH", headers: SB_H, body: JSON.stringify(row),
      }).catch(() => {});
    } else {
      await fetch(`${SB_URL}/rest/v1/bid_attributions`, {
        method: "POST", headers: SB_H, body: JSON.stringify(row),
      }).catch(() => {});
    }

    // If a creator commission applies AND a commission row doesn't already
    // exist for this bid, write one (pending) so the creator hub picks it up.
    if (creatorId && commissionAmount != null && commissionAmount > 0) {
      const dup = await sbSelect(`influencer_commissions?bid_id=eq.${encodeURIComponent(b.bidId)}&select=id&limit=1`);
      if (!Array.isArray(dup) || !dup[0]) {
        await fetch(`${SB_URL}/rest/v1/influencer_commissions`, {
          method: "POST", headers: SB_H,
          body: JSON.stringify({
            influencer_id:          creatorId,
            bid_id:                 b.bidId,
            booking_id:             null,
            hotel_id:               b.hotelId,
            booking_amount:         Number(b.paidTotal || 0),
            commission_percentage:  commissionPct,
            commission_amount:      commissionAmount,
            status:                 "pending",
          }),
        }).catch(() => {});
      }
      // v95 — snapshot the creator's current calendar month so the
      // consecutive-months loyalty check has data to walk against next time.
      if (commissionMeta) {
        await upsertMonthSnapshot({
          creatorId,
          monthlyBookings:  commissionMeta.monthlyBookings,
          slabMin:          commissionMeta.slab?.minBookings ?? null,
          slabMax:          commissionMeta.slab?.maxBookings ?? null,
          slabPct:          commissionMeta.basePct,
          loyaltyPct:       commissionMeta.loyaltyPct,
          totalPct:         commissionMeta.totalPct,
          bookingAmount:    Number(b.paidTotal || 0),
          commissionAmount: commissionAmount,
        });
      }
    }

    return NextResponse.json({ recorded: true, source, creatorId, commissionAmount, commission: commissionMeta });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "record failed" }, { status: 500 });
  }
}

// GET /api/attribution/record?ids=bid1,bid2,...  → bulk read.
// Used by partner + admin Bookings tables to enrich rows with their source.
export async function GET(req: Request) {
  try {
    const ids = (new URL(req.url).searchParams.get("ids") || "").split(",").filter(Boolean);
    if (!ids.length) return NextResponse.json({ attributions: {} });
    const rows = await sbSelect(
      `bid_attributions?bid_id=in.(${ids.map(encodeURIComponent).join(",")})&select=*&limit=500`
    );
    const map: Record<string, any> = {};
    for (const r of (rows as any[])) {
      map[r.bid_id] = {
        bidId:            r.bid_id,
        source:           r.source,
        creatorId:        r.creator_id,
        creatorUserId:    r.creator_user_id,
        creatorHandle:    r.creator_handle,
        creatorType:      r.creator_type,
        videoId:          r.video_id,
        flow:             r.flow,
        dealId:           r.deal_id,
        paidTotal:        r.paid_total != null ? Number(r.paid_total) : null,
        commissionPct:    r.commission_pct != null ? Number(r.commission_pct) : null,
        commissionAmount: r.commission_amount != null ? Number(r.commission_amount) : null,
        createdAt:        r.created_at,
      };
    }
    return NextResponse.json({ attributions: map });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "fetch failed" }, { status: 500 });
  }
}
