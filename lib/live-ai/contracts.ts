// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-01A — typed contracts + runtime validation.
//
// SINGLE source of truth for:
//   • the fail-closed feature gate (reuses the EXISTING visibility family
//     NEXT_PUBLIC_VOICE_AI_BETA === "1"; this packet does NOT create/change any
//     env value);
//   • bounded/canonical input validation (city, query, hotel id, ordinal, ISO
//     date, price, amenity label…);
//   • the bounded, data-minimized page-context shapes the model/transport is
//     ever allowed to see (raw DOM / raw rows are NEVER carried);
//   • the CLOSED typed operation union (six frozen operations) with an EXACT
//     allowed-key set per operation — an extra own key REJECTS the operation
//     (never sanitize-and-accept);
//   • tri-state facility facts (present | absent | unknown) — a malformed
//     amenities array is ALWAYS unknown, never absent;
//   • the PURE authority-relevant snapshot BUILDERS (buildHotelsSnapshot /
//     buildHotelDetailSnapshot) that both the React bridges AND the tests call,
//     so the tests exercise real production logic (REV-12). Each snapshot's
//     contextRevision is a SYNCHRONOUS complete-state fingerprint (REV-05): if
//     any authority-relevant fact changes, the fingerprint changes immediately
//     (no post-render useEffect window).
//
// PURE — no I/O, no React, no next/*, no @/lib imports (not even @/lib/voice).
// Malformed / unknown / extra-field input ALWAYS fails closed → returns null.
// There is NO url/href/path/method/selector/html/js/sql/rpc/command field in
// ANY operation variant — a hotel destination is only ever an ORDINAL resolved
// against the current visible order by the runtime.
// ─────────────────────────────────────────────────────────────────────────

// ---- fail-closed feature gate (EXISTING visibility family) ------------------
export const LIVE_AI_BETA_FLAG = "NEXT_PUBLIC_VOICE_AI_BETA";
export function isLiveAiEnabled(): boolean {
  return process.env.NEXT_PUBLIC_VOICE_AI_BETA === "1";
}

// ---- schema version (authority metadata) ------------------------------------
export const LIVE_AI_SCHEMA_VERSION = "live-ai-01a.2" as const;

// ---- bounds (kept small + explicit; the tests assert these) -----------------
export const MAX_CITY_LEN = 40;
export const MAX_QUERY_LEN = 60;
export const MAX_HOTEL_ID_LEN = 64;
export const MAX_VISIBLE_HOTELS = 24;
export const MAX_ROOM_TYPES = 12;
export const MAX_AMENITIES = 16; // hard cap on amenity-vocabulary length (REV-11)
export const MAX_AMENITY_LABEL_LEN = 48; // per-label length bound (REV-11)
export const MAX_NAME_LEN = 120;
export const MAX_CITY_DISPLAY_LEN = 60;
export const MAX_STARS = 5;
export const MIN_STARS = 3; // the /hotels star filter only offers 3/4/5
export const MAX_PRICE = 100_000_000; // ₹ technical safety bound (NOT a pricing rule)
// R5A — the reject-not-normalize upper bound for an UNTRUSTED external operation's maxPrice.
// Distinct from MAX_PRICE (the page-builder safety bound): the operation bound is the one the
// provider Structured Output schema declares and the gateway mirror enforces, so the browser
// and the gateway accept/reject an operation's maxPrice at the EXACT same ceiling (parity).
export const MAX_OP_PRICE = 10_000_000;
export const MAX_GUESTS = 30;
export const MAX_MEMORY_TURNS = 40;
export const MAX_DEDUP_ENTRIES = 256; // bounded dedup structure size (REV-13)

// ---- supported first-slice pages --------------------------------------------
export type LiveAiPageId = "hotels" | "hotel-detail";
export const LIVE_AI_PAGE_IDS: readonly LiveAiPageId[] = Object.freeze(["hotels", "hotel-detail"]);
export function isLiveAiPageId(x: unknown): x is LiveAiPageId {
  return typeof x === "string" && (LIVE_AI_PAGE_IDS as readonly string[]).includes(x);
}

// ---- first-slice roles (anonymous / customer ONLY) --------------------------
export type LiveAiRole = "anonymous" | "customer";
export const LIVE_AI_ROLES: readonly LiveAiRole[] = Object.freeze(["anonymous", "customer"]);
export function isLiveAiRole(x: unknown): x is LiveAiRole {
  return typeof x === "string" && (LIVE_AI_ROLES as readonly string[]).includes(x);
}

// ---- authority levels -------------------------------------------------------
export type AuthorityLevel = "READ" | "UI_LOCAL" | "DRAFT_LOCAL" | "CONFIRMED_WRITE";
export const CONFIRMED_WRITE_ENABLED = false;
export const DRAFT_LOCAL_ENABLED = false;

// ---- primitive input validators (bounded + canonical, fail-closed) ----------
export function canonicalCity(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  if (trimmed.length > MAX_CITY_LEN) return null;
  if (!/^[A-Za-zÀ-ɏ .'-]+$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function boundedQuery(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const cleaned = Array.from(input)
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c >= 0x20 && c !== 0x7f;
    })
    .join("")
    .trim()
    .replace(/\s+/g, " ");
  if (!cleaned) return null;
  if (cleaned.length > MAX_QUERY_LEN) return null;
  return cleaned;
}

export function isValidHotelId(input: unknown): input is string {
  return (
    typeof input === "string" &&
    input.length > 0 &&
    input.length <= MAX_HOTEL_ID_LEN &&
    /^[A-Za-z0-9_-]+$/.test(input)
  );
}

