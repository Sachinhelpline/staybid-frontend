// v138.1 — Bilingual tutorial content (Phase 1: Welcome Story).
//
// v138.1 changes:
//   • Card copy MUCH briefer (billboard-style punchier headlines + 1-line body)
//   • Added `scene` field — points to a CSS-rendered poster scene in
//     components/tutorial/WelcomeScenes.tsx (visual hero above the text)
//   • Old emoji-as-hero is retained as fallback when scene === "icon"
//
// Single source of truth. Per-page tour content (Phase 2) will be appended
// to this file under PAGE_TOURS in v139.
//
// Translation policy:
//   • en (English)  — premium luxury copy, full sentences
//   • hi (Hinglish) — Hindi conversational with English brand/CTA words mixed
//     (matches StayBid's user audience — Indian travelers, mixed literacy)

export type WelcomeSceneKey = "welcome" | "bid" | "flash" | "earn" | "explore";

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
      body: "Luxury stays. Your price.",
      accent: "var(--cozy-champagne)",
    },
    {
      scene: "bid",
      icon: "💰",
      headline: "Name your price",
      body: "Hotels accept or counter — you always save.",
      accent: "var(--cozy-champagne-light)",
    },
    {
      scene: "flash",
      icon: "⚡",
      headline: "Flash Deals tonight",
      body: "Big drops, gone by midnight.",
      accent: "#D49583",
    },
    {
      scene: "earn",
      icon: "💎",
      headline: "Stay. Refer. Earn.",
      body: "Points + commissions on every booking.",
      accent: "var(--cozy-sage)",
    },
    {
      scene: "explore",
      icon: "🚀",
      headline: "Ready to explore",
      body: "Swipe. Save. Book in one tap.",
      accent: "var(--cozy-champagne)",
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
      body: "Luxury stay. Aapki price.",
      accent: "var(--cozy-champagne)",
    },
    {
      scene: "bid",
      icon: "💰",
      headline: "Apni price batao",
      body: "Hotel accept ya counter karega — bachat guaranteed.",
      accent: "var(--cozy-champagne-light)",
    },
    {
      scene: "flash",
      icon: "⚡",
      headline: "Aaj raat Flash Deals",
      body: "Massive discount, midnight tak bas.",
      accent: "#D49583",
    },
    {
      scene: "earn",
      icon: "💎",
      headline: "Stay karo. Refer karo. Kamao.",
      body: "Har booking par points + commission.",
      accent: "var(--cozy-sage)",
    },
    {
      scene: "explore",
      icon: "🚀",
      headline: "Chalo explore karein",
      body: "Swipe karo. Save karo. Ek tap mein book.",
      accent: "var(--cozy-champagne)",
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
