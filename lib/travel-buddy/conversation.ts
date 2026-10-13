// ─────────────────────────────────────────────────────────────────────────
// StayBid Travel Buddy — SCREEN-FIRST UX PREVIEW (offline candidate 01).
//
// PURE, deterministic conversation core for the screen-first Travel Buddy
// presentation. It is an INTERNAL SIMULATION: a bounded keyword/pattern parser
// (Hindi / Hinglish / English), NOT a language model and NOT a provider. It:
//   • parses ONE guest utterance into bounded, typed slots;
//   • plans the turn as a short list of steps whose ONLY effects are
//       - typed Live-AI operations (validated by lib/live-ai/contracts
//         validateOperation, executed by the existing runtime envelope path), or
//       - ONE safe navigation from the Stage home to the existing /hotels route
//         for an ALLOW-LISTED city (no free-form URL ever leaves this module);
//   • formats short, grounded captions from the page's OWN validated data.
//
// It never books, bids, pays, holds, messages or writes anything: those
// requests produce guidance captions only. Dates / guests / unsupported
// amenities are noted in ephemeral slots and HONESTLY reported as not applied.
// No I/O, no React, no DOM, no network, no storage. Imports only contracts.
// ─────────────────────────────────────────────────────────────────────────
import {
  canonicalCity,
  validateOperation,
  type LiveAiOperation,
  type HotelSection,
  type VisibleHotelSummary,
  type FacilityFact,
} from "../live-ai/contracts";

// ---- gate: presentation preview ONLY, never provider enablement ------------
export const TRAVEL_BUDDY_FLAG = "NEXT_PUBLIC_TRAVEL_BUDDY_UX_PREVIEW";

/**
 * The Travel Buddy presentation mounts ONLY when ALL hold:
 *   • the existing Live-AI visibility gate V is on (runtime exists),
 *   • the provider gate P is OFF (no gateway transport / microphone provider),
 *   • the dedicated preview flag is exactly "1".
 * Fail-closed: anything else ⇒ false (the existing orb / nothing renders as today).
 */
export function resolveTravelBuddyGate(
  liveAiEnabled: boolean,
  providerEnabled: boolean,
  flag: string | undefined = process.env.NEXT_PUBLIC_TRAVEL_BUDDY_UX_PREVIEW,
): boolean {
  return liveAiEnabled === true && providerEnabled !== true && flag === "1";
}

// ---- surfaces ---------------------------------------------------------------
export type BuddySurface = "home" | "hotels" | "hotel-detail" | "other";

/** Map a pathname to the ONLY surfaces Travel Buddy may appear on. */
export function surfaceForPath(pathname: string | null | undefined): BuddySurface {
  const p = (pathname || "").split("?")[0].split("#")[0];
  if (p === "/") return "home";
  if (p === "/hotels") return "hotels";
  if (/^\/hotels\/[^/]+\/?$/.test(p)) return "hotel-detail";
  return "other";
}

// ---- language ---------------------------------------------------------------
export type BuddyLang = "hinglish" | "en";

const HINGLISH_MARKERS = /\b(hai|hain|ho|kar|karo|kardo|kar do|dikhao|dikha|batao|chahiye|chaahiye|jana|jaana|mein|me|ke|ka|ki|ko|kya|nahi|nahin|aur|wala|wali|andar|tak|se|kitna|kitne|kab|log|raat|ghumne|ghoomne|pahad|doosra|dusra|pehla|teesra|zaroor|accha|achha|haan|ji|namaste|bhai|thik|theek)\b/i;
const DEVANAGARI = /[ऀ-ॿ]/;

export function detectLang(text: string, previous: BuddyLang = "hinglish"): BuddyLang {
  const t = (text || "").trim();
  if (!t) return previous;
  if (DEVANAGARI.test(t) || HINGLISH_MARKERS.test(t)) return "hinglish";
  if (/[a-z]/i.test(t)) return "en";
  return previous;
}

