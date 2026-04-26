// SINGLE SOURCE OF TRUTH for customer tier across the platform.
//
// Wallet/Profile already computes tier from totalSpend; this module mirrors
// EXACTLY the same thresholds so the Verification module never disagrees.
//
// Thresholds match app/wallet/page.tsx so all surfaces show the same tier.

export type Tier = "silver" | "gold" | "platinum";

export const TIER_THRESHOLDS = {
  silver:   { min: 0,     max: 9_999,    pointsRate: 5  },
  gold:     { min: 10_000, max: 49_999,  pointsRate: 7  },
  platinum: { min: 50_000, max: Infinity, pointsRate: 10 },
} as const;

export function computeTierFromSpend(totalSpend: number): Tier {
  if (totalSpend >= TIER_THRESHOLDS.platinum.min) return "platinum";
  if (totalSpend >= TIER_THRESHOLDS.gold.min)     return "gold";
  return "silver";
}

export function tierLabel(t: Tier): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}
