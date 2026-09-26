// ─────────────────────────────────────────────────────────────────────────
// StayBid Live-AI — OWNER PREVIEW deterministic interpreter (LIVE-AI owner-visible first slice).
//
// PURE + BOUNDED. Given one bounded user utterance and the runtime's already-published bounded page context, it returns EITHER exactly ONE validated LiveAiOperation to run through the
// EXISTING runtime, OR a bounded informational / unavailable reply. It NEVER touches the network, the provider,
// the gateway, the microphone, the router, the DOM, or raw hotel objects. It invents NO routes, IDs, URLs,
// selectors, HTTP/SQL/DOM commands and NO seventh operation.
//
// Every operation it emits targets ONLY the six CLOSED runtime operations and is built in already-canonical form
// (via the shared contracts canonicalizers) so runtime.makeEnvelope()'s validateOperation() accepts it. The
// deterministic-preview controller in LiveAiProvider is the ONLY caller; it feeds the operation through
// runtime.beginTurn() → makeEnvelope() → execute() → reconcile(), exactly like the provider path — one controller
// per turn, provider-dormant only.
//
// LANGUAGE BOUNDARY (exactly what the tests prove): English + Roman-Hindi/Hinglish + BOUNDED native Devanagari
// vocabulary for the authorized first-slice intents only. Devanagari support is a small explicit cue list matched
// with Unicode-aware boundaries plus an explicit Devanagari→canonical-city alias map. It is NOT general Hindi
// understanding, NOT translation/transliteration, and it does NOT recognize arbitrary Hindi destinations.
//
// DESTINATION AUTHORITY (frozen invariant): an emitted destination ALWAYS resolves to exactly one canonical StayBid
// city in lib/cities.ts (ALL_CITIES). Arbitrary / unsupported place phrases never receive destination authority.
// ─────────────────────────────────────────────────────────────────────────
import {
  type LiveAiOperation,
  type HotelCompareFactor,
  type HotelSort,
  type HotelSection,
  type FacilityFact,
  canonicalCity,
  boundedPrice,
  boundedQuery,
  MAX_VISIBLE_HOTELS,
} from "./contracts";
import type { PublishedContext } from "./protocol";
// The StayBid canonical CITY registry (single source of truth, pure). The ONLY destination authority for the preview.
import { ALL_CITIES, cityMeta } from "../cities";
import type { ExecutionResult, CompanionTurn } from "./runtime";

// The interpreter consumes the runtime's bounded, data-minimized PublishedContext — the SAME gateway-safe view
// the provider path's model sees. It never inspects raw hotel objects.
export type PreviewContext = PublishedContext | null;

/** What the interpreter asked, so the controller can format the reply from the runtime result. */
export type PreviewFactsFocus = "parking" | "breakfast" | "rooms" | "all";

export type PreviewOutcome =
  | { kind: "operation"; operation: LiveAiOperation; factsFocus?: PreviewFactsFocus }
  | { kind: "info"; message: string }
  | { kind: "unavailable"; message: string };

export const PREVIEW_MAX_INPUT = 200;
export const PREVIEW_MARKER = "Preview";
export const OWNER_PREVIEW_FLAG = "NEXT_PUBLIC_LIVE_AI_OWNER_PREVIEW";

/**
 * OWNER-PREVIEW gate (fail-closed, default OFF). ON only when V (NEXT_PUBLIC_VOICE_AI_BETA==="1", passed as
 * `enabled`) AND NEXT_PUBLIC_LIVE_AI_OWNER_PREVIEW==="1" AND the real provider path is NOT enabled. Requiring
 * provider-dormant guarantees exactly ONE controller ever owns a turn (provider when providerEnabled, else the
 * deterministic preview). Pure + env-injectable for tests.
 */
export function resolveOwnerPreviewGate(
  enabled: boolean,
  providerEnabled: boolean,
  env?: Record<string, string | undefined>,
): boolean {
  // The default path MUST be the literal `process.env.NEXT_PUBLIC_LIVE_AI_OWNER_PREVIEW` member expression:
  // Next.js inlines only literal NEXT_PUBLIC_* reads into the client bundle, so a dynamic key would always be
  // undefined in the browser (preview silently OFF).
  const flag = env
    ? env[OWNER_PREVIEW_FLAG]
    : typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_LIVE_AI_OWNER_PREVIEW
      : undefined;
  return enabled && !providerEnabled && flag === "1";
}

// Default list-level comparison factors. Breakfast is intentionally EXCLUDED at the list level: the list context
// carries no verified breakfast fact, and we never claim one (§7C).
const DEFAULT_LIST_COMPARE_FACTORS: HotelCompareFactor[] = ["price", "rating", "parking"];

