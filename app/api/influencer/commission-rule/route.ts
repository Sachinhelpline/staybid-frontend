// v105.2 — Creator's effective commission rule + live snapshot.
//
// Surfaces the v95 tiered slab system to the creator dashboard:
//   - Active rule (global or per-creator override)
//   - Slab ladder (1-25: 5%, 26-50: 7%, etc.)
//   - This month's attributed booking count
//   - Consecutive-month tally for loyalty bonus
//   - Current slab + projected next-slab rate
//
// Anyone can call with a creator_id; production gate is via the route's
// own role check (caller must be the creator themselves or admin).

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, userFromReq } from "@/lib/sb";
import { DEFAULT_RULE, pickSlab, pickLoyalty, type CommissionRule } from "@/lib/commission";

async function getRule(creatorId: string | null): Promise<CommissionRule> {
  // 1. Try the per-creator override first.
  if (creatorId) {
    try {
      const r = await fetch(
        `${SB_URL}/rest/v1/commission_rules?scope=eq.creator&creator_id=eq.${encodeURIComponent(creatorId)}&active=eq.true&order=updated_at.desc&limit=1`,
        { headers: SB_H }
      );
      const rows = await r.json();
      if (Array.isArray(rows) && rows[0]) {
        return {
          id: rows[0].id, scope: "creator", creator_id: creatorId,
          slabs: rows[0].slabs || DEFAULT_RULE.slabs,
          loyaltyBonuses: rows[0].loyalty_bonuses || DEFAULT_RULE.loyaltyBonuses,
          note: rows[0].note,
          updatedAt: rows[0].updated_at,
        };
      }
    } catch { /* fall through to global */ }
  }
  // 2. Fall back to the global rule.
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/commission_rules?scope=eq.global&active=eq.true&order=updated_at.desc&limit=1`,
      { headers: SB_H }
    );
    const rows = await r.json();
    if (Array.isArray(rows) && rows[0]) {
      return {
        id: rows[0].id, scope: "global",
        slabs: rows[0].slabs || DEFAULT_RULE.slabs,
        loyaltyBonuses: rows[0].loyalty_bonuses || DEFAULT_RULE.loyaltyBonuses,
        note: rows[0].note,
        updatedAt: rows[0].updated_at,
      };
    }
  } catch { /* fall through to baked-in default */ }
  return DEFAULT_RULE;
}

async function getMonthlyBookings(creatorId: string | null, creatorUserId: string | null): Promise<number> {
  const month = new Date();
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1).toISOString();
  const ors: string[] = [];
  if (creatorId)     ors.push(`creator_id.eq.${encodeURIComponent(creatorId)}`);
  if (creatorUserId) ors.push(`creator_user_id.eq.${encodeURIComponent(creatorUserId)}`);
  if (!ors.length) return 0;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/bid_attributions?or=(${ors.join(",")})&source=eq.creator&created_at=gte.${monthStart}&select=bid_id`,
      { headers: { ...SB_H, Prefer: "count=exact" } }
    );
    const cr = r.headers.get("content-range") || "";
    const m = cr.match(/\/(\d+)$/);
    if (m) return parseInt(m[1], 10);
    const j = await r.json().catch(() => []);
    return Array.isArray(j) ? j.length : 0;
  } catch { return 0; }
}

async function getConsecutiveMonths(creatorId: string | null, currentSlabMin: number): Promise<number> {
  if (!creatorId || !currentSlabMin) return 0;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/creator_commission_history?creator_id=eq.${encodeURIComponent(creatorId)}&order=year.desc,month.desc&limit=12&select=year,month,slab_min`,
      { headers: SB_H }
    );
    const rows = await r.json();
    if (!Array.isArray(rows)) return 0;
    let streak = 0;
    const now = new Date();
    let yr = now.getFullYear();
    let mo = now.getMonth() + 1;
    for (const row of rows) {
      // Walk months backwards. Stop on first gap or first lower slab.
      mo--; if (mo === 0) { mo = 12; yr--; }
      if (row.year !== yr || row.month !== mo) break;
      if ((row.slab_min || 0) < currentSlabMin) break;
      streak++;
    }
    return streak;
  } catch { return 0; }
}

export async function GET(req: NextRequest) {
  const u = userFromReq(req);
  if (!u?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const creatorId = searchParams.get("creatorId");

  // Resolve the creator's influencer id from the user id if not provided.
  let resolvedCreatorId = creatorId;
  let resolvedCreatorUserId: string | null = u.id;
  if (!resolvedCreatorId) {
    try {
      const r = await fetch(
        `${SB_URL}/rest/v1/influencers?user_id=eq.${encodeURIComponent(u.id)}&select=id&limit=1`,
        { headers: SB_H }
      );
      const rows = await r.json();
      resolvedCreatorId = Array.isArray(rows) && rows[0]?.id ? rows[0].id : null;
    } catch { /* ok — fall through with null */ }
  }

  const rule = await getRule(resolvedCreatorId);
  const monthlyBookings = await getMonthlyBookings(resolvedCreatorId, resolvedCreatorUserId);
  const currentSlab = pickSlab(rule.slabs, monthlyBookings);
  const consecutiveMonths = currentSlab
    ? await getConsecutiveMonths(resolvedCreatorId, currentSlab.minBookings)
    : 0;
  const loyaltyPct = pickLoyalty(rule.loyaltyBonuses, consecutiveMonths);
  const basePct = currentSlab?.pct || 0;
  const totalPct = Math.min(100, basePct + loyaltyPct);

  // Find next slab up so creator can see "X more bookings → Y%"
  const sortedSlabs = [...rule.slabs].sort((a, b) => a.minBookings - b.minBookings);
  const nextSlab = sortedSlabs.find((s) => s.minBookings > monthlyBookings);
  const bookingsToNext = nextSlab ? Math.max(0, nextSlab.minBookings - monthlyBookings) : 0;

  return NextResponse.json({
    rule: {
      scope: rule.scope,
      slabs: rule.slabs,
      loyaltyBonuses: rule.loyaltyBonuses,
      note: rule.note || null,
    },
    snapshot: {
      monthlyBookings,
      currentSlab,
      basePct,
      loyaltyPct,
      totalPct,
      consecutiveMonths,
      nextSlab,
      bookingsToNext,
    },
  });
}