const STRICT_NUMERIC_STRING = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;
export function strictFinite(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t || !STRICT_NUMERIC_STRING.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Non-negative finite price in [0, MAX_PRICE] (strict input), else null. */
export function boundedPrice(v: unknown): number | null {
  const n = strictFinite(v);
  if (n === null || n < 0 || n > MAX_PRICE) return null;
  return n;
}

export function numInRange(v: unknown, min: number, max: number): number | null {
  const n = strictFinite(v);
  if (n === null || n < min || n > max) return null;
  return n;
}

/** A 1-based ordinal in [1, MAX_VISIBLE_HOTELS], strict integer, else null. */
export function boundedOrdinal(v: unknown): number | null {
  const n = strictFinite(v);
  if (n === null) return null;
  const i = Math.floor(n);
  if (i !== n) return null;
  if (i < 1 || i > MAX_VISIBLE_HOTELS) return null;
  return i;
}

export function safeStr(v: unknown, max = 120): string {
  if (typeof v !== "string") return "";
  return v.slice(0, max);
}

/**
 * ISO calendar date (YYYY-MM-DD) validator with a real calendar check + a
 * conservative year range. Any invalid/unbounded/malformed string → null
 * (REV-11). We deliberately accept ONLY the date form the /hotels pickers emit.
 */
export function isoDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s.length !== 10) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 2000 || y > 2100) return null;
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return s;
}

// ---- tri-state facility facts (REV-09) --------------------------------------
export type FacilityFact = "present" | "absent" | "unknown";

/** A member is an ACCEPTABLE amenity entry iff it is a bounded plain string. */
function acceptableAmenityMember(m: unknown): m is string {
  return typeof m === "string" && m.length <= 256;
}

export type FacilityName = "parking" | "breakfast";

// Keyword markers still used by the bridge for detecting a previously-applied
// parking option to toggle OFF (an internal set operation, not an authority
// fact). Facility FACTS + the parking FILTER use the explicit positive/negative
// recognition below, never bare substring inclusion.
export const PARKING_NEEDLES: readonly string[] = Object.freeze(["parking", "valet"]);
export const BREAKFAST_NEEDLES: readonly string[] = Object.freeze(["breakfast"]);

const FACILITY_KEYWORDS: Readonly<Record<FacilityName, readonly string[]>> = Object.freeze({
  parking: ["parking", "valet", "car park"],
  breakfast: ["breakfast"],
});

// Explicit REVIEWED positive canonical forms (normalized). A facility label is
// only "positive" by EXACT membership here — never by substring — so
// "No Parking" / "Parking unavailable" / "Parking nearby" are NOT positive.
const PARKING_POSITIVE: ReadonlySet<string> = new Set([
  "parking", "free parking", "private parking", "car parking", "car park", "on-site parking", "on site parking",
  "onsite parking", "free onsite parking", "valet parking", "covered parking", "self parking", "paid parking",
  "secure parking", "complimentary parking", "parking available", "free parking available", "parking included",
  "reserved parking", "free private parking", "free public parking", "public parking", "garage parking", "street parking",
]);
const BREAKFAST_POSITIVE: ReadonlySet<string> = new Set([
  "breakfast", "free breakfast", "complimentary breakfast", "breakfast included", "breakfast available",
  "breakfast provided", "continental breakfast", "breakfast buffet", "buffet breakfast", "daily breakfast",
  "free breakfast included", "american breakfast", "english breakfast", "breakfast in bed", "hot breakfast",
]);

/** Normalize a label for COMPARISON only (lowercase + collapse whitespace).
 *  NEVER used to transform a returned authority value. */
function normLabel(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}
function mentionsFacility(n: string, f: FacilityName): boolean {
  return FACILITY_KEYWORDS[f].some((k) => n.includes(k));
}
function isNegativeFacility(n: string): boolean {
  return (
    /(^|\s)no\s+\S/.test(n) ||
    /(^|\s)without\b/.test(n) ||
    /\bunavailable\b/.test(n) ||
    /\bnot\s+(available|included|offered|provided|allowed)\b/.test(n) ||
    /\bexcluded\b/.test(n)
  );
}
function facilityPositiveSet(f: FacilityName): ReadonlySet<string> {
  return f === "parking" ? PARKING_POSITIVE : BREAKFAST_POSITIVE;
}

/**
 * EXACT positive-parking recognition (R3 Fix 3 / REV-08). A label counts as an
 * ACTIVE parking selection ONLY by exact membership in the reviewed positive
 * allowlist (normalized) — NEVER by bare substring. This single predicate backs
 * BOTH the applied-parking snapshot flag (buildHotelsSnapshot) and
 * resolveParkingAmenity, so "No Parking" / "Parking unavailable" /
 * "Paid parking unavailable" / "Parking nearby" can never read as active parking.
 */
function isPositiveParkingLabel(s: unknown): boolean {
  return typeof s === "string" && PARKING_POSITIVE.has(normLabel(s));
}

/**
 * Facility fact tri-state with EXPLICIT positive/negative/ambiguous recognition
 * (R1-REV-NEW-02) on top of the frozen REV-09 malformed rule:
 *   present — at least one EXACT positive canonical label, no negative, no
 *             ambiguous mention;
 *   absent  — a clear negative statement (no positive), OR a valid complete
 *             array where the facility is simply not mentioned;
 *   unknown — malformed array (REV-09) · any ambiguous mention · a positive +
 *             negative conflict · anything not safely classifiable.
 * "No Parking" / "Parking unavailable" / "No Breakfast" / "Breakfast not
 * included" can NEVER be present.
 */
