// v138.2 — Bilingual tutorial content (Phase 1: Welcome Story).
//
// v138.2 changes:
//   • 5 cards → 6 cards (adds OTA compare + Score Card cards per user spec)
//   • Each body is now a SINGLE crisp line (was 1-2 sentences)
//   • Old "bid" scene (price stack) → renamed "compare" (used for Card 4)
//   • New "bid" scene (3-step process) for Card 3 (reverse auction)
//   • New "score" scene (medal + rank) for Card 5
//
// Mapping → poster scene:
//   1. welcome — brand wordmark + sparkles
//   2. flash   — lightning + countdown + LIVE
//   3. bid     — 3 step pills (city → dates → budget) + AI chip
//   4. compare — 4-OTA price bar stack with stay·bid winning
//   5. score   — medal disc with rank ribbon + checkpoint dots
//   6. earn    — fan of 3 mini cards
//
// Translation policy:
//   • en (English)  — premium luxury copy
//   • hi (Hinglish) — Hindi conversational with English brand/CTA words mixed

export type WelcomeSceneKey = "welcome" | "flash" | "bid" | "compare" | "score" | "earn";

export type WelcomeCard = {
  scene: WelcomeSceneKey;
  icon: string;       // fallback / accent emoji
  headline: string;
  body: string;
  accent?: string;
};

export type WelcomeStoryContent = {
  cards: WelcomeCard[];
  skipLabel: string;
  nextLabel: string;
  doneLabel: string;
  langToggleHint: string;
};

const WELCOME_EN: WelcomeStoryContent = {
  cards: [
    {
      scene: "welcome",
      icon: "✨",
      headline: "Welcome to StayBid",
      body: "Verified hotels · Score cards · 3 ways to book.",
      accent: "var(--cozy-champagne)",
    },
    {
      scene: "flash",
      icon: "⚡",
      headline: "Flash Deal of the Day",
      body: "Last-minute. Cheapest guaranteed. First come, first served.",
      accent: "#D49583",
    },
    {
      scene: "bid",
      icon: "💰",
      headline: "Bid your price",
      body: "3 steps: city · dates · budget. Hotels compete for you.",
      accent: "var(--cozy-champagne-light)",
    },
    {
      scene: "compare",
      icon: "📊",
      headline: "Cheaper than every OTA",
      body: "Live compare. 10–20% off guaranteed. Then negotiate further.",
      accent: "var(--cozy-champagne)",
    },
    {
      scene: "score",
      icon: "🏆",
      headline: "Real Score Cards",
      body: "Forget fake reviews. Detailed score + city rank for every hotel.",
      accent: "var(--cozy-champagne-light)",
    },
    {
      scene: "earn",
      icon: "💎",
      headline: "You earn too",
      body: "Share content · 5–12% commission · or refer friends.",
      accent: "var(--cozy-sage)",
    },
  ],
  skipLabel: "Skip",
  nextLabel: "Next",
  doneLabel: "Start exploring",
  langToggleHint: "हिं",
};

const WELCOME_HI: WelcomeStoryContent = {
  cards: [
    {
      scene: "welcome",
      icon: "✨",
      headline: "Welcome StayBid pe",
      body: "Verified hotels · Score cards · 3 tareeke book karne ke.",
      accent: "var(--cozy-champagne)",
    },
    {
      scene: "flash",
      icon: "⚡",
      headline: "Aaj ka Flash Deal",
      body: "Last-minute. Sasta guaranteed. Pehle aao, pehle pao.",
      accent: "#D49583",
    },
    {
      scene: "bid",
      icon: "💰",
      headline: "Apni price batao",
      body: "3 steps: city · dates · budget. Hotels compete karenge.",
      accent: "var(--cozy-champagne-light)",
    },
    {
      scene: "compare",
      icon: "📊",
      headline: "Har OTA se sasta",
      body: "Live compare. 10–20% sasta guaranteed. Phir bhi negotiate karo.",
      accent: "var(--cozy-champagne)",
    },
    {
      scene: "score",
      icon: "🏆",
      headline: "Real Score Cards",
      body: "Fake reviews bhulo. Har hotel ka detailed score + city rank.",
      accent: "var(--cozy-champagne-light)",
    },
    {
      scene: "earn",
      icon: "💎",
      headline: "Aap bhi kamao",
      body: "Content daalo · 5–12% commission · ya refer karo.",
      accent: "var(--cozy-sage)",
    },
  ],
  skipLabel: "Skip",
  nextLabel: "Aage",
  doneLabel: "Shuru karein",
  langToggleHint: "EN",
};

