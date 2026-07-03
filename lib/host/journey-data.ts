// ============================================================================
// StayBid for Hosts — 5-Phase Investment Journey — shared dataset (v284)
// ----------------------------------------------------------------------------
// Single source of truth for every NON-PRICED fact the 5-phase journey shows:
//   Phase 1 — Choose Your Investment  (slabs intel, return engine, badges,
//             payment methods, rules & compliance, important notes)
//   Phase 2 — Choose Your City        (city intelligence: occupancy, ADR,
//             RevPAR, ROI, risk, footfall, seasonality, nearby distance)
//   Phase 3 — Choose Property Type    (15 categories, 6 sourcing options,
//             smart filters, scorecard dimensions)
//   Phase 4 — Choose Design & Setup   (8 themes, popular add-ons, process)
//   Phase 5 — Operations & Go Live    (operating modes, workforce, pricing
//             factors/strategies, go-live checklist, growth engine)
//
// ⚠️ PRICING NEVER LIVES HERE. Every rupee that gets charged flows through
// lib/host/wizard-rules.ts computeBundle (admin-editable via
// host_wizard_config). This file is intelligence/preference/display data.
// All figures are deterministic + indicative (marked in UI as such).
// ============================================================================

import type { HostTierKey } from "./wizard-rules";

// ── The 5 phases (journey spine — wizard stepper + landing) ─────────────────
export interface HostPhase {
  n: number;
  key: string;
  title: string;
  short: string;
  desc: string;
  icon: string;
  time: string;
}

export const HOST_PHASES: HostPhase[] = [
  { n: 1, key: "investment", title: "Choose Your Investment", short: "Investment", icon: "💰", time: "5 mins",
    desc: "Pick a budget slab & investment plan — returns, badges & rules upfront." },
  { n: 2, key: "city", title: "Choose Your City", short: "City", icon: "📍", time: "1 day",
    desc: "Location is the foundation of profitability — pick with live city intelligence." },
  { n: 3, key: "property", title: "Choose Property Type", short: "Property", icon: "🏡", time: "2–3 days",
    desc: "Categories, sourcing options & smart filters — the right asset for your goal." },
  { n: 4, key: "design", title: "Choose Design & Setup", short: "Design", icon: "🎨", time: "3–5 days",
    desc: "Design that delights. Setup that performs. 5★ reviews & higher ADR." },
  { n: 5, key: "operations", title: "Operations, Go Live & Growth", short: "Go Live", icon: "🚀", time: "1–2 days",
    desc: "Launch smoothly, operate efficiently, maximise bookings & long-term growth." },
];

// ── Phase 1 · per-tier investment intelligence (display metadata) ───────────
// Numbers that get CHARGED stay in wizard-rules; these are the slab-table
// facts from the master infographic (monthly budget band, access bands,
// expected return, ideal-for, risk & payback estimates).
export interface TierIntel {
  monthlyBudget: string;
  citiesAccess: string;
  roomsAccess: string;
  returnBand: string;        // expected return p.a. (indicative)
  idealFor: string;
  occupancyBand: string;
  riskScore: "Low" | "Low–Medium" | "Medium";
  payback: string;
}

export const TIER_INTEL: Record<HostTierKey, TierIntel> = {
  explorer: {
    monthlyBudget: "₹20,000 – ₹50,000",
    citiesAccess: "1 – 2 cities",
    roomsAccess: "1 – 3 rooms",
    returnBand: "18% – 24%",
    idealFor: "First-time investors",
    occupancyBand: "60–70%",
    riskScore: "Low",
    payback: "~4–5 years",
  },
  adventurer: {
    monthlyBudget: "₹50,000 – ₹1,00,000",
    citiesAccess: "2 – 5 cities",
    roomsAccess: "3 – 8 rooms",
    returnBand: "20% – 28%",
    idealFor: "Growth focused",
    occupancyBand: "65–75%",
    riskScore: "Low",
    payback: "~3.5–4.5 years",
  },
  trailblazer: {
    monthlyBudget: "₹1,00,000 – ₹2,00,000",
    citiesAccess: "5 – 10 cities",
    roomsAccess: "8 – 15 rooms",
    returnBand: "22% – 32%",
    idealFor: "Serious investors",
    occupancyBand: "70–78%",
    riskScore: "Low–Medium",
    payback: "~3–4 years",
  },
  elite: {
    monthlyBudget: "₹2,00,000+",
    citiesAccess: "10+ cities",
    roomsAccess: "15+ rooms",
    returnBand: "24% – 36%",
    idealFor: "High net worth",
    occupancyBand: "72–82%",
    riskScore: "Low–Medium",
    payback: "~2.5–3.5 years",
  },
};

// ── Phase 1 · Amount-first budget slider (v285 redesign) ────────────────────
// The slider is DISPLAY-ONLY UX sugar: dragging it auto-matches the priced
// tier key (cfg.tier stays the single priced source of truth). Bands mirror
// TIER_INTEL.monthlyBudget so the matched plan always agrees with the copy.
export const TIER_BUDGETS: Record<HostTierKey, { min: number; max: number; def: number }> = {
  explorer:    { min: 20_000,  max: 50_000,  def: 30_000 },
  adventurer:  { min: 50_000,  max: 100_000, def: 75_000 },
  trailblazer: { min: 100_000, max: 200_000, def: 150_000 },
  elite:       { min: 200_000, max: 300_000, def: 250_000 },
};
export const BUDGET_SLIDER = { min: 20_000, max: 300_000, step: 5_000 };

export function tierForAmount(amount: number): HostTierKey {
  if (amount >= 200_000) return "elite";
  if (amount >= 100_000) return "trailblazer";
  if (amount >= 50_000) return "adventurer";
  return "explorer";
}

