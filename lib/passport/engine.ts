// ═══════════════════════════════════════════════════════════════════════
// Passport engine — pure functions only. NO fetch, NO Supabase. Imported by
// the server API route (award/compute) AND the client UI (display). Same
// rules everywhere, so badges/rank never drift between server and screen.
//
// Phase 1 — personal Explorer Passport. Stamps come from confirmed stays;
// XP + rank + badges + stamp-rewards all derive deterministically from the
// stamp set, so re-running the engine is idempotent.
// ═══════════════════════════════════════════════════════════════════════

// ─── XP economy ─────────────────────────────────────────────────────────
export const XP_PER_STAMP = 150; // base XP per confirmed stay
export const XP_NEW_CITY_BONUS = 60; // first stamp in a brand-new city
export const XP_PER_BADGE = 80; // each unlocked badge

// ─── Ranks (XP ladder) ──────────────────────────────────────────────────
// Calibrated so an active explorer climbs through them naturally.
// Adventurer tops out at 3000 (Trailblazer threshold) — matches the
// reference design's "ADVENTURER 1750 / 3000 · Next: TRAILBLAZER".
export type RankKey =
  | "explorer"
  | "adventurer"
  | "trailblazer"
  | "nomad"
  | "legend"
  | "founders_circle";

export type Rank = {
  key: RankKey;
  label: string;
  emoji: string;
  xpMin: number;
  gradient: string; // CSS gradient for the rank chip / ring
  color: string; // solid accent
  blurb: string;
};

export const RANKS: Rank[] = [
  {
    key: "explorer",
    label: "Explorer",
    emoji: "🧭",
    xpMin: 0,
    gradient: "linear-gradient(135deg,#9DAD8F,#7F9269)",
    color: "#7F9269",
    blurb: "Every journey begins here.",
  },
  {
    key: "adventurer",
    label: "Adventurer",
    emoji: "⛰️",
    xpMin: 1000,
    gradient: "linear-gradient(135deg,#E7CFA0,#C9A66B)",
    color: "#C9A66B",
    blurb: "You've found your rhythm on the road.",
  },
  {
    key: "trailblazer",
    label: "Trailblazer",
    emoji: "🔥",
    xpMin: 3000,
    gradient: "linear-gradient(135deg,#F0B429,#C9911A)",
    color: "#C9911A",
    blurb: "Cutting paths others follow.",
  },
  {
    key: "nomad",
    label: "Nomad",
    emoji: "🌍",
    xpMin: 6000,
    gradient: "linear-gradient(135deg,#5EA0C9,#3D7BA6)",
    color: "#3D7BA6",
    blurb: "Home is wherever the next stay is.",
  },
  {
    key: "legend",
    label: "Legend",
    emoji: "👑",
    xpMin: 10000,
    gradient: "linear-gradient(135deg,#B98BF0,#8A5CD8)",
    color: "#8A5CD8",
    blurb: "Your passport tells stories.",
  },
  {
    key: "founders_circle",
    label: "Founder's Circle",
    emoji: "💎",
    xpMin: 20000,
    gradient: "linear-gradient(135deg,#F5E6B8,#D4AF37,#8B6914)",
    color: "#D4AF37",
    blurb: "The rarefied few. Thank you for believing early.",
  },
];

export type RankState = {
  rank: Rank;
  next: Rank | null;
  xp: number;
  xpIntoRank: number;
  xpForNext: number; // total XP threshold for next rank (absolute)
  progressPct: number; // 0–100 toward next rank
};

export function rankForXp(xp: number): RankState {
  const x = Math.max(0, Math.floor(xp || 0));
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) {
    if (x >= RANKS[i].xpMin) idx = i;
  }
  const rank = RANKS[idx];
  const next = idx < RANKS.length - 1 ? RANKS[idx + 1] : null;
  const xpIntoRank = x - rank.xpMin;
  const span = next ? next.xpMin - rank.xpMin : 1;
  const progressPct = next ? Math.min(100, Math.round((xpIntoRank / span) * 100)) : 100;
  return {
    rank,
    next,
    xp: x,
    xpIntoRank,
    xpForNext: next ? next.xpMin : rank.xpMin,
    progressPct,
  };
}

// ─── City → region classification ───────────────────────────────────────
// Used both for the stamp's region tint AND the Mountain Explorer badge.
const MOUNTAIN_CITIES = new Set(
  [
    "mussoorie",
    "manali",
    "shimla",
    "dhanaulti",
    "nainital",
    "dehradun",
    "rishikesh",
    "kasol",
    "mcleodganj",
    "dharamshala",
    "auli",
    "chopta",
    "lansdowne",
    "kufri",
    "chail",
    "munsiyari",
    "chakrata",
  ].map((c) => c.toLowerCase()),
);

const BEACH_CITIES = new Set(
  ["goa", "gokarna", "varkala", "pondicherry", "puducherry", "alibaug", "diu", "kovalam"].map((c) =>
    c.toLowerCase(),
  ),
);

export type Region = "mountain" | "beach" | "city";