export function facilityFact(amenities: unknown, facility: FacilityName): FacilityFact {
  if (!Array.isArray(amenities)) return "unknown";
  // ANY malformed member makes the whole list untrustworthy → unknown (REV-09).
  for (const m of amenities) {
    if (!acceptableAmenityMember(m)) return "unknown";
  }
  const posSet = facilityPositiveSet(facility);
  let pos = false, neg = false, amb = false;
  for (const raw of amenities as string[]) {
    const n = normLabel(raw);
    if (!n || !mentionsFacility(n, facility)) continue;
    if (isNegativeFacility(n)) { neg = true; continue; }
    if (posSet.has(n)) { pos = true; continue; }
    amb = true; // mentions the facility but is neither clearly positive nor negative
  }
  if (amb) return "unknown"; // ambiguous wording → unknown
  if (pos && neg) return "unknown"; // conflicting signals → unknown
  if (pos) return "present";
  if (neg) return "absent"; // clear negative statement
  return "absent"; // complete array, facility not mentioned (REV-09 tri-state)
}

/**
 * Resolve the "parking" refinement to an EXACT amenity option that ACTUALLY
 * exists in the page's selectable filter vocabulary (amenityOpts). REV-08: match
 * is EXACT against an explicit positive allowlist (normalized) — never substring
 * — so "No Parking" / "Parking unavailable" / "Parking nearby" are rejected.
 * REV-11: an over-bound option is OMITTED (never truncated); the returned value
 * is the UNCHANGED original option. Returns null (→ unsupported_filter, no
 * mutation) for negative/ambiguous/absent/over-bound vocabularies.
 */
export function resolveParkingAmenity(vocabulary: unknown): string | null {
  if (!Array.isArray(vocabulary)) return null;
  for (const a of vocabulary) {
    if (typeof a !== "string") continue;
    if (a.length > MAX_AMENITY_LABEL_LEN) continue; // never return an over-bound authority value
    if (isPositiveParkingLabel(a)) return a; // EXACT positive → the ORIGINAL option, unchanged
  }
  return null;
}

// ---- bounded, data-minimized page-context shapes ----------------------------
export interface VisibleHotelSummary {
  /** 1-based TRUE visual position in displayHotels (never renumbered — REV-07). */
  position: number;
  id: string;
  name: string;
  city: string;
  minPrice: number | null;
  rating: number | null;
  parking: FacilityFact;
}

/** Request/response-bound resolved-catalogue receipt (REV-02). */
export interface CatalogueReceipt {
  /** the destination the CURRENT displayHotels actually correspond to. */
  city: string | null;
  /** the query the CURRENT displayHotels actually correspond to. */
  query: string | null;
  /** the destination the page is CURRENTLY targeting (may differ while loading). */
  requestedCity: string | null;
  /** the query the page is CURRENTLY targeting. */
  requestedQuery: string | null;
  /** "ready" only when requested === resolved AND not loading AND no error. */
  status: "loading" | "ready" | "error";
}

export type HotelSort = "default" | "price-asc" | "price-desc" | "rating";
export const HOTEL_SORTS: readonly HotelSort[] = Object.freeze(["default", "price-asc", "price-desc", "rating"]);
export function isHotelSort(x: unknown): x is HotelSort {
  return typeof x === "string" && (HOTEL_SORTS as readonly string[]).includes(x);
}

export type HotelSection = "rooms" | "about";
export const HOTEL_SECTIONS: readonly HotelSection[] = Object.freeze(["rooms", "about"]);
export function isHotelSection(x: unknown): x is HotelSection {
  return typeof x === "string" && (HOTEL_SECTIONS as readonly string[]).includes(x);
}

// R5A — the CLOSED, ordered comparison-factor vocabulary a COMPARE_VISIBLE_HOTELS operation
// may declare (which dimensions the model wants compared). The same four factors the answer
// plan uses; kept here because contracts.ts is the operation authority (the gateway mirror +
// the provider Structured Output schema list the identical enum). A COMPARE operation's factors
// are validated ORDERED + DISTINCT + recognized (reject-not-normalize) — never deduped/sorted.
export type HotelCompareFactor = "price" | "rating" | "parking" | "breakfast";
export const HOTEL_COMPARE_FACTORS: readonly HotelCompareFactor[] = Object.freeze(["price", "rating", "parking", "breakfast"]);
export function isHotelCompareFactor(x: unknown): x is HotelCompareFactor {
  return typeof x === "string" && (HOTEL_COMPARE_FACTORS as readonly string[]).includes(x);
}

export interface HotelsListContext {
  pageId: "hotels";
  /** SYNCHRONOUS complete-state fingerprint (REV-05). */
  contextRevision: string;
  role: LiveAiRole;
  destination: string | null;
  query: string | null;
  checkIn: string | null;
  checkOut: string | null;
  guests: number | null;
  maxPrice: number | null;
  parking: boolean;
  sort: HotelSort;
  stars: number[];
  loadState: "loading" | "ready" | "error";
  receipt: CatalogueReceipt;
  visibleHotels: VisibleHotelSummary[];
  /** the selectable amenity vocabulary (page amenityOpts) — for safe parking mapping. */
  availableAmenities: string[];
}

export interface RoomTypeSummary {
  name: string;
  floorPrice: number | null;
}

export interface HotelDetailContext {
  pageId: "hotel-detail";
  contextRevision: string;
  role: LiveAiRole;
  routeHotelId: string | null;
  currentHotelId: string | null;
  loadState: "loading" | "ready" | "error";
  /** true ONLY when loadState==="ready" AND routeHotelId===currentHotelId (REV-10). */
  validated: boolean;
  section: HotelSection;
  /** null until validated — no stale/other hotel is ever projected as current. */
  hotel: {
    id: string;
    name: string;
    city: string;
    starRating: number | null;
    avgRating: number | null;
    minPrice: number | null;
  } | null;
  roomTypes: RoomTypeSummary[];
  breakfast: FacilityFact;
  parking: FacilityFact;
}

