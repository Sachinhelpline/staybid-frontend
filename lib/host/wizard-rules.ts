// ============================================================================
// StayBid for Hosts — Portfolio Configurator: rules engine (v278)
// ----------------------------------------------------------------------------
// Sachin's spec (verbatim intent): "pick a budget tier" is STEP 1 — it sets the
// budget + constraints, NOT a payment. Then the partner picks cities (within the
// tier's city limit), rooms (within the tier's room band), a design package, and
// optional add-on services. As they go, a BUNDLE builds up. At the END, with the
// partner's CONSENT, payment happens — in their chosen mode (monthly / quarterly /
// half-yearly / yearly). Each mode has its own SECURITY amount. Rental add-ons and
// EMI add-ons are bifurcated into the right buckets. All of it is rule-driven.
//
// THIS FILE IS THE SINGLE SOURCE OF TRUTH for every number. The server route
// (`/api/host/portfolio/checkout`) re-computes the bundle from the SAME function
// the client uses, so the Razorpay amount can NEVER be tampered client-side.
//
// ⚠️  EVERY ₹ FIGURE BELOW IS A SENSIBLE DEFAULT — Sachin should confirm/replace
//     the real business numbers. Changing a number here updates the wizard, the
//     summary, AND the server-validated charge in lockstep. Nothing else to edit.
// ============================================================================

export type HostTierKey = "explorer" | "adventurer" | "trailblazer" | "elite";
export type PaymentModeKey = "monthly" | "quarterly" | "half_yearly" | "yearly";
export type AddonBilling = "rental" | "emi" | "oneoff";

// ── Per-tier structured limits + pricing ────────────────────────────────────
// (Replaces the unstructured "1 managed room" / "up to 2 cities" strings in
//  lib/host/modules.ts with machine-usable numbers.)
export interface TierRule {
  key: HostTierKey;
  name: string;
  accent: string;
  minRooms: number;
  maxRooms: number;        // 0 = unlimited (Elite)
  maxCities: number;       // 0 = unlimited (Elite)
  setupPerRoom: number;    // ⚠️ one-time onboarding/setup per managed room
  mgmtPerRoomMonthly: number; // ⚠️ monthly management fee per room (recurring)
  commissionPct: number;   // platform fee on revenue (display only, not charged here)
}

export const HOST_UNLIMITED = 999; // sentinel for "unlimited" so UI/maths stay simple

// v284 — slab bands aligned to the 5-phase journey master spec:
// Explorer 1–3 rooms · 1–2 cities | Growth 3–8 · 2–5 | Premium 8–15 · 5–10 |
// Elite 15+ · 10+ (unlimited). Keys are STABLE ("adventurer"/"trailblazer"
// stay as keys — stored configs + admin overrides reference them); only the
// display NAMES changed to Growth / Premium.
export const TIER_RULES: Record<HostTierKey, TierRule> = {
  explorer: {
    key: "explorer", name: "Explorer", accent: "#0d9488",
    minRooms: 1, maxRooms: 3, maxCities: 2,
    setupPerRoom: 20000, mgmtPerRoomMonthly: 2000, commissionPct: 15,
  },
  adventurer: {
    key: "adventurer", name: "Growth", accent: "#2563eb",
    minRooms: 3, maxRooms: 8, maxCities: 5,
    setupPerRoom: 18000, mgmtPerRoomMonthly: 1900, commissionPct: 12,
  },
  trailblazer: {
    key: "trailblazer", name: "Premium", accent: "#7c3aed",
    minRooms: 8, maxRooms: 15, maxCities: 10,
    setupPerRoom: 16000, mgmtPerRoomMonthly: 1800, commissionPct: 9,
  },
  elite: {
    key: "elite", name: "Elite", accent: "#c9911a",
    minRooms: 15, maxRooms: HOST_UNLIMITED, maxCities: HOST_UNLIMITED,
    setupPerRoom: 14000, mgmtPerRoomMonthly: 1600, commissionPct: 5,
  },
};

// ⚠️ one-time per-city activation (sourcing, agreements, local ops setup).
export const CITY_ACTIVATION_FEE = 5000;