// ── Phase 1 · Expected Return Engine (AI-powered projection profiles) ───────
export interface ReturnProfile {
  key: "conservative" | "balanced" | "aggressive" | "luxury";
  name: string;
  band: string;
  blurb: string;
  plain: string;         // v285 — one-line plain-language explainer
  riskDots: 1 | 2 | 3 | 4; // v285 — visual risk meter (1 = safest)
  tone: string;          // accent hex
  roiMin: number;        // for the projection chart
  roiMax: number;
}

export const RETURN_PROFILES: ReturnProfile[] = [
  { key: "conservative", name: "Conservative", band: "18% – 22%",  blurb: "Low risk, steady growth",    plain: "Safe & steady — slow but sure", riskDots: 1, tone: "#15803d", roiMin: 18, roiMax: 22 },
  { key: "balanced",     name: "Balanced",     band: "22% – 28%",  blurb: "Optimal risk & returns",     plain: "The sweet spot most investors pick", riskDots: 2, tone: "#2563eb", roiMin: 22, roiMax: 28 },
  { key: "aggressive",   name: "Aggressive",   band: "28% – 34%",  blurb: "High growth potential",      plain: "Chase growth — bigger swings, bigger upside", riskDots: 3, tone: "#b45309", roiMin: 28, roiMax: 34 },
  { key: "luxury",       name: "Luxury",       band: "32% – 36%+", blurb: "Premium locations",          plain: "Premium stays in premium locations", riskDots: 4, tone: "#7c3aed", roiMin: 32, roiMax: 36 },
];

// ── Phase 1 · Investment badge system (unlocks as the portfolio grows) ──────
export interface InvestBadge {
  key: string;
  name: string;
  icon: string;
  tone: string;
  unlockedAt: string;          // human criteria
  minPortfolios: number;       // deterministic unlock rule for /host/me
  benefits: string[];
}

export const INVEST_BADGES: InvestBadge[] = [
  { key: "bronze",   name: "Bronze",   icon: "🥉", tone: "#b45309", unlockedAt: "First active portfolio", minPortfolios: 1,
    benefits: ["Priority support", "Basic tools access"] },
  { key: "silver",   name: "Silver",   icon: "🥈", tone: "#64748b", unlockedAt: "2 active portfolios",    minPortfolios: 2,
    benefits: ["Better locations", "Higher referral %"] },
  { key: "gold",     name: "Gold",     icon: "🥇", tone: "#c9911a", unlockedAt: "3 active portfolios",    minPortfolios: 3,
    benefits: ["Early access deals", "Exclusive events"] },
  { key: "platinum", name: "Platinum", icon: "💠", tone: "#2563eb", unlockedAt: "5 active portfolios",    minPortfolios: 5,
    benefits: ["Higher commission", "Premium support"] },
  { key: "elite",    name: "Elite",    icon: "👑", tone: "#7c3aed", unlockedAt: "8+ active portfolios",   minPortfolios: 8,
    benefits: ["Dedicated RM", "VIP partner events"] },
];

export function badgeForPortfolios(count: number): InvestBadge | null {
  let out: InvestBadge | null = null;
  INVEST_BADGES.forEach((b) => { if (count >= b.minPortfolios) out = b; });
  return out;
}

// ── Phase 1 · Payment methods (display chips — actual charge = Razorpay) ────
export const PAYMENT_METHODS = [
  { icon: "🗓️", name: "Monthly" }, { icon: "📆", name: "Quarterly" },
  { icon: "🗂️", name: "Half yearly" }, { icon: "📅", name: "Annual" },
  { icon: "🔄", name: "Auto debit" }, { icon: "₹", name: "EMI" },
  { icon: "📲", name: "UPI" }, { icon: "👛", name: "Wallet" },
  { icon: "💳", name: "Credit card" }, { icon: "🏦", name: "Bank transfer" },
];

// ── Phase 1 · Rules & compliance (strict SOPs) ──────────────────────────────
export const COMPLIANCE_RULES = [
  { icon: "🔒", title: "Minimum lock-in",       sub: "3 / 6 / 12 months by plan" },
  { icon: "↩️", title: "Cancellation policy",   sub: "As per plan selected" },
  { icon: "🤝", title: "Revenue sharing",       sub: "Transparent model" },
  { icon: "💸", title: "Refund policy",         sub: "As per policy" },
  { icon: "🛡️", title: "SOP acceptance",        sub: "Mandatory" },
  { icon: "🪪", title: "KYC mandatory",         sub: "Verified investors only" },
  { icon: "🧾", title: "Tax declaration",       sub: "As per Indian law" },
  { icon: "📜", title: "Compliance agreement",  sub: "Legally binding" },
  { icon: "⚠️", title: "Risk disclosure",       sub: "Transparent" },
  { icon: "🛟", title: "Investor protection",   sub: "StayBid Secure" },
];

export const IMPORTANT_NOTES = [
  "All amounts are in INR (₹)",
  "Returns are not guaranteed — performance based",
  "Market conditions may affect occupancy & returns",
  "StayBid fee & revenue share applicable",
  "Invest responsibly — don't invest borrowed money",
  "Past performance is not an indicator of future returns",
];

