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
