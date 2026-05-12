// Tiered commission compute (v95).
//
// Replaces the v94 flat 12% / 15% Elite hardcoded rate with a slab-based
// system where the rate climbs with monthly booking volume + a loyalty
// bonus for creators who stay at a slab for N consecutive months.
//
// Pure functions only — no Supabase calls here. The /api/attribution/record
// route resolves the effective rule + the creator's monthly bookings count
// + consecutive-months tally, then calls computeCommission().

export type Slab = {
  minBookings: number;   // inclusive
  maxBookings: number;   // inclusive (use 999999 for "no upper cap")
  pct: number;           // e.g. 5 = 5%
};

export type LoyaltyBonus = {
  months: number;        // consecutive months at same-or-higher slab
  bonusPct: number;      // additive bonus (e.g. 1 = +1%)
};

export type CommissionRule = {
  id?: string;
  scope?: "global" | "creator";
  creator_id?: string | null;
  slabs: Slab[];
  loyaltyBonuses: LoyaltyBonus[];
  note?: string | null;
  updatedAt?: string;
};

// Default platform rule — also seeded in the v95 migration, but used as a
// final fallback if BOTH the per-creator override AND the global row are
// missing (e.g. the migration hasn't been applied yet).
export const DEFAULT_RULE: CommissionRule = {
  scope: "global",
  slabs: [
    { minBookings: 1,   maxBookings: 25,  pct: 5  },
    { minBookings: 26,  maxBookings: 50,  pct: 7  },
    { minBookings: 51,  maxBookings: 100, pct: 10 },
    { minBookings: 101, maxBookings: 300, pct: 12 },
  ],
  loyaltyBonuses: [
    { months: 3, bonusPct: 1 },
    { months: 6, bonusPct: 2 },
  ],
};

export type CommissionResult = {
  slab: Slab | null;
  basePct: number;        // slab.pct
  loyaltyPct: number;     // best matching bonus
  totalPct: number;       // basePct + loyaltyPct (capped at 100)
  commissionAmount: number;
  meta: {
    monthlyBookings: number;
    consecutiveMonths: number;
    bookingAmount: number;
  };
};

// Pick the slab row for the given monthly booking count.
// Below the lowest slab → returns null (no commission — creator hasn't
// reached the minimum-booking threshold yet).
// Above the top slab's maxBookings → returns the top slab (rate is capped
// at the highest tier, not increased further).
export function pickSlab(slabs: Slab[], monthlyBookings: number): Slab | null {
  if (!Array.isArray(slabs) || slabs.length === 0) return null;
  // Sort so we have a deterministic "top slab" definition
  const sorted = [...slabs].sort((a, b) => a.minBookings - b.minBookings);
  const exact = sorted.find(s => monthlyBookings >= s.minBookings && monthlyBookings <= s.maxBookings);
  if (exact) return exact;
  // Above the highest maxBookings → cap at the top slab
  const top = sorted[sorted.length - 1];
  if (monthlyBookings > top.maxBookings) return top;
  // Below the lowest minBookings → no slab matched
  return null;
}

// Pick the best loyalty bonus the creator qualifies for, given how many
// months they've consecutively held this slab (or a higher one — see the
// resolver in /api/attribution/record).
export function pickLoyalty(bonuses: LoyaltyBonus[], consecutiveMonths: number): number {
  if (!Array.isArray(bonuses) || bonuses.length === 0) return 0;
  let best = 0;
  for (const b of bonuses) {
    if (consecutiveMonths >= b.months && b.bonusPct > best) best = b.bonusPct;
  }
  return best;
}

// Main compute. Given a rule + the creator's current booking volume +
// consecutive-months tally + the booking's GMV, returns the slab, the
// effective % and the absolute commission amount.
export function computeCommission(args: {
  rule: CommissionRule;
  monthlyBookings: number;       // count of attributed bookings this calendar month (including this one)
  consecutiveMonths: number;     // months in a row at this slab or higher
  bookingAmount: number;         // paid_total of THIS booking
}): CommissionResult {
  const { rule, monthlyBookings, consecutiveMonths, bookingAmount } = args;
  const slab = pickSlab(rule.slabs, monthlyBookings);
  const basePct = slab?.pct ?? 0;
  const loyaltyPct = slab ? pickLoyalty(rule.loyaltyBonuses, consecutiveMonths) : 0;
  const totalPct = Math.min(100, basePct + loyaltyPct);
  const commissionAmount = Math.round((Number(bookingAmount) || 0) * (totalPct / 100) * 100) / 100;
  return {
    slab: slab || null,
    basePct,
    loyaltyPct,
    totalPct,
    commissionAmount,
    meta: { monthlyBookings, consecutiveMonths, bookingAmount: Number(bookingAmount) || 0 },
  };
}

// Lightweight validation used by the admin API before writing a rule row.
// Returns null on success or an error message string.
export function validateRule(rule: Partial<CommissionRule>): string | null {
  if (!rule.slabs || !Array.isArray(rule.slabs) || rule.slabs.length === 0) {
    return "At least one slab is required.";
  }
  // Slab bounds must be sane
  for (const s of rule.slabs) {
    if (typeof s.minBookings !== "number" || typeof s.maxBookings !== "number" || typeof s.pct !== "number") {
      return "Each slab needs numeric minBookings, maxBookings and pct.";
    }
    if (s.minBookings < 0 || s.maxBookings < s.minBookings) {
      return "Slab maxBookings must be ≥ minBookings and both ≥ 0.";
    }
    if (s.pct < 0 || s.pct > 100) {
      return "Slab pct must be between 0 and 100.";
    }
  }
  // No overlaps (sorted; consecutive slabs should not overlap)
  const sorted = [...rule.slabs].sort((a, b) => a.minBookings - b.minBookings);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].minBookings <= sorted[i - 1].maxBookings) {
      return `Slabs overlap: [${sorted[i - 1].minBookings}–${sorted[i - 1].maxBookings}] vs [${sorted[i].minBookings}–${sorted[i].maxBookings}].`;
    }
  }
  // Bonuses (optional but if provided must be valid)
  if (rule.loyaltyBonuses) {
    if (!Array.isArray(rule.loyaltyBonuses)) return "loyaltyBonuses must be an array.";
    for (const b of rule.loyaltyBonuses) {
      if (typeof b.months !== "number" || typeof b.bonusPct !== "number") {
        return "Each loyalty bonus needs numeric months + bonusPct.";
      }
      if (b.months < 1 || b.bonusPct < 0 || b.bonusPct > 100) {
        return "Loyalty bonus months must be ≥ 1 and bonusPct must be 0–100.";
      }
    }
  }
  return null;
}