// ── Phase 2 · City intelligence ─────────────────────────────────────────────
// Deterministic, indicative market data per city. RevPAR = ADR × occupancy.
// distanceKm = road distance from Delhi NCR (the "Nearby you" reference —
// labelled in UI). seasonality = 12 monthly demand indices (0–100, Jan→Dec).
export interface CityIntel {
  key: string;
  name: string;
  state: string;
  kind: "tourist" | "metro";
  occupancy: number;     // %
  adr: number;           // ₹ average daily rate
  roiMin: number;
  roiMax: number;
  risk: "Low" | "Medium";
  footfallLakh: number;  // annual tourist footfall in lakhs (indicative)
  distanceKm: number;    // fallback road distance from Delhi NCR (used when live location is unavailable)
  lat: number;           // v286 — city centroid for live-location distances
  lng: number;
  emoji: string;         // v286 — landmark glyph on the 3D city card
  scene: string;         // v286 — scenery gradient key (SCENES map in /host/build)
  demand: "High Demand" | "Medium Demand";
  bestFor: string;
  tags: string[];
  seasonality: number[]; // 12 values, Jan..Dec
}

const S = (arr: number[]) => arr; // readability helper

export const CITY_INTEL: CityIntel[] = [
  // ── Himalayan / nearby cluster (matches live StayBid inventory) ──
  { key: "mussoorie",  name: "Mussoorie",  state: "Uttarakhand", kind: "tourist", occupancy: 75, adr: 5200, roiMin: 24, roiMax: 32, risk: "Low",    footfallLakh: 30, distanceKm: 290, lat: 30.4599, lng: 78.0664, emoji: "🏔️", scene: "hills", demand: "High Demand",   bestFor: "Hill-station cottages & premium stays", tags: ["Hill Station", "Honeymoon", "Weekend"], seasonality: S([55,60,70,85,95,100,60,55,65,80,75,85]) },
  { key: "rishikesh",  name: "Rishikesh",  state: "Uttarakhand", kind: "tourist", occupancy: 73, adr: 4200, roiMin: 22, roiMax: 30, risk: "Low",    footfallLakh: 45, distanceKm: 240, lat: 30.0869, lng: 78.2676, emoji: "🛶", scene: "river", demand: "High Demand",   bestFor: "Riverside camps, yoga retreats & hostels", tags: ["Adventure", "Spiritual", "Backpacker"], seasonality: S([70,80,90,95,90,75,55,60,80,95,90,80]) },
  { key: "dehradun",   name: "Dehradun",   state: "Uttarakhand", kind: "tourist", occupancy: 72, adr: 4200, roiMin: 20, roiMax: 26, risk: "Low",    footfallLakh: 28, distanceKm: 250, lat: 30.3165, lng: 78.0322, emoji: "🌄", scene: "forest", demand: "High Demand",   bestFor: "Serviced apartments & transit stays", tags: ["Gateway City", "Business", "Family"], seasonality: S([60,65,75,85,90,95,65,60,70,80,75,80]) },
  { key: "dhanaulti",  name: "Dhanaulti",  state: "Uttarakhand", kind: "tourist", occupancy: 68, adr: 3800, roiMin: 22, roiMax: 30, risk: "Low",    footfallLakh: 8,  distanceKm: 320, lat: 30.4227, lng: 78.241, emoji: "🌲", scene: "forest", demand: "High Demand",   bestFor: "Eco resorts, camps & nature getaways", tags: ["Offbeat", "Nature", "Camping"], seasonality: S([65,60,70,85,95,100,55,50,60,75,80,90]) },
  { key: "haridwar",   name: "Haridwar",   state: "Uttarakhand", kind: "tourist", occupancy: 65, adr: 3200, roiMin: 18, roiMax: 24, risk: "Low",    footfallLakh: 70, distanceKm: 220, lat: 29.9457, lng: 78.1642, emoji: "🛕", scene: "spiritual", demand: "Medium Demand", bestFor: "Pilgrim stays & budget hotels", tags: ["Spiritual", "Budget", "Year-round"], seasonality: S([75,80,85,90,85,70,65,70,85,90,85,80]) },
  { key: "nainital",   name: "Nainital",   state: "Uttarakhand", kind: "tourist", occupancy: 70, adr: 4100, roiMin: 22, roiMax: 28, risk: "Low",    footfallLakh: 22, distanceKm: 300, lat: 29.3919, lng: 79.4542, emoji: "🚣", scene: "lake", demand: "High Demand",   bestFor: "Lake-view properties & family stays", tags: ["Lake", "Family", "Honeymoon"], seasonality: S([50,55,70,85,100,100,60,55,65,80,70,85]) },
  { key: "shimla",     name: "Shimla",     state: "Himachal Pradesh", kind: "tourist", occupancy: 72, adr: 4800, roiMin: 22, roiMax: 30, risk: "Low", footfallLakh: 35, distanceKm: 340, lat: 31.1048, lng: 77.1734, emoji: "🚞", scene: "hills", demand: "High Demand", bestFor: "Colonial-charm hotels & apartments", tags: ["Hill Station", "Heritage", "Snow"], seasonality: S([70,65,70,85,95,100,60,55,65,75,70,95]) },
  { key: "manali",     name: "Manali",     state: "Himachal Pradesh", kind: "tourist", occupancy: 78, adr: 6500, roiMin: 24, roiMax: 34, risk: "Low", footfallLakh: 18.5, distanceKm: 540, lat: 32.2396, lng: 77.1887, emoji: "🎿", scene: "snow", demand: "High Demand", bestFor: "Premium cottages, villas & luxury camps", tags: ["Snow", "Adventure", "Honeymoon"], seasonality: S([75,70,75,85,100,100,55,50,60,75,70,95]) },
  { key: "dharamshala", name: "Dharamshala", state: "Himachal Pradesh", kind: "tourist", occupancy: 70, adr: 4900, roiMin: 22, roiMax: 30, risk: "Low", footfallLakh: 12, distanceKm: 480, lat: 32.219, lng: 76.3234, emoji: "🧘", scene: "hills", demand: "High Demand", bestFor: "Boutique stays & workation homes", tags: ["Workation", "Spiritual", "Nature"], seasonality: S([60,65,80,90,95,85,55,55,70,85,80,75]) },
  { key: "kasauli",    name: "Kasauli",    state: "Himachal Pradesh", kind: "tourist", occupancy: 60, adr: 4100, roiMin: 18, roiMax: 26, risk: "Low",  footfallLakh: 6, distanceKm: 290, lat: 30.8977, lng: 76.9645, emoji: "🌿", scene: "forest", demand: "Medium Demand", bestFor: "Quiet weekend cottages", tags: ["Offbeat", "Weekend", "Quiet"], seasonality: S([55,60,70,85,95,90,60,55,65,80,75,80]) },
  // ── Marquee tourist destinations ──
  { key: "goa",        name: "Goa",        state: "Goa",       kind: "tourist", occupancy: 72, adr: 5800, roiMin: 25, roiMax: 34, risk: "Low",    footfallLakh: 80, distanceKm: 1900, lat: 15.4909, lng: 73.8278, emoji: "🏖️", scene: "beach", demand: "High Demand",   bestFor: "Beach villas, apartments & boutique stays", tags: ["Beach", "Party", "International"], seasonality: S([100,90,70,55,45,40,45,50,60,80,95,100]) },
  { key: "jaipur",     name: "Jaipur",     state: "Rajasthan", kind: "tourist", occupancy: 71, adr: 4600, roiMin: 22, roiMax: 30, risk: "Low",    footfallLakh: 55, distanceKm: 270, lat: 26.9124, lng: 75.7873, emoji: "🏰", scene: "heritage", demand: "High Demand",   bestFor: "Heritage homes, apartments & homestays", tags: ["Heritage", "Wedding", "Culture"], seasonality: S([95,90,75,55,45,40,50,60,75,90,100,100]) },
  { key: "udaipur",    name: "Udaipur",    state: "Rajasthan", kind: "tourist", occupancy: 69, adr: 5100, roiMin: 22, roiMax: 30, risk: "Medium", footfallLakh: 30, distanceKm: 660, lat: 24.5854, lng: 73.7125, emoji: "🏯", scene: "lake", demand: "High Demand",   bestFor: "Lake-facing boutique & wedding stays", tags: ["Lake", "Wedding", "Luxury"], seasonality: S([95,90,70,55,45,40,50,60,75,90,100,100]) },
  { key: "pondicherry", name: "Pondicherry", state: "Puducherry", kind: "tourist", occupancy: 67, adr: 4300, roiMin: 20, roiMax: 28, risk: "Low", footfallLakh: 15, distanceKm: 2400, lat: 11.9416, lng: 79.8083, emoji: "🏝️", scene: "coast", demand: "Medium Demand", bestFor: "French-quarter villas & cafés-adjacent stays", tags: ["Beach", "Heritage", "Café Culture"], seasonality: S([90,85,70,60,50,45,55,65,70,80,90,100]) },
  { key: "coorg",      name: "Coorg",      state: "Karnataka", kind: "tourist", occupancy: 66, adr: 4700, roiMin: 20, roiMax: 30, risk: "Low",    footfallLakh: 10, distanceKm: 2300, lat: 12.4208, lng: 75.7397, emoji: "☕", scene: "plantation", demand: "Medium Demand", bestFor: "Plantation farm stays & nature resorts", tags: ["Plantation", "Nature", "Monsoon"], seasonality: S([85,80,75,70,60,55,65,70,75,85,90,95]) },
  // ── Metro cities (business + bleisure demand) ──
  { key: "delhi",      name: "Delhi NCR",  state: "Delhi",       kind: "metro", occupancy: 74, adr: 4800, roiMin: 20, roiMax: 26, risk: "Low",    footfallLakh: 120, distanceKm: 0, lat: 28.6139, lng: 77.209, emoji: "🏛️", scene: "metro",   demand: "High Demand",   bestFor: "Serviced apartments & corporate stays", tags: ["Business", "Transit", "Events"], seasonality: S([80,85,80,70,60,55,60,65,75,90,95,90]) },
  { key: "mumbai",     name: "Mumbai",     state: "Maharashtra", kind: "metro", occupancy: 77, adr: 6200, roiMin: 20, roiMax: 28, risk: "Low",    footfallLakh: 150, distanceKm: 1400, lat: 19.076, lng: 72.8777, emoji: "🌇", scene: "metro", demand: "High Demand",  bestFor: "Studio & premium apartments", tags: ["Business", "High ADR", "Year-round"], seasonality: S([85,85,80,75,65,55,60,65,75,85,95,95]) },
  { key: "bangalore",  name: "Bangalore",  state: "Karnataka",   kind: "metro", occupancy: 75, adr: 5400, roiMin: 20, roiMax: 26, risk: "Low",    footfallLakh: 95,  distanceKm: 2100, lat: 12.9716, lng: 77.5946, emoji: "🌆", scene: "metro", demand: "High Demand",  bestFor: "Co-living & workation apartments", tags: ["Tech", "Workation", "Year-round"], seasonality: S([85,85,85,80,75,70,70,75,80,85,90,90]) },
  { key: "hyderabad",  name: "Hyderabad",  state: "Telangana",   kind: "metro", occupancy: 72, adr: 4600, roiMin: 18, roiMax: 25, risk: "Low",    footfallLakh: 70,  distanceKm: 1550, lat: 17.385, lng: 78.4867, emoji: "🕌", scene: "metro", demand: "Medium Demand", bestFor: "Business apartments & events stays", tags: ["Business", "Events", "Value"], seasonality: S([85,85,80,75,65,60,65,70,80,85,90,90]) },
  { key: "pune",       name: "Pune",       state: "Maharashtra", kind: "metro", occupancy: 70, adr: 4200, roiMin: 18, roiMax: 24, risk: "Low",    footfallLakh: 60,  distanceKm: 1450, lat: 18.5204, lng: 73.8567, emoji: "🏙️", scene: "metro", demand: "Medium Demand", bestFor: "Student + IT corridor stays", tags: ["Education", "IT", "Weekend Gateway"], seasonality: S([80,80,80,75,70,60,65,70,80,85,90,85]) },
  { key: "chennai",    name: "Chennai",    state: "Tamil Nadu",  kind: "metro", occupancy: 69, adr: 4300, roiMin: 18, roiMax: 24, risk: "Low",    footfallLakh: 75,  distanceKm: 2200, lat: 13.0827, lng: 80.2707, emoji: "🌊", scene: "coast", demand: "Medium Demand", bestFor: "Medical + business travel stays", tags: ["Medical", "Business", "Coastal"], seasonality: S([90,85,75,65,55,50,60,65,70,80,90,100]) },
];