export function regionForCity(city?: string | null): Region {
  const c = String(city || "").trim().toLowerCase();
  if (!c) return "city";
  if (MOUNTAIN_CITIES.has(c)) return "mountain";
  if (BEACH_CITIES.has(c)) return "beach";
  // Heuristic fallback — common hill-station / beach keywords.
  if (/(hill|mount|valley|himachal|uttarakhand|ladakh|spiti)/.test(c)) return "mountain";
  if (/(beach|coast|island)/.test(c)) return "beach";
  return "city";
}

export const REGION_STYLE: Record<Region, { emoji: string; ring: string; tint: string; label: string }> = {
  mountain: {
    emoji: "🏔️",
    ring: "linear-gradient(135deg,#7F9269,#4F6B4A)",
    tint: "#EAF0E6",
    label: "Mountains",
  },
  beach: {
    emoji: "🏝️",
    ring: "linear-gradient(135deg,#5EA0C9,#3D7BA6)",
    tint: "#E6F0F5",
    label: "Coast",
  },
  city: {
    emoji: "🏙️",
    ring: "linear-gradient(135deg,#C9A66B,#8B6914)",
    tint: "#F5EFE0",
    label: "City",
  },
};

// ─── Stamp + stats shapes ───────────────────────────────────────────────
export type StampRow = {
  id?: string;
  hotel_id?: string | null;
  hotel_name?: string | null;
  city?: string | null;
  region?: string | null;
  source_type?: string;
  source_id?: string;
  stay_date?: string | null;
  earned_at?: string | null;
  // optional analytics carried from the source stay (not persisted)
  _guests?: number | null;
  _amount?: number | null;
  _checkInDow?: number | null; // 0=Sun … 6=Sat
};

export type PassportStats = {
  stampCount: number;
  propertiesVisited: number;
  citiesVisited: number;
  mountainStays: number;
  beachStays: number;
  weekendStays: number;
  soloStays: number;
  familyStays: number;
  topStackCount: number; // most stays at a single property
  cities: string[];
};

export function computeStats(stamps: StampRow[]): PassportStats {
  const hotels = new Map<string, number>();
  const cities = new Map<string, number>();
  let mountainStays = 0,
    beachStays = 0,
    weekendStays = 0,
    soloStays = 0,
    familyStays = 0;

  for (const s of stamps) {
    const hid = String(s.hotel_id || s.hotel_name || s.source_id || "");
    if (hid) hotels.set(hid, (hotels.get(hid) || 0) + 1);
    const cityKey = String(s.city || "").trim().toLowerCase();
    if (cityKey) cities.set(cityKey, (cities.get(cityKey) || 0) + 1);
    const region = (s.region as Region) || regionForCity(s.city);
    if (region === "mountain") mountainStays++;
    if (region === "beach") beachStays++;
    const dow = s._checkInDow;
    if (dow === 5 || dow === 6) weekendStays++; // Fri / Sat check-in
    const g = Number(s._guests || 0);
    if (g > 0 && g <= 1) soloStays++;
    if (g >= 4) familyStays++;
  }

  let topStackCount = 0;
  hotels.forEach((n) => {
    if (n > topStackCount) topStackCount = n;
  });

  return {
    stampCount: stamps.length,
    propertiesVisited: hotels.size,
    citiesVisited: cities.size,
    mountainStays,
    beachStays,
    weekendStays,
    soloStays,
    familyStays,
    topStackCount,
    cities: Array.from(cities.keys()),
  };
}

// ─── Badges ─────────────────────────────────────────────────────────────
export type Badge = {
  key: string;
  label: string;
  emoji: string;
  blurb: string;
  // criterion text shown when locked + the progress fraction [done, target]
  goal: (s: PassportStats) => { earned: boolean; have: number; need: number; hint: string };
};

