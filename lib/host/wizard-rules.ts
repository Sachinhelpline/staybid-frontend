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

export const TIER_RULES: Record<HostTierKey, TierRule> = {
  explorer: {
    key: "explorer", name: "Explorer", accent: "#0d9488",
    minRooms: 1, maxRooms: 1, maxCities: 1,
    setupPerRoom: 20000, mgmtPerRoomMonthly: 2000, commissionPct: 15,
  },
  adventurer: {
    key: "adventurer", name: "Adventurer", accent: "#2563eb",
    minRooms: 2, maxRooms: 3, maxCities: 2,
    setupPerRoom: 18000, mgmtPerRoomMonthly: 1900, commissionPct: 12,
  },
  trailblazer: {
    key: "trailblazer", name: "Trailblazer", accent: "#7c3aed",
    minRooms: 4, maxRooms: 6, maxCities: 3,
    setupPerRoom: 16000, mgmtPerRoomMonthly: 1800, commissionPct: 9,
  },
  elite: {
    key: "elite", name: "Elite", accent: "#c9911a",
    minRooms: 7, maxRooms: HOST_UNLIMITED, maxCities: HOST_UNLIMITED,
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
export const DESIGN_PACKAGES: DesignPackage[] = [
  { key: "essential", name: "Essential",  blurb: "Clean, functional, guest-ready basics", perRoom: 0,     icon: "🛏️" },
  { key: "signature", name: "Signature",  blurb: "Styled interiors that photograph + book well", perRoom: 12000, icon: "🎨" },
  { key: "luxe",      name: "Luxe",       blurb: "Premium design + custom branding for top rates", perRoom: 25000, icon: "💎" },
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
export const PAYMENT_MODES: Record<PaymentModeKey, PaymentModeRule> = {
  monthly:     { key: "monthly",     name: "Monthly",      periodMonths: 1,  recurringDiscount: 0,    securityMonths: 2,   blurb: "Lowest commitment · highest security" },
  quarterly:   { key: "quarterly",   name: "Quarterly",    periodMonths: 3,  recurringDiscount: 0.03, securityMonths: 1.5, blurb: "3% off management · less security" },
  half_yearly: { key: "half_yearly", name: "Half-yearly",  periodMonths: 6,  recurringDiscount: 0.06, securityMonths: 1,   blurb: "6% off management · low security" },
  yearly:      { key: "yearly",      name: "Yearly",       periodMonths: 12, recurringDiscount: 0.12, securityMonths: 0.5, blurb: "Best value · 12% off · lowest security" },
};

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

export function tierOf(key: string | undefined | null): TierRule | null {
  if (!key) return null;
  const t = TIER_RULES[key as HostTierKey];
  return t || null;
}

export function tierFromName(name: string | undefined | null): TierRule | null {
  if (!name) return null;
  const k = String(name).trim().toLowerCase() as HostTierKey;
  return TIER_RULES[k] || Object.values(TIER_RULES).find(t => t.name.toLowerCase() === String(name).trim().toLowerCase()) || null;
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
export function clampConfig(cfg: PortfolioConfig): PortfolioConfig {
  const t = TIER_RULES[cfg.tier] || TIER_RULES.explorer;
  const maxRooms = t.maxRooms >= HOST_UNLIMITED ? 50 : t.maxRooms;
  const maxCities = t.maxCities >= HOST_UNLIMITED ? 50 : t.maxCities;
  const rooms = Math.max(t.minRooms, Math.min(maxRooms, Math.round(Number(cfg.rooms) || t.minRooms)));
  const cities = Array.from(new Set((cfg.cities || []).map(c => String(c).trim()).filter(Boolean))).slice(0, maxCities);
  const design = DESIGN_PACKAGES.some(d => d.key === cfg.design) ? cfg.design : "essential";
  const addons = Array.from(new Set((cfg.addons || []).filter(a => ADDON_SERVICES.some(s => s.key === a))));
  const paymentMode = PAYMENT_MODES[cfg.paymentMode] ? cfg.paymentMode : "monthly";
  return { tier: t.key, rooms, cities, design, addons, paymentMode };
}

// ── THE compute function — single source of truth for every total ───────────
export function computeBundle(input: PortfolioConfig): BundleBreakdown {
  const t = TIER_RULES[input.tier];
  if (!t) {
    return errorBundle("Pick a valid budget tier.");
  }
  const cfg = clampConfig(input);
  const mode = PAYMENT_MODES[cfg.paymentMode];
  const design = DESIGN_PACKAGES.find(d => d.key === cfg.design) || DESIGN_PACKAGES[0];

  // Validation
  if (cfg.cities.length < 1) return errorBundle("Pick at least one city.", t, mode);
  if (cfg.rooms < t.minRooms) return errorBundle(`This tier needs at least ${t.minRooms} room(s).`, t, mode);

  const rooms = cfg.rooms;
  const cities = cfg.cities.length;

  // One-time
  const setup = round2(rooms * t.setupPerRoom);
  const cityActivation = round2(cities * CITY_ACTIVATION_FEE);
  const designOneOff = round2(rooms * design.perRoom);

  const selectedAddons = ADDON_SERVICES.filter(s => cfg.addons.includes(s.key));
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
  lines.push({ label: `City activation · ${cities}`, amount: cityActivation, note: `₹${CITY_ACTIVATION_FEE.toLocaleString("en-IN")}/city`, kind: "onetime" });
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