// ── bounded normalization ──
// Zero-width characters some Indic keyboards insert inside words (ZWSP/ZWNJ/ZWJ/WORD JOINER/BOM). They only affect
// glyph shaping, so removing them is a pure matching normalization.
const INVISIBLE_JOINERS = /[\u200B-\u200D\u2060\uFEFF]/g;
// Devanagari digits ०-९ → ASCII 0-9 (a fixed 10-character digit map — NOT word transliteration), so "५०००" is read
// exactly like "5000" by the existing bounded number parser (a bare number still never becomes a price).
const DEVANAGARI_DIGITS = /[\u0966-\u096F]/g;

function normalize(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .slice(0, PREVIEW_MAX_INPUT * 2)          // cost bound before Unicode work
    .normalize("NFC")                         // one canonical form for native-script matching
    .replace(INVISIBLE_JOINERS, "")
    .replace(DEVANAGARI_DIGITS, (d) => String(d.charCodeAt(0) - 0x0966))
    .slice(0, PREVIEW_MAX_INPUT)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ── Unicode-safe exact cue / phrase matcher ──
// ASCII `\b` does not work for Devanagari (vowel signs are \p{M}, not \w). A cue matches ONLY as a whole
// normalized word/phrase: the characters on either side must NOT be a letter, combining mark or number
// (\p{L}\p{M}\p{N}, `u` flag). No lookbehind (older Safari), no substring matching of short tokens, and the
// internal spaces of a multi-word phrase match normalized whitespace only.
const WORD_CHAR = "\\p{L}\\p{M}\\p{N}";
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function phraseSource(cues: readonly string[]): string {
  return cues
    .map((c) => c.normalize("NFC").toLowerCase())
    .sort((a, b) => b.length - a.length)
    .map((c) => escapeRe(c).replace(/ /g, "\\s+"))
    .join("|");
}
function cueMatcher(cues: readonly string[]): RegExp {
  return new RegExp(`(?:^|[^${WORD_CHAR}])(?:${phraseSource(cues)})(?=[^${WORD_CHAR}]|$)`, "u");
}

// ── bounded native Devanagari vocabulary (first-slice intents ONLY) ──
const HI_OPEN = cueMatcher(["खोलो", "खोल", "खोलिए", "खोलें", "खोल दो"]);
const HI_COMPARE = cueMatcher(["तुलना", "तुलना करो", "मुकाबला", "मुक़ाबला"]);
const HI_RESULTS = cueMatcher(["क्या विकल्प हैं", "क्या विकल्प है", "क्या दिख रहा है", "क्या दिख रहे हैं", "अभी क्या है"]);
const HI_PARKING = cueMatcher(["पार्किंग"]);
const HI_BREAKFAST = cueMatcher(["नाश्ता", "नाश्ते", "ब्रेकफास्ट"]);
const HI_ROOMS_OR_PRICE = cueMatcher(["कमरा", "कमरे", "कमरों", "कीमत", "रेट"]);
const HI_FACILITIES = cueMatcher(["सुविधा", "सुविधाएँ", "सुविधाएं"]);
const HI_SHOW = cueMatcher(["दिखाओ", "दिखा दो", "दिखाइए", "दिखाएं", "दिखाएँ", "खोलो"]);
const HI_ROOMS_SECTION = cueMatcher(["कमरे", "कमरा", "कमरों"]);
const HI_ABOUT_SECTION = cueMatcher(["जानकारी", "विवरण"]);
const HI_BUDGET = cueMatcher(["के अंदर", "से कम", "से नीचे", "के नीचे", "तक", "बजट"]);

// Negated parking in EITHER script ("बिना पार्किंग", "पार्किंग नहीं", "parking nahi", "no parking", …). The
// existing operation contract has no "without parking" filter, so on the list page negation FAILS CLOSED — it must
// never become parking=true and never partially apply the rest of the request.
const PARKING_WORDS = ["parking", "valet", "car park", "पार्किंग"];
const NEG_BEFORE_PARKING = ["no", "bina", "without", "nahi", "na", "बिना", "नो", "बगैर", "बग़ैर"];
const NEG_AFTER_PARKING = ["nahi", "nahin", "nhi", "na", "not", "ke bina", "नहीं", "नही", "ना", "के बिना"];
const PARKING_NEGATED = new RegExp(
  `(?:^|[^${WORD_CHAR}])(?:(?:${phraseSource(NEG_BEFORE_PARKING)})\\s+(?:${phraseSource(PARKING_WORDS)})` +
    `|(?:${phraseSource(PARKING_WORDS)})\\s+(?:${phraseSource(NEG_AFTER_PARKING)}))(?=[^${WORD_CHAR}]|$)`,
  "u",
);

// Explicit, reviewed Devanagari city labels → the EXISTING canonical Latin city keys (the launch "Garhwal" zone
// the first slice represents). No transliteration, no fuzzy guessing; canonicalCity() is unchanged and still the
// final oracle. A native destination is recognized ONLY as "<alias> में/मे/me/mein/mai".
export const DEVANAGARI_CITY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "मसूरी": "mussoorie",
  "देहरादून": "dehradun",
  "धनौल्टी": "dhanaulti",
  "ऋषिकेश": "rishikesh",
  "कनाताल": "kanatal",
});
const IN_POSTPOSITIONS = ["में", "मे", "me", "mein", "mai"];
const DEVANAGARI_DESTINATION_MATCHERS: ReadonlyArray<readonly [RegExp, string]> = Object.entries(DEVANAGARI_CITY_ALIASES).map(
  ([alias, city]) =>
    [
      new RegExp(`(?:^|[^${WORD_CHAR}])${escapeRe(alias.normalize("NFC"))}\\s+(?:${phraseSource(IN_POSTPOSITIONS)})(?=[^${WORD_CHAR}]|$)`, "u"),
      city,
    ] as const,
);

