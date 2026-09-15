// ─────────────────────────────────────────────────────────────────────────
// StayBid AI — PRESENTATION-DEMO-01 — deterministic text/voice assistant controller.
//
// A bounded, case-based Hinglish/English intent engine for the hidden /voice-demo
// presentation surface. TEXT input → TEXT response. NO provider / OpenAI / model
// call, NO transcription/TTS/mic. Reuses ONLY the existing read-only StayBid
// hotel data (via injected deps that hit /api/hotels and /api/hotels/:id) and the
// existing SB-01 normalizers for data minimization.
//
// SAFETY (by construction):
//   • Never performs or triggers any write: booking / bid / payment / message /
//     availability are answered with a static safe-decline string only.
//   • Destinations are gated by canonicalCity(); hotel ids by isValidHotelId().
//   • compare / details only ever reference hotels in the AUTHORITATIVE currently
//     displayed result set (state.displayed) — never an arbitrary id from user text.
//   • Session memory lives in caller-held state (page/session only) — no storage,
//     no network beyond the two injected read fns.
//
// DEMO-REV-02: ONE authoritative displayed result set. Search establishes it;
//   budget/amenity filters COMPOSE by narrowing the currently displayed set (an
//   excluded hotel never re-enters); a combined utterance applies destination +
//   budget + amenity in the SAME turn; details/compare consume ONLY the displayed
//   set; reset clears it.
// DEMO-REV-04: comparison superlatives are emitted ONLY when both candidates have
//   the comparable value known (price / rating); otherwise a "data incomplete" line.
//
// Pure where possible: parseIntent + all reducers are pure; runTurn is async only
// because the two injected read fns are.
// ─────────────────────────────────────────────────────────────────────────
import {
  canonicalCity,
  isValidHotelId,
  MAX_SEARCH_RESULTS,
  type NormalizedHotel,
  type NormalizedHotelDetails,
} from "@/lib/voice/contracts";

// ---- session memory (page/session only — caller holds it) -------------------
export interface DemoState {
  // baseResults = the full result set the last SEARCH returned (reference only).
  baseResults: NormalizedHotel[];
  // displayed = the AUTHORITATIVE currently displayed result set (after filters).
  displayed: NormalizedHotel[];
  selectedId: string | null;
  topTwoIds: string[];
  lastCity: string | null;
  activeBudget: number | null;
  activeAmenity: string | null;
}

export function initialState(): DemoState {
  return {
    baseResults: [],
    displayed: [],
    selectedId: null,
    topTwoIds: [],
    lastCity: null,
    activeBudget: null,
    activeAmenity: null,
  };
}

// ---- DEMO-REV-03: monotonic turn-ownership gate -----------------------------
// Reset bumps the generation FIRST; any recognition result or async runTurn
// completion captured under an older generation is stale and MUST be discarded
// (no state/UI/speech update). Pure + framework-free so it is directly testable.
export interface TurnGate {
  gen(): number;
  /** invalidate all in-flight work (called first on Reset). */
  bump(): void;
  /** snapshot the current generation at the start of a turn/recognition. */
  capture(): number;
  /** true when a captured token no longer owns the active generation. */
  isStale(token: number): boolean;
}
export function createTurnGate(): TurnGate {
  let g = 0;
  return {
    gen: () => g,
    bump: () => { g += 1; },
    capture: () => g,
    isStale: (token: number) => token !== g,
  };
}

// ---- injected read-only data layer -----------------------------------------
export interface DemoDeps {
  // Reads the existing /api/hotels?city=&q= route and returns NORMALIZED hotels.
  searchHotels(city: string | null, query: string | null): Promise<NormalizedHotel[]>;
  // Reads the existing /api/hotels/:id route and returns NORMALIZED details.
  getHotelDetails(id: string): Promise<NormalizedHotelDetails | null>;
}

// ---- turn output ------------------------------------------------------------
export interface DemoTurn {
  state: DemoState;
  reply: string;
  cards: NormalizedHotel[]; // hotel result cards to render (the displayed set)
  detail: NormalizedHotelDetails | null;
}

// ---- static copy (English + light Hinglish, demo-safe) ----------------------
export const OUT_OF_SCOPE_REPLY =
  "Abhi demo mode mein main hotel search, details aur comparison mein help kar sakta hoon.";
export const BOOKING_DECLINE_REPLY =
  "Demo mode mein main abhi booking ya bid submit nahi karta — main sirf search, details aur comparison dikha sakta hoon.";
const NO_RESULTS_YET =
  "Pehle koi destination search karein — jaise \"Dhanaulti hotels dikhao\".";