// ── Design packages (one-time, per room so it scales with the portfolio) ────
export interface DesignPackage {
  key: string;
  name: string;
  blurb: string;
  perRoom: number;   // ⚠️
  icon: string;
}
// v284 — 4 packages matching the Design & Setup master spec
// (Basic / Premium / Luxury / Signature). Keys stay stable for stored
// configs + admin overrides; `bespoke` is the new additive 4th package.
export const DESIGN_PACKAGES: DesignPackage[] = [
  { key: "essential", name: "Basic",     blurb: "Elegant & functional — guest-ready essentials",     perRoom: 0,     icon: "🛏️" },
  { key: "signature", name: "Premium",   blurb: "Stylish & comfortable — photographs + books well",  perRoom: 12000, icon: "🎨" },
  { key: "luxe",      name: "Luxury",    blurb: "High-end & sophisticated — top-rate interiors",     perRoom: 25000, icon: "💎" },
  { key: "bespoke",   name: "Signature", blurb: "Bespoke & ultra-luxury — custom branding included", perRoom: 50000, icon: "👑" },
];

// ── Optional add-on services (rental / EMI / one-off) ───────────────────────
export interface AddonService {
  key: string;
  name: string;
  desc: string;
  icon: string;
  billing: AddonBilling;
  // rental → monthly; emi → principal (split over tenureMonths); oneoff → amount.
  amount: number;            // ⚠️
  emiTenureMonths?: number;  // EMI add-ons only — default split
  emiDownPayment?: number;   // EMI add-ons only — optional down payment
}
export const ADDON_SERVICES: AddonService[] = [
  { key: "housekeeping_pro",  name: "Housekeeping Pro",     desc: "Dedicated daily cleaning + linen, beyond the shared pool", icon: "🧹", billing: "rental", amount: 3000 },
  { key: "channel_pro",       name: "Channel Manager Pro",  desc: "All-OTA sync + rate parity + auto flash deals",            icon: "🔗", billing: "rental", amount: 1500 },
  { key: "concierge",         name: "Guest Concierge",      desc: "24×7 guest hotline + experiences upsell",                  icon: "🛎️", billing: "rental", amount: 2500 },
  { key: "furniture_premium", name: "Premium Furniture Kit",desc: "Designer furniture + appliances, paid over EMI",           icon: "🛋️", billing: "emi",    amount: 60000, emiTenureMonths: 6,  emiDownPayment: 0 },
  { key: "appliance_kit",     name: "Smart Appliance Kit",  desc: "TV, AC, smart locks, mini-bar — over EMI",                 icon: "🔌", billing: "emi",    amount: 36000, emiTenureMonths: 6,  emiDownPayment: 0 },
  { key: "reels_marketing",   name: "Reels & Marketing",    desc: "Pro reels shoot + 100K+ traveller reach",                  icon: "📣", billing: "oneoff", amount: 8000 },
  { key: "verification_boost",name: "Verification + Stay Score Boost", desc: "Verification video + Stay Score priority",      icon: "🎥", billing: "oneoff", amount: 2500 },
];