// ---- the CLOSED typed operation union ---------------------------------------
export type LiveAiOperation =
  | {
      op: "APPLY_HOTEL_REFINEMENT";
      destination?: string | null;
      query?: string | null;
      maxPrice?: number | null;
      parking?: boolean;
      sort?: HotelSort;
      stars?: number[];
    }
  | { op: "READ_CURRENT_RESULTS" }
  | { op: "COMPARE_VISIBLE_HOTELS"; positions: number[]; factors: HotelCompareFactor[] }
  | { op: "OPEN_VISIBLE_HOTEL"; position: number }
  | { op: "READ_CURRENT_HOTEL_FACTS" }
  | { op: "SHOW_HOTEL_SECTION"; section: HotelSection };

export type LiveAiOperationName = LiveAiOperation["op"];

export const OPERATION_NAMES: readonly LiveAiOperationName[] = Object.freeze([
  "APPLY_HOTEL_REFINEMENT",
  "READ_CURRENT_RESULTS",
  "COMPARE_VISIBLE_HOTELS",
  "OPEN_VISIBLE_HOTEL",
  "READ_CURRENT_HOTEL_FACTS",
  "SHOW_HOTEL_SECTION",
]);

export const OPERATION_AUTHORITY: Readonly<Record<LiveAiOperationName, AuthorityLevel>> = Object.freeze({
  APPLY_HOTEL_REFINEMENT: "UI_LOCAL",
  READ_CURRENT_RESULTS: "READ",
  COMPARE_VISIBLE_HOTELS: "READ",
  OPEN_VISIBLE_HOTEL: "UI_LOCAL",
  READ_CURRENT_HOTEL_FACTS: "READ",
  SHOW_HOTEL_SECTION: "UI_LOCAL",
});

export const OPERATION_PAGE: Readonly<Record<LiveAiOperationName, LiveAiPageId>> = Object.freeze({
  APPLY_HOTEL_REFINEMENT: "hotels",
  READ_CURRENT_RESULTS: "hotels",
  COMPARE_VISIBLE_HOTELS: "hotels",
  OPEN_VISIBLE_HOTEL: "hotels",
  READ_CURRENT_HOTEL_FACTS: "hotel-detail",
  SHOW_HOTEL_SECTION: "hotel-detail",
});

// EXACT allowed own-key sets per operation (REV-01). An extra own key REJECTS.
const OP_ALLOWED_KEYS: Readonly<Record<LiveAiOperationName, readonly string[]>> = Object.freeze({
  APPLY_HOTEL_REFINEMENT: ["op", "destination", "query", "maxPrice", "parking", "sort", "stars"],
  READ_CURRENT_RESULTS: ["op"],
  COMPARE_VISIBLE_HOTELS: ["op", "positions", "factors"],
  OPEN_VISIBLE_HOTEL: ["op", "position"],
  READ_CURRENT_HOTEL_FACTS: ["op"],
  SHOW_HOTEL_SECTION: ["op", "section"],
});

const MAX_COMPARE_POSITIONS = 4;
// R5A SECOND REMEDIATION (REV-NEW-02): the outer length bound the strict array snapshot will
// inspect at all — every authority-bearing array (APPLY stars, COMPARE positions/factors) is far
// smaller, and each caller re-enforces its own tighter window after the snapshot. This only bounds
// the per-index inspection loop so a hostile huge `length` can never make the snapshot do unbounded
// work; it is NOT a semantic array limit.
const MAX_OP_ARRAY_LEN = 64;

/**
 * STRICT own-DATA-property record (REV-01 / R1-REV-NEW-01 / R3 Fix 1+2). Inspects
 * EVERY own key via Reflect.ownKeys and fails closed on:
 *   • a NON-plain prototype — the value's [[Prototype]] MUST be exactly
 *     Object.prototype or null (a bare {…} / Object.create(null) record). A
 *     custom prototype, a class instance, or ANY inherited-authority prototype
 *     chain REJECTS the whole record BEFORE any field is extracted (R3 Fix 1 for
 *     operations, R3 Fix 2 for envelopes — validateEnvelope calls this helper);
 *   • any symbol key;
 *   • any own key outside the allowed set (enumerable OR non-enumerable);
 *   • any accessor (getter/setter) descriptor — value must be a plain data prop.
 * Returns a NULL-PROTOTYPE snapshot of ONLY the allowed own data properties, so
 * inherited/prototype authority fields are NEVER read, and every downstream read
 * comes from this frozen-at-source copy (no re-read of the mutable original, no
 * TOCTOU getter). Returns null on any violation.
 */
function strictOwnDataRecord(x: object, allowed: readonly string[]): Record<string, unknown> | null {
  // R5A-REMEDIATION (REV-NEW-02): TOTAL, fail-closed. Every reflective inspection below can be a
  // hostile-Proxy trap (getPrototypeOf / ownKeys / getOwnPropertyDescriptor). Any thrown trap makes
  // the WHOLE inspection fail closed → null (never throw out, never repair/coerce/partial-authorize).
  try {
    // R3 Fix 1+2: reject any non-plain prototype (custom prototype, class instance,
    // inherited-authority chain) BEFORE extracting any field. Only a bare object
    // literal (proto === Object.prototype) or a null-prototype record is accepted.
    const proto = Object.getPrototypeOf(x);
    if (proto !== Object.prototype && proto !== null) return null;
    const out: Record<string, unknown> = Object.create(null);
    const keys = Reflect.ownKeys(x); // string + symbol own keys
    for (const k of keys) {
      if (typeof k === "symbol") return null; // no symbol keys
      if (!allowed.includes(k)) return null; // undeclared own key (enumerable or not)
      const d = Object.getOwnPropertyDescriptor(x, k);
      if (!d) return null;
      if (typeof d.get === "function" || typeof d.set === "function" || !("value" in d)) return null; // accessor → reject
      out[k] = d.value; // captured ONCE from the data property
    }
    return out;
  } catch {
    return null; // any hostile reflective-trap exception → fail closed
  }
}
function hasOwnData(rec: Record<string, unknown>, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(rec, k);
}

