// ============================================================================
// StayCircle™ — Community Partner Platform · bundle engine (v288)
//
// SINGLE SOURCE OF TRUTH for every ₹ figure in the /circle vertical.
// Pure functions only — NO fetch, NO Supabase. Imported by BOTH the client
// wizard (live preview on /circle/build) AND the server checkout
// (/api/circle/checkout re-computes the ENTIRE bundle from DB rates before
// creating the Razorpay order) so preview == charge, always.
// Same contract as lib/host/wizard-rules.ts — the client NEVER sets an amount.
// ============================================================================

export type PaymentPlanKey = "monthly" | "quarterly" | "half_yearly" | "yearly";

export interface PaymentPlan {
  key: PaymentPlanKey;
  name: string;
  months: number;       // billing period covered by one payment
  discountPct: number;  // 0–1 fraction off the period total
  hint: string;
}

// From the launch design: Monthly · Quarterly (5% off) · Half-Yearly (8% off)
// · Yearly (12% off).
export const CIRCLE_PLANS: Record<PaymentPlanKey, PaymentPlan> = {
  monthly:     { key: "monthly",     name: "Monthly",              months: 1,  discountPct: 0,    hint: "Pay month to month" },
  quarterly:   { key: "quarterly",   name: "Quarterly (3 months)", months: 3,  discountPct: 0.05, hint: "5% off" },
  half_yearly: { key: "half_yearly", name: "Half-Yearly (6 months)", months: 6, discountPct: 0.08, hint: "8% off" },
  yearly:      { key: "yearly",      name: "Yearly (12 months)",   months: 12, discountPct: 0.12, hint: "12% off" },
};

export const PLAN_ORDER: PaymentPlanKey[] = ["monthly", "quarterly", "half_yearly", "yearly"];

// ---------------------------------------------------------------------------
// Revenue bifurcation (v294.9)
// The investor's NET income is the ROI-anchored number (unchanged). The GROSS
// booking revenue the property earns sits ABOVE it — StayBid keeps a
// management/platform share, the investor keeps the rest. So:
//   net income  = gross revenue × INVESTOR_SHARE
//   platform    = gross revenue × (1 − INVESTOR_SHARE)
//   ⇒ gross revenue = net income ÷ INVESTOR_SHARE   (derive up from income)
// This keeps the net income EXACT (== the ROI number the investor sees) and
// only derives the revenue line above it for the "where does my income come
// from" breakdown.
//
// ⚠ FLAGGED SENSIBLE DEFAULT — pending Sachin's real business number. The
// investor keeps 72% of gross booking revenue; StayBid management + platform
// takes 28%. Change here → both the engine + build page update in lockstep.
export const INVESTOR_SHARE = 0.72;
export const PLATFORM_SHARE = Math.round((1 - INVESTOR_SHARE) * 1000) / 1000; // 0.28

export interface BundleItem {
  propertyId: string;
  propertyTitle: string;
  city: string;
  roomTypeId: string;
  roomTypeName: string;
  monthlyRate: number;  // ₹ / room / month — ALWAYS from DB, never from client
  rooms: number;        // 0–10 per room type
  roiMin: number;       // property annual ROI band (pct)
  roiMax: number;
}

export interface CircleBundle {
  ok: boolean;
  error?: string;
  items: BundleItem[];
  propertyCount: number;
  roomCount: number;
  monthlyTotal: number;          // ₹ committed per month before discount
  plan: PaymentPlanKey;
  planMonths: number;
  discountPct: number;           // 0–1
  discountAmount: number;        // ₹ saved on this payment
  payNow: number;                // ₹ charged today (period total − discount)
  diversificationBonusPct: number;
  expectedRoiMin: number;        // pct, incl. diversification bonus
  expectedRoiMax: number;
  expectedMonthlyIncome: number; // ₹ / month at avg ROI — your NET take-home
  expectedAnnualIncome: number;
  // Revenue bifurcation (v294.9) — gross booking revenue the property earns,
  // and StayBid's management/platform share. Net income = revenue − platform.
  investorSharePct: number;         // pct the investor keeps (e.g. 72)
  platformSharePct: number;         // pct StayBid keeps (e.g. 28)
  expectedMonthlyRevenue: number;   // ₹ / month GROSS booking revenue
  expectedAnnualRevenue: number;
  platformShareMonthly: number;     // ₹ / month StayBid management + platform
  platformShareAnnual: number;
  paybackYearsMin: number;
  paybackYearsMax: number;
  paybackLabel: string;          // "3–4 years"
}

export const MAX_ROOMS_PER_TYPE = 10;
export const MAX_BUNDLE_ITEMS = 12;

// Multi-property bundles earn a diversification bonus on the blended ROI —
// this is what lifts a 15–19% single-card band into the 28–32% bundle band
// shown on the Investment & Returns screen. +4% per EXTRA property, cap +12%.
export function diversificationBonus(propertyCount: number): number {
  return Math.min(12, Math.max(0, propertyCount - 1) * 4);
}