// ── Payment modes — period length, recurring discount, security deposit ──────
export interface PaymentModeRule {
  key: PaymentModeKey;
  name: string;
  periodMonths: number;
  recurringDiscount: number; // fraction off the management recurring for committing longer
  securityMonths: number;    // ⚠️ refundable security = securityMonths × monthly recurring
  blurb: string;
}
// v285 — Sachin's payment-plan rules (all admin-editable via /admin/host/pricing):
//   monthly     → 2mo security + 1mo advance (periodCharge = 1mo recurring), 0% off,
//                 covers a SINGLE property (enforced at checkout + wizard gate).
//   quarterly   → 1mo security + a quarter's advance (3mo recurring), 7% off. Next
//                 instalment falls due ~1 month before the quarter ends.
//   half-yearly → 12% off, low security (same pattern: prepay the period + deposit).
//   yearly      → 20% off, lowest security (biggest advance → smallest deposit).
// The "advance" IS periodCharge in computeBundle (monthlyRecurring × periodMonths ×
// (1 - discount)); security = securityMonths × monthlyRecurring — no new field needed.
export const PAYMENT_MODES: Record<PaymentModeKey, PaymentModeRule> = {
  monthly:     { key: "monthly",     name: "Monthly",      periodMonths: 1,  recurringDiscount: 0,    securityMonths: 2,   blurb: "2mo security + 1mo advance · single property" },
  quarterly:   { key: "quarterly",   name: "Quarterly",    periodMonths: 3,  recurringDiscount: 0.07, securityMonths: 1,   blurb: "7% off · 1mo security + quarterly advance" },
  half_yearly: { key: "half_yearly", name: "Half-yearly",  periodMonths: 6,  recurringDiscount: 0.12, securityMonths: 1,   blurb: "12% off · low security + half-yearly advance" },
  yearly:      { key: "yearly",      name: "Yearly",       periodMonths: 12, recurringDiscount: 0.20, securityMonths: 0.5, blurb: "Best value · 20% off · lowest security" },
};

// v285 — the monthly plan covers ONE property only. Wizard gate + checkout both
// reject monthly when rooms > this. Keep as a named constant so the rule is
// discoverable + tunable in one place.
export const MONTHLY_MAX_ROOMS = 1;

// ── Editable config bundle ──────────────────────────────────────────────────
// v280: every number above is now ADMIN-EDITABLE. The constants stay as the
// hard-coded DEFAULT (fallback if the DB row is missing/partial). The admin
// panel edits a `host_wizard_config` row; `mergeWizardConfig()` overlays those
// overrides on top of the defaults BY KEY (the set of tiers / designs / addons /
// modes is fixed — only their numbers change). Both the client wizard and the
// server `/checkout` compute from the SAME resolved config, so the charge can
// never drift from what the partner saw.
export interface WizardConfig {
  tiers: Record<HostTierKey, TierRule>;
  cityActivationFee: number;
  designPackages: DesignPackage[];
  addons: AddonService[];
  paymentModes: Record<PaymentModeKey, PaymentModeRule>;
}

export const DEFAULT_WIZARD_CONFIG: WizardConfig = {
  tiers: TIER_RULES,
  cityActivationFee: CITY_ACTIVATION_FEE,
  designPackages: DESIGN_PACKAGES,
  addons: ADDON_SERVICES,
  paymentModes: PAYMENT_MODES,
};

const num = (v: any, fallback: number): number =>
  (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) ? fallback : Number(v);
const nonNeg = (v: any, fallback: number): number => Math.max(0, num(v, fallback));
const clampFrac = (v: any, fallback: number): number => Math.min(0.9, Math.max(0, num(v, fallback)));