/**
 * STRICT ARRAY SNAPSHOT (R5A SECOND REMEDIATION — REV-NEW-02). Capture an untrusted value as a
 * FRESH, inert, ordinary array of its own indexed DATA values, or null. A hostile Array may
 * override map / slice / keys / values / Symbol.iterator / a "length" getter so that validation
 * inspects one sequence while a frozen output ends up carrying another (e.g. positions [999,999]
 * whose map() returns [1,2], or factors ["zoom"] whose iterator yields "price"). This helper
 * defeats that class of attack by NEVER invoking any caller-owned method: it reads every index
 * through a trusted intrinsic property descriptor and rebuilds a brand-new array literal from the
 * captured primitive values, so downstream validation AND the frozen output both come from the one
 * inert snapshot. TOTAL and fail-closed: EVERY potentially-throwing reflective inspection below —
 * `Array.isArray` (which THROWS on a revoked Proxy), getPrototypeOf, getOwnPropertyDescriptor,
 * Reflect.ownKeys — is inside the guard, so any hostile trap fails closed to null rather than
 * throwing out. It NEVER freezes or mutates the caller input.
 *
 * Rejects (→ null): a non-Array; a value whose [[Prototype]] is not exactly the intrinsic
 * Array.prototype (an Array subclass / re-parented array whose own map/slice/iterator could be
 * hostile); a non-own or accessor "length"; a non-integer / negative / over-bound length; a missing
 * (hole / sparse) index; an accessor index descriptor; any own key that is neither a canonical
 * in-range decimal index nor "length" (a symbol key, a stray named property, "00"/"-0"/"1.5", an
 * out-of-range numeric key). The caller freezes the returned fresh array after validating it.
 */
function strictArraySnapshot(x: unknown): unknown[] | null {
  try {
    if (!Array.isArray(x)) return null; // brand check — THROWS on a revoked Proxy, caught below
    // The [[Prototype]] MUST be exactly the intrinsic Array.prototype — reject an Array subclass or
    // a re-parented array whose own map/slice/iterator/Symbol.iterator could be caller-controlled.
    if (Object.getPrototypeOf(x) !== Array.prototype) return null;
    // Capture "length" as an OWN DATA property (never a caller getter).
    const lenDesc = Object.getOwnPropertyDescriptor(x, "length");
    if (!lenDesc || typeof lenDesc.get === "function" || typeof lenDesc.set === "function" || !("value" in lenDesc)) return null;
    const len = lenDesc.value;
    if (typeof len !== "number" || !Number.isInteger(len) || len < 0 || len > MAX_OP_ARRAY_LEN) return null;
    // Every own key must be a canonical decimal index in [0,len) or "length" — a symbol key, a stray
    // named property, or a non-canonical / out-of-range numeric key REJECTS the whole value.
    const keys = Reflect.ownKeys(x);
    for (const k of keys) {
      if (k === "length") continue;
      if (typeof k === "symbol") return null;
      const n = Number(k);
      if (!(String(n) === k && Number.isInteger(n) && n >= 0 && n < len)) return null;
    }
    // Capture each index 0..len-1 as an OWN DATA value (reject holes + accessors); read exactly ONCE
    // so validation and the rebuilt output can never observe two different sequences.
    const out: unknown[] = [];
    for (let i = 0; i < len; i++) {
      const d = Object.getOwnPropertyDescriptor(x, i);
      if (!d) return null; // hole / sparse
      if (typeof d.get === "function" || typeof d.set === "function" || !("value" in d)) return null; // accessor
      out.push(d.value);
    }
    return out; // a FRESH ordinary array (intrinsic prototype); the caller validates then freezes it
  } catch {
    return null; // any hostile reflective-trap exception → fail closed
  }
}

/**
 * Runtime-validate an untrusted candidate into an IMMUTABLE LiveAiOperation, or
 * null. REV-01: the body must be an exact validated data record — any undeclared
 * property (enumerable/non-enumerable/symbol/inherited/accessor) or a smuggled
 * url/path/href/method/selector/html/js/hotelId REJECTS the whole operation. The
 * returned value is a FROZEN canonical copy built only from own data props; the
 * runtime executes from this copy and never re-reads the original.
 */
