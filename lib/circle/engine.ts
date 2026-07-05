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

// ----------------------------------------------------------------------------
// Honest revenue model (v294.13) — admin-editable, ALL defaults.
// The panel shows: You invest ₹X/mo → your properties generate booking
// revenue (uplift % of investment, ALWAYS > investment) → StayBid platform
// fee (% of revenue) + management (channel-manager) + one-time setup/city.
// The investor's take-home stays the realistic ROI-band income
// (expectedMonthlyIncome) — gross revenue is TURNOVER (proof the asset is
// productive), NOT the investor's pocket. Numbers below are sensible
// defaults, overridable per-row from /admin/circle → Revenue Model.
// ----------------------------------------------------------------------------
export interface CircleRevenueConfig {
  upliftPct: number;         // booking revenue as % of monthly investment (≥100)
  commissionPct: number;     // StayBid platform fee as % of gross revenue (0–100)
  setupPerRoom: number;      // one-time onboarding ₹ / room
  cityActivationFee: number; // one-time ₹ / city
  managementMonthly: number; // recurring channel-manager ₹ / property / month
}

export const DEFAULT_CIRCLE_REVENUE: CircleRevenueConfig = {
  upliftPct: 140,
  commissionPct: 10,
  setupPerRoom: 4999,
  cityActivationFee: 2499,
  managementMonthly: 1499,
};

// Merge a (possibly partial) admin-stored blob over the defaults, pulling ONLY
// numeric fields + clamping every one — same contract as host mergeWizardConfig.
// upliftPct floored at 100 (revenue can never be below investment), commission
// capped 0–90, all fees non-negative.
export function mergeRevenueConfig(
  stored: Partial<CircleRevenueConfig> | null | undefined,
): CircleRevenueConfig {
  const s = stored && typeof stored === "object" ? stored : {};
  const num = (v: unknown, def: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };
  return {
    upliftPct: Math.max(100, Math.min(400, num(s.upliftPct, DEFAULT_CIRCLE_REVENUE.upliftPct))),
    commissionPct: Math.max(0, Math.min(90, num(s.commissionPct, DEFAULT_CIRCLE_REVENUE.commissionPct))),
    setupPerRoom: Math.max(0, num(s.setupPerRoom, DEFAULT_CIRCLE_REVENUE.setupPerRoom)),
    cityActivationFee: Math.max(0, num(s.cityActivationFee, DEFAULT_CIRCLE_REVENUE.cityActivationFee)),
    managementMonthly: Math.max(0, num(s.managementMonthly, DEFAULT_CIRCLE_REVENUE.managementMonthly)),
  };
}

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
  paybackYearsMin: number;
  paybackYearsMax: number;
  paybackLabel: string;          // "3–4 years"
  // Honest revenue disclosures (v294.13) — turnover + fees, NOT investor pocket.
  cityCount: number;
  revenueUpliftPct: number;      // config echo
  revenueCommissionPct: number;  // config echo
  grossBookingRevenue: number;   // ₹ / mo — properties' booking turnover (> investment)
  stayBidCommission: number;     // ₹ / mo — platform fee (commissionPct of gross)
  managementFee: number;         // ₹ / mo — channel manager × propertyCount
  setupOneTime: number;          // one-time — setupPerRoom × roomCount
  cityOneTime: number;           // one-time — cityActivationFee × cityCount
  oneTimeTotal: number;          // setupOneTime + cityOneTime
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
  revenueConfig?: CircleRevenueConfig | Partial<CircleRevenueConfig> | null,
): CircleBundle {
  const plan = CIRCLE_PLANS[planKey] || CIRCLE_PLANS.monthly;
  const rc = mergeRevenueConfig(revenueConfig as Partial<CircleRevenueConfig>);
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
    paybackYearsMin: 0,
    paybackYearsMax: 0,
    paybackLabel: "—",
    cityCount: 0,
    revenueUpliftPct: rc.upliftPct,
    revenueCommissionPct: rc.commissionPct,
    grossBookingRevenue: 0,
    stayBidCommission: 0,
    managementFee: 0,
    setupOneTime: 0,
    cityOneTime: 0,
    oneTimeTotal: 0,
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

  const paybackYearsMin = expectedRoiMax > 0 ? Math.round((100 / expectedRoiMax) * 10) / 10 : 0;
  const paybackYearsMax = expectedRoiMin > 0 ? Math.round((100 / expectedRoiMin) * 10) / 10 : 0;
  const paybackLabel =
    paybackYearsMin > 0
      ? `${Math.round(paybackYearsMin)}–${Math.round(paybackYearsMax)} years`
      : "—";

  // Honest revenue disclosures. Gross = property booking TURNOVER (always
  // ≥ investment via upliftPct ≥ 100). Commission + management are the
  // disclosed platform fee + channel-manager cost. Setup/city are one-time.
  const cityNames: string[] = [];
  items.forEach((it) => {
    const c = String(it.city || "").trim();
    if (c && !cityNames.includes(c)) cityNames.push(c);
  });
  const cityCount = Math.max(1, cityNames.length);
  const grossBookingRevenue = r0(monthlyTotal * (rc.upliftPct / 100));
  const stayBidCommission = r0(grossBookingRevenue * (rc.commissionPct / 100));
  const managementFee = r0(rc.managementMonthly * Math.max(1, propertyCount));
  const setupOneTime = r0(rc.setupPerRoom * roomCount);
  const cityOneTime = r0(rc.cityActivationFee * cityCount);
  const oneTimeTotal = setupOneTime + cityOneTime;

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
    paybackYearsMin,
    paybackYearsMax,
    paybackLabel,
    cityCount,
    revenueUpliftPct: rc.upliftPct,
    revenueCommissionPct: rc.commissionPct,
    grossBookingRevenue,
    stayBidCommission,
    managementFee,
    setupOneTime,
    cityOneTime,
    oneTimeTotal,
  };
}

export function fmtINR(n: number): string {
  return "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
}