// Deep-merge a (possibly partial) stored config over the defaults, BY KEY.
// Only numeric fields are pulled from the stored blob; keys/names/icons stay
// from defaults so a bad payload can never add/rename/remove items. Every
// number is range-clamped so a fat-finger in the admin panel can't produce a
// negative or absurd charge.
export function mergeWizardConfig(stored: any): WizardConfig {
  const s = stored && typeof stored === "object" ? stored : {};

  const tiers = {} as Record<HostTierKey, TierRule>;
  (Object.keys(TIER_RULES) as HostTierKey[]).forEach((k) => {
    const d = TIER_RULES[k];
    const o = (s.tiers && typeof s.tiers === "object" && s.tiers[k]) || {};
    tiers[k] = {
      ...d,
      minRooms: Math.max(1, Math.round(num(o.minRooms, d.minRooms))),
      maxRooms: Math.max(1, Math.round(num(o.maxRooms, d.maxRooms))),
      maxCities: Math.max(1, Math.round(num(o.maxCities, d.maxCities))),
      setupPerRoom: nonNeg(o.setupPerRoom, d.setupPerRoom),
      mgmtPerRoomMonthly: nonNeg(o.mgmtPerRoomMonthly, d.mgmtPerRoomMonthly),
      commissionPct: Math.min(100, nonNeg(o.commissionPct, d.commissionPct)),
    };
  });

  const dpByKey = new Map<string, any>(
    Array.isArray(s.designPackages) ? s.designPackages.filter((x: any) => x && x.key).map((x: any) => [x.key, x]) : [],
  );
  const designPackages: DesignPackage[] = DESIGN_PACKAGES.map((d) => ({
    ...d,
    perRoom: nonNeg(dpByKey.get(d.key)?.perRoom, d.perRoom),
  }));

  const adByKey = new Map<string, any>(
    Array.isArray(s.addons) ? s.addons.filter((x: any) => x && x.key).map((x: any) => [x.key, x]) : [],
  );
  const addons: AddonService[] = ADDON_SERVICES.map((a) => {
    const o = adByKey.get(a.key) || {};
    const out: AddonService = { ...a, amount: nonNeg(o.amount, a.amount) };
    if (a.billing === "emi") {
      out.emiTenureMonths = Math.max(1, Math.round(num(o.emiTenureMonths, a.emiTenureMonths || 6)));
      out.emiDownPayment = nonNeg(o.emiDownPayment, a.emiDownPayment || 0);
    }
    return out;
  });

  const paymentModes = {} as Record<PaymentModeKey, PaymentModeRule>;
  (Object.keys(PAYMENT_MODES) as PaymentModeKey[]).forEach((k) => {
    const d = PAYMENT_MODES[k];
    const o = (s.paymentModes && typeof s.paymentModes === "object" && s.paymentModes[k]) || {};
    paymentModes[k] = {
      ...d,
      periodMonths: Math.max(1, Math.round(num(o.periodMonths, d.periodMonths))),
      recurringDiscount: clampFrac(o.recurringDiscount, d.recurringDiscount),
      securityMonths: nonNeg(o.securityMonths, d.securityMonths),
    };
  });

  return { tiers, cityActivationFee: nonNeg(s.cityActivationFee, CITY_ACTIVATION_FEE), designPackages, addons, paymentModes };
}

// ── Config shape (what the wizard collects) ─────────────────────────────────
export interface PortfolioConfig {
  tier: HostTierKey;
  cities: string[];
  rooms: number;
  design: string;            // DesignPackage.key
  addons: string[];          // AddonService.key[]
  paymentMode: PaymentModeKey;
}

export interface EmiPlan {
  key: string;
  name: string;
  principal: number;
  tenureMonths: number;
  downPayment: number;
  monthlyInstallment: number;  // round(principal / tenure)
  dueNow: number;              // downPayment + first installment
  remainingMonths: number;     // tenure - 1
}

export interface BundleBreakdown {
  ok: boolean;
  error?: string;
  tier: TierRule;
  mode: PaymentModeRule;
  rooms: number;
  cities: number;
  // one-time
  setup: number;             // rooms × setupPerRoom
  cityActivation: number;    // cities × CITY_ACTIVATION_FEE
  designOneOff: number;      // rooms × design.perRoom
  oneoffAddons: number;      // sum of one-off add-ons
  oneTimeTotal: number;      // setup + cityActivation + designOneOff + oneoffAddons
  // recurring (management + rental add-ons)
  mgmtMonthly: number;       // rooms × mgmtPerRoomMonthly
  rentalMonthly: number;     // sum of rental add-ons / month
  monthlyRecurring: number;  // mgmtMonthly + rentalMonthly (pre-discount)
  periodCharge: number;      // monthlyRecurring × periodMonths × (1 - discount) — billed upfront this period
  recurringSavings: number;  // discount savings vs paying monthly
  // EMI
  emiPlans: EmiPlan[];
  emiDueNow: number;         // sum of emiPlans.dueNow
  // security
  security: number;          // refundable deposit (securityMonths × monthlyRecurring)
  // grand total to charge now + what recurs
  payNow: number;            // oneTimeTotal + periodCharge + emiDueNow + security
  recurringAfter: number;    // periodCharge (then every period)
  commissionPct: number;
  lines: { label: string; amount: number; note?: string; kind: "onetime" | "recurring" | "emi" | "security" }[];
}