export const WELCOME_STORY: Record<"en" | "hi", WelcomeStoryContent> = {
  en: WELCOME_EN,
  hi: WELCOME_HI,
};

// ── Drawer / replay-list copy (used by Phase 4 in /me drawer) ──────────
// Exported here so Phase 4 doesn't need its own content file.
export const TUTORIAL_DRAWER_COPY = {
  en: {
    sectionTitle: "App Tour",
    sectionSub: "Replay any walkthrough below",
    replay: "Replay",
    welcomeLabel: "Welcome story",
    homeLabel: "Home + Reels feed",
    hotelLabel: "Hotel detail page",
    bidLabel: "Reverse auction bid",
    flashLabel: "Flash Deals",
    reelsLabel: "Reels gestures",
    earnLabel: "Refer & earn",
    disabledTitle: "Tutorials disabled",
    disabledSub: "Auto-tours won't show on first visits",
    enableLabel: "Enable",
    disableLabel: "Disable all tours",
  },
  hi: {
    sectionTitle: "App Tour",
    sectionSub: "Niche se koi bhi walkthrough dobara dekhein",
    replay: "Dobara dekho",
    welcomeLabel: "Welcome story",
    homeLabel: "Home + Reels feed",
    hotelLabel: "Hotel detail page",
    bidLabel: "Reverse auction bid",
    flashLabel: "Flash Deals",
    reelsLabel: "Reels gestures",
    earnLabel: "Refer & earn",
    disabledTitle: "Tutorials band hain",
    disabledSub: "First-visit pe auto-tour nahi chalega",
    enableLabel: "Chalu karo",
    disableLabel: "Sab tour band karo",
  },
};

// ── v139: Per-page spotlight tours (Layer 2) ─────────────────────────
// Each tour is an ordered array of TourStep objects keyed by a stable
// CSS selector (existing class / id on the page — we deliberately AVOID
// adding data-tour attributes so onboarding lives entirely in this file
// and never bloats page JSX).
//
// The usePageTour hook polls for the FIRST step's element for ~1.5s
// before firing. If the selector doesn't exist (e.g. page in an empty
// state, A/B variant) the tour is skipped silently.

export type TourStep = {
  /** CSS selector — must match an element rendered on the page. */
  element: string;
  /** Step heading — short. */
  title: string;
  /** Step body — 1 line ideal, 2 max. */
  description: string;
  /** Popover position relative to highlighted element. Default "bottom". */
  side?: "top" | "right" | "bottom" | "left";
  /** Popover alignment. Default "center". */
  align?: "start" | "center" | "end";
};

type LocalisedSteps = { en: TourStep[]; hi: TourStep[] };

// Home / discover reel feed — 4 steps
const HOME_STEPS: LocalisedSteps = {
  en: [
    {
      element: ".fdeal-rail-wrap",
      title: "🔥 Flash Deals",
      description: "Top hotels release massive same-day discounts here. Tap any avatar to grab one.",
      side: "bottom",
    },
    {
      element: ".ig-card",
      title: "👆 Reel feed",
      description: "Swipe up / down to browse hotels. Each reel is a real verified property.",
      side: "left",
    },
    {
      element: ".ig-cta-book",
      title: "Book Now",
      description: "Pay the listed price and confirm instantly. Always cheaper than OTAs.",
      side: "left",
    },
    {
      element: ".ig-cta-bid",
      title: "Or Bid Your Price",
      description: "Name what you'd pay — the hotel accepts, counters, or rejects in real time.",
      side: "left",
    },
  ],
  hi: [
    {
      element: ".fdeal-rail-wrap",
      title: "🔥 Flash Deals",
      description: "Top hotels yahaan same-day massive discount dete hain. Tap karo aur grab karo.",
      side: "bottom",
    },
    {
      element: ".ig-card",
      title: "👆 Reel feed",
      description: "Up / down swipe karo hotels browse karne ke liye. Har reel verified property hai.",
      side: "left",
    },
    {
      element: ".ig-cta-book",
      title: "Book Now",
      description: "Listed price pe pay karo aur instant confirm. Hamesha OTA se sasta.",
      side: "left",
    },
    {
      element: ".ig-cta-bid",
      title: "Ya Apni Price Bid Karo",
      description: "Apni price batao — hotel turant accept, counter, ya reject karega.",
      side: "left",
    },
  ],
};