export const revpar = (c: CityIntel) => Math.round((c.adr * c.occupancy) / 100);

export const KEY_CITY_FACTORS = [
  { icon: "🎡", title: "Tourist attractions & activities" },
  { icon: "🚉", title: "Connectivity (flights, trains, roads)" },
  { icon: "🏗️", title: "Infrastructure development" },
  { icon: "🏨", title: "Hotel supply & competition" },
  { icon: "📜", title: "Local regulations & policies" },
  { icon: "🛡️", title: "Safety & security index" },
  { icon: "🌦️", title: "Weather & seasonality" },
  { icon: "📈", title: "Future growth potential" },
];

export const WHY_LOCATION_MATTERS = [
  "70% of returns depend on location",
  "High tourist footfall = high bookings",
  "Right city = year-round occupancy",
  "Better ADR (average daily rate)",
  "Future infrastructure growth",
  "Low vacancy & high appreciation",
  "Strong rental & resale value",
];

export const DISTANCE_BANDS = [
  { label: "Within 100 km", km: 100 },
  { label: "Within 300 km", km: 300 },
  { label: "Within 600 km", km: 600 },
  { label: "Anywhere in India", km: 99999 },
];

// ── v286 · Live-location helpers (Option A "Nearby you") ────────────────────
// Great-circle distance between the user's device and a city centroid.
// UI multiplies by a 1.25 road factor and labels it "approx road distance".
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Rough drive-time estimate at ~55 km/h average Indian highway pace.
export function driveHours(km: number): number {
  return Math.max(1, Math.round(km / 55));
}

