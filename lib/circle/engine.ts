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
  months: number;          // advance period covered by one payment (billing period)
  securityMonths: number;  // refundable security deposit, in months of investment
  discountPct: number;     // 0–1 fraction off the ADVANCE portion only
  commissionPct: number;   // 0–1 StayBid platform fee as a fraction of gross revenue (per plan)
  mgmtDiscountPct: number; // 0–1 discount on the management/channel-manager fee (per plan)
  hint: string;
}

// v297.2 payment rules (Sachin's spec — max-profit tuning):
//   Monthly     — 2mo security + 1mo advance · 0% off  · 12% platform fee · 0%  mgmt off
//   Quarterly   — 1mo security + 3mo advance · 7% off  · 10% platform fee · 10% mgmt off
//   Half-Yearly — 1mo security + 6mo advance · 13% off · 8%  platform fee · 18% mgmt off
//   Yearly      — 0.5mo security + 12mo advance · 20% off · 5% platform fee · 25% mgmt off
// Pay-now = security(monthly×securityMonths) + advance(monthly×months×(1−disc)).
// The discount applies to the advance portion only; security is a refundable
// deposit and is NEVER counted as investment. Longer plans get a lower platform
// fee AND a cheaper management fee, so the shown net profit rises with tenure.
export const CIRCLE_PLANS: Record<PaymentPlanKey, PaymentPlan> = {
  monthly:     { key: "monthly",     name: "Monthly",                months: 1,  securityMonths: 2,   discountPct: 0,    commissionPct: 0.12, mgmtDiscountPct: 0,    hint: "2mo security + 1mo advance · 12% fee" },
  quarterly:   { key: "quarterly",   name: "Quarterly (3 months)",   months: 3,  securityMonths: 1,   discountPct: 0.07, commissionPct: 0.10, mgmtDiscountPct: 0.10, hint: "1mo security + quarter advance · 7% off · 10% fee" },
  half_yearly: { key: "half_yearly", name: "Half-Yearly (6 months)", months: 6,  securityMonths: 1,   discountPct: 0.13, commissionPct: 0.08, mgmtDiscountPct: 0.18, hint: "1mo security + 6mo advance · 13% off · 8% fee" },
  yearly:      { key: "yearly",      name: "Yearly (12 months)",     months: 12, securityMonths: 0.5, discountPct: 0.20, commissionPct: 0.05, mgmtDiscountPct: 0.25, hint: "12mo advance · 20% off · 5% fee" },
};

export const PLAN_ORDER: PaymentPlanKey[] = ["monthly", "quarterly", "half_yearly", "yearly"];

// Monthly plan is restricted to a single property (Sachin's rule). Multi-
// property bundles must pick quarterly or larger. Enforced in computeBundle
// (monthlyPlanBlocked) + the checkout route.
export const MONTHLY_MAX_PROPERTIES = 1;