// Hotel detail page — 5 steps
const HOTEL_STEPS: LocalisedSteps = {
  en: [
    {
      element: ".hx-room-media",
      title: "📸 Photo gallery",
      description: "Real verified photos from the property. Tap to view full-screen.",
      side: "right",
    },
    {
      element: "#availability-picker",
      title: "📅 Pick dates first",
      description: "Set check-in / check-out + guests. Room prices update for your stay.",
      side: "top",
    },
    {
      element: ".hsb",
      title: "🏆 Score Card",
      description: "Detailed score out of 100 + city rank. Tap for the full 10-checkpoint breakdown.",
      side: "left",
    },
    {
      element: ".hx-cta-primary",
      title: "Book Now",
      description: "Charged instantly via Razorpay. Booking confirmed in 30 seconds.",
      side: "top",
    },
    {
      element: ".hx-cta-secondary",
      title: "Or Negotiate",
      description: "Bid below the listed price — hotel may accept or counter your offer.",
      side: "top",
    },
  ],
  hi: [
    {
      element: ".hx-room-media",
      title: "📸 Photo gallery",
      description: "Property ki real verified photos. Full-screen ke liye tap karo.",
      side: "right",
    },
    {
      element: "#availability-picker",
      title: "📅 Pehle dates set karo",
      description: "Check-in / check-out + guests. Room prices apke stay ke liye update honge.",
      side: "top",
    },
    {
      element: ".hsb",
      title: "🏆 Score Card",
      description: "100 mein se detailed score + city rank. 10-checkpoint breakdown ke liye tap karo.",
      side: "left",
    },
    {
      element: ".hx-cta-primary",
      title: "Book Now",
      description: "Razorpay se instant charge. 30 second mein booking confirm.",
      side: "top",
    },
    {
      element: ".hx-cta-secondary",
      title: "Ya Negotiate karo",
      description: "Listed price se kam bid karo — hotel accept ya counter karega.",
      side: "top",
    },
  ],
};

// /bid page (reverse auction) — 4 steps
const BID_STEPS: LocalisedSteps = {
  en: [
    {
      element: '[data-autonext="destination"]',
      title: "1. Pick city",
      description: "Choose where you want to stay. Your bid goes to all hotels in this city.",
      side: "top",
    },
    {
      element: '[data-autonext="dates"]',
      title: "2. Set dates",
      description: "Check-in + check-out. Hotels see your dates while bidding.",
      side: "top",
    },
    {
      element: '[data-autonext="addons"]',
      title: "3. Your budget",
      description: "Tell us your max per-night budget. Our AI hints a smart price.",
      side: "top",
    },
    {
      element: ".bx-launch-btn",
      title: "🚀 Submit",
      description: "Hotels respond in My Bids — check back in 10-15 minutes.",
      side: "top",
    },
  ],
  hi: [
    {
      element: '[data-autonext="destination"]',
      title: "1. City chuno",
      description: "Kahaan stay karna hai. Aapki bid us city ke saare hotels ko jayegi.",
      side: "top",
    },
    {
      element: '[data-autonext="dates"]',
      title: "2. Dates batao",
      description: "Check-in + check-out. Hotels apki dates ke liye bid karenge.",
      side: "top",
    },
    {
      element: '[data-autonext="addons"]',
      title: "3. Apna budget",
      description: "Per-night max budget batao. Hamari AI smart price suggest karegi.",
      side: "top",
    },
    {
      element: ".bx-launch-btn",
      title: "🚀 Submit",
      description: "Hotels My Bids mein respond karenge. 10-15 minute mein check karo.",
      side: "top",
    },
  ],
};

export const PAGE_TOURS: Record<string, LocalisedSteps> = {
  home: HOME_STEPS,
  hotel: HOTEL_STEPS,
  bid: BID_STEPS,
};

/** Hook helper — returns the steps array for the given key + current language. */
export function useLocalisedSteps(key: string, lang: "en" | "hi"): TourStep[] | null {
  const bucket = PAGE_TOURS[key];
  if (!bucket) return null;
  return bucket[lang] || bucket.en || null;
}