export function round2(n: number): number { return Math.round(n); }

export function tierOf(key: string | undefined | null, wc: WizardConfig = DEFAULT_WIZARD_CONFIG): TierRule | null {
  if (!key) return null;
  const t = wc.tiers[key as HostTierKey];
  return t || null;
}

export function tierFromName(name: string | undefined | null, wc: WizardConfig = DEFAULT_WIZARD_CONFIG): TierRule | null {
  if (!name) return null;
  const k = String(name).trim().toLowerCase() as HostTierKey;
  return wc.tiers[k] || Object.values(wc.tiers).find(t => t.name.toLowerCase() === String(name).trim().toLowerCase()) || null;
}

export function maxCitiesLabel(t: TierRule): string {
  return t.maxCities >= HOST_UNLIMITED ? "Unlimited cities" : `Up to ${t.maxCities} ${t.maxCities === 1 ? "city" : "cities"}`;
}
export function roomsLabel(t: TierRule): string {
  if (t.maxRooms >= HOST_UNLIMITED) return `${t.minRooms}+ rooms`;
  return t.minRooms === t.maxRooms ? `${t.minRooms} room` : `${t.minRooms}–${t.maxRooms} rooms`;
}

// Clamp a config to its tier's structured limits (defensive — used by both
// client and server so out-of-band values can never slip into a charge).
export function clampConfig(cfg: PortfolioConfig, wc: WizardConfig = DEFAULT_WIZARD_CONFIG): PortfolioConfig {
  const t = wc.tiers[cfg.tier] || wc.tiers.explorer;
  const maxRooms = t.maxRooms >= HOST_UNLIMITED ? 50 : t.maxRooms;
  const maxCities = t.maxCities >= HOST_UNLIMITED ? 50 : t.maxCities;
  const rooms = Math.max(t.minRooms, Math.min(maxRooms, Math.round(Number(cfg.rooms) || t.minRooms)));
  const cities = Array.from(new Set((cfg.cities || []).map(c => String(c).trim()).filter(Boolean))).slice(0, maxCities);
  const design = wc.designPackages.some(d => d.key === cfg.design) ? cfg.design : "essential";
  const addons = Array.from(new Set((cfg.addons || []).filter(a => wc.addons.some(s => s.key === a))));
  const paymentMode = wc.paymentModes[cfg.paymentMode] ? cfg.paymentMode : "monthly";
  return { tier: t.key, rooms, cities, design, addons, paymentMode };
}