const PRICE_DATA_INCOMPLETE =
  "Price comparison ke liye dono hotels ka comparable current price available nahi hai.";
const RATING_DATA_INCOMPLETE =
  "Rating comparison ke liye complete data available nahi hai.";
const FACT_UNAVAILABLE =
  "Is hotel ke current data mein ye information available nahi hai.";

// ---- known destinations (bounded alias match → canonical English city) ------
// Each entry maps real-device SpeechRecognition spelling/script variants (roman
// misspellings + Devanagari) to ONE canonical English city that the hotel API
// understands. Bounded + deterministic — NOT open NLP.
const CITY_ALIASES: Array<{ re: RegExp; canon: string }> = [
  { re: /dhanaulti|dhanolti|dhanoli|dhanolty|dhanaulty|dhanauli|धनौल्टी|धनौली|धनोल्टी|धनौलती/i, canon: "dhanaulti" },
  { re: /mussoorie|masoori|mussorie|मसूरी/i, canon: "mussoorie" },
  { re: /dehradun|देहरादून/i, canon: "dehradun" },
  { re: /rishikesh|hrishikesh|ऋषिकेश|रिशिकेश/i, canon: "rishikesh" },
  { re: /manali|मनाली/i, canon: "manali" },
  { re: /shimla|शिमला/i, canon: "shimla" },
  { re: /nainital|नैनीताल/i, canon: "nainital" },
];

// amenity keywords → canonical amenity label used for filtering
const AMENITY_KEYWORDS: Array<{ re: RegExp; label: string }> = [
  { re: /\bpark(ing)?\b/i, label: "parking" },
  { re: /\b(breakfast|nashta)\b/i, label: "breakfast" },
  { re: /\b(wifi|wi-fi|internet)\b/i, label: "wifi" },
  { re: /\b(pool|swimming)\b/i, label: "pool" },
  { re: /\b(pet|pets)\b/i, label: "pet" },
  { re: /\b(spa)\b/i, label: "spa" },
  { re: /\b(ac|air ?condition(ing)?)\b/i, label: "ac" },
];

function findCity(text: string): string | null {
  for (const c of CITY_ALIASES) {
    if (c.re.test(text)) return canonicalCity(c.canon);
  }
  return null;
}

function findAmenity(text: string): string | null {
  for (const a of AMENITY_KEYWORDS) {
    if (a.re.test(text)) return a.label;
  }
  return null;
}

// Spoken-number words → multipliers/units (English + Hindi/Hinglish).
const WORD_UNITS: Record<string, number> = {
  zero: 0, ek: 1, one: 1, do: 2, two: 2, teen: 3, three: 3, char: 4, chaar: 4, four: 4,
  paanch: 5, panch: 5, five: 5, chha: 6, chhe: 6, cheh: 6, six: 6, saat: 7, seven: 7,
  aath: 8, eight: 8, nau: 9, nine: 9, das: 10, dus: 10, ten: 10,
};
const WORD_SCALES: Record<string, number> = {
  hundred: 100, sau: 100, thousand: 1000, hazaar: 1000, hazar: 1000, k: 1000,
  lakh: 100000, lac: 100000,
};

/** Parse a spoken/word number span into an integer, else null. PURE. */
export function wordsToNumber(text: string): number | null {
  const tokens = text.toLowerCase().replace(/[,]/g, " ").split(/\s+/).filter(Boolean);
  let total = 0;
  let current = 0;
  let sawAny = false;
  for (const tok of tokens) {
    if (tok in WORD_UNITS) { current += WORD_UNITS[tok]; sawAny = true; continue; }
    if (tok in WORD_SCALES) {
      const scale = WORD_SCALES[tok];
      current = (current === 0 ? 1 : current) * scale;
      total += current;
      current = 0;
      sawAny = true;
      continue;
    }
    if (sawAny) break; // bounded — stop at the first non-number word after a run
  }
  const n = total + current;
  if (!sawAny || !Number.isFinite(n) || n <= 0 || n > 100_000_000) return null;
  return n;
}

function findBudget(text: string): number | null {
  const kMatch = text.match(/\b(\d+(?:\.\d+)?)\s*k\b/i);
  if (kMatch) {
    const n = Math.round(parseFloat(kMatch[1]) * 1000);
    if (Number.isFinite(n) && n > 0 && n <= 100_000_000) return n;
  }
  const m = text.match(/\b(\d{3,8})\b/);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0 && n <= 100_000_000) return n;
  }
  return wordsToNumber(text);
}