// ── v286 · Smart-recommendation intelligence (Option B upgrade) ─────────────
// Deterministic match % per ranked pick — rank bonus + demand bonus, capped.
export function recoMatchPct(rank: number, c: CityIntel): number {
  const base = 78 + (rank === 0 ? 14 : rank === 1 ? 9 : rank === 2 ? 5 : 2);
  return Math.min(97, base + (c.demand === "High Demand" ? 2 : 0));
}

// Plain-language "Why this city" line, tuned to the investor's return profile.
export function recoReason(profile: ReturnProfile["key"], c: CityIntel): string {
  const inrAdr = `₹${c.adr.toLocaleString("en-IN")}`;
  if (profile === "luxury") return `Premium ${inrAdr} ADR with ${c.roiMin}–${c.roiMax}% ROI — fits your luxury play`;
  if (profile === "aggressive") return `Highest ROI ${c.roiMin}–${c.roiMax}% for your growth appetite`;
  if (profile === "conservative") return `Steady ${c.occupancy}% occupancy · ${c.risk.toLowerCase()} risk · dependable demand`;
  return `Strong ${c.occupancy}% occupancy + ${c.roiMin}–${c.roiMax}% ROI — balanced sweet spot`;
}

// Deterministic "smart recommendation" — highest ROI within tier risk appetite.
export function recommendCities(profile: ReturnProfile["key"], picked: string[], max = 3): CityIntel[] {
  const wantLuxury = profile === "luxury";
  const wantAggressive = profile === "aggressive" || wantLuxury;
  return CITY_INTEL
    .filter((c) => !picked.includes(c.name))
    .filter((c) => (wantLuxury ? c.adr >= 4800 : true))
    .sort((a, b) => (wantAggressive ? b.roiMax - a.roiMax : b.occupancy - a.occupancy))
    .slice(0, max);
}

// ── Phase 3 · Property type categories (15) ─────────────────────────────────
export interface PropertyCategory {
  key: string;
  name: string;
  sub: string;
  icon: string;
}

export const PROPERTY_CATEGORIES: PropertyCategory[] = [
  { key: "studio",        name: "Studio Apartment",   sub: "Compact & smart · high yield",       icon: "🛏️" },
  { key: "premium_apt",   name: "Premium Apartment",  sub: "Modern comfort · urban stays",       icon: "🏢" },
  { key: "villa",         name: "Villa",              sub: "Luxury & privacy · high returns",    icon: "🏡" },
  { key: "cottage",       name: "Cottage",            sub: "Nature getaway · peaceful retreat",  icon: "🏕️" },
  { key: "farm_stay",     name: "Farm Stay",          sub: "Rural experience · unique stays",    icon: "🌾" },
  { key: "luxury_tent",   name: "Luxury Tent",        sub: "Unique & premium · high demand",     icon: "⛺" },
  { key: "homestay",      name: "Homestay",           sub: "Local experience · budget friendly", icon: "🏠" },
  { key: "hotel_room",    name: "Hotel Room",         sub: "Business & leisure · high turnover", icon: "🛎️" },
  { key: "serviced_apt",  name: "Serviced Apartment", sub: "Long-stay friendly · high occupancy", icon: "🏬" },
  { key: "boutique",      name: "Boutique Resort",    sub: "Premium hospitality · high ADR",     icon: "🌺" },
  { key: "hostel",        name: "Hostel",             sub: "Budget travellers · high volume",    icon: "🎒" },
  { key: "glamping",      name: "Glamping",           sub: "Luxury + nature · premium niche",    icon: "🌌" },
  { key: "beach_house",   name: "Beach House",        sub: "Beachfront living · high demand",    icon: "🏖️" },
  { key: "lake_view",     name: "Lake View Property", sub: "Scenic & serene · high returns",     icon: "🌊" },
  { key: "heritage",      name: "Heritage Property",  sub: "Royal experience · premium niche",   icon: "🏰" },
];