// ── THE compute function — single source of truth for every total ───────────
export function computeBundle(input: PortfolioConfig, wc: WizardConfig = DEFAULT_WIZARD_CONFIG): BundleBreakdown {
  const t = wc.tiers[input.tier];
  if (!t) {
    return errorBundle("Pick a valid budget tier.");
  }
  const cfg = clampConfig(input, wc);
  const mode = wc.paymentModes[cfg.paymentMode];
  const design = wc.designPackages.find(d => d.key === cfg.design) || wc.designPackages[0];

  // Validation
  if (cfg.cities.length < 1) return errorBundle("Pick at least one city.", t, mode);
  if (cfg.rooms < t.minRooms) return errorBundle(`This tier needs at least ${t.minRooms} room(s).`, t, mode);

  const rooms = cfg.rooms;
  const cities = cfg.cities.length;

  // One-time
  const setup = round2(rooms * t.setupPerRoom);
  const cityActivation = round2(cities * wc.cityActivationFee);
  const designOneOff = round2(rooms * design.perRoom);

  const selectedAddons = wc.addons.filter(s => cfg.addons.includes(s.key));
  const oneoffAddons = round2(selectedAddons.filter(s => s.billing === "oneoff").reduce((a, s) => a + s.amount, 0));
  const oneTimeTotal = setup + cityActivation + designOneOff + oneoffAddons;

  // Recurring (management + rentals)
  const mgmtMonthly = round2(rooms * t.mgmtPerRoomMonthly);
  const rentalMonthly = round2(selectedAddons.filter(s => s.billing === "rental").reduce((a, s) => a + s.amount, 0));
  const monthlyRecurring = mgmtMonthly + rentalMonthly;

  const undiscountedPeriod = monthlyRecurring * mode.periodMonths;
  const periodCharge = round2(undiscountedPeriod * (1 - mode.recurringDiscount));
  const recurringSavings = round2(undiscountedPeriod - periodCharge);

  // EMI add-ons → bifurcated schedule
  const emiPlans: EmiPlan[] = selectedAddons.filter(s => s.billing === "emi").map(s => {
    const tenure = Math.max(1, s.emiTenureMonths || 6);
    const down = Math.max(0, s.emiDownPayment || 0);
    const financed = Math.max(0, s.amount - down);
    const monthlyInstallment = round2(financed / tenure);
    return {
      key: s.key, name: s.name, principal: s.amount, tenureMonths: tenure,
      downPayment: down, monthlyInstallment,
      dueNow: round2(down + monthlyInstallment),  // first installment + down payment now
      remainingMonths: tenure - 1,
    };
  });
  const emiDueNow = round2(emiPlans.reduce((a, e) => a + e.dueNow, 0));

  // Security (refundable deposit, scaled by chosen mode's risk)
  const security = round2(monthlyRecurring * mode.securityMonths);

  const payNow = oneTimeTotal + periodCharge + emiDueNow + security;
  const recurringAfter = periodCharge;

  // Itemised lines for the summary UI
  const lines: BundleBreakdown["lines"] = [];
  lines.push({ label: `Setup · ${rooms} room${rooms > 1 ? "s" : ""}`, amount: setup, note: `₹${t.setupPerRoom.toLocaleString("en-IN")}/room`, kind: "onetime" });
  lines.push({ label: `City activation · ${cities}`, amount: cityActivation, note: `₹${wc.cityActivationFee.toLocaleString("en-IN")}/city`, kind: "onetime" });
  if (designOneOff > 0) lines.push({ label: `Design · ${design.name}`, amount: designOneOff, note: `₹${design.perRoom.toLocaleString("en-IN")}/room`, kind: "onetime" });
  selectedAddons.filter(s => s.billing === "oneoff").forEach(s => lines.push({ label: s.name, amount: s.amount, kind: "onetime" }));
  lines.push({ label: `Management (${mode.name})`, amount: periodCharge, note: mode.periodMonths > 1 ? `${mode.periodMonths} months${mode.recurringDiscount ? ` · ${Math.round(mode.recurringDiscount * 100)}% off` : ""}` : "per month", kind: "recurring" });
  emiPlans.forEach(e => lines.push({ label: `${e.name} — 1st EMI`, amount: e.dueNow, note: `₹${e.monthlyInstallment.toLocaleString("en-IN")}/mo × ${e.tenureMonths}`, kind: "emi" }));
  lines.push({ label: "Refundable security", amount: security, note: `${mode.securityMonths}× monthly`, kind: "security" });

  return {
    ok: true, tier: t, mode, rooms, cities,
    setup, cityActivation, designOneOff, oneoffAddons, oneTimeTotal,
    mgmtMonthly, rentalMonthly, monthlyRecurring, periodCharge, recurringSavings,
    emiPlans, emiDueNow, security, payNow, recurringAfter,
    commissionPct: t.commissionPct, lines,
  };
}

function errorBundle(error: string, t?: TierRule, mode?: PaymentModeRule): BundleBreakdown {
  return {
    ok: false, error,
    tier: t || TIER_RULES.explorer, mode: mode || PAYMENT_MODES.monthly,
    rooms: 0, cities: 0, setup: 0, cityActivation: 0, designOneOff: 0, oneoffAddons: 0, oneTimeTotal: 0,
    mgmtMonthly: 0, rentalMonthly: 0, monthlyRecurring: 0, periodCharge: 0, recurringSavings: 0,
    emiPlans: [], emiDueNow: 0, security: 0, payNow: 0, recurringAfter: 0,
    commissionPct: (t || TIER_RULES.explorer).commissionPct, lines: [],
  };
}

export function inr(n: number): string {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}