function hasBudgetCue(text: string): boolean {
  // explicit cue words (English + Hinglish), incl. "tak" (= up to), "ke liye" (= for)
  const hasWord = /\b(under|below|budget|se ?kam|kam|less than|upto|up to|<=?|within|andar|ke andar|tak|ke liye)\b/i.test(text);
  // natural "<amount> wala" forms: "5000 wala", "5k wala", "paanch hazaar wala"
  const hasWala =
    /\d[\d,]*\s*k?\s*(wala|waala|wale|walaa)\b/i.test(text) ||
    /\b(hazaar|hazar|thousand|sau|hundred|lakh|lac)\s+(wala|waala|wale)\b/i.test(text);
  if (!hasWord && !hasWala) return false;
  // a cue only counts as a budget when an actual amount is parseable
  return findBudget(text) != null;
}

// ---- intent model -----------------------------------------------------------
export type DemoIntent =
  | { kind: "search"; city: string | null; budget: number | null; amenity: string | null }
  | { kind: "filter"; budget: number | null; amenity: string | null } // narrow displayed set
  | { kind: "details"; ref: string | null }
  | { kind: "compare" }
  | { kind: "followup"; topic: "breakfast" | "rating" | "location" }
  | { kind: "booking_decline" }
  | { kind: "out_of_scope" };