export function validateOperation(x: unknown): LiveAiOperation | null {
  // R5A SECOND REMEDIATION (REV-NEW-01): TOTAL, fail-closed for arbitrary JS input. EVERY
  // potentially-throwing inspection of the untrusted value lives INSIDE this guard — including the
  // `Array.isArray(x)` brand check, which THROWS on a REVOKED Proxy. A hostile Proxy trap anywhere
  // below (the head guard, the discriminant read, strictOwnDataRecord, or the strict array snapshot)
  // fails closed to null instead of throwing OUT of the validator; nothing is repaired/coerced.
  try {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  // Read `op` only as an own DATA property (never inherited / accessor).
  const opDesc = Object.getOwnPropertyDescriptor(x, "op");
  if (!opDesc || !("value" in opDesc) || typeof opDesc.get === "function") return null;
  const name = opDesc.value;
  if (typeof name !== "string") return null;
  const allowed = (OP_ALLOWED_KEYS as Record<string, readonly string[]>)[name];
  if (!allowed) return null; // unknown op
  const a = strictOwnDataRecord(x, allowed);
  if (!a) return null; // symbol/accessor/undeclared own key → fail closed

  switch (name) {
    case "APPLY_HOTEL_REFINEMENT": {
      // R5A — UNTRUSTED external operation authority (REJECT-not-normalize). A present field
      // is accepted ONLY in its already-canonical form (an EQUALITY ORACLE over the SAME trusted
      // page-builder canonicalizers) — never trimmed / lowercased / collapsed / coerced / sorted /
      // deduped / truncated / repaired; anything they would have CHANGED fails the WHOLE op. A
      // null field is "not part of this refinement" (skip) — the SAME meaning the provider schema
      // and the gateway mirror give it, so client == server EXACTLY. At least one non-null valid
      // field must survive, else the refinement is empty and refused.
      const out: Extract<LiveAiOperation, { op: "APPLY_HOTEL_REFINEMENT" }> = { op: "APPLY_HOTEL_REFINEMENT" };
      let touched = false;
      if (hasOwnData(a, "destination") && a.destination !== null) {
        if (typeof a.destination !== "string" || canonicalCity(a.destination) !== a.destination) return null;
        out.destination = a.destination; touched = true;
      }
      if (hasOwnData(a, "query") && a.query !== null) {
        if (typeof a.query !== "string" || boundedQuery(a.query) !== a.query) return null;
        out.query = a.query; touched = true;
      }
      if (hasOwnData(a, "maxPrice") && a.maxPrice !== null) {
        // strict number (NO numeric-string coercion), > 0, within the shared operation bound.
        if (typeof a.maxPrice !== "number" || !Number.isFinite(a.maxPrice) || a.maxPrice <= 0 || a.maxPrice > MAX_OP_PRICE) return null;
        out.maxPrice = a.maxPrice; touched = true;
      }
      if (hasOwnData(a, "parking") && a.parking !== null) {
        if (typeof a.parking !== "boolean") return null;
        out.parking = a.parking; touched = true;
      }
      if (hasOwnData(a, "sort") && a.sort !== null) {
        if (!isHotelSort(a.sort)) return null;
        out.sort = a.sort; touched = true;
      }
      if (hasOwnData(a, "stars") && a.stars !== null) {
        // R5A SECOND REMEDIATION (REV-NEW-02): SNAPSHOT the array to a fresh inert copy via trusted
        // descriptor capture (never the caller's map/slice/iterator) BEFORE validating — a hostile
        // Array cannot make validation inspect one sequence while the frozen output carries another
        // (e.g. stars [1] whose map() returns [5]). Length 1..(MAX-MIN+1); each star a STRICT integer
        // in [MIN,MAX] (no coercion); ALREADY strictly DESCENDING (⇒ unique + no reorder) — the op is
        // refused, never deduped/sorted/coerced/repaired, on a duplicate / out-of-order / out-of-range.
        const snap = strictArraySnapshot(a.stars);
        if (!snap) return null;
        if (snap.length < 1 || snap.length > MAX_STARS - MIN_STARS + 1) return null;
        for (let i = 0; i < snap.length; i++) {
          const s = snap[i];
          if (typeof s !== "number" || !Number.isInteger(s) || s < MIN_STARS || s > MAX_STARS) return null;
        }
        const arr = snap as number[];
        for (let i = 1; i < arr.length; i++) if (!(arr[i] < arr[i - 1])) return null; // strictly descending
        out.stars = Object.freeze(arr.slice()) as number[]; touched = true;
      }
      if (!touched) return null; // no recognized non-null field ⇒ nothing to apply
      return Object.freeze(out);
    }
    case "READ_CURRENT_RESULTS":
      return Object.freeze({ op: "READ_CURRENT_RESULTS" as const });
    case "READ_CURRENT_HOTEL_FACTS":
      return Object.freeze({ op: "READ_CURRENT_HOTEL_FACTS" as const });
    case "COMPARE_VISIBLE_HOTELS": {
      // R5A SECOND REMEDIATION (REV-NEW-02): SNAPSHOT both arrays to fresh inert copies via trusted
      // descriptor capture (never caller map/slice/iterator/for-of/new Set(untrusted)) BEFORE any
      // validation, so a hostile Array cannot make validation inspect one sequence while the frozen
      // output carries another (e.g. positions [999,999] whose map() returns [1,2], or factors
      // ["zoom"] whose iterator yields "price"). EXACT positions: length 2..MAX, each a STRICT
      // in-range integer (no coercion), DISTINCT (a duplicate REJECTS — never dedupe), ORDER GIVEN
      // (never sort). Factors: length 1..N, each a recognized factor, DISTINCT, order given (an
      // unknown or duplicate factor REJECTS — never dedupe/repair). Distinctness is an O(n²) scan on
      // the FRESH snapshot, never new Set(<untrusted>).
      const posSnap = strictArraySnapshot(a.positions);
      if (!posSnap) return null;
      if (posSnap.length < 2 || posSnap.length > MAX_COMPARE_POSITIONS) return null;
      for (let i = 0; i < posSnap.length; i++) {
        const p = posSnap[i];
        if (typeof p !== "number" || !Number.isInteger(p) || p < 1 || p > MAX_VISIBLE_HOTELS) return null;
      }
      const pnums = posSnap as number[];
      for (let i = 0; i < pnums.length; i++) for (let j = i + 1; j < pnums.length; j++) if (pnums[i] === pnums[j]) return null; // duplicate → reject
      const facSnap = strictArraySnapshot(a.factors);
      if (!facSnap) return null;
      if (facSnap.length < 1 || facSnap.length > HOTEL_COMPARE_FACTORS.length) return null;
      for (let i = 0; i < facSnap.length; i++) if (!isHotelCompareFactor(facSnap[i])) return null; // unknown factor → reject
      const factors = facSnap as HotelCompareFactor[];
      for (let i = 0; i < factors.length; i++) for (let j = i + 1; j < factors.length; j++) if (factors[i] === factors[j]) return null; // duplicate → reject
      return Object.freeze({
        op: "COMPARE_VISIBLE_HOTELS" as const,
        positions: Object.freeze(pnums.slice()) as number[],
        factors: Object.freeze(factors.slice()) as HotelCompareFactor[],
      });
    }
    case "OPEN_VISIBLE_HOTEL": {
      // R5A — STRICT position (no numeric-string coercion), parity with the gateway mirror.
      if (typeof a.position !== "number" || !Number.isInteger(a.position) || a.position < 1 || a.position > MAX_VISIBLE_HOTELS) return null;
      return Object.freeze({ op: "OPEN_VISIBLE_HOTEL" as const, position: a.position });
    }
    case "SHOW_HOTEL_SECTION": {
      if (!isHotelSection(a.section)) return null;
      return Object.freeze({ op: "SHOW_HOTEL_SECTION" as const, section: a.section });
    }
    default:
      return null;
  }
  } catch {
    return null; // any hostile reflective-trap / nested-array-inspection exception → fail closed
  }
}