// ── deterministic ordinal parsing (1..N), English + Hinglish + digits ──
const ORDINAL_WORDS: Readonly<Record<string, number>> = Object.freeze({
  first: 1, "1st": 1, pehla: 1, pehle: 1, pahla: 1, pehlа: 1,
  second: 2, "2nd": 2, doosra: 2, dusra: 2, dusre: 2, doosre: 2,
  third: 3, "3rd": 3, teesra: 3, tisra: 3, teesre: 3,
  fourth: 4, "4th": 4, chautha: 4, chotha: 4,
  fifth: 5, "5th": 5, panchwa: 5, paanchwa: 5,
});

// Explicit native ordinals only (1..5, same bound as the Latin list), incl. common पाँच/पांच spelling variants.
const DEVANAGARI_ORDINALS: ReadonlyArray<readonly [RegExp, number]> = (
  [
    [["पहला", "पहली", "पहले"], 1],
    [["दूसरा", "दूसरी", "दूसरे"], 2],
    [["तीसरा", "तीसरी", "तीसरे"], 3],
    [["चौथा", "चौथी", "चौथे"], 4],
    [["पाँचवाँ", "पांचवां", "पाँचवां", "पांचवाँ", "पाँचवा", "पांचवा", "पाँचवीं", "पांचवीं", "पाँचवी", "पांचवी", "पाँचवें", "पांचवें", "पाँचवे", "पांचवे"], 5],
  ] as const
).map(([words, n]) => [cueMatcher(words), n] as const);