const r0 = (n: number) => Math.round(n);

export function computeBundle(
  rawItems: BundleItem[],
  planKey: PaymentPlanKey,
): CircleBundle {
  const plan = CIRCLE_PLANS[planKey] || CIRCLE_PLANS.monthly;
  const items = (Array.isArray(rawItems) ? rawItems : [])
    .filter((it) => it && Number(it.rooms) > 0 && Number(it.monthlyRate) > 0)
    .slice(0, MAX_BUNDLE_ITEMS)
    .map((it) => ({
      ...it,
      rooms: Math.min(MAX_ROOMS_PER_TYPE, Math.max(1, Math.floor(Number(it.rooms) || 1))),
      monthlyRate: Math.max(0, Number(it.monthlyRate) || 0),
    }));

  const empty: CircleBundle = {
    ok: false,
    error: "Bundle me kam se kam 1 room add karein.",
    items: [],
    propertyCount: 0,
    roomCount: 0,
    monthlyTotal: 0,
    plan: plan.key,
    planMonths: plan.months,
    discountPct: plan.discountPct,
    discountAmount: 0,
    payNow: 0,
    diversificationBonusPct: 0,
    expectedRoiMin: 0,
    expectedRoiMax: 0,
    expectedMonthlyIncome: 0,
    expectedAnnualIncome: 0,
    investorSharePct: Math.round(INVESTOR_SHARE * 100),
    platformSharePct: Math.round(PLATFORM_SHARE * 100),
    expectedMonthlyRevenue: 0,
    expectedAnnualRevenue: 0,
    platformShareMonthly: 0,
    platformShareAnnual: 0,
    paybackYearsMin: 0,
    paybackYearsMax: 0,
    paybackLabel: "—",
  };
  if (!items.length) return empty;

  const monthlyTotal = r0(items.reduce((s, it) => s + it.monthlyRate * it.rooms, 0));
  if (monthlyTotal <= 0) return empty;

  const roomCount = items.reduce((s, it) => s + it.rooms, 0);
  const propertyIds: string[] = [];
  items.forEach((it) => {
    if (!propertyIds.includes(it.propertyId)) propertyIds.push(it.propertyId);
  });
  const propertyCount = propertyIds.length;

  // Contribution-weighted ROI band + diversification bonus.
  const wMin = items.reduce((s, it) => s + (Number(it.roiMin) || 0) * it.monthlyRate * it.rooms, 0) / monthlyTotal;
  const wMax = items.reduce((s, it) => s + (Number(it.roiMax) || 0) * it.monthlyRate * it.rooms, 0) / monthlyTotal;
  const bonus = diversificationBonus(propertyCount);
  const expectedRoiMin = Math.round((wMin + bonus) * 10) / 10;
  const expectedRoiMax = Math.round((wMax + bonus) * 10) / 10;
  const roiAvg = (expectedRoiMin + expectedRoiMax) / 2;

  const periodGross = monthlyTotal * plan.months;
  const discountAmount = r0(periodGross * plan.discountPct);
  const payNow = r0(periodGross - discountAmount);

  const expectedAnnualIncome = r0(monthlyTotal * 12 * (roiAvg / 100));
  const expectedMonthlyIncome = r0(expectedAnnualIncome / 12);

  // Revenue bifurcation: derive gross revenue ABOVE the net income so the
  // net income stays EXACTLY the ROI number and the platform share is the gap.
  const expectedMonthlyRevenue = r0(expectedMonthlyIncome / INVESTOR_SHARE);
  const platformShareMonthly = r0(expectedMonthlyRevenue - expectedMonthlyIncome);
  const expectedAnnualRevenue = r0(expectedMonthlyRevenue * 12);
  const platformShareAnnual = r0(platformShareMonthly * 12);

  const paybackYearsMin = expectedRoiMax > 0 ? Math.round((100 / expectedRoiMax) * 10) / 10 : 0;
  const paybackYearsMax = expectedRoiMin > 0 ? Math.round((100 / expectedRoiMin) * 10) / 10 : 0;
  const paybackLabel =
    paybackYearsMin > 0
      ? `${Math.round(paybackYearsMin)}–${Math.round(paybackYearsMax)} years`
      : "—";

  return {
    ok: true,
    items,
    propertyCount,
    roomCount,
    monthlyTotal,
    plan: plan.key,
    planMonths: plan.months,
    discountPct: plan.discountPct,
    discountAmount,
    payNow,
    diversificationBonusPct: bonus,
    expectedRoiMin,
    expectedRoiMax,
    expectedMonthlyIncome,
    expectedAnnualIncome,
    investorSharePct: Math.round(INVESTOR_SHARE * 100),
    platformSharePct: Math.round(PLATFORM_SHARE * 100),
    expectedMonthlyRevenue,
    expectedAnnualRevenue,
    platformShareMonthly,
    platformShareAnnual,
    paybackYearsMin,
    paybackYearsMax,
    paybackLabel,
  };
}

export function fmtINR(n: number): string {
  return "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
}