/** Extract a 1-based ordinal reference from text, else null. */
function extractOrdinal(text: string): string | null {
  const t = text.toLowerCase();
  if (/\b(pehla|pehle|first|#?1\b|number 1)\b/.test(t)) return "1";
  if (/\b(dusra|doosra|second|#?2\b|number 2)\b/.test(t)) return "2";
  if (/\b(teesra|third|#?3\b|number 3)\b/.test(t)) return "3";
  const m = text.match(/#?(\d{1,2})\b/);
  if (m) return m[1];
  return null;
}

/** PURE deterministic intent parser. Composes multiple constraints per utterance. */
export function parseIntent(raw: string): DemoIntent {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { kind: "out_of_scope" };

  // 1) booking / bid / payment / write — safe decline FIRST (highest guard).
  if (/\b(book|booking|reserve|reservation|bid|pay|payment|checkout|confirm karo|book karo|book kar do)\b/i.test(text)) {
    return { kind: "booking_decline" };
  }

  // 2) compare / top two
  if (/\b(compare|comparison|dono|top ?2|top two|vs|versus|behtar kaun)\b/i.test(text)) {
    return { kind: "compare" };
  }

  const city = findCity(text);
  const budget = hasBudgetCue(text) ? findBudget(text) : null;
  // amenity as a FILTER intent only when it reads as a refinement, not a fact question
  const isQuestion = /\?|hai\b|kya\b|does|include/i.test(text);

  // 3) follow-ups (about the currently selected hotel) — question phrasing, no city
  if (!city && isQuestion) {
    if (/\b(breakfast|nashta)\b/i.test(text)) return { kind: "followup", topic: "breakfast" };
    if (/\b(rating|ratings|review|reviews|stars?)\b/i.test(text)) return { kind: "followup", topic: "rating" };
    if (/\b(location|where|kahan|kaha|address)\b/i.test(text)) return { kind: "followup", topic: "location" };
  }
  // rating/location follow-ups can also be bare statements (no city, no filters)
  if (!city && budget == null && findAmenity(text) == null) {
    if (/\b(rating|ratings|review|reviews|stars?)\b/i.test(text)) return { kind: "followup", topic: "rating" };
    if (/\b(location|where|kahan|kaha|address)\b/i.test(text)) return { kind: "followup", topic: "location" };
  }

  const amenity = findAmenity(text);

  // 4) details ("details", "batao", "tell me about", ordinal, "#2")
  if (/\b(details?|batao|bata do|info|facilities)\b/i.test(text)
      || /tell me about/i.test(text)
      || /\b(pehla|pehle|first|dusra|doosra|second|teesra|third)\b/i.test(text)
      || /#\d+|number \d+/i.test(text)) {
    // A details request must not carry a fresh-search city; if it does, treat as search.
    if (!city) return { kind: "details", ref: extractOrdinal(text) };
  }

  // 5) fresh SEARCH when a city is present → apply destination + budget + amenity together.
  if (city) {
    return { kind: "search", city, budget, amenity };
  }

  // 6) FILTER the current displayed set when budget and/or amenity constraint present.
  if (budget != null || amenity != null) {
    return { kind: "filter", budget, amenity };
  }

  // 7) bare search verb, no city, no filter → fresh search across all.
  if (/\b(search|find|dikhao|dikha do|show|hotels?|stay|ghumne)\b/i.test(text)) {
    return { kind: "search", city: null, budget: null, amenity: null };
  }

  return { kind: "out_of_scope" };
}

// ---- pure helpers -----------------------------------------------------------
function money(n: number | null): string {
  return n == null ? "price on request" : `₹${n.toLocaleString("en-IN")}`;
}

function listReply(hotels: NormalizedHotel[], header: string): string {
  if (hotels.length === 0) return "Is filter ke saath koi hotel nahi mila. Thoda budget ya filter badal ke dekhein.";
  const lines = hotels.slice(0, 5).map((h, i) => {
    const rating = h.avgRating != null ? ` · ⭐${h.avgRating}` : "";
    return `${i + 1}. ${h.name} — ${money(h.minPrice)}/night${rating}`;
  });
  return `${header}\n${lines.join("\n")}`;
}

function applyBudget(hotels: NormalizedHotel[], budget: number): NormalizedHotel[] {
  return hotels.filter((h) => h.minPrice != null && h.minPrice <= budget);
}

// Amenity filter needs details; resolve details for the given (bounded) set and
// keep those whose amenity list contains the label.
async function applyAmenity(
  hotels: NormalizedHotel[],
  label: string,
  deps: DemoDeps,
): Promise<NormalizedHotel[]> {
  const kept: NormalizedHotel[] = [];
  for (const h of hotels.slice(0, 12)) {
    const d = await deps.getHotelDetails(h.id);
    if (d && d.amenities.some((a) => a.toLowerCase().includes(label))) kept.push(h);
  }
  return kept;
}

/** Cheapest / top-rated over exactly the displayed set. PURE. */
export function pickTopTwo(hotels: NormalizedHotel[]): NormalizedHotel[] {
  const priced = hotels.filter((h) => h.minPrice != null);
  const byPrice = [...priced].sort((a, b) => (a.minPrice! - b.minPrice!));
  const out: NormalizedHotel[] = [];
  if (byPrice[0]) out.push(byPrice[0]);
  const byRating = [...hotels].filter((h) => h.avgRating != null).sort((a, b) => b.avgRating! - a.avgRating!);
  for (const h of byRating) {
    if (out.length >= 2) break;
    if (!out.find((x) => x.id === h.id)) out.push(h);
  }
  for (const h of hotels) {
    if (out.length >= 2) break;
    if (!out.find((x) => x.id === h.id)) out.push(h);
  }
  return out.slice(0, 2);
}

// ---- main turn --------------------------------------------------------------
export async function runTurn(state: DemoState, raw: string, deps: DemoDeps): Promise<DemoTurn> {
  const intent = parseIntent(raw);
  const base: DemoTurn = { state, reply: "", cards: [], detail: null };

  switch (intent.kind) {
    case "booking_decline":
      return { ...base, reply: BOOKING_DECLINE_REPLY };

    case "out_of_scope":
      return { ...base, reply: OUT_OF_SCOPE_REPLY };

    case "search": {
      const found = (await deps.searchHotels(intent.city, null)).slice(0, MAX_SEARCH_RESULTS);
      let displayed = found;
      // Compose the same-utterance constraints onto the fresh result set.
      if (intent.budget != null) displayed = applyBudget(displayed, intent.budget);
      if (intent.amenity != null) displayed = await applyAmenity(displayed, intent.amenity, deps);
      const next: DemoState = {
        baseResults: found,
        displayed,
        selectedId: null,
        topTwoIds: [],
        lastCity: intent.city,
        activeBudget: intent.budget,
        activeAmenity: intent.amenity,
      };
      const where = intent.city ? intent.city.replace(/\b\w/g, (c) => c.toUpperCase()) : "StayBid";
      const bits: string[] = [];
      if (intent.budget != null) bits.push(`${money(intent.budget)} ke andar`);
      if (intent.amenity != null) bits.push(`"${intent.amenity}" wale`);
      const header = bits.length ? `${where} ke ${bits.join(" + ")} hotels:` : `${where} ke top hotels:`;
      return { state: next, reply: listReply(displayed, header), cards: displayed.slice(0, 5), detail: null };
    }

    case "filter": {
      if (state.displayed.length === 0 && state.baseResults.length === 0) {
        return { ...base, reply: NO_RESULTS_YET };
      }
      // COMPOSE: narrow the CURRENT displayed set (an excluded hotel never re-enters).
      let displayed = state.displayed;
      let activeBudget = state.activeBudget;
      let activeAmenity = state.activeAmenity;
      if (intent.budget != null) { displayed = applyBudget(displayed, intent.budget); activeBudget = intent.budget; }
      if (intent.amenity != null) { displayed = await applyAmenity(displayed, intent.amenity, deps); activeAmenity = intent.amenity; }
      const next: DemoState = { ...state, displayed, activeBudget, activeAmenity, topTwoIds: [], selectedId: null };
      const bits: string[] = [];
      if (intent.budget != null) bits.push(`${money(intent.budget)} ke andar`);
      if (intent.amenity != null) bits.push(`"${intent.amenity}" wale`);
      return { state: next, reply: listReply(displayed, `${bits.join(" + ")} options:`), cards: displayed.slice(0, 5), detail: null };
    }

    case "details": {
      if (state.displayed.length === 0) return { ...base, reply: NO_RESULTS_YET };
      const idx = intent.ref ? Math.max(1, parseInt(intent.ref, 10)) - 1 : 0;
      const target = state.displayed[idx] || state.displayed[0];
      if (!target || !isValidHotelId(target.id)) return { ...base, reply: NO_RESULTS_YET };
      const d = await deps.getHotelDetails(target.id);
      if (!d) return { ...base, reply: `${target.name} ki details abhi load nahi ho paayin.` };
      const next: DemoState = { ...state, selectedId: d.id };
      const am = d.amenities.length ? d.amenities.slice(0, 6).join(", ") : "listed on request";
      const reviews = d.totalReviews != null ? ` (${d.totalReviews} reviews)` : "";
      const reply =
        `${d.name}, ${d.city || "—"}\n` +
        `Rating: ${d.avgRating != null ? `⭐${d.avgRating}${reviews}` : "new"}\n` +
        `From ${money(d.minPrice)}/night\n` +
        `Amenities: ${am}`;
      return { state: next, reply, cards: [], detail: d };
    }

    case "compare": {
      if (state.displayed.length < 2) {
        return { ...base, reply: "Compare karne ke liye pehle kam se kam 2 hotels search karein." };
      }
      const two = pickTopTwo(state.displayed);
      const next: DemoState = { ...state, topTwoIds: two.map((h) => h.id) };
      const rows = two
        .map((h) => `• ${h.name} — ${money(h.minPrice)}/night${h.avgRating != null ? ` · ⭐${h.avgRating}` : ""}`)
        .join("\n");

      // DEMO-REV-04 — null-safe superlatives.
      const verdictLines: string[] = [];
      const bothPriced = two.every((h) => h.minPrice != null);
      if (bothPriced) {
        const cheapest = two.reduce((a, b) => (b.minPrice! < a.minPrice! ? b : a));
        verdictLines.push(`Sabse sasta: ${cheapest.name} (${money(cheapest.minPrice)})`);
      } else {
        verdictLines.push(PRICE_DATA_INCOMPLETE);
      }
      const bothRated = two.every((h) => h.avgRating != null);
      if (bothRated) {
        const topRated = two.reduce((a, b) => (b.avgRating! > a.avgRating! ? b : a));
        verdictLines.push(`Sabse zyada rated: ${topRated.name} (⭐${topRated.avgRating})`);
      } else {
        verdictLines.push(RATING_DATA_INCOMPLETE);
      }
      return { state: next, reply: `Top 2 comparison:\n${rows}\n${verdictLines.join("\n")}`, cards: two, detail: null };
    }

    case "followup": {
      const sel = state.selectedId ? state.displayed.find((h) => h.id === state.selectedId) : null;
      const focus = sel || state.displayed[0];
      if (!focus) return { ...base, reply: NO_RESULTS_YET };
      const d = await deps.getHotelDetails(focus.id);
      if (!d) return { ...base, reply: `${focus.name} ki details abhi load nahi ho paayin.` };
      const next: DemoState = { ...state, selectedId: d.id };
      if (intent.topic === "breakfast") {
        const has = d.amenities.some((a) => /breakfast|nashta/i.test(a));
        const msg = has ? "breakfast available hai ✓" : FACT_UNAVAILABLE;
        return { state: next, reply: `${d.name}: ${msg}`, cards: [], detail: d };
      }
      if (intent.topic === "rating") {
        const rv = d.totalReviews != null ? ` (${d.totalReviews} reviews)` : "";
        const msg = d.avgRating != null ? `⭐${d.avgRating}${rv}` : FACT_UNAVAILABLE;
        return { state: next, reply: `${d.name} ka rating: ${msg}`, cards: [], detail: d };
      }
      const msg = d.city ? `${d.city} mein hai.` : FACT_UNAVAILABLE;
      return { state: next, reply: `${d.name} ${msg}`, cards: [], detail: d };
    }
  }
}