function parseOrdinal(text: string): number | null {
  for (const [word, n] of Object.entries(ORDINAL_WORDS)) {
    if (new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`).test(text)) return n;
  }
  for (const [re, n] of DEVANAGARI_ORDINALS) {
    if (re.test(text)) return n;
  }
  // A bare digit ordinal like "open 2" / "2 kholo". The digit must stand alone: a digit glued to letters,
  // other digits, "_" or "-" (e.g. an id like "htl_2" / "fx-hotel-2") is NEVER read as an ordinal.
  const m = /(?:^|[^\p{L}\p{N}_-])([1-9])(?:st|nd|rd|th)?(?=[^\p{L}\p{N}_-]|$)/u.exec(text);
  if (m) { const n = Number(m[1]); if (n >= 1 && n <= 9) return n; }
  return null;
}

// ── intent cue vocabularies ──
const OPEN_CUES = /\b(open|kholo|khol|kholiye|dekhао|dikha do)\b/;
const COMPARE_CUES = /\b(compare|comparison|tulna|tulnaa|muqabla|vs)\b/;
const RESULTS_CUES = /\b(kya options|options kya|kya dikh|what do you see|current stays|current options|show current|show results|results|kitne stays|kya mil|what.?s here|kya hai yaha|dikh raha)\b/;
const PARKING_CUES = /\b(parking|valet|car park)\b/;
const PARKING_NEG = /\b(no|bina|nahi|without|na)\s+(parking|valet)\b/;
const BREAKFAST_CUES = /\b(breakfast|nashta|naashta)\b/;

// budget cue → treat a nearby number as maxPrice
const BUDGET_CUES = /(under|below|less than|upto|up to|max|budget|ke andar|se kam|se niche|ke neeche|se neeche|tak|andar|kam|₹|rs\.?|inr|<)/;

function parseMaxPrice(text: string): number | null {
  if (!BUDGET_CUES.test(text) && !HI_BUDGET.test(text)) return null;
  const m = /(\d[\d,]{1,8})/.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  const p = boundedPrice(n);
  if (p === null || p <= 0) return null;   // validateOperation requires strict number > 0
  return p;
}

function parseSort(text: string): HotelSort | null {
  if (/\b(cheapest|sasta|sabse sasta|low to high|price low|kam price|budget)\b/.test(text)) return "price-asc";
  if (/\b(expensive|mehnga|mehenga|high to low|price high|zyada price|costliest)\b/.test(text)) return "price-desc";
  if (/\b(top rated|best rated|highest rated|top rating|best rating|sabse acha rating|rating)\b/.test(text)) return "rating";
  return null;
}

function parseStars(text: string): number[] | null {
  const found = new Set<number>();
  const re = /([345])\s*[- ]?\s*star/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) { const n = Number(m[1]); if (n >= 3 && n <= 5) found.add(n); }
  if (found.size === 0) return null;
  // validateOperation requires 1..3 entries, strictly DESCENDING, unique.
  return Array.from(found).sort((a, b) => b - a).slice(0, 3);
}

// Native-script destination: exactly ONE explicit alias followed by an "in" postposition. Two different native
// cities in one utterance is ambiguous → "ambiguous" (the caller fails closed; nothing is applied).
function parseDevanagariDestination(text: string): string | "ambiguous" | null {
  const found = new Set<string>();
  for (const [re, city] of DEVANAGARI_DESTINATION_MATCHERS) {
    if (re.test(text)) found.add(city);
  }
  if (found.size === 0) return null;
  if (found.size > 1) return "ambiguous";
  return registryCity(Array.from(found)[0]) || "ambiguous";   // an alias whose target is not a registry city never applies
}

// ── Destination authority: the canonical StayBid city registry (lib/cities.ts) ──
// A destination is ONLY a canonical registry city found by exact token-phrase matching adjacent to explicit
// destination grammar:
//   "<city> me|mein|mai|में|मे"  → the LONGEST registry city ending immediately before the postposition
//   "in|at|near <city>"          → the LONGEST registry city starting immediately after the preposition
// Longest-match means "south goa me" → South Goa (never Goa). Words around the city ("scenic", "parking wala hotel")
// are simply not part of the match, so they can never leak. No city list is duplicated here; no stop-word list
// grants authority; canonicalCity() is unchanged and still the final contract check.
type RegistryCity = { value: string; tokens: string[] };
const REGISTRY_CITIES: readonly RegistryCity[] = Object.freeze(
  ALL_CITIES
    .map((c) => {
      const value = canonicalCity(c.key);   // lowercase canonical form the Live-AI contract expects
      return value ? { value, tokens: value.split(" ") } : null;
    })
    .filter((c): c is RegistryCity => c !== null)
    .sort((a, b) => b.tokens.length - a.tokens.length),   // longest first
);
/** The contract-form destination for a registry city, or null when it is not a canonical StayBid city. */
function registryCity(candidate: string): string | null {
  const meta = cityMeta(candidate);
  return meta ? canonicalCity(meta.key) : null;
}

const LATIN_POSTPOSITIONS = new Set(["me", "mein", "mai", "में", "मे"]);
const LATIN_PREPOSITIONS = new Set(["in", "at", "near"]);
// Joiners. "/" stands for / & + (always a join); "|" stands for , ; : . ? ! etc. (a boundary, and a join only when it
// precedes a "<city> me" match, e.g. "delhi, mussoorie me").
const JOIN_WORDS = new Set(["aur", "and", "or", "ya", "va", "और", "या", "व", "/"]);
const DESTINATION_CONJUNCTIONS = new Set(["|", ...Array.from(JOIN_WORDS)]);
// Words after which "me" is the English PRONOUN ("show me hotels …"), not a destination postposition. This tiny set
// grants NO authority: it only stops a pronoun being treated as an unresolved destination attempt.
const PRONOUN_ME_VERBS = new Set(["show", "give", "tell", "send", "let", "help", "find", "get", "book", "bring"]);
// After "in|at|near <city>", a separator ("|") followed by a place-slot word is a SECOND destination attempt — unless the
// word is one of these English connectors ("hotels in mussoorie, with parking"). Safe direction only: a word missing
// here can only cause a refusal, never destination authority.
const SEPARATOR_CONTINUATION_WORDS = new Set(["with", "without", "under", "below", "above", "upto", "for", "please"]);

function destinationTokens(text: string): string[] {
  return text
    .replace(/[\/&+]/g, " / ")
    .replace(/[,|;:.?!()"“”‘’]/g, " | ")
    .split(/\s+/)
    .filter(Boolean);
}
// SCRIPT-INDEPENDENT place-slot word: any word made of letters/marks in ANY script (Latin, Devanagari, mixed), that is
// not itself a destination marker or a joiner. It does NOT mean "a known place" — only "the user put a word in the
// destination slot". Resolution (registry city or approved native alias) is what grants authority; an unresolved
// place-slot word makes the WHOLE refinement turn fail closed.
const isPlaceSlotWord = (t: string | undefined): boolean =>
  !!t && /^[\p{L}\p{M}][\p{L}\p{M}'-]*$/u.test(t) &&
  !LATIN_POSTPOSITIONS.has(t) && !LATIN_PREPOSITIONS.has(t) && !DESTINATION_CONJUNCTIONS.has(t);
// Approved native aliases (single tokens) → canonical registry city, for token-level resolution in the same scan.
const NATIVE_ALIAS_CITY: ReadonlyMap<string, string> = new Map(
  Object.entries(DEVANAGARI_CITY_ALIASES)
    .map(([alias, city]) => [alias.normalize("NFC"), registryCity(city)] as const)
    .filter((e): e is readonly [string, string] => e[1] !== null),
);

function registryEndingAt(tokens: string[], end: number): RegistryCity | null {   // tokens[..end-1]
  for (const c of REGISTRY_CITIES) {
    const n = c.tokens.length;
    if (end - n < 0) continue;
    let hit = true;
    for (let k = 0; k < n; k += 1) if (tokens[end - n + k] !== c.tokens[k]) { hit = false; break; }
    if (hit) return c;
  }
  return null;
}
function registryStartingAt(tokens: string[], start: number): RegistryCity | null {   // tokens[start..]
  for (const c of REGISTRY_CITIES) {
    const n = c.tokens.length;
    if (start + n > tokens.length) continue;
    let hit = true;
    for (let k = 0; k < n; k += 1) if (tokens[start + k] !== c.tokens[k]) { hit = false; break; }
    if (hit) return c;
  }
  return null;
}

type LatinDestination = { city: string } | "ambiguous" | "unresolved" | null;

// The destination slot resolved to a canonical city: a registry city (longest match) or an approved native alias.
function resolvedEndingAt(tokens: string[], end: number): { value: string; length: number } | null {
  const c = registryEndingAt(tokens, end);
  if (c) return { value: c.value, length: c.tokens.length };
  const alias = end - 1 >= 0 ? NATIVE_ALIAS_CITY.get(tokens[end - 1]) : undefined;
  return alias ? { value: alias, length: 1 } : null;
}
function resolvedStartingAt(tokens: string[], start: number): { value: string; length: number } | null {
  const c = registryStartingAt(tokens, start);
  if (c) return { value: c.value, length: c.tokens.length };
  const alias = start < tokens.length ? NATIVE_ALIAS_CITY.get(tokens[start]) : undefined;
  return alias ? { value: alias, length: 1 } : null;
}

// An EXPLICIT DESTINATION ATTEMPT = destination grammar (me/mein/mai/में/मे before, in/at/near after) with a place-slot
// word next to it, in ANY script. If the slot does not resolve to a canonical city → "unresolved": the whole turn
// fails closed (never a partial apply). A marker next to a digit / separator / English pronoun context is not an attempt.
function parseDestination(text: string): LatinDestination {
  const tokens = destinationTokens(text);
  const found = new Set<string>();
  let unresolved = false;
  let ambiguous = false;
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (LATIN_POSTPOSITIONS.has(t)) {
      const c = resolvedEndingAt(tokens, i);
      if (c) {
        found.add(c.value);
        // "<place> aur|और|/|, <city> me|में" — another place (any script) joined onto the matched city → two destinations.
        const s0 = i - c.length;
        if (DESTINATION_CONJUNCTIONS.has(tokens[s0 - 1]) && isPlaceSlotWord(tokens[s0 - 2])) ambiguous = true;
      } else if (isPlaceSlotWord(tokens[i - 1]) && !(t === "me" && PRONOUN_ME_VERBS.has(tokens[i - 1]))) unresolved = true;
    } else if (LATIN_PREPOSITIONS.has(t)) {
      const c = resolvedStartingAt(tokens, i + 1);
      if (c) {
        found.add(c.value);
        // "in <city> or|और|/ <place>" — another place (any script) joined onto the matched city → two destinations.
        const e = i + 1 + c.length;
        if (JOIN_WORDS.has(tokens[e]) && isPlaceSlotWord(tokens[e + 1])) ambiguous = true;
        if (tokens[e] === "|" && isPlaceSlotWord(tokens[e + 1]) && !SEPARATOR_CONTINUATION_WORDS.has(tokens[e + 1])) ambiguous = true;
      } else if (isPlaceSlotWord(tokens[i + 1])) unresolved = true;
    }
  }
  if (ambiguous || found.size > 1) return "ambiguous";
  if (unresolved) return "unresolved";   // incl. known + unresolved pairs ("मसूरी में और दिल्ली में") — never pick the known one
  if (found.size === 0) return null;
  return { city: Array.from(found)[0] };
}

// Every canonical registry city mentioned ANYWHERE (longest-first, non-overlapping exact token phrases), plus the
// explicit Devanagari aliases. Two different cities → ambiguous; a city that is not the extracted destination (named
// without destination grammar) → fail closed. Never silently drop or choose a city.
const KNOWN_DEVANAGARI_CITY_MATCHERS: ReadonlyArray<readonly [RegExp, string]> = Object.entries(DEVANAGARI_CITY_ALIASES).map(
  ([alias, city]) => [cueMatcher([alias]), city] as const,
);
function mentionedRegistryCities(text: string): Set<string> {
  const out = new Set<string>();
  const tokens = destinationTokens(text);
  let i = 0;
  while (i < tokens.length) {
    const c = registryStartingAt(tokens, i);
    if (c) { out.add(c.value); i += c.tokens.length; } else i += 1;
  }
  for (const [re, city] of KNOWN_DEVANAGARI_CITY_MATCHERS) {
    if (re.test(text)) out.add(registryCity(city) || "__unregistered_alias__:" + city);
  }
  return out;
}

function parseSearchQuery(text: string): string | null {
  const m = /\b(?:search|find|dhoondo|dhundo|khojo|search for)\s+([a-z0-9][a-z0-9 .'&-]{1,58})$/.exec(text);
  if (!m) return null;
  return boundedQuery(m[1]);
}

// ── list-page refinement extraction (only CONFIDENTLY parsed dimensions) ──
type RefinementRefusal = { refusal: "ambiguous" } | { refusal: "unresolved" } | { refusal: "unplaced"; city: string };

function tryRefinement(text: string): LiveAiOperation | RefinementRefusal | null {
  const op: Extract<LiveAiOperation, { op: "APPLY_HOTEL_REFINEMENT" }> = { op: "APPLY_HOTEL_REFINEMENT" };
  let any = false;

  const latin = parseDestination(text);
  const nativeDestination = parseDevanagariDestination(text);
  if (latin === "ambiguous" || nativeDestination === "ambiguous") return { refusal: "ambiguous" };
  // Explicit destination grammar that does not resolve to a canonical StayBid city fails the WHOLE turn closed
  // (never apply only the remaining filters).
  if (latin === "unresolved") return { refusal: "unresolved" };
  const latinDestination = latin ? latin.city : null;
  if (latinDestination && nativeDestination && latinDestination !== nativeDestination) return { refusal: "ambiguous" };
  const destination = latinDestination || nativeDestination;
  // Registry safety net: two different canonical cities, or a canonical city that is NOT the extracted destination
  // (named without destination grammar), fails closed — never silently drop or choose a destination.
  const mentioned = Array.from(mentionedRegistryCities(text));
  if (mentioned.length > 1) return { refusal: "ambiguous" };
  if (mentioned.length === 1 && destination !== mentioned[0]) {
    return destination ? { refusal: "ambiguous" } : { refusal: "unplaced", city: mentioned[0] };
  }
  if (destination) { op.destination = destination; any = true; }

  const maxPrice = parseMaxPrice(text);
  if (maxPrice !== null) { op.maxPrice = maxPrice; any = true; }

  if ((PARKING_CUES.test(text) || HI_PARKING.test(text)) && !PARKING_NEG.test(text) && !PARKING_NEGATED.test(text)) {
    op.parking = true; any = true;
  }

  const sort = parseSort(text);
  if (sort) { op.sort = sort; any = true; }

  const stars = parseStars(text);
  if (stars) { op.stars = stars; any = true; }

  // A free-text search query is accepted ONLY via an explicit search verb and ONLY when no other dimension
  // matched (keeps it unambiguous, §6).
  if (!any) {
    const query = parseSearchQuery(text);
    if (query) { op.query = query; any = true; }
  }

  return any ? op : null;
}

// ── comparison position resolution (TRUE visible positions only) ──
function firstNVisiblePositions(list: PublishedContext, n: number): number[] {
  return list.visibleHotels.slice(0, n).map((h) => h.position);
}

// ── the interpreter ──
export function interpretOwnerPreview(rawText: string, context: PreviewContext): PreviewOutcome {
  const text = normalize(rawText);
  if (!text) return { kind: "info", message: previewGreeting(context) };

  if (context && context.pageId === "hotels") return interpretHotelsList(text, context);
  if (context && context.pageId === "hotel-detail") return interpretHotelDetail(text, context);
  return { kind: "unavailable", message: "Open the hotels list or a stay to use the preview." };
}

function interpretHotelsList(text: string, ctx: PublishedContext): PreviewOutcome {
  // 1) OPEN a visible hotel by ORDINAL only (never an id from free text).
  if (OPEN_CUES.test(text) || HI_OPEN.test(text)) {
    const ord = parseOrdinal(text);
    if (ord === null) return { kind: "info", message: "Tell me which one to open — e.g. \"open the second\"." };
    if (ord > ctx.visibleHotels.length || ord > MAX_VISIBLE_HOTELS) {
      return { kind: "unavailable", message: `Only ${ctx.visibleHotels.length} stays are on screen.` };
    }
    const target = ctx.visibleHotels[ord - 1];
    return { kind: "operation", operation: { op: "OPEN_VISIBLE_HOTEL", position: target.position } };
  }

  // 2) COMPARE the visible hotels (default: first two true positions).
  if (COMPARE_CUES.test(text) || HI_COMPARE.test(text)) {
    if (ctx.visibleHotels.length < 2) return { kind: "unavailable", message: "Need at least two stays on screen to compare." };
    const ord = parseOrdinal(text);
    // "top 2" / "first two" / "pehle do" → first two; a single ordinal is not a compare of two → default first two.
    const positions = firstNVisiblePositions(ctx, 2);
    void ord;
    return { kind: "operation", operation: { op: "COMPARE_VISIBLE_HOTELS", positions, factors: [...DEFAULT_LIST_COMPARE_FACTORS] } };
  }

  // 3) REFINEMENT — only when at least one dimension is confidently parsed. Negated parking and conflicting
  // destinations FAIL CLOSED (no partial apply of the rest of the request).
  if (PARKING_NEGATED.test(text) || PARKING_NEG.test(text)) {
    return { kind: "unavailable", message: "I can only narrow to stays WITH parking, not without it." };
  }
  const refinement = tryRefinement(text);
  if (refinement && "refusal" in refinement) {
    if (refinement.refusal === "unresolved") {
      return { kind: "info", message: "I couldn't match that destination to a StayBid city." };
    }
    if (refinement.refusal === "unplaced") {
      return { kind: "info", message: `Say the destination as "${refinement.city} me" or "in ${refinement.city}".` };
    }
    return { kind: "info", message: "Ask about one destination at a time." };
  }
  if (refinement) return { kind: "operation", operation: refinement };

  // 4) READ current results.
  if (RESULTS_CUES.test(text) || HI_RESULTS.test(text)) return { kind: "operation", operation: { op: "READ_CURRENT_RESULTS" } };

  // 5) Bounded help — no mutation.
  return { kind: "info", message: previewGreeting(ctx) };
}

function interpretHotelDetail(text: string, ctx: PublishedContext): PreviewOutcome {
  // 1) SHOW a section by an explicit show-verb.
  const showVerb = /\b(show|dikhao|dikha|dekhao|dekhna|open)\b/.test(text) || HI_SHOW.test(text);
  if (showVerb && (/\brooms?\b/.test(text) || HI_ROOMS_SECTION.test(text))) {
    return { kind: "operation", operation: { op: "SHOW_HOTEL_SECTION", section: "rooms" as HotelSection } };
  }
  if (showVerb && (/\b(about|details?|overview|jaankari|jankari)\b/.test(text) || HI_ABOUT_SECTION.test(text))) {
    return { kind: "operation", operation: { op: "SHOW_HOTEL_SECTION", section: "about" as HotelSection } };
  }

  // 2) FACTS — parking / breakfast / rooms+price / facilities. Answered ONLY from bounded runtime facts.
  const asksParking = PARKING_CUES.test(text) || HI_PARKING.test(text);
  const asksBreakfast = BREAKFAST_CUES.test(text) || HI_BREAKFAST.test(text);
  const asksRooms = /\b(rooms?|kamre|kamra|price|rate|cost|kitne ka|kitna)\b/.test(text) || HI_ROOMS_OR_PRICE.test(text);
  // stems need NO trailing \b (e.g. "facilit|ies", "amenit|ies").
  const asksFacilities = /\b(facilit\w*|amenit\w*|suvidha\w*|features?)\b/.test(text) || HI_FACILITIES.test(text);
  if (asksParking || asksBreakfast || asksRooms || asksFacilities) {
    let focus: PreviewFactsFocus = "all";
    if (asksParking && !asksBreakfast && !asksRooms && !asksFacilities) focus = "parking";
    else if (asksBreakfast && !asksParking && !asksRooms && !asksFacilities) focus = "breakfast";
    else if (asksRooms && !asksParking && !asksBreakfast && !asksFacilities) focus = "rooms";
    return { kind: "operation", operation: { op: "READ_CURRENT_HOTEL_FACTS" }, factsFocus: focus };
  }

  // 3) Bounded help.
  return { kind: "info", message: previewGreeting(ctx) };
}

// ── context-aware greeting (§12) ──
export function previewGreeting(context: PreviewContext): string {
  if (context && context.pageId === "hotel-detail") {
    return "I can explain this stay's rooms, price, parking and breakfast information.";
  }
  return "I can help narrow these stays by destination, budget, parking or compare what's on screen.";
}

// ── tri-state facility phrasing (never turns unknown into yes/no) ──
export function facilityPhrase(label: string, fact: FacilityFact): string {
  if (fact === "present") return `${label} is available.`;
  if (fact === "absent") return `${label} is not listed.`;
  return `${label} information is unknown.`;
}

// ── reply formatting from the runtime result (single source of truth, §9) ──
export interface PreviewReplyHint { factsFocus?: PreviewFactsFocus; openLabel?: string; section?: "rooms" | "about"; }
const PREVIEW_REPLY_MAX = 180;
const clip = (s: string) => (s.length > PREVIEW_REPLY_MAX ? s.slice(0, PREVIEW_REPLY_MAX - 1).trimEnd() + "…" : s);

const STATUS_MESSAGE: Partial<Record<ExecutionResult["status"], string>> = {
  not_ready: "The stays are still loading — try again in a moment.",
  missing_ordinal: "Tell me which one — e.g. \"open the second\".",
  unsupported_filter: "I can't apply that here.",
  wrong_page: "That doesn't apply on this screen.",
  stale_context: "The screen just changed — try that again.",
  stale_route: "The screen just changed — try that again.",
  hotel_id_mismatch: "This stay is still loading — try again in a moment.",
};

/** Build a bounded reply from a NON-refinement execution result (READ / COMPARE / OPEN / FACTS / SECTION). */
export function formatExecutionReply(result: ExecutionResult, hint: PreviewReplyHint = {}): string {
  if (!result.ok) {
    const msg = STATUS_MESSAGE[result.status];
    return clip(msg || "That request isn't available right now.");
  }
  switch (result.operation) {
    case "READ_CURRENT_RESULTS": {
      const n = result.results ? result.results.length : 0;
      return clip(n === 0 ? "No stays match right now." : `${n} ${n === 1 ? "stay is" : "stays are"} on screen.`);
    }
    case "COMPARE_VISIBLE_HOTELS": {
      const cmp = result.comparison;
      if (!cmp || cmp.rows.length < 2) return "Need at least two stays to compare.";
      const nameAt = (pos: number | null) => {
        if (pos === null) return null;
        const row = cmp.rows.find((r) => r.position === pos);
        return row ? row.name : null;
      };
      const cheap = nameAt(cmp.cheapestPosition);
      const top = nameAt(cmp.topRatedPosition);
      if (cheap && top && cmp.cheapestPosition === cmp.topRatedPosition) {
        return clip(`${cheap} is both cheaper and higher rated.`);
      }
      const parts: string[] = [];
      if (cheap) parts.push(`${cheap} is cheaper`);
      if (top) parts.push(`${top} has the higher rating`);
      if (parts.length === 0) return clip(`Comparing ${cmp.rows.length} stays on screen.`);
      return clip(parts.join("; ") + ".");
    }
    case "OPEN_VISIBLE_HOTEL":
      return clip(hint.openLabel ? `Opening ${hint.openLabel}.` : "Opening the selected stay.");
    case "SHOW_HOTEL_SECTION":
      return clip(
        hint.section === "about" ? "Showing About this stay." : hint.section === "rooms" ? "Showing the rooms." : "Showing that section.",
      );
    case "READ_CURRENT_HOTEL_FACTS": {
      const facts = result.facts;
      if (!facts) return "This stay is still loading — try again in a moment.";
      const focus = hint.factsFocus || "all";
      if (focus === "parking") return clip(facilityPhrase("Parking", facts.parking));
      if (focus === "breakfast") return clip(facilityPhrase("Breakfast", facts.breakfast));
      if (focus === "rooms") {
        const n = facts.roomTypes ? facts.roomTypes.length : 0;
        const from = facts.hotel && facts.hotel.minPrice != null ? ` from ₹${facts.hotel.minPrice}` : "";
        return clip(n === 0 ? "No room types are listed for this stay." : `${n} room ${n === 1 ? "type" : "types"} listed${from}.`);
      }
      return clip(`${facilityPhrase("Parking", facts.parking)} ${facilityPhrase("Breakfast", facts.breakfast)}`);
    }
    default:
      return clip(result.companion && result.companion.speech ? result.companion.speech : "Done.");
  }
}

/** The verified reply after an APPLY reconciles (uses the runtime's own verified speech). */
export function formatVerifiedReply(verified: CompanionTurn | null): string | null {
  if (!verified || verified.phase !== "verified") return null;
  return clip(verified.speech || "Updated.");
}