export const BADGES: Badge[] = [
  {
    key: "first_stamp",
    label: "First Stamp",
    emoji: "📖",
    blurb: "Your passport's first memory.",
    goal: (s) => ({ earned: s.stampCount >= 1, have: s.stampCount, need: 1, hint: "Complete your first stay" }),
  },
  {
    key: "mountain_explorer",
    label: "Mountain Explorer",
    emoji: "🏔️",
    blurb: "The peaks know your name.",
    goal: (s) => ({ earned: s.mountainStays >= 1, have: s.mountainStays, need: 1, hint: "Stay at a hill-station" }),
  },
  {
    key: "weekend_warrior",
    label: "Weekend Warrior",
    emoji: "🗓️",
    blurb: "Two weekends, two escapes.",
    goal: (s) => ({ earned: s.weekendStays >= 2, have: s.weekendStays, need: 2, hint: "2 weekend (Fri/Sat) stays" }),
  },
  {
    key: "family_traveller",
    label: "Family Traveller",
    emoji: "👨‍👩‍👧",
    blurb: "Memories multiply when shared.",
    goal: (s) => ({ earned: s.familyStays >= 1, have: s.familyStays, need: 1, hint: "Book a stay for 4+ guests" }),
  },
  {
    key: "solo_explorer",
    label: "Solo Explorer",
    emoji: "🧍",
    blurb: "Just you and the open road.",
    goal: (s) => ({ earned: s.soloStays >= 1, have: s.soloStays, need: 1, hint: "Take a solo trip" }),
  },
  {
    key: "digital_nomad",
    label: "Digital Nomad",
    emoji: "💻",
    blurb: "Five stays and still going.",
    goal: (s) => ({ earned: s.stampCount >= 5, have: s.stampCount, need: 5, hint: "Complete 5 stays" }),
  },
  {
    key: "adventurer",
    label: "Adventurer",
    emoji: "⛰️",
    blurb: "Three stamps in the book.",
    goal: (s) => ({ earned: s.stampCount >= 3, have: s.stampCount, need: 3, hint: "Collect 3 stamps" }),
  },
  {
    key: "trailblazer",
    label: "Trailblazer",
    emoji: "🔥",
    blurb: "Three cities, one passport.",
    goal: (s) => ({ earned: s.citiesVisited >= 3, have: s.citiesVisited, need: 3, hint: "Visit 3 different cities" }),
  },
  {
    key: "nomad",
    label: "Nomad",
    emoji: "🌍",
    blurb: "Seven stamps and counting.",
    goal: (s) => ({ earned: s.stampCount >= 7, have: s.stampCount, need: 7, hint: "Collect 7 stamps" }),
  },
  {
    key: "legend",
    label: "Legend",
    emoji: "👑",
    blurb: "Fifteen stays. A living legend.",
    goal: (s) => ({ earned: s.stampCount >= 15, have: s.stampCount, need: 15, hint: "Collect 15 stamps" }),
  },
  {
    key: "loyal_regular",
    label: "Regular",
    emoji: "🛎️",
    blurb: "Three stays at the same place.",
    goal: (s) => ({ earned: s.topStackCount >= 3, have: s.topStackCount, need: 3, hint: "Stay 3× at one property" }),
  },
  {
    key: "founders_circle",
    label: "Founder's Circle",
    emoji: "💎",
    blurb: "Twenty stamps. The rarefied few.",
    goal: (s) => ({ earned: s.stampCount >= 20, have: s.stampCount, need: 20, hint: "Collect 20 stamps" }),
  },
];

export function evaluateBadges(stats: PassportStats): string[] {
  const out: string[] = [];
  for (const b of BADGES) {
    if (b.goal(stats).earned) out.push(b.key);
  }
  return out;
}

// ─── XP roll-up ─────────────────────────────────────────────────────────
// Total XP = stamps + new-city bonuses + per-badge XP. Pure + deterministic.
export function computeXp(stats: PassportStats, earnedBadgeKeys: string[]): number {
  const stampXp = stats.stampCount * XP_PER_STAMP;
  const cityXp = stats.citiesVisited * XP_NEW_CITY_BONUS;
  const badgeXp = earnedBadgeKeys.length * XP_PER_BADGE;
  return stampXp + cityXp + badgeXp;
}

// ─── Stamp-count reward ladder ──────────────────────────────────────────
// 3 → ₹200 welcome voucher · 7 → free breakfast · 11 → room upgrade ·
// 20 → 1 free night. Claiming mints a redemption_code (see claim route).
export type StampReward = {
  key: string;
  stamps: number;
  title: string;
  sub: string;
  emoji: string;
  kind: "coupon" | "amenity" | "voucher";
  value_inr: number;
};

export const STAMP_REWARDS: StampReward[] = [
  { key: "welcome_voucher", stamps: 3, title: "₹200 Welcome Voucher", sub: "Off your next booking", emoji: "🎟️", kind: "coupon", value_inr: 200 },
  { key: "free_breakfast", stamps: 7, title: "Free Breakfast", sub: "On your next stay", emoji: "🥐", kind: "amenity", value_inr: 0 },
  { key: "room_upgrade", stamps: 11, title: "Free Room Upgrade", sub: "Subject to availability", emoji: "🛏️", kind: "amenity", value_inr: 0 },
  { key: "free_night", stamps: 20, title: "1 Night Free Stay", sub: "Any StayBid partner hotel", emoji: "🎁", kind: "voucher", value_inr: 2500 },
];

export type RewardState = StampReward & {
  unlocked: boolean; // stampCount >= stamps
  claimed: boolean;
  claimedCode?: string | null;
  remaining: number; // stamps still needed (0 if unlocked)
};

export function rewardStates(
  stampCount: number,
  claimedMap: Record<string, { code?: string | null } | undefined>,
): RewardState[] {
  return STAMP_REWARDS.map((r) => {
    const unlocked = stampCount >= r.stamps;
    const claim = claimedMap[r.key];
    return {
      ...r,
      unlocked,
      claimed: !!claim,
      claimedCode: claim?.code || null,
      remaining: unlocked ? 0 : r.stamps - stampCount,
    };
  });
}

// ─── Explorer ID generator (server) ─────────────────────────────────────
// SB-EXP-###### — stable, human-readable. Derived from a per-user counter
// would need a sequence; a zero-padded random in a wide space is collision-
// safe enough (UNIQUE constraint on explorer_id is the real guard).
export function genExplorerId(): string {
  const n = Math.floor(100000 + Math.random() * 899999);
  return `SB-EXP-${n}`;
}