// ── Phase 3 · Property sourcing options (6) ─────────────────────────────────
export interface SourcingOption {
  key: string;
  name: string;
  desc: string;
  bestFor: string;
  icon: string;
}

export const SOURCING_OPTIONS: SourcingOption[] = [
  { key: "lease",      name: "Lease Property",      desc: "Take property on lease & operate",      bestFor: "New investors · low capital", icon: "📈" },
  { key: "revshare",   name: "Revenue Sharing",     desc: "Share revenue with the property owner", bestFor: "Low-risk partnership",        icon: "🤝" },
  { key: "management", name: "Management Contract", desc: "Manage an owner's property & earn",     bestFor: "Experienced operators",       icon: "🗂️" },
  { key: "buy",        name: "Buy Property",        desc: "Full ownership & high appreciation",    bestFor: "Long-term investment",        icon: "🏦" },
  { key: "coinvest",   name: "Co-Invest Property",  desc: "Partner & invest together",             bestFor: "High-value properties",       icon: "👥" },
  { key: "franchise",  name: "Franchise Property",  desc: "Operate branded StayBid units",         bestFor: "Brand power & support",       icon: "🏷️" },
];

export const SOURCING_ASSISTANCE = [
  "Verified owners", "Legal verification", "Best-deal negotiation",
  "Documentation support", "Market price analysis", "End-to-end assistance",
];

// ── Phase 3 · Smart property filters (preference chips) ─────────────────────
export const SMART_FILTERS: { group: string; options: string[] }[] = [
  { group: "Location type",   options: ["City Center", "Near Airport", "Beachfront", "Hill Station", "Rural / Countryside"] },
  { group: "View",            options: ["Mountain View", "Sea View", "Lake View", "City View", "Garden View"] },
  { group: "Amenities",       options: ["WiFi", "Parking", "Kitchen", "Pool", "Air Conditioning"] },
  { group: "Features",        options: ["Pet Friendly", "Workation Friendly", "Family Friendly", "Events Allowed", "Party Friendly"] },
  { group: "Property age",    options: ["New Construction", "0–5 Years", "5–10 Years", "10–20 Years", "20+ Years"] },
  { group: "Ownership",       options: ["Individual", "Company", "Trust", "NRI Owner", "Builder"] },
  { group: "Documentation",   options: ["Clear Title", "RERA Approved", "No Litigation", "All Approvals", "Verified Docs"] },
];

export const POPULAR_COMBINATIONS = [
  "🏔 Hill View + 1–5 rooms + ₹25K–₹50K",
  "🏖 Beachfront + 3–8 rooms + ₹50K+",
  "🏙 City Center + Studio + high yield",
  "🏡 Villa + Pool + 5–10 rooms + premium",
  "🌾 Farm Stay + 3–6 rooms + budget friendly",
];

// AI property scorecard dimensions (deterministic showcase).
export const SCORECARD_DIMENSIONS = [
  { label: "Location advantage", of: 20 },
  { label: "Market demand",      of: 20 },
  { label: "Revenue potential",  of: 20 },
  { label: "Property condition", of: 20 },
  { label: "Legal compliance",   of: 10 },
  { label: "Operational ease",   of: 10 },
];

// ── Phase 4 · Design themes (8) ─────────────────────────────────────────────
export interface DesignTheme {
  key: string;
  name: string;
  blurb: string;
  icon: string;
  tone: string;
}

export const DESIGN_THEMES: DesignTheme[] = [
  { key: "eco",       name: "Eco",            blurb: "Natural · sustainable · refreshing",   icon: "🌿", tone: "#15803d" },
  { key: "local",     name: "Local",          blurb: "Celebrate local culture & heritage",   icon: "🪔", tone: "#b45309" },
  { key: "luxury",    name: "Luxury",         blurb: "Premium · elegant · high end",         icon: "💎", tone: "#c9911a" },
  { key: "cozy",      name: "Cozy",           blurb: "Warm · comfortable · homely",          icon: "🕯️", tone: "#9a3412" },
  { key: "modern",    name: "Modern",         blurb: "Minimal · sleek · contemporary",       icon: "◻️", tone: "#334155" },
  { key: "insta",     name: "Instagrammable", blurb: "Trendy · aesthetic · photo-perfect",   icon: "📸", tone: "#db2777" },
  { key: "family",    name: "Family",         blurb: "Safe · spacious · kid-friendly",       icon: "👨‍👩‍👧", tone: "#2563eb" },
  { key: "corporate", name: "Corporate",      blurb: "Smart · professional · work-friendly", icon: "💼", tone: "#0f766e" },
];

// ── Phase 4 · Popular add-ons (experience upgrades — ops wishlist) ──────────
export interface PopularAddon {
  key: string;
  name: string;
  from: string;   // "₹X+ onwards" display
  icon: string;
}