// Exported for the strict ENVELOPE validator (runtime.ts) — same fail-closed
// inspection contract (R1-REV-NEW-01).
export { strictOwnDataRecord };

// ---- PURE snapshot builders (used by BOTH the bridges and the tests) --------
// REV-12: the authority-relevant snapshot logic is production code exercised
// directly by tests. REV-05: contextRevision is a synchronous fingerprint of
// the complete normalized snapshot. REV-11: every field is bounded here.

function minPriceOfHotel(h: any): number | null {
  if (h && typeof h === "object" && h._minPrice !== undefined) {
    return boundedPrice(h._minPrice);
  }
  const rooms = Array.isArray(h?.rooms) ? h.rooms : [];
  let min = Infinity;
  for (const r of rooms) {
    const f = boundedPrice((r as any)?.floorPrice);
    if (f != null && f > 0 && f < min) min = f;
  }
  return Number.isFinite(min) ? min : null;
}

function boundedAmenityVocabulary(vocab: unknown): string[] {
  if (!Array.isArray(vocab)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of vocab) {
    if (typeof a !== "string") continue;
    if (!a) continue;
    // REV-11: an over-bound selectable/filter option is OMITTED, never truncated
    // (truncation would manufacture a value that is not in the real page
    // vocabulary). The label is kept VERBATIM so it stays byte-identical to the
    // page option the setter matches.
    if (a.length > MAX_AMENITY_LABEL_LEN) continue;
    if (seen.has(a)) continue;
    seen.add(a);
    out.push(a);
    if (out.length >= MAX_AMENITIES) break;
  }
  return out;
}

export interface HotelsSnapshotInput {
  displayHotels: any[];
  /** current requested destination input (page `city`). */
  city: string;
  /** current requested query input (page `debouncedSearch`). */
  query: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  maxPrice: number | null;
  sort: HotelSort;
  stars: number[];
  /** currently-applied amenity filters (page amenitySel). */
  appliedAmenities: string[];
  /** selectable amenity vocabulary (page amenityOpts) — REV-08. */
  amenityOpts: string[];
  loading: boolean;
  error: string;
  /** destination the CURRENT displayHotels correspond to (page resolved state). */
  resolvedCity: string;
  resolvedQuery: string;
  /** status of the winning request that produced displayHotels. */
  resolvedStatus: "ready" | "error";
  role?: LiveAiRole;
}

export function buildHotelsSnapshot(input: HotelsSnapshotInput): HotelsListContext {
  const requestedCity = input.city ? canonicalCity(input.city) : null;
  const requestedQuery = input.query ? boundedQuery(input.query) : null;
  const resolvedCity = input.resolvedCity ? canonicalCity(input.resolvedCity) : null;
  const resolvedQuery = input.resolvedQuery ? boundedQuery(input.resolvedQuery) : null;

  const requestedMatchesResolved = requestedCity === resolvedCity && requestedQuery === resolvedQuery;
  const status: CatalogueReceipt["status"] =
    input.loading || !requestedMatchesResolved
      ? "loading"
      : input.resolvedStatus === "error"
        ? "error"
        : "ready";

  const src = Array.isArray(input.displayHotels) ? input.displayHotels : [];
  const visibleHotels: VisibleHotelSummary[] = [];
  const scan = Math.min(src.length, MAX_VISIBLE_HOTELS);
  for (let i = 0; i < scan; i++) {
    const h = src[i];
    // REV-07: NEVER renumber. Preserve the TRUE visual position (i+1); an
    // invalid-id row simply leaves a gap so ordinals never silently shift.
    if (!h || !isValidHotelId(h.id)) continue;
    visibleHotels.push({
      position: i + 1,
      id: h.id,
      name: safeStr(h.name, MAX_NAME_LEN),
      city: safeStr(h.city, MAX_CITY_DISPLAY_LEN),
      minPrice: minPriceOfHotel(h),
      rating: numInRange(h.avgRating, 0, 5),
      parking: facilityFact(h.amenities, "parking"),
    });
  }

  // R3 Fix 3 (REV-08): the applied-parking flag uses the SAME exact positive
  // allowlist as resolveParkingAmenity — NEVER substring inclusion. So an applied
  // amenity of "No Parking" / "Parking unavailable" / "Parking nearby" can never
  // flip parking = true.
  const parkingActive = (Array.isArray(input.appliedAmenities) ? input.appliedAmenities : []).some(
    isPositiveParkingLabel,
  );

  const core: Omit<HotelsListContext, "contextRevision"> = {
    pageId: "hotels",
    role: input.role || "anonymous",
    destination: requestedCity,
    query: requestedQuery,
    checkIn: isoDate(input.checkIn),
    checkOut: isoDate(input.checkOut),
    guests: numInRange(input.guests, 1, MAX_GUESTS),
    maxPrice: input.maxPrice == null ? null : boundedPrice(input.maxPrice),
    parking: parkingActive,
    sort: isHotelSort(input.sort) ? input.sort : "default",
    stars: (Array.isArray(input.stars) ? input.stars : [])
      .map((s) => strictFinite(s))
      .filter((s): s is number => s !== null && Number.isInteger(s) && s >= MIN_STARS && s <= MAX_STARS)
      .sort((p, q) => q - p),
    loadState: status,
    receipt: { city: resolvedCity, query: resolvedQuery, requestedCity, requestedQuery, status },
    visibleHotels,
    availableAmenities: boundedAmenityVocabulary(input.amenityOpts),
  };
  return { ...core, contextRevision: fingerprint(core) };
}

