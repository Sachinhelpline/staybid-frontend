// v138 — Bilingual tutorial content (Phase 1: Welcome Story).
//
// Single source of truth. Per-page tour content (Phase 2) will be appended
// to this file under PAGE_TOURS in v139.
//
// Translation policy:
//   • en (English)  — premium luxury copy, full sentences
//   • hi (Hinglish) — Hindi conversational with English brand/CTA words mixed
//     (matches StayBid's user audience — Indian travelers, mixed literacy)
//
// Visual policy (WelcomeStory consumes these fields):
//   • icon     — emoji or short string rendered at 56-72px inside the card
//   • headline — main heading, 1 line, Cormorant italic
//   • body     — 1-2 sentences, supporting copy
//   • accent   — optional CSS color override for emoji halo
//
// Adding a 6th card or shuffling order is safe — WelcomeStory loops over
// this array. Just keep parity between en[] and hi[].

export type WelcomeCard = {
  icon: string;
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
      icon: "✨",
      headline: "Welcome to StayBid",
      body: "India's first reverse-auction hotel platform. Luxury stays, your price.",
      accent: "var(--cozy-champagne)",
    },
    {
      icon: "💰",
      headline: "Name your price. Hotels compete.",
      body: "Place a bid on any hotel — the property accepts, counters, or rejects in real time. You always pay less than booking sites.",
      accent: "var(--cozy-champagne-light)",
    },
    {
      icon: "⚡",
      headline: "Flash Deals every night",
      body: "Hotels release limited-time discounted rooms before midnight. Massive savings, first-come first-served.",
      accent: "#D49583",
    },
    {
      icon: "💎",
      headline: "Earn while you stay",
      body: "Every booking earns StayPoints — redeem as cashback. Refer friends or upload reels to earn commission on every booking they make.",
      accent: "var(--cozy-sage)",
    },
    {
      icon: "🚀",
      headline: "Let's explore",
      body: "Swipe through hotel reels, save favourites, and book in one tap. Your perfect stay is one bid away.",
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
      icon: "✨",
      headline: "StayBid pe welcome",
      body: "India ka pehla reverse-auction hotel platform. Luxury stays, aapki keemat pe.",
      accent: "var(--cozy-champagne)",
    },
    {
      icon: "💰",
      headline: "Apni price batao, hotels compete karenge",
      body: "Kisi bhi hotel pe bid lagao — hotel turant accept, counter, ya reject karega. Booking sites se hamesha kam paise lagenge.",
      accent: "var(--cozy-champagne-light)",
    },
    {
      icon: "⚡",
      headline: "Roz raat ko Flash Deals",
      body: "Hotels midnight se pehle limited rooms pe massive discount dete hain. Pehle aao, pehle pao.",
      accent: "#D49583",
    },
    {
      icon: "💎",
      headline: "Stay karo, paise kamao",
      body: "Har booking pe StayPoints milte hain — cashback ke jaise use karo. Friends ko refer karo ya hotel reels upload karo — har booking par commission kamao.",
      accent: "var(--cozy-sage)",
    },
    {
      icon: "🚀",
      headline: "Chalo explore karein",
      body: "Hotel reels swipe karo, favourites save karo, ek tap se book karo. Aapka perfect stay sirf ek bid door hai.",
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