export const POPULAR_ADDONS: PopularAddon[] = [
  { key: "pool",       name: "Private Pool",           from: "₹1,50,000+", icon: "🏊" },
  { key: "jacuzzi",    name: "Jacuzzi",                from: "₹80,000+",   icon: "🛁" },
  { key: "fireplace",  name: "Fireplace",              from: "₹75,000+",   icon: "🔥" },
  { key: "theatre",    name: "Home Theatre",           from: "₹1,25,000+", icon: "🎬" },
  { key: "workstation", name: "Workstation Setup",     from: "₹25,000+",   icon: "🖥️" },
  { key: "balcony",    name: "Balcony Garden",         from: "₹20,000+",   icon: "🌱" },
  { key: "smarthome",  name: "Smart Home Automation",  from: "₹60,000+",   icon: "🏠" },
  { key: "kidsplay",   name: "Kids Play Area",         from: "₹30,000+",   icon: "🛝" },
];

export const ADDON_BENEFITS = ["Higher ADR", "More bookings", "Better guest experience", "Stand out from competitors"];

// ── Phase 4 · Design & setup process (8 steps) ──────────────────────────────
export const DESIGN_PROCESS = [
  { n: 1, title: "Requirement discussion" },
  { n: 2, title: "Space analysis & planning" },
  { n: 3, title: "Design concept & 3D renders" },
  { n: 4, title: "Approval & customization" },
  { n: 5, title: "Procurement & logistics" },
  { n: 6, title: "Installation & setup" },
  { n: 7, title: "Quality check & handover" },
  { n: 8, title: "Go live & support" },
];

export const WHY_DESIGN_MATTERS = [
  "First impressions drive bookings",
  "Beautiful spaces = higher ADR",
  "Better amenities = happy guests",
  "5★ reviews = repeat bookings",
  "Well designed = less maintenance",
  "Stand out from competition",
];

// ── Phase 5 · Operating modes ───────────────────────────────────────────────
export interface OperatingMode {
  key: "fully_managed" | "hybrid" | "self_operated";
  name: string;
  icon: string;
  tone: string;
  blurb: string;
  points: string[];
  recommended?: boolean;
}

export const OPERATING_MODES: OperatingMode[] = [
  {
    key: "fully_managed", name: "Fully Managed", icon: "🤝", tone: "#c9911a",
    blurb: "We handle everything", recommended: true,
    points: ["End-to-end operations", "Dynamic pricing", "Guest management", "Housekeeping", "Maintenance", "Marketing"],
  },
  {
    key: "hybrid", name: "Hybrid Mode", icon: "⚖️", tone: "#2563eb",
    blurb: "You + StayBid together",
    points: ["Shared operations", "You handle some, we handle some", "Cost effective", "Flexible"],
  },
  {
    key: "self_operated", name: "Self Operated", icon: "🧑‍💼", tone: "#0f766e",
    blurb: "You are in control",
    points: ["You manage everything", "We provide technology", "SOPs & support", "Training & tools", "Complete freedom"],
  },
];

// ── Phase 5 · Workforce categories (on-demand services) ─────────────────────
export const WORKFORCE_CATEGORIES = [
  { icon: "🧹", name: "Housekeeping" }, { icon: "🧺", name: "Laundry" },
  { icon: "🔧", name: "Maintenance" },  { icon: "💡", name: "Electrician" },
  { icon: "🚰", name: "Plumber" },      { icon: "🎨", name: "Interior Designer" },
  { icon: "📷", name: "Photographer" }, { icon: "🎥", name: "Videographer" },
  { icon: "🛎️", name: "Guest Manager" },{ icon: "👨‍🍳", name: "Cook / Chef" },
  { icon: "🗺️", name: "Local Guide" },  { icon: "🚗", name: "Driver" },
  { icon: "🛡️", name: "Security" },     { icon: "🌿", name: "Gardener" },
  { icon: "🐜", name: "Pest Control" }, { icon: "🤵", name: "Concierge" },
];

// ── Phase 5 · Dynamic pricing (factors + strategies + preview series) ───────
export const PRICING_FACTORS = [
  { icon: "📈", name: "Demand & seasonality" }, { icon: "🆚", name: "Competitor pricing" },
  { icon: "🎉", name: "Events & festivals" },   { icon: "📅", name: "Day of week" },
  { icon: "🕐", name: "Length of stay" },       { icon: "⏳", name: "Booking window" },
  { icon: "🌍", name: "Local market trend" },   { icon: "🔮", name: "Occupancy forecast" },
];

export const PRICING_STRATEGIES = [
  { icon: "🏷️", name: "Base price" },        { icon: "🌅", name: "Early-bird offers" },
  { icon: "🗓️", name: "Weekend price" },     { icon: "🛌", name: "Long-stay discounts" },
  { icon: "🎊", name: "Festival price" },     { icon: "🏢", name: "Corporate pricing" },
  { icon: "⚡", name: "Last-minute deals" },  { icon: "🔥", name: "Flash deals" },
];

// Deterministic 7-day smart-price vs market-average preview (₹).
export const PRICING_PREVIEW = [
  { day: "Mon", smart: 4200, market: 4600 },
  { day: "Tue", smart: 4000, market: 4500 },
  { day: "Wed", smart: 4300, market: 4600 },
  { day: "Thu", smart: 4800, market: 4900 },
  { day: "Fri", smart: 6200, market: 5600 },
  { day: "Sat", smart: 6800, market: 5900 },
  { day: "Sun", smart: 5400, market: 5100 },
];