// Visit-Access Hold: reserve the property for a physical visit by paying this
// fraction of pay-now; the balance is due after the visit + signed agreement.
export const HOLD_FRACTION = 0.10;

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
  planMonths: number;            // advance months (billing period)
  securityMonths: number;        // refundable deposit, months of investment
  securityAmount: number;        // ₹ security deposit
  advanceAmount: number;         // ₹ advance (period × monthly − discount)
  effectiveMonthlyInvestment: number; // ₹ per-month investment AFTER the plan discount (CHANGES per plan)
  discountPct: number;           // 0–1 (on advance only)
  discountAmount: number;        // ₹ saved on the advance
  payNow: number;                // ₹ charged today (security + discounted advance)
  monthlyPlanBlocked: boolean;   // true when plan=monthly but >1 property
  // Plan-period revenue bifurcation — every figure scales with the selected
  // plan's advance period so "gross → −fees → net" auto-changes with the mode.
  periodMonths: number;          // = planMonths (advance period for revenue)
  grossPeriod: number;           // ₹ gross booking revenue over the period
  commissionPeriod: number;      // ₹ platform fee over the period
  managementPeriod: number;      // ₹ management/channel-manager over the period
  netPeriod: number;             // ₹ net income over the period
  diversificationBonusPct: number;
  expectedRoiMin: number;        // pct, incl. diversification bonus
  expectedRoiMax: number;
  expectedMonthlyIncome: number; // ₹ / month — your NET take-home (= netMonthlyIncome)
  netMonthlyIncome: number;      // ₹ / month — gross − platform fee − management − effective rent
  expectedAnnualIncome: number;
  paybackYearsMin: number;
  paybackYearsMax: number;
  paybackLabel: string;          // "3–4 years"
  // Honest revenue disclosures (v294.13) — turnover + fees, NOT investor pocket.
  cityCount: number;
  revenueUpliftPct: number;      // config echo
  revenueCommissionPct: number;  // effective platform-fee % this plan (per-plan slab, as pct)
  mgmtDiscountPct: number;       // 0–1 management-fee discount for this plan
  grossBookingRevenue: number;   // ₹ / mo — properties' booking turnover (> investment)
  stayBidCommission: number;     // ₹ / mo — platform fee (plan commissionPct of gross)
  managementFee: number;         // ₹ / mo — channel manager × propertyCount, plan-discounted
  // Per-plan SAVINGS vs the monthly baseline — how much a longer plan saves.
  commissionSaved: number;       // ₹ over the period — platform-fee saving vs monthly (12%) slab
  managementSaved: number;       // ₹ over the period — management saving vs no-discount baseline
  setupOneTime: number;          // one-time — setupPerRoom × roomCount (NOT in net basis)
  cityOneTime: number;           // one-time — cityActivationFee × cityCount (NOT in net basis)
  oneTimeTotal: number;          // setupOneTime + cityOneTime (separate upfront)
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
    securityMonths: plan.securityMonths,
    securityAmount: 0,
    advanceAmount: 0,
    effectiveMonthlyInvestment: 0,
    discountPct: plan.discountPct,
    discountAmount: 0,
    payNow: 0,
    monthlyPlanBlocked: false,
    periodMonths: plan.months,
    grossPeriod: 0,
    commissionPeriod: 0,
    managementPeriod: 0,
    netPeriod: 0,
    diversificationBonusPct: 0,
    expectedRoiMin: 0,
    expectedRoiMax: 0,
    expectedMonthlyIncome: 0,
    netMonthlyIncome: 0,
    expectedAnnualIncome: 0,
    paybackYearsMin: 0,
    paybackYearsMax: 0,
    paybackLabel: "—",
    cityCount: 0,
    revenueUpliftPct: rc.upliftPct,
    revenueCommissionPct: Math.round(plan.commissionPct * 100),
    mgmtDiscountPct: plan.mgmtDiscountPct,
    grossBookingRevenue: 0,
    stayBidCommission: 0,
    managementFee: 0,
    commissionSaved: 0,
    managementSaved: 0,
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

  // Property-yield spread (used only to widen the shown ROI band realistically).
  const wMin = items.reduce((s, it) => s + (Number(it.roiMin) || 0) * it.monthlyRate * it.rooms, 0) / monthlyTotal;
  const wMax = items.reduce((s, it) => s + (Number(it.roiMax) || 0) * it.monthlyRate * it.rooms, 0) / monthlyTotal;
  const bonus = diversificationBonus(propertyCount);

  // Pay-now = refundable security deposit + discounted advance.
  const discountAmount = r0(monthlyTotal * plan.months * plan.discountPct);
  const advanceAmount = r0(monthlyTotal * plan.months - discountAmount);
  const securityAmount = r0(monthlyTotal * plan.securityMonths);
  const payNow = advanceAmount + securityAmount;
  // v297.1 — monthly single-property restriction removed (Sachin): every plan
  // works for multi-property bundles now.
  const monthlyPlanBlocked = false;

  // v297.2 — EFFECTIVE monthly investment = the DISCOUNTED advance / months.
  // This is the number that CHANGES per plan (monthly ₹X → yearly ~0.80×X) and
  // is the true capital basis for the profit. Security is refundable → excluded.
  const effectiveMonthlyInvestment = plan.months > 0 ? r0(advanceAmount / plan.months) : monthlyTotal;

  // Booking revenue (turnover) — based on the FULL monthly rate (uplift ≥ 100%).
  const cityNames: string[] = [];
  items.forEach((it) => {
    const c = String(it.city || "").trim();
    if (c && !cityNames.includes(c)) cityNames.push(c);
  });
  const cityCount = Math.max(1, cityNames.length);
  const grossBookingRevenue = r0(monthlyTotal * (rc.upliftPct / 100));
  // StayBid platform fee — PER-PLAN slab (12/10/8/5%). Lower fee for longer
  // plans → higher net. (rc.commissionPct is ignored; the plan slab wins.)
  const stayBidCommission = r0(grossBookingRevenue * plan.commissionPct);
  // Management / channel-manager — PER-PLAN discount (0/10/18/25% off). Cheaper
  // for longer plans → higher net.
  const baseManagementMonthly = r0(rc.managementMonthly * Math.max(1, propertyCount));
  const managementFee = r0(baseManagementMonthly * (1 - plan.mgmtDiscountPct));
  // Per-plan SAVINGS (period-scaled, matching commissionPeriod / managementPeriod):
  //   Platform fee — vs the monthly baseline slab (12%).
  //   Management   — vs the no-discount base management.
  const baselineCommissionPct = CIRCLE_PLANS.monthly.commissionPct;
  const commissionSaved = r0(
    grossBookingRevenue * Math.max(0, baselineCommissionPct - plan.commissionPct) * plan.months,
  );
  const managementSaved = r0(baseManagementMonthly * plan.mgmtDiscountPct * plan.months);
  // One-time onboarding — SEPARATE upfront, NEVER added to investment nor
  // subtracted from net profit (Sachin's rule #6).
  const setupOneTime = r0(rc.setupPerRoom * roomCount);
  const cityOneTime = r0(rc.cityActivationFee * cityCount);
  const oneTimeTotal = setupOneTime + cityOneTime;

  // NET take-home = gross − platform fee − management − effective rent.
  // Security (refundable) + one-time (upfront) are NOT in this basis.
  const netMonthlyIncome = Math.max(
    0,
    r0(grossBookingRevenue - stayBidCommission - managementFee - effectiveMonthlyInvestment),
  );
  const expectedMonthlyIncome = netMonthlyIncome;
  const expectedAnnualIncome = r0(netMonthlyIncome * 12);

  // Net ROI on the capital actually deployed for the year (annualised).
  const annualInvestment = effectiveMonthlyInvestment * 12;
  const netRoiPct = annualInvestment > 0
    ? Math.round((expectedAnnualIncome / annualInvestment) * 1000) / 10
    : 0;
  // Realistic ± band around the net ROI (widened by property spread + bundle bonus).
  const bandSpread = Math.max(2, Math.round(((wMax - wMin) / 2) * 10) / 10);
  const expectedRoiMin = Math.max(0, Math.round((netRoiPct - bandSpread) * 10) / 10);
  const expectedRoiMax = Math.round((netRoiPct + bandSpread + bonus) * 10) / 10;

  const paybackYearsMin = expectedRoiMax > 0 ? Math.round((100 / expectedRoiMax) * 10) / 10 : 0;
  const paybackYearsMax = expectedRoiMin > 0 ? Math.round((100 / expectedRoiMin) * 10) / 10 : 0;
  const paybackLabel =
    paybackYearsMin > 0
      ? `${Math.round(paybackYearsMin)}–${Math.round(paybackYearsMax)} years`
      : "—";

  // Plan-period bifurcation — scales the /mo figures to the plan's advance
  // period so the whole "gross → −fees → net" panel auto-changes with the mode.
  const periodMonths = plan.months;
  const grossPeriod = r0(grossBookingRevenue * periodMonths);
  const commissionPeriod = r0(stayBidCommission * periodMonths);
  const managementPeriod = r0(managementFee * periodMonths);
  const netPeriod = r0(netMonthlyIncome * periodMonths);

  return {
    ok: true,
    items,
    propertyCount,
    roomCount,
    monthlyTotal,
    plan: plan.key,
    planMonths: plan.months,
    securityMonths: plan.securityMonths,
    securityAmount,
    advanceAmount,
    effectiveMonthlyInvestment,
    discountPct: plan.discountPct,
    discountAmount,
    payNow,
    monthlyPlanBlocked,
    periodMonths,
    grossPeriod,
    commissionPeriod,
    managementPeriod,
    netPeriod,
    diversificationBonusPct: bonus,
    expectedRoiMin,
    expectedRoiMax,
    expectedMonthlyIncome,
    netMonthlyIncome,
    expectedAnnualIncome,
    paybackYearsMin,
    paybackYearsMax,
    paybackLabel,
    cityCount,
    revenueUpliftPct: rc.upliftPct,
    revenueCommissionPct: Math.round(plan.commissionPct * 100),
    mgmtDiscountPct: plan.mgmtDiscountPct,
    grossBookingRevenue,
    stayBidCommission,
    managementFee,
    commissionSaved,
    managementSaved,
    setupOneTime,
    cityOneTime,
    oneTimeTotal,
  };
}

export function fmtINR(n: number): string {
  return "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
}
