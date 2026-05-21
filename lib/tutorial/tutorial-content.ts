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

// Home / discover reel feed — 5 steps (v141: added filter chip)
const HOME_STEPS: LocalisedSteps = {
  en: [
    {
      element: ".fdeal-rail-wrap",
      title: "🔥 Flash Deals",
      description: "Top hotels release massive same-day discounts here. Tap any avatar to grab one.",
      side: "bottom",
    },
    {
      element: ".ig-filter-chip",
      title: "🎯 Filter the feed",
      description: "Switch source (Hotels · Creators · Public) and city. Your feed updates live.",
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
      element: ".ig-filter-chip",
      title: "🎯 Feed filter karo",
      description: "Source (Hotels · Creators · Public) aur city switch karo. Feed live update hoga.",
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

// Hotel detail page — 5 steps. v140.1 — reordered to follow natural
// top-down visual order (Score Card sits high under the hero ribbon;
// Photos + CTAs are inside room cards further down). Old order caused
// up-down-up scroll jumps; new order scrolls smoothly down once.
const HOTEL_STEPS: LocalisedSteps = {
  en: [
    {
      element: ".hsb",
      title: "🏆 Score Card",
      description: "Detailed score out of 100 + city rank. Tap for the full 10-checkpoint breakdown.",
      side: "bottom",
    },
    {
      element: "#availability-picker",
      title: "📅 Pick dates first",
      description: "Set check-in / check-out + guests. Room prices update for your stay.",
      side: "top",
    },
    {
      element: ".hx-room-media",
      title: "📸 Real photos",
      description: "Verified photos from the property. Tap to view full-screen.",
      side: "right",
    },
    {
      element: ".hx-ota",
      title: "📊 vs OTAs",
      description: "Live comparison with MakeMyTrip / Booking / Agoda — we're always 10-25% cheaper.",
      side: "top",
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
      element: ".hsb",
      title: "🏆 Score Card",
      description: "100 mein se detailed score + city rank. 10-checkpoint breakdown ke liye tap karo.",
      side: "bottom",
    },
    {
      element: "#availability-picker",
      title: "📅 Pehle dates set karo",
      description: "Check-in / check-out + guests. Room prices apke stay ke liye update honge.",
      side: "top",
    },
    {
      element: ".hx-room-media",
      title: "📸 Real photos",
      description: "Property ki verified photos. Full-screen ke liye tap karo.",
      side: "right",
    },
    {
      element: ".hx-ota",
      title: "📊 OTAs se compare",
      description: "MakeMyTrip / Booking / Agoda se live comparison — hum hamesha 10-25% sasta.",
      side: "top",
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

// /bid page (reverse auction) — 5 steps (v141: added AI Smart Price step
// between dates and budget). Tour idx → page step mapping handled by
// the listener in app/bid/page.tsx via sb:tour-prep event:
//   idx 0,1 → page step 1 (city + dates visible)
//   idx 2,3 → page step 3 (AI presets + budget visible)
//   idx 4   → page step 4 (submit)
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
      element: '[data-autonext="presets"]',
      title: "🤖 AI Smart Price",
      description: "Max Save · Smart · Instant — AI suggests three budgets based on real demand.",
      side: "top",
    },
    {
      element: '[data-autonext="addons"]',
      title: "3. Your budget",
      description: "Type your own per-night max OR tap a preset. Lower bid = bigger savings.",
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
      element: '[data-autonext="presets"]',
      title: "🤖 AI Smart Price",
      description: "Max Save · Smart · Instant — AI 3 budget suggest karta hai real demand pe.",
      side: "top",
    },
    {
      element: '[data-autonext="addons"]',
      title: "3. Apna budget",
      description: "Apna per-night max likho ya preset tap karo. Kam bid = zyada bachat.",
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

// /flash-deals page — 3 steps
const FLASH_STEPS: LocalisedSteps = {
  en: [
    {
      element: ".fd-ticker",
      title: "🔴 Live ticker",
      description: "Real-time count of deals live · hotels in your city · average discount.",
      side: "bottom",
    },
    {
      element: ".fd-card",
      title: "⚡ A flash deal",
      description: "Tap any card to see room types + book. Cheapest guaranteed.",
      side: "top",
    },
    {
      element: ".fd-cta",
      title: "Book before midnight",
      description: "Slots are limited. First booking wins. No bidding here — fixed-price flash.",
      side: "top",
    },
  ],
  hi: [
    {
      element: ".fd-ticker",
      title: "🔴 Live ticker",
      description: "Real-time count: deals live · apke city ke hotels · avg discount.",
      side: "bottom",
    },
    {
      element: ".fd-card",
      title: "⚡ Ek flash deal",
      description: "Card tap karo room types dekhne ke liye + book karne ke liye. Sasta guaranteed.",
      side: "top",
    },
    {
      element: ".fd-cta",
      title: "Midnight se pehle book",
      description: "Slots kam hain. Pehle book karne wala jeetega. Yahaan bidding nahi — fixed flash price.",
      side: "top",
    },
  ],
};

// /upgrade page — 3 steps (public → creator / hotel partner earning)
const EARN_STEPS: LocalisedSteps = {
  en: [
    {
      element: '[data-tour="upgrade-creator"]',
      title: "✨ Become a Creator",
      description: "Upload hotel reels · earn 5–12% commission on every booking they drive.",
      side: "right",
      align: "start",
    },
    {
      element: '[data-tour="upgrade-hotel"]',
      title: "🏨 Hotel Partner",
      description: "Own a hotel? List it · accept bids · run flash deals from the partner panel.",
      side: "left",
      align: "start",
    },
    {
      // v140.1 — target the Apply button itself (data-tour added on the
      // UpgradeCard CTA in v140.1). Previously this re-pointed at the
      // creator card again which highlighted the whole card twice in a
      // row — confusing UX. Now it spotlights the actual button.
      element: '[data-tour="upgrade-creator-apply"]',
      title: "Quick apply",
      description: "Tap 'Apply as a Creator' — fill 3 fields. Admin approval in 1-2 days.",
      side: "top",
    },
  ],
  hi: [
    {
      element: '[data-tour="upgrade-creator"]',
      title: "✨ Creator bano",
      description: "Hotel reels upload karo · har booking pe 5–12% commission kamao.",
      side: "right",
      align: "start",
    },
    {
      element: '[data-tour="upgrade-hotel"]',
      title: "🏨 Hotel Partner",
      description: "Hotel hai? List karo · bids accept karo · flash deals chalao partner panel se.",
      side: "left",
      align: "start",
    },
    {
      element: '[data-tour="upgrade-creator-apply"]',
      title: "Quick apply",
      description: "'Apply as a Creator' tap karo — 3 fields fill karo. Admin 1-2 din mein approve karega.",
      side: "top",
    },
  ],
};

// v141 — Phase 5: booking-funnel tours.

// /hotels listing — explore page — 4 steps
const EXPLORE_STEPS: LocalisedSteps = {
  en: [
    {
      element: '.sb-cbar-search',
      title: "🔍 Search",
      description: "Type a hotel name or vibe. Results filter live as you type.",
      side: "bottom",
    },
    {
      element: '[data-autonext-self="hotels-results"]',
      title: "📍 City filter",
      description: "Tap a city chip — feed updates instantly. 'All' shows every city.",
      side: "bottom",
    },
    {
      element: '.sb-cbar-filter',
      title: "📊 Sort + ★ filter",
      description: "Sort by price / rating, multi-select star levels. Combine for the perfect view.",
      side: "bottom",
    },
    {
      element: '[data-autonext="hotels-results"] > *:first-child',
      title: "🏨 Hotel card",
      description: "Each card shows price · score · city rank. Tap to view photos + book.",
      side: "top",
    },
  ],
  hi: [
    {
      element: '.sb-cbar-search',
      title: "🔍 Search",
      description: "Hotel name ya vibe likho. Result live filter hote rahenge.",
      side: "bottom",
    },
    {
      element: '[data-autonext-self="hotels-results"]',
      title: "📍 City filter",
      description: "City chip tap karo — feed turant update hoga. 'All' = saari cities.",
      side: "bottom",
    },
    {
      element: '.sb-cbar-filter',
      title: "📊 Sort + ★ filter",
      description: "Price/rating se sort karo, multi-select stars. Combine kar ke perfect view.",
      side: "bottom",
    },
    {
      element: '[data-autonext="hotels-results"] > *:first-child',
      title: "🏨 Hotel card",
      description: "Har card pe price · score · city rank. Tap karo photos dekho aur book karo.",
      side: "top",
    },
  ],
};

// /my-bids — bid lifecycle — 4 steps
const MYBIDS_STEPS: LocalisedSteps = {
  en: [
    {
      element: ".glass-card",
      title: "💎 Your bid card",
      description: "Each card shows hotel · room · your bid · status. Real-time updates.",
      side: "top",
    },
    {
      element: ".glass-card .text-emerald-200, .glass-card .text-amber-200, .glass-card .text-rose-200",
      title: "🚦 Status",
      description: "Pending = waiting · Counter = hotel offered new price · Accepted = pay to confirm.",
      side: "top",
    },
    {
      element: ".glass-card button",
      title: "Actions",
      description: "Pay Now to confirm an Accepted bid · Accept Counter when hotel responds.",
      side: "top",
    },
    {
      element: ".glass-card",
      title: "⏱ Auto-accept timer",
      description: "Premium / strong bidders get auto-confirm in 30s. Lowball bids wait for hotel.",
      side: "top",
    },
  ],
  hi: [
    {
      element: ".glass-card",
      title: "💎 Aapki bid card",
      description: "Har card pe hotel · room · aapki bid · status. Real-time update.",
      side: "top",
    },
    {
      element: ".glass-card .text-emerald-200, .glass-card .text-amber-200, .glass-card .text-rose-200",
      title: "🚦 Status",
      description: "Pending = wait · Counter = hotel ne nayi price di · Accepted = pay karo confirm karo.",
      side: "top",
    },
    {
      element: ".glass-card button",
      title: "Actions",
      description: "Accepted bid pe Pay Now · Counter aaye toh Accept Counter karo.",
      side: "top",
    },
    {
      element: ".glass-card",
      title: "⏱ Auto-accept timer",
      description: "Premium / strong bidders ko 30s mein auto-confirm. Lowball bid hotel wait karega.",
      side: "top",
    },
  ],
};

// /bookings — confirmed stays — 3 steps
const BOOKINGS_STEPS: LocalisedSteps = {
  en: [
    {
      element: ".card-luxury",
      title: "🎫 Your booking",
      description: "Confirmed stays · check-in details · barcode · map link · phone of the hotel.",
      side: "top",
    },
    {
      element: ".card-luxury",
      title: "💎 StayPoints",
      description: "Earn 5 points per ₹100 spent. Credited after check-out. Redeem at /points.",
      side: "top",
    },
    {
      element: ".card-luxury",
      title: "💬 Chat with hotel",
      description: "Early check-in? Room request? Message the hotel directly from your booking.",
      side: "top",
    },
  ],
  hi: [
    {
      element: ".card-luxury",
      title: "🎫 Aapki booking",
      description: "Confirmed stays · check-in info · barcode · map link · hotel ka phone.",
      side: "top",
    },
    {
      element: ".card-luxury",
      title: "💎 StayPoints",
      description: "Har ₹100 pe 5 points. Check-out ke baad credit. /points pe redeem karo.",
      side: "top",
    },
    {
      element: ".card-luxury",
      title: "💬 Hotel se chat",
      description: "Early check-in chahiye? Room request? Hotel ko direct message karo booking se.",
      side: "top",
    },
  ],
};

// ── v142 — Phase 6: account + creator hub + support tours ────────────

// /wallet — 3 steps
const WALLET_STEPS: LocalisedSteps = {
  en: [
    {
      element: ".sb-balance-halo",
      title: "💰 Wallet balance",
      description: "Real ₹ refundable to bank. Auto-credited from cancellations + StayBid promos.",
      side: "bottom",
    },
    {
      element: ".sb-balance-halo + div, .sb-balance-halo ~ div",
      title: "📊 In & Out",
      description: "Total credited vs total spent + StayPoints earned across all bookings.",
      side: "top",
    },
    {
      element: ".sb-tx-row",
      title: "🧾 Transactions",
      description: "Every credit + debit with date · reason · linked booking. Always traceable.",
      side: "top",
    },
  ],
  hi: [
    {
      element: ".sb-balance-halo",
      title: "💰 Wallet balance",
      description: "Real ₹ bank ko refund ho sakte hain. Cancellations + StayBid promo se auto-credit.",
      side: "bottom",
    },
    {
      element: ".sb-balance-halo + div, .sb-balance-halo ~ div",
      title: "📊 In & Out",
      description: "Total credited vs spent + StayPoints — saari bookings ka summary.",
      side: "top",
    },
    {
      element: ".sb-tx-row",
      title: "🧾 Transactions",
      description: "Har credit + debit, date · reason · booking link ke saath. Sab traceable.",
      side: "top",
    },
  ],
};

// /points — 3 steps
const POINTS_STEPS: LocalisedSteps = {
  en: [
    {
      element: ".card-luxury.sb-card-lift",
      title: "💎 Your StayPoints",
      description: "Earn 5 points per ₹100 spent on bookings. Credited post check-out.",
      side: "bottom",
    },
    {
      element: ".card-luxury.sb-card-lift .btn-luxury, .card-luxury.sb-card-lift a[href='/points/redeem']",
      title: "🎁 Redeem",
      description: "Convert points to wallet ₹ · coupons · hotel amenities. 1 point = ₹1 cashback.",
      side: "top",
    },
    {
      element: ".card-luxury.sb-card-lift",
      title: "📜 Recent activity",
      description: "See every points credit + debit · linked to specific bookings + redemptions.",
      side: "top",
    },
  ],
  hi: [
    {
      element: ".card-luxury.sb-card-lift",
      title: "💎 Aapke StayPoints",
      description: "Har ₹100 spend pe 5 points. Check-out ke baad credit honge.",
      side: "bottom",
    },
    {
      element: ".card-luxury.sb-card-lift .btn-luxury, .card-luxury.sb-card-lift a[href='/points/redeem']",
      title: "🎁 Redeem",
      description: "Points ko wallet ₹ · coupons · hotel amenities mein convert karo. 1 point = ₹1.",
      side: "top",
    },
    {
      element: ".card-luxury.sb-card-lift",
      title: "📜 Recent activity",
      description: "Har points credit + debit · bookings + redemptions se linked.",
      side: "top",
    },
  ],
};

// /saved — 3 steps
const SAVED_STEPS: LocalisedSteps = {
  en: [
    {
      element: ".flex.gap-2.mb-6",
      title: "🗂 Filter tabs",
      description: "All · Reels · Hotels · Creators · Deals. Quickly browse anything you bookmarked.",
      side: "bottom",
    },
    {
      element: ".grid.grid-cols-2",
      title: "🔖 Saved items",
      description: "Tap any tile to open it. Hover/long-press the ✕ to remove a save.",
      side: "top",
    },
    {
      element: ".grid.grid-cols-2",
      title: "💡 Tip",
      description: "Save anywhere — tap 🔖 on a reel, hotel card, creator profile, or flash deal.",
      side: "top",
    },
  ],
  hi: [
    {
      element: ".flex.gap-2.mb-6",
      title: "🗂 Filter tabs",
      description: "All · Reels · Hotels · Creators · Deals — sab kuch quick filter kar ke dekho.",
      side: "bottom",
    },
    {
      element: ".grid.grid-cols-2",
      title: "🔖 Saved items",
      description: "Koi bhi tile tap kar ke khol lo. ✕ pe hover/long-press se remove karo.",
      side: "top",
    },
    {
      element: ".grid.grid-cols-2",
      title: "💡 Tip",
      description: "Kahi bhi save karo — reel, hotel card, creator profile, ya flash deal pe 🔖 tap.",
      side: "top",
    },
  ],
};

// /me — 4 steps (IG-style profile)
const ME_STEPS: LocalisedSteps = {
  en: [
    {
      element: ".me-avatar-btn",
      title: "📷 Profile photo",
      description: "Tap to upload your avatar. Public visible on your reels + comments.",
      side: "right",
    },
    {
      element: ".me-stats",
      title: "📊 Your stats",
      description: "Posts · followers · following. Tap any number to see the full list.",
      side: "bottom",
    },
    {
      element: ".me-tabs",
      title: "🗂 Content tabs",
      description: "Posts (photos + reels you uploaded) · Reels only · Tagged (where you appear).",
      side: "bottom",
    },
    {
      element: '.me-top-icon[aria-label="Menu"], .me-top-actions button:last-of-type',
      title: "☰ Menu drawer",
      description: "Bookings · Wallet · Points · Saved · Theme · Sign out · App tour — all here.",
      side: "left",
    },
  ],
  hi: [
    {
      element: ".me-avatar-btn",
      title: "📷 Profile photo",
      description: "Avatar upload karne ke liye tap karo. Aapki reels + comments par dikhega.",
      side: "right",
    },
    {
      element: ".me-stats",
      title: "📊 Aapke stats",
      description: "Posts · followers · following. Number tap karo full list dekhne ke liye.",
      side: "bottom",
    },
    {
      element: ".me-tabs",
      title: "🗂 Content tabs",
      description: "Posts (photos + reels) · sirf Reels · Tagged (jahan aap dikh rahe ho).",
      side: "bottom",
    },
    {
      element: '.me-top-icon[aria-label="Menu"], .me-top-actions button:last-of-type',
      title: "☰ Menu drawer",
      description: "Bookings · Wallet · Points · Saved · Theme · Sign out · App tour — sab yahaan.",
      side: "left",
    },
  ],
};

// /influencer/dashboard — 4 steps (creator hub)
const INFLUENCER_STEPS: LocalisedSteps = {
  en: [
    {
      element: ".card-luxury.sb-card-lift.sb-fade-in",
      title: "👑 Your tier",
      description: "Tier 1-5 based on bookings driven. Higher tier = bigger commission slab.",
      side: "bottom",
    },
    {
      element: ".grid.grid-cols-2.md\\:grid-cols-4",
      title: "📊 KPI grid",
      description: "Bookings driven · pending payout · GMV · followers. Updated in real-time.",
      side: "bottom",
    },
    {
      element: 'h3, [class*="KYC"]',
      title: "🛡 KYC progress",
      description: "Complete Aadhaar + PAN + bank verification to unlock payouts.",
      side: "top",
    },
    {
      element: ".card-luxury",
      title: "💰 Recent commissions",
      description: "Every approved commission with hotel · date · attribution source.",
      side: "top",
    },
  ],
  hi: [
    {
      element: ".card-luxury.sb-card-lift.sb-fade-in",
      title: "👑 Aapka tier",
      description: "Bookings driven ke hisaab se Tier 1-5. Higher tier = bigger commission slab.",
      side: "bottom",
    },
    {
      element: ".grid.grid-cols-2.md\\:grid-cols-4",
      title: "📊 KPI grid",
      description: "Bookings driven · pending payout · GMV · followers. Real-time update.",
      side: "bottom",
    },
    {
      element: 'h3, [class*="KYC"]',
      title: "🛡 KYC progress",
      description: "Aadhaar + PAN + bank verify karo payouts unlock karne ke liye.",
      side: "top",
    },
    {
      element: ".card-luxury",
      title: "💰 Recent commissions",
      description: "Har approved commission — hotel · date · attribution source ke saath.",
      side: "top",
    },
  ],
};

// /verification — 2 steps
const VERIFY_STEPS: LocalisedSteps = {
  en: [
    {
      element: ".card-luxury.sb-card-lift",
      title: "🎥 Stay verification",
      description: "Record a short video of your room — hotels prove what they promised.",
      side: "bottom",
    },
    {
      element: ".btn-luxury",
      title: "Request video",
      description: "After check-in, hotel sends you a verification link. Pre-stay video also visible.",
      side: "top",
    },
  ],
  hi: [
    {
      element: ".card-luxury.sb-card-lift",
      title: "🎥 Stay verification",
      description: "Apne room ka short video record karo — hotel ne jo promise kiya wo prove karega.",
      side: "bottom",
    },
    {
      element: ".btn-luxury",
      title: "Request video",
      description: "Check-in ke baad hotel verification link bhejega. Pre-stay video bhi dikhega.",
      side: "top",
    },
  ],
};

// /complaints — 3 steps
const COMPLAINTS_STEPS: LocalisedSteps = {
  en: [
    {
      element: ".btn-luxury.sb-shimmer",
      title: "+ New complaint",
      description: "Raise issues about bookings · payments · hotel service. Team responds in 24h.",
      side: "left",
    },
    {
      element: ".card-luxury.sb-card-lift.sb-fade-in",
      title: "🚀 Faster routes",
      description: "Bid issue? Check My Bids. Booking? Open the booking. Room mismatch? Record video.",
      side: "top",
    },
    {
      element: ".card-luxury",
      title: "📜 Your complaints",
      description: "See status of past complaints + admin replies. Auto-refund triggers on resolution.",
      side: "top",
    },
  ],
  hi: [
    {
      element: ".btn-luxury.sb-shimmer",
      title: "+ Nayi complaint",
      description: "Bookings · payments · hotel service ki issues raise karo. 24h mein team respond karegi.",
      side: "left",
    },
    {
      element: ".card-luxury.sb-card-lift.sb-fade-in",
      title: "🚀 Faster routes",
      description: "Bid issue? My Bids dekho. Booking? Booking khol ke. Room mismatch? Video record karo.",
      side: "top",
    },
    {
      element: ".card-luxury",
      title: "📜 Aapki complaints",
      description: "Past complaints ke status + admin replies. Resolve hote hi auto-refund.",
      side: "top",
    },
  ],
};

// ── v143 — Modal / drawer tours (imperative triggerTour only) ────────

// Negotiate modal on /hotels/[id] — 4 steps. Triggered from openNegotiate().
const NEGOTIATE_STEPS: LocalisedSteps = {
  en: [
    {
      element: '[data-tour="neg-prob"]',
      title: "🎯 Acceptance probability",
      description: "Live AI probability that the hotel will accept your bid — updates as you slide.",
      side: "bottom",
    },
    {
      element: '[data-tour="neg-slider"]',
      title: "↔ Drag to set price",
      description: "Snap to ₹100 multiples. Lower bid = bigger savings · higher bid = faster confirm.",
      side: "top",
    },
    {
      element: '[data-tour="neg-info"]',
      title: "🤖 Live AI insights",
      description: "Recent accepted prices · viewers now · stay-points you'll earn — all real-time.",
      side: "top",
    },
    {
      element: '[data-tour="neg-submit"]',
      title: "🚀 Submit bid",
      description: "Bid above floor → instant Razorpay charge. Below floor → hotel reviews + may counter.",
      side: "top",
    },
  ],
  hi: [
    {
      element: '[data-tour="neg-prob"]',
      title: "🎯 Acceptance probability",
      description: "Live AI bata raha hai hotel apki bid accept karega ya nahi — slider ke saath update hota hai.",
      side: "bottom",
    },
    {
      element: '[data-tour="neg-slider"]',
      title: "↔ Slider se price set karo",
      description: "₹100 ke multiples mein snap. Kam bid = zyada bachat · zyada bid = jaldi confirm.",
      side: "top",
    },
    {
      element: '[data-tour="neg-info"]',
      title: "🤖 Live AI insights",
      description: "Recent accepted prices · abhi kitne viewers · kitne stay-points milenge — real-time.",
      side: "top",
    },
    {
      element: '[data-tour="neg-submit"]',
      title: "🚀 Submit bid",
      description: "Floor se upar → instant Razorpay charge. Niche → hotel review karega + counter de sakta hai.",
      side: "top",
    },
  ],
};

// Booking Review modal — 3 steps. Triggered from BookingReview onMount.
// Renders identically across /hotels/[id], /my-bids, /bookings.
const BOOKING_REVIEW_STEPS: LocalisedSteps = {
  en: [
    {
      element: '[data-tour="br-pay"]',
      title: "✨ Pay Full",
      description: "Charged instantly via Razorpay. Booking confirmed in 30 seconds. StayPoints credited after check-out.",
      side: "top",
    },
    {
      element: '[data-tour="br-hold"]',
      title: "🔒 Hold for 24h",
      description: "Pay a small ₹ hold to lock today's price for 24 hours. Settle the balance whenever you're ready.",
      side: "top",
    },
    {
      element: '[data-tour="br-payhotel"]',
      title: "🏨 Pay at Hotel",
      description: "Online hold today, balance at the front desk on check-in. Hotel keeps your slot reserved.",
      side: "top",
    },
  ],
  hi: [
    {
      element: '[data-tour="br-pay"]',
      title: "✨ Pay Full",
      description: "Razorpay se instant charge. 30 second mein booking confirm. Check-out ke baad StayPoints milenge.",
      side: "top",
    },
    {
      element: '[data-tour="br-hold"]',
      title: "🔒 Hold for 24h",
      description: "Chhota sa ₹ hold pay karo, aaj ki price 24 ghante lock. Baad mein balance settle karo.",
      side: "top",
    },
    {
      element: '[data-tour="br-payhotel"]',
      title: "🏨 Pay at Hotel",
      description: "Online hold aaj, balance check-in pe hotel ke desk pe. Slot reserved rahega.",
      side: "top",
    },
  ],
};

// Flash Deal drawer on /flash-deals — 3 steps. Triggered from openId set.
const FLASH_DRAWER_STEPS: LocalisedSteps = {
  en: [
    {
      element: ".fd-drawer-rooms",
      title: "🛏 Choose your room",
      description: "Multiple room types at this hotel? Pick the one you want. Sold-out rooms are dimmed.",
      side: "top",
    },
    {
      element: ".fd-drawer-rules",
      title: "📜 How this deal works",
      description: "Fixed flash price · no bidding · limited slots · midnight cut-off. Confirmation in 30 seconds.",
      side: "top",
    },
    {
      element: ".fd-drawer-cta",
      title: "⚡ Grab this stay",
      description: "Razorpay opens · pay · slot is yours. Cheapest guaranteed across all OTAs.",
      side: "top",
    },
  ],
  hi: [
    {
      element: ".fd-drawer-rooms",
      title: "🛏 Apna room chuno",
      description: "Multiple room types hain? Apni pasand chuno. Sold-out rooms dim ho jate hain.",
      side: "top",
    },
    {
      element: ".fd-drawer-rules",
      title: "📜 Yeh deal kaise kaam karta hai",
      description: "Fixed flash price · bidding nahi · limited slots · midnight cut-off. 30 sec mein confirm.",
      side: "top",
    },
    {
      element: ".fd-drawer-cta",
      title: "⚡ Yeh stay grab karo",
      description: "Razorpay khulega · pay karo · slot apka. Sab OTA se sasta guaranteed.",
      side: "top",
    },
  ],
};

export const PAGE_TOURS: Record<string, LocalisedSteps> = {
  home: HOME_STEPS,
  hotel: HOTEL_STEPS,
  bid: BID_STEPS,
  flash: FLASH_STEPS,
  earn: EARN_STEPS,
  // v141 — booking funnel completion
  explore: EXPLORE_STEPS,
  mybids: MYBIDS_STEPS,
  bookings: BOOKINGS_STEPS,
  // v142 — account + creator hub + support
  wallet: WALLET_STEPS,
  points: POINTS_STEPS,
  saved: SAVED_STEPS,
  me: ME_STEPS,
  influencer: INFLUENCER_STEPS,
  verify: VERIFY_STEPS,
  complaints: COMPLAINTS_STEPS,
  // v143 — modal/drawer tours (imperative triggerTour only)
  negotiate: NEGOTIATE_STEPS,
  bookingReview: BOOKING_REVIEW_STEPS,
  flashDrawer: FLASH_DRAWER_STEPS,
};

/** Hook helper — returns the steps array for the given key + current language. */
export function useLocalisedSteps(key: string, lang: "en" | "hi"): TourStep[] | null {
  const bucket = PAGE_TOURS[key];
  if (!bucket) return null;
  return bucket[lang] || bucket.en || null;
}