// ---- normalization ----------------------------------------------------------
const DEVANAGARI_DIGITS: Record<string, string> = {
  "०": "0", "१": "1", "२": "2", "३": "3", "४": "4", "५": "5", "६": "6", "७": "7", "८": "8", "९": "9",
};
// Common Devanagari words → the Latin keyword the parser understands.
const DEVANAGARI_WORDS: Array<[RegExp, string]> = [
  [/मसूरी/g, " mussoorie "], [/देहरादून/g, " dehradun "], [/धनौल्टी|धनोल्टी/g, " dhanaulti "],
  [/ऋषिकेश|रिशिकेश/g, " rishikesh "], [/नैनीताल/g, " nainital "], [/शिमला/g, " shimla "],
  [/मनाली/g, " manali "], [/गोवा/g, " goa "], [/जयपुर/g, " jaipur "], [/उदयपुर/g, " udaipur "],
  [/हरिद्वार/g, " haridwar "], [/कसौली/g, " kasauli "], [/लैंसडाउन/g, " lansdowne "],
  [/होटल/g, " hotel "], [/दिखाओ|दिखा दो/g, " dikhao "], [/पार्किंग/g, " parking "],
  [/नाश्ता/g, " breakfast "], [/बजट/g, " budget "], [/हज़ार|हजार/g, " hazaar "],
  [/दूसरा|दूसरे/g, " doosra "], [/पहला|पहले/g, " pehla "], [/तीसरा/g, " teesra "],
  [/कमरे|कमरा/g, " rooms "], [/बुकिंग|बुक/g, " booking "], [/भुगतान|पेमेंट/g, " payment "],
  [/रुको|बस करो|बंद करो/g, " stop "], [/नमस्ते/g, " namaste "], [/के अंदर|से कम/g, " under "],
  [/परिवार|फैमिली/g, " family "], [/रात/g, " raat "], [/लोग/g, " log "], [/तुलना/g, " compare "],
  [/पहाड़/g, " pahad "], [/हाँ|हां/g, " haan "], [/है/g, " hai "], [/चाहिए/g, " chahiye "],
  [/एक/g, " ek "], [/दो/g, " do "], [/तीन/g, " teen "], [/चार/g, " char "], [/पांच|पाँच/g, " paanch "],
  [/छह|छः/g, " chhe "], [/सात/g, " saat "], [/आठ/g, " aath "], [/नौ/g, " nau "], [/दस/g, " das "],
  [/तक/g, " tak "], [/कम/g, " kam "], [/कितने/g, " kitne "],
];

export function normalizeUtterance(raw: string): string {
  let t = String(raw || "").slice(0, 300);
  t = t.replace(/[०-९]/g, (d) => DEVANAGARI_DIGITS[d] || d);
  for (const [re, rep] of DEVANAGARI_WORDS) t = t.replace(re, rep);
  t = t.replace(/[“”"’']/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  return t;
}

// ---- number words -----------------------------------------------------------
const WORD_UNITS: Record<string, number> = {
  ek: 1, one: 1, do: 2, two: 2, teen: 3, three: 3, char: 4, chaar: 4, four: 4, paanch: 5, panch: 5,
  five: 5, chhe: 6, chha: 6, six: 6, saat: 7, seven: 7, aath: 8, eight: 8, nau: 9, nine: 9, das: 10, dus: 10, ten: 10,
};
const WORD_SCALES: Record<string, number> = { sau: 100, hundred: 100, hazaar: 1000, hazar: 1000, thousand: 1000 };

function wordNumberAfterCue(t: string): number | null {
  const tokens = t.split(/\s+/);
  let total = 0, current = 0, seen = false;
  for (const tok of tokens) {
    if (tok in WORD_UNITS) { current += WORD_UNITS[tok]; seen = true; continue; }
    if (tok in WORD_SCALES) { current = (current || 1) * WORD_SCALES[tok]; total += current; current = 0; seen = true; continue; }
    if (seen) break;
  }
  const n = total + current;
  return seen && n >= 100 ? n : null;
}

const BUDGET_CUE = /\b(under|below|budget|upto|up to|within|max|maximum|andar|tak|se kam|kam|less than|per night|\/night|rs|inr|₹)\b|₹/i;

/** A bounded per-night budget (₹100 … ₹10,00,000) only when a budget cue is present. */
export function parseBudget(t: string): number | null {
  if (!BUDGET_CUE.test(t)) return null;
  const k = t.match(/(\d+(?:\.\d+)?)\s*k\b/);
  let n: number | null = null;
  if (k) n = Math.round(parseFloat(k[1]) * 1000);
  if (n == null) {
    const m = t.replace(/(\d),(\d)/g, "$1$2").match(/(?:₹|rs\.?\s*)?(\d{3,7})\b/);
    if (m) n = Number(m[1]);
  }
  if (n == null) {
    const idx = t.search(BUDGET_CUE);
    n = wordNumberAfterCue(t.slice(Math.max(0, idx))) ?? wordNumberAfterCue(t);
  }
  if (n == null || !Number.isFinite(n) || n < 100 || n > 1_000_000) return null;
  return Math.round(n);
}

// ---- parsed utterance -------------------------------------------------------
export interface ParsedUtterance {
  lang: BuddyLang;
  text: string;
  stop: boolean;
  greeting: boolean;
  help: boolean;
  booking: boolean;
  city: string | null;            // canonical lowercase, from the supplied allow-list only
  maxPrice: number | null;
  parking: boolean;               // parking mentioned (list: requirement)
  question: boolean;
  factTopic: "breakfast" | "parking" | null; // breakfast/parking mentioned (fact on detail, filter wish on list)
  unsupported: string[];          // filters the existing app cannot apply (honestly reported)
  dates: string | null;           // noted only
  nights: number | null;          // noted only
  guests: number | null;          // noted only
  family: boolean;                // noted only
  open: number | null;            // 1-based visible position to open
  section: HotelSection | null;
  compare: boolean;
  results: boolean;
  inspiration: "mountains" | "beach" | "spiritual" | "heritage" | null;
}

const MONTHS = "jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december";
const UNSUPPORTED_FILTERS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(valley|mountain|hill|lake|river)\s*view\b/, label: "view" },
  { re: /\b(sea|beach|ocean)\s*view\b/, label: "view" },
  { re: /\b(pool|swimming)\b/, label: "pool" },
  { re: /\bspa\b/, label: "spa" },
  { re: /\b(wifi|wi-fi|internet)\b/, label: "wifi" },
  { re: /\b(pet|pets|dog)\b/, label: "pet-friendly" },
  { re: /\b(balcony|fireplace|bonfire)\b/, label: "room feature" },
];