// ── Phase 5 · Go-live checklist + growth engine ─────────────────────────────
export const GO_LIVE_CHECKLIST = [
  { icon: "📸", title: "Professional photography & videography" },
  { icon: "📝", title: "Listing creation & optimization" },
  { icon: "🌐", title: "Multi-platform onboarding" },
  { icon: "🗓️", title: "Calendar sync & rate setup" },
  { icon: "✅", title: "Property verification & activation" },
  { icon: "🔍", title: "Pre-launch quality check" },
];

export const GROWTH_BOOSTERS = [
  "Upsell & cross-sell", "Add experiential services", "Food & beverage tie-ups",
  "Event & retreat hosting", "Long-stay & monthly stays", "Corporate partnerships",
  "Group bookings", "Referral incentives",
];

export const BRAND_TOOLS = [
  "Custom brand page", "Social media marketing kit", "Professional content support",
  "Guest review management", "Loyalty program", "Influencer collaborations",
  "PR & media exposure", "Email & WhatsApp campaigns",
];

export const SUPPORT_PROMISES = [
  { icon: "🧑‍💼", title: "Dedicated Relationship Manager" },
  { icon: "📞", title: "24/7 support (call, chat, WhatsApp)" },
  { icon: "📍", title: "On-ground assistance" },
  { icon: "⚖️", title: "Legal & compliance support" },
  { icon: "🚨", title: "Emergency support" },
  { icon: "📈", title: "Growth advisory" },
];

// ── Landing · Why invest with StayBid (image 1 sidebar) ─────────────────────
export const WHY_INVEST = [
  { icon: "🪶", title: "Asset-light model" },
  { icon: "📈", title: "High returns" },
  { icon: "😌", title: "Passive income" },
  { icon: "🧠", title: "Expert management" },
  { icon: "🌆", title: "Multiple cities" },
  { icon: "🛡️", title: "Low risk, high transparency" },
  { icon: "🤖", title: "Technology driven" },
  { icon: "🤝", title: "End-to-end support" },
];

// ── Preference whitelists (server-side validation uses these) ───────────────
export const RETURN_PROFILE_KEYS = RETURN_PROFILES.map((r) => r.key as string);
export const PROPERTY_CATEGORY_KEYS = PROPERTY_CATEGORIES.map((c) => c.key);
export const SOURCING_KEYS = SOURCING_OPTIONS.map((s) => s.key);
export const DESIGN_THEME_KEYS = DESIGN_THEMES.map((t) => t.key);
export const OPERATING_MODE_KEYS = OPERATING_MODES.map((m) => m.key as string);
export const POPULAR_ADDON_KEYS = POPULAR_ADDONS.map((a) => a.key);

// The non-priced journey preferences persisted on host_portfolio_configs.
export interface JourneyPreferences {
  returnProfile?: string;
  cityMode?: "nearby" | "tourist";
  propertyTypes?: string[];
  sourcing?: string;
  designTheme?: string;
  operatingMode?: string;
  popularAddons?: string[];
}

// Shared sanitizer — client sends, server re-runs (defense in depth).
export function sanitizeJourneyPreferences(raw: any): JourneyPreferences {
  const p = raw && typeof raw === "object" ? raw : {};
  const pickOne = (v: any, allowed: string[]) =>
    typeof v === "string" && allowed.includes(v) ? v : undefined;
  const pickMany = (v: any, allowed: string[], max: number) =>
    Array.isArray(v)
      ? Array.from(new Set(v.filter((x) => typeof x === "string" && allowed.includes(x)))).slice(0, max)
      : [];
  const out: JourneyPreferences = {};
  const rp = pickOne(p.returnProfile, RETURN_PROFILE_KEYS);
  if (rp) out.returnProfile = rp;
  if (p.cityMode === "nearby" || p.cityMode === "tourist") out.cityMode = p.cityMode;
  const pt = pickMany(p.propertyTypes, PROPERTY_CATEGORY_KEYS, 6);
  if (pt.length) out.propertyTypes = pt;
  const so = pickOne(p.sourcing, SOURCING_KEYS);
  if (so) out.sourcing = so;
  const th = pickOne(p.designTheme, DESIGN_THEME_KEYS);
  if (th) out.designTheme = th;
  const om = pickOne(p.operatingMode, OPERATING_MODE_KEYS);
  if (om) out.operatingMode = om;
  const pa = pickMany(p.popularAddons, POPULAR_ADDON_KEYS, 8);
  if (pa.length) out.popularAddons = pa;
  return out;
}

// Human-readable resolvers (admin + /host/me render these).
export function prefLabels(p: JourneyPreferences | null | undefined) {
  if (!p) return [];
  const out: { k: string; v: string }[] = [];
  const rp = RETURN_PROFILES.find((r) => r.key === p.returnProfile);
  if (rp) out.push({ k: "Return profile", v: `${rp.name} (${rp.band})` });
  if (p.propertyTypes?.length)
    out.push({ k: "Property types", v: p.propertyTypes.map((k) => PROPERTY_CATEGORIES.find((c) => c.key === k)?.name || k).join(", ") });
  const so = SOURCING_OPTIONS.find((s) => s.key === p.sourcing);
  if (so) out.push({ k: "Sourcing", v: so.name });
  const th = DESIGN_THEMES.find((t) => t.key === p.designTheme);
  if (th) out.push({ k: "Design theme", v: th.name });
  const om = OPERATING_MODES.find((m) => m.key === p.operatingMode);
  if (om) out.push({ k: "Operating mode", v: om.name });
  if (p.popularAddons?.length)
    out.push({ k: "Add-on wishlist", v: p.popularAddons.map((k) => POPULAR_ADDONS.find((a) => a.key === k)?.name || k).join(", ") });
  return out;
}