export interface HotelDetailSnapshotInput {
  routeId: string;
  hotel: any | null;
  loading: boolean;
  loadErr: boolean;
  tab: string;
  role?: LiveAiRole;
}

export function buildHotelDetailSnapshot(input: HotelDetailSnapshotInput): HotelDetailContext {
  const routeHotelId = isValidHotelId(input.routeId) ? input.routeId : null;
  const h = input.hotel;
  const currentHotelId = h && isValidHotelId(h.id) ? h.id : null;
  const loadState: HotelDetailContext["loadState"] = input.loading ? "loading" : input.loadErr ? "error" : "ready";
  const section: HotelSection = input.tab === "about" ? "about" : "rooms";

  // REV-10: detail authority ONLY after ready AND route id == loaded id.
  const validated = loadState === "ready" && !!routeHotelId && !!currentHotelId && routeHotelId === currentHotelId;

  const roomTypes: RoomTypeSummary[] =
    validated && Array.isArray(h?.rooms)
      ? h.rooms
          .slice(0, MAX_ROOM_TYPES)
          .map((r: any) => ({ name: safeStr(r?.name, MAX_NAME_LEN), floorPrice: boundedPrice(r?.floorPrice) }))
          .filter((r: RoomTypeSummary) => r.name)
      : [];

  const hotel =
    validated && currentHotelId && h
      ? {
          id: currentHotelId,
          name: safeStr(h.name, MAX_NAME_LEN),
          city: safeStr(h.city, MAX_CITY_DISPLAY_LEN),
          starRating: numInRange(h.starRating, 0, 5),
          avgRating: numInRange(h.avgRating, 0, 5),
          minPrice: minPriceOfHotel(h),
        }
      : null;

  const core: Omit<HotelDetailContext, "contextRevision"> = {
    pageId: "hotel-detail",
    role: input.role || "anonymous",
    routeHotelId,
    currentHotelId,
    loadState,
    validated,
    section,
    hotel,
    roomTypes,
    // Facts are only meaningful once validated; otherwise unknown (no stale hotel).
    breakfast: validated ? facilityFact(h?.amenities, "breakfast") : "unknown",
    parking: validated ? facilityFact(h?.amenities, "parking") : "unknown",
  };
  return { ...core, contextRevision: fingerprint(core) };
}

/**
 * SYNCHRONOUS complete-state fingerprint (REV-05). Deterministic JSON over the
 * whole normalized snapshot core (fixed key insertion order + null-normalized),
 * so ANY authority-relevant change yields a different revision immediately — no
 * post-render useEffect window where an old envelope could execute against new
 * facts.
 */
export function fingerprint(core: object): string {
  return "fp:" + JSON.stringify(core, (_k, v) => (v === undefined ? null : v));
}

// ---- catalogue request coordinator (REV-12) ---------------------------------
// The authority-relevant request-race logic, extracted as a PURE production
// primitive that app/hotels/page.tsx USES and the tests EXECUTE (so the winner
// behaviour is proven behaviorally, not by duplicating the algorithm in a test).
// A monotonic request id is claimed when a catalogue fetch starts; ONLY the
// current (latest) request may publish results / a resolved receipt / an error /
// clear the loading flag. A superseded (stale) response publishes NOTHING.

export function nextRequestId(prev: number): number {
  return (Number.isInteger(prev) && prev >= 0 ? prev : 0) + 1;
}

export interface CatalogueResponseUpdate {
  publishResults: boolean;
  publishReceipt: boolean;
  setError: boolean;
  clearLoading: boolean;
}

const STALE_RESPONSE: Readonly<CatalogueResponseUpdate> = Object.freeze({
  publishResults: false, publishReceipt: false, setError: false, clearLoading: false,
});

/**
 * Decide what a completing catalogue response is ALLOWED to publish. `myReqId`
 * is the id claimed when THIS request started; `currentReqId` is the latest
 * claimed id. A superseded response is allowed nothing — it can neither set
 * hotels, publish a receipt, set error, nor clear a newer request's loading flag.
 */
export function catalogueResponseUpdate(
  myReqId: number,
  currentReqId: number,
  kind: "success" | "error",
): Readonly<CatalogueResponseUpdate> {
  if (myReqId !== currentReqId) return STALE_RESPONSE;
  return Object.freeze({
    publishResults: kind === "success",
    publishReceipt: true,
    setError: kind === "error",
    clearLoading: true,
  });
}