function ordinalOf(t: string): number | null {
  if (/\b(pehla|pehle|first|1st|number 1|option 1)\b/.test(t)) return 1;
  if (/\b(doosra|dusra|doosre|dusre|second|2nd|number 2|option 2)\b/.test(t)) return 2;
  if (/\b(teesra|tisra|third|3rd|number 3|option 3)\b/.test(t)) return 3;
  if (/\b(chautha|fourth|4th|number 4|option 4)\b/.test(t)) return 4;
  const m = t.match(/\b(?:option|number|hotel|#)\s*(\d{1,2})\b/);
  if (m) { const n = Number(m[1]); if (n >= 1 && n <= 24) return n; }
  return null;
}

/**
 * PURE parse. `cities` is the caller-supplied allow-list of canonical lowercase
 * destination names (the app's own launch-zone list); nothing outside it can
 * become a destination.
 */
export function parseUtterance(raw: string, cities: readonly string[], previous: BuddyLang = "hinglish"): ParsedUtterance {
  const lang = detectLang(raw, previous);
  const t = normalizeUtterance(raw);
  const question = /\?|\b(kya|hai kya|hain kya|does|is there|do they|include|milega|milta)\b/.test(t) || /\bhai\s*$/.test(t);

  let city: string | null = null;
  const sorted = Array.from(cities).sort((a, b) => b.length - a.length);
  for (const c of sorted) {
    const cc = canonicalCity(c);
    if (!cc) continue;
    const re = new RegExp(`\\b${cc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (re.test(t)) { city = cc; break; }
  }

  const booking = /\b(book|booking|reserve|reservation|bid|bidding|pay|payment|checkout|confirm|offer laga|order)\b/.test(t);
  const breakfastWord = /\b(breakfast|nashta)\b/.test(t);
  const parkingWord = /\b(parking|car park|gaadi)\b/.test(t);
  // A breakfast/parking mention is a FACT question on a hotel page and a filter wish on a list;
  // the planner decides by surface (breakfast is never a supported list filter).
  const factTopic: ParsedUtterance["factTopic"] = breakfastWord ? "breakfast" : parkingWord ? "parking" : null;

  const unsupported: string[] = [];
  for (const u of UNSUPPORTED_FILTERS) if (u.re.test(t) && !unsupported.includes(u.label)) unsupported.push(u.label);

  const dateM = t.match(new RegExp(`\\b(\\d{1,2})\\s*(${MONTHS})\\b|\\b(${MONTHS})\\s*(\\d{1,2})\\b|\\b(today|tomorrow|aaj|kal|weekend|next week|agle hafte|parso)\\b`));
  const nightsM = t.match(/\b(\d{1,2}|ek|do|teen|char|chaar|paanch|one|two|three|four|five)\s*(nights?|raat|raatein|din|days?)\b/);
  const guestsM = t.match(/\b(\d{1,2}|do|teen|char|chaar|paanch|two|three|four|five|six)\s*(log|people|persons?|guests?|adults?|members?)\b/);
  const toN = (s: string) => (/^\d+$/.test(s) ? Number(s) : WORD_UNITS[s] ?? null);

  let section: HotelSection | null = null;
  if (/\b(rooms?|kamre|room types?|price list|rates?)\b/.test(t)) section = "rooms";
  else if (/\b(about|amenities|facilities|suvidha|location|details? section)\b/.test(t)) section = "about";

  const openCue = /\b(dikhao|dikha|show|open|kholo|khol|details?|batao|dekhna|dekhao|see)\b/.test(t);
  const ord = ordinalOf(t);

  let inspiration: ParsedUtterance["inspiration"] = null;
  if (/\b(pahad|pahadon|mountains?|hills?|snow|barf)\b/.test(t)) inspiration = "mountains";
  else if (/\b(beach|samundar|sea|coast)\b/.test(t) && !/\bview\b/.test(t)) inspiration = "beach";
  else if (/\b(spiritual|mandir|temple|ganga|teerth|dharmik)\b/.test(t)) inspiration = "spiritual";
  else if (/\b(fort|palace|heritage|royal|kila|mahal)\b/.test(t)) inspiration = "heritage";

  return {
    lang,
    text: t,
    stop: /^(stop|ruko|bas|band karo|chup|quiet|cancel|end|bye|alvida)\b/.test(t) || /\b(stop talking|band kar do|bas karo)\b/.test(t),
    greeting: /^(hi|hello|hey|namaste|namaskar|hii)\b/.test(t) && t.split(" ").length <= 3,
    help: /\b(help|madad|kya kar sakte|what can you do|kaise use|how does this work)\b/.test(t),
    booking,
    city,
    maxPrice: parseBudget(t),
    parking: parkingWord,
    question,
    factTopic,
    unsupported,
    dates: dateM ? dateM[0] : null,
    nights: nightsM ? toN(nightsM[1]) : null,
    guests: guestsM ? toN(guestsM[1]) : null,
    family: /\b(family|parivar|bachche|kids|children)\b/.test(t),
    open: ord != null && (openCue || /\b(option|hotel)\b/.test(t)) ? ord : null,
    section,
    compare: /\b(compare|comparison|tulna|dono|both|top ?2|top two|vs|versus|behtar kaun|which is better)\b/.test(t),
    results: /\b(kitne|how many|what.?s on screen|kya dikh raha|results?)\b/.test(t),
    inspiration,
  };
}

// ---- ephemeral conversational slots ----------------------------------------
export interface BuddySlots {
  city: string | null;
  maxPrice: number | null;
  parking: boolean;
  dates: string | null;
  nights: number | null;
  guests: number | null;
  family: boolean;
  asked: string[]; // which follow-up questions were already asked (never repeat)
}

export function emptySlots(): BuddySlots {
  return { city: null, maxPrice: null, parking: false, dates: null, nights: null, guests: null, family: false, asked: [] };
}

// ---- page context the planner may read (from the runtime's own snapshot) ---
export interface PlannerContext {
  surface: BuddySurface;
  /** hotels list: current destination / dims (from the authoritative snapshot). */
  listDestination: string | null;
  listMaxPrice: number | null;
  listParking: boolean;
  listReady: boolean;
  visibleCount: number;
  /** hotel detail: validated + loaded. */
  detailValidated: boolean;
}

// ---- plan -------------------------------------------------------------------
export type PlanStep =
  | { kind: "say"; text: string }
  | { kind: "navigate_hotels"; city: string }               // home → /hotels?city=<allow-listed>
  | { kind: "op"; op: LiveAiOperation; purpose: "refine" | "results" | "compare" | "open" | "facts" | "section" }
  | { kind: "end" };

export interface TurnPlan {
  steps: PlanStep[];
  /** dims to apply AFTER a home→/hotels navigation once the list is ready (typed op). */
  deferred: { maxPrice?: number; parking?: boolean } | null;
  slots: BuddySlots;
  lang: BuddyLang;
  /** the one next question (spoken after the steps' outcomes), or null. */
  followUp: string | null;
  /** fact topic requested (for formatting the facts result). */
  factTopic: "breakfast" | "parking" | null;
}

function op(x: unknown): LiveAiOperation | null {
  return validateOperation(x); // every planned operation passes the SAME closed validator
}

function titleCase(c: string): string {
  return c.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

export function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

const L = (lang: BuddyLang, hi: string, en: string) => (lang === "en" ? en : hi);

export function greetingFor(surface: BuddySurface, lang: BuddyLang = "hinglish"): string {
  if (surface === "hotel-detail") {
    return L(lang,
      "Namaste! Main StayBid Travel Buddy hoon. Is stay ke rooms ya facilities ke baare mein poochiye.",
      "Hi! I'm your StayBid Travel Buddy. Ask me about this stay's rooms or facilities.");
  }
  if (surface === "hotels") {
    return L(lang,
      "Namaste! Main StayBid Travel Buddy hoon. Kahan ghoomne ka plan hai, aur budget kitna?",
      "Hi! I'm your StayBid Travel Buddy. Where would you like to go, and what's your budget?");
  }
  return L(lang,
    "Namaste! Main StayBid Travel Buddy hoon. Aap kahan ghoomne ka plan bana rahe hain?",
    "Hi! I'm your StayBid Travel Buddy. Where are you planning to travel?");
}

/** The ONE gentle post-activation follow-up after silence (then quiet standby). */
export function silenceFollowUp(surface: BuddySurface, slots: BuddySlots, lang: BuddyLang): string {
  if (surface === "hotel-detail") return L(lang, "Rooms aur price dekhne hain? Bas \"rooms dikhao\" boliye.", "Want to see rooms and prices? Just say \"show rooms\".");
  if (!slots.city) return L(lang, "Pahad, beach ya quiet weekend? Ek jagah ka naam boliye ya type kariye.", "Mountains, beach or a quiet weekend? Say or type a place.");
  if (slots.maxPrice == null) return L(lang, "Per night budget bata dein toh options aur saaf ho jayenge.", "Tell me a per-night budget and I'll narrow the options.");
  return L(lang, "Kisi option ko kholna ho toh \"doosra option dikhao\" boliye.", "To open one, say \"show the second option\".");
}

export const BOOKING_GUIDANCE = {
  hinglish: "Main booking, bid ya payment khud submit nahi karta. Hotel page par \"Check availability\" ya \"Bid\" aap khud tap karke steps follow kar sakte hain.",
  en: "I never submit a booking, bid or payment myself. On the hotel page you can tap \"Check availability\" or \"Bid\" and follow the steps yourself.",
} as const;

export const PREVIEW_LIMITS = {
  hinglish: "Yeh scripted preview hai: main destination, budget, parking, hotel kholna, rooms aur breakfast/parking sawal samajhta hoon.",
  en: "This is a scripted preview: I understand destination, budget, parking, opening a hotel, rooms and breakfast/parking questions.",
} as const;

function nextQuestion(s: BuddySlots, surface: BuddySurface, lang: BuddyLang): { key: string; text: string } | null {
  if (surface === "hotel-detail") return null;
  if (!s.city && !s.asked.includes("city")) return { key: "city", text: L(lang, "Kahan jaana chahte hain?", "Where would you like to go?") };
  if (s.city && s.maxPrice == null && !s.asked.includes("budget")) return { key: "budget", text: L(lang, "Per night budget kitna rakhna hai?", "What per-night budget should I keep?") };
  if (s.city && !s.parking && !s.asked.includes("priority")) return { key: "priority", text: L(lang, "Parking jaisi koi zaroori cheez chahiye?", "Anything essential, like parking?") };
  if (s.city && !s.asked.includes("open")) return { key: "open", text: L(lang, "Kisi option ko kholna ho toh bas uska number boliye.", "To open an option, just say its number.") };
  return null;
}

const INSPIRATION_CITIES: Record<NonNullable<ParsedUtterance["inspiration"]>, string[]> = {
  mountains: ["mussoorie", "manali", "shimla", "nainital"],
  beach: ["goa"],
  spiritual: ["rishikesh", "haridwar", "varanasi"],
  heritage: ["jaipur", "udaipur", "jaisalmer"],
};

/**
 * PURE turn planner. Produces only typed operations (validated), at most one
 * allow-listed navigation, and grounded/honest captions.
 */
export function planTurn(p: ParsedUtterance, ctx: PlannerContext, prev: BuddySlots, cities: readonly string[]): TurnPlan {
  const lang = p.lang;
  const slots: BuddySlots = { ...prev, asked: prev.asked.slice() };
  const steps: PlanStep[] = [];
  let deferred: TurnPlan["deferred"] = null;
  const say = (hi: string, en: string) => steps.push({ kind: "say", text: L(lang, hi, en) });

  if (p.stop) {
    steps.push({ kind: "say", text: L(lang, "Theek hai, main ruk jaata hoon. Jab chahein phir tap kariye.", "Okay, I'll stop. Tap again whenever you like.") });
    steps.push({ kind: "end" });
    return { steps, deferred, slots, lang, followUp: null, factTopic: null };
  }

  // Booking / bid / payment — guidance ONLY, never a write (highest guard).
  if (p.booking) {
    steps.push({ kind: "say", text: BOOKING_GUIDANCE[lang] });
    if (ctx.surface === "hotel-detail" && ctx.detailValidated) {
      const o = op({ op: "SHOW_HOTEL_SECTION", section: "rooms" });
      if (o) steps.push({ kind: "op", op: o, purpose: "section" });
    }
    return { steps, deferred, slots, lang, followUp: null, factTopic: null };
  }

  // Noted-only slots (never applied as availability).
  const noted: string[] = [];
  if (p.dates) { slots.dates = p.dates; noted.push(p.dates); }
  if (p.nights) { slots.nights = p.nights; noted.push(L(lang, `${p.nights} raat`, `${p.nights} night${p.nights === 1 ? "" : "s"}`)); }
  if (p.guests) { slots.guests = p.guests; noted.push(L(lang, `${p.guests} log`, `${p.guests} guests`)); }
  if (p.family) slots.family = true;

  // The page's OWN current state is context too: never re-ask what the screen already shows.
  if (ctx.surface === "hotels") {
    if (!slots.city && ctx.listDestination) slots.city = ctx.listDestination;
    if (slots.maxPrice == null && ctx.listMaxPrice != null) slots.maxPrice = ctx.listMaxPrice;
    if (!slots.parking && ctx.listParking) slots.parking = true;
  }
  const knownCity = p.city && cities.map((c) => canonicalCity(c)).includes(p.city) ? p.city : null;
  if (knownCity) slots.city = knownCity;
  if (p.maxPrice != null) slots.maxPrice = p.maxPrice;
  if (p.parking && ctx.surface !== "hotel-detail") slots.parking = true;

  // Honest limitations FIRST — said before any action, never silently pretended.
  if (ctx.surface !== "hotel-detail" && p.factTopic === "breakfast") {
    say("Breakfast ka filter list mein nahi hai — hotel kholkar poochiye, main uski listing se bataunga.",
        "The list has no breakfast filter — open a hotel and ask, I'll read its listing.");
  }
  if (p.unsupported.length) {
    const label = p.unsupported.join(", ");
    say(`"${label}" ka filter abhi app mein nahi hai, isliye use apply nahi kar raha.`,
        `The app has no "${label}" filter yet, so I'm not applying it.`);
  }
  if (noted.length) {
    say(`${noted.join(", ")} note kar liya. Dates se availability main abhi check nahi karta — dates aap rooms page par khud chunein.`,
        `Noted ${noted.join(", ")}. I don't check availability by date yet — please pick dates on the rooms page yourself.`);
  }

  // Detail-page questions first (grounded facts from the validated detail snapshot).
  if (ctx.surface === "hotel-detail") {
    if (p.factTopic) {
      const o = op({ op: "READ_CURRENT_HOTEL_FACTS" });
      if (o) steps.push({ kind: "op", op: o, purpose: "facts" });
    } else if (p.section) {
      const o = op({ op: "SHOW_HOTEL_SECTION", section: p.section });
      if (o) steps.push({ kind: "op", op: o, purpose: "section" });
    } else if (knownCity) {
      say(`${titleCase(knownCity)} ke stays ke liye neeche Explore tab kholiye — yeh page abhi is hotel ka hai.`,
          `For stays in ${titleCase(knownCity)}, open the Explore tab below — this page is about the current hotel.`);
    } else if (p.greeting || p.help) {
      steps.push({ kind: "say", text: PREVIEW_LIMITS[lang] });
    } else if (!noted.length && !p.unsupported.length) {
      say("Is hotel ke rooms, breakfast ya parking ke baare mein poochiye.", "Ask me about this hotel's rooms, breakfast or parking.");
    }
  } else {
    // Home / hotels list.
    if (p.greeting && !knownCity && p.maxPrice == null && !p.parking) {
      say("Namaste! Bataiye kahan ghoomne jaana hai?", "Hello! Where would you like to go?");
    }
    if (p.help) steps.push({ kind: "say", text: PREVIEW_LIMITS[lang] });

    if (!knownCity && p.inspiration && !slots.city) {
      const ideas = INSPIRATION_CITIES[p.inspiration].filter((c) => cities.includes(c)).slice(0, 3).map(titleCase);
      if (ideas.length) say(`Accha! Jaise ${ideas.join(", ")}. Inmein se koi naam boliye.`, `Nice! For example ${ideas.join(", ")}. Say one of these.`);
    }

    if (ctx.surface === "home") {
      if (knownCity) {
        say(`Zaroor — ${titleCase(knownCity)} ke stays dikhata hoon.`, `Sure — showing stays in ${titleCase(knownCity)}.`);
        steps.push({ kind: "navigate_hotels", city: knownCity });
        const d: { maxPrice?: number; parking?: boolean } = {};
        if (slots.maxPrice != null) d.maxPrice = slots.maxPrice;
        if (slots.parking) d.parking = true;
        deferred = Object.keys(d).length ? d : null;
      } else if (p.maxPrice != null || p.parking) {
        say("Note kar liya. Pehle bataiye kahan jaana hai?", "Noted. First, where would you like to go?");
      } else if (p.open != null || p.compare) {
        say("Pehle ek destination boliye, phir main options khol sakta hoon.", "Tell me a destination first, then I can open options.");
      }
    }

    if (ctx.surface === "hotels") {
      const refine: Record<string, unknown> = { op: "APPLY_HOTEL_REFINEMENT" };
      if (knownCity && knownCity !== ctx.listDestination) refine.destination = knownCity;
      if (p.maxPrice != null && p.maxPrice !== ctx.listMaxPrice) refine.maxPrice = p.maxPrice;
      if (p.parking && !ctx.listParking) refine.parking = true;
      const touched = Object.keys(refine).length > 1;
      if (touched) {
        const o = op(refine);
        if (o) {
          say(knownCity ? `${titleCase(knownCity)} ke stays laa raha hoon.` : "Aapke hisaab se results update kar raha hoon.",
              knownCity ? `Getting stays in ${titleCase(knownCity)}.` : "Updating the results for you.");
          steps.push({ kind: "op", op: o, purpose: "refine" });
        }
      }
      if (p.compare) {
        const o = op({ op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2], factors: ["price", "rating"] });
        if (o) steps.push({ kind: "op", op: o, purpose: "compare" });
      }
      if (p.open != null) {
        const o = op({ op: "OPEN_VISIBLE_HOTEL", position: p.open });
        if (o) steps.push({ kind: "op", op: o, purpose: "open" });
      }
      if (p.results && !touched && p.open == null && !p.compare) {
        const o = op({ op: "READ_CURRENT_RESULTS" });
        if (o) steps.push({ kind: "op", op: o, purpose: "results" });
      }
    }
  }


  if (!steps.length) {
    say("Maaf kijiye, yeh main abhi nahi samjha. Jaise boliye: \"Mussoorie mein 5000 tak parking wala hotel\".",
        "Sorry, I didn't get that. Try: \"Hotels in Mussoorie under 5000 with parking\".");
  }

  // Exactly ONE next question, never repeated.
  let followUp: string | null = null;
  const willNavigate = steps.some((s) => s.kind === "navigate_hotels");
  const hasAction = steps.some((s) => s.kind === "op");
  if (!willNavigate || deferred == null) {
    const q = nextQuestion(slots, ctx.surface === "home" && willNavigate ? "hotels" : ctx.surface, lang);
    if (q && (hasAction || willNavigate || !knownCity || ctx.surface !== "hotels")) { followUp = q.text; slots.asked.push(q.key); }
  }
  return { steps, deferred, slots, lang, followUp, factTopic: p.factTopic };
}

// ---- grounded outcome captions ---------------------------------------------
export function formatResults(lang: BuddyLang, rows: VisibleHotelSummary[], city: string | null): string {
  const n = rows.length;
  const where = city ? titleCase(city) : "";
  if (!n) {
    return L(lang,
      `${where ? where + " mein " : ""}is filter ke saath abhi koi stay screen par nahi hai. Budget badha kar dekhein?`,
      `No stays${where ? " in " + where : ""} match this filter right now. Try a higher budget?`);
  }
  const prices = rows.map((r) => r.minPrice).filter((x): x is number => typeof x === "number" && x > 0);
  const from = prices.length ? Math.min(...prices) : null;
  const stays = L(lang, n === 1 ? "1 stay" : `${n} stays`, n === 1 ? "1 stay" : `${n} stays`);
  if (from != null) {
    return L(lang,
      `${where ? where + " mein " : ""}${stays} screen par ${n === 1 ? "hai" : "hain"} — ${inr(from)} se shuru.`,
      `${stays} on screen${where ? " in " + where : ""} — from ${inr(from)}.`);
  }
  return L(lang, `${where ? where + " mein " : ""}${stays} screen par ${n === 1 ? "hai" : "hain"}.`, `${stays} on screen${where ? " in " + where : ""}.`);
}

export function formatCompare(
  lang: BuddyLang,
  rows: VisibleHotelSummary[],
  cheapestPosition: number | null,
  topRatedPosition: number | null,
): string {
  if (rows.length < 2) return L(lang, "Compare karne ke liye screen par do stays chahiye.", "I need two stays on screen to compare.");
  const name = (pos: number | null) => rows.find((r) => r.position === pos)?.name || "";
  const parts: string[] = [];
  if (cheapestPosition != null && name(cheapestPosition)) parts.push(L(lang, `sasta: ${name(cheapestPosition)}`, `lower price: ${name(cheapestPosition)}`));
  if (topRatedPosition != null && name(topRatedPosition)) parts.push(L(lang, `behtar rating: ${name(topRatedPosition)}`, `higher rating: ${name(topRatedPosition)}`));
  if (!parts.length) return L(lang, "In dono ka comparable price/rating data poora nahi hai.", "Comparable price/rating data is incomplete for these two.");
  return L(lang, `Top do mein — ${parts.join("; ")}.`, `Of the top two — ${parts.join("; ")}.`);
}

export function formatFact(lang: BuddyLang, topic: "breakfast" | "parking", fact: FacilityFact | null | undefined, hotelName: string | null): string {
  const who = hotelName || L(lang, "is hotel", "this hotel");
  const word = topic === "breakfast" ? L(lang, "breakfast", "breakfast") : "parking";
  if (fact === "present") return L(lang, `${who} ki listing mein ${word} hai.`, `${who} lists ${word}.`);
  if (fact === "absent") return L(lang, `${who} ki listing mein ${word} nahi dikh raha.`, `${who} does not list ${word}.`);
  return L(lang, `${who} ke current data mein ${word} ki pakki jaankari nahi hai.`, `${who}'s current data doesn't confirm ${word}.`);
}

/** Honest caption for a refused typed operation (never a pretend success). */
export function formatRefusal(lang: BuddyLang, status: string): string {
  switch (status) {
    case "not_ready":
      return L(lang, "Results abhi load ho rahe hain — ek pal mein phir boliye.", "Results are still loading — try again in a moment.");
    case "missing_ordinal":
      return L(lang, "Itne options abhi screen par nahi hain.", "There aren't that many options on screen right now.");
    case "unsupported_filter":
      return L(lang, "Is list mein parking filter available nahi hai, isliye apply nahi kiya.", "This list has no parking filter, so I didn't apply it.");
    case "stale_route":
    case "stale_context":
    case "stale_turn":
      return L(lang, "Screen badal gayi thi, isliye purana action cancel kar diya.", "The screen changed, so I cancelled the old action.");
    case "hotel_id_mismatch":
      return L(lang, "Yeh hotel abhi poori tarah load nahi hua.", "This hotel hasn't fully loaded yet.");
    default:
      return L(lang, "Yeh action abhi is screen par nahi ho sakta.", "That action isn't available on this screen.");
  }
}

/** Split a caption into Netflix-style chunks of ≤ maxLen chars at word boundaries. */
export function captionChunks(text: string, maxLen = 84): string[] {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?।]+[.!?।]?/g) || [clean];
  const out: string[] = [];
  for (const raw of sentences) {
    let s = raw.trim();
    while (s.length > maxLen) {
      let cut = s.lastIndexOf(" ", maxLen);
      if (cut < maxLen * 0.5) cut = maxLen;
      out.push(s.slice(0, cut).trim());
      s = s.slice(cut).trim();
    }
    if (s) {
      if (out.length && (out[out.length - 1].length + 1 + s.length) <= maxLen) out[out.length - 1] += " " + s;
      else out.push(s);
    }
  }
  return out;
}

/** Build the ONLY navigation target Travel Buddy may produce: /hotels?city=<Title>. */
export function hotelsHrefFor(city: string, cities: readonly string[]): string | null {
  const c = canonicalCity(city);
  if (!c || !cities.map((x) => canonicalCity(x)).includes(c)) return null;
  return `/hotels?city=${encodeURIComponent(titleCase(c))}`;
}
