// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-01 — result normalization / data minimization.
//
// The StayBid read APIs return rich raw rows (owner ids, contact, agent ids,
// free-text description, internal flags…). Voice must NEVER see those. Each
// normalizer PICKS an explicit safe subset and drops everything else — the model
// context only ever contains public catalogue fields.
//
// Property/deal text is DATA, not instructions — normalized strings are bounded
// and carried as plain values.
//
// Pure module: no I/O, no React, no next/*, no @/lib imports.
// ─────────────────────────────────────────────────────────────────────────
import {
  type NormalizedHotel,
  type NormalizedHotelDetails,
  type NormalizedFlashDeal,
  isValidHotelId,
  MAX_AMENITIES,
  MAX_IMAGES,
  MAX_IMAGE_URL_LEN,
  STAR_RATING_MIN,
  STAR_RATING_MAX,
  REVIEW_RATING_MIN,
  REVIEW_RATING_MAX,
  MAX_TOTAL_REVIEWS,
  MAX_PRICE,
} from "./contracts";

function str(v: unknown, max = 120): string {
  if (typeof v !== "string") return "";
  return v.slice(0, max);
}

// ---- REREV2-01 STRICT numeric input boundary (fail closed → null) -----------
// Malformed JS values must NOT be coerced into apparently-valid numbers. A bare
// Number(v) turns null/""/" "/false/[]/[1] → 0 and true → 1; that is forbidden.
// Accept ONLY: (a) a finite number primitive, OR (b) a deliberately valid,
// non-empty, STRICT decimal numeric string. The StayBid catalogue legitimately
// supplies these fields as number|string (evidence: lib/min-price.ts types
// floorPrice/aiPrice as `number | string | null`, and every consumer wraps reads
// in Number(); Postgres `numeric` columns serialize to JSON strings via
// PostgREST). Rejects null/undefined/boolean/array/object/symbol/bigint, ""/" ",
// "12abc", "0x10", "Infinity", "NaN", exponent forms, NaN, ±Infinity.
const STRICT_NUMERIC_STRING = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;
function strictFinite(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t || !STRICT_NUMERIC_STRING.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null; // null/undefined/boolean/array/object/symbol/bigint
}

/** Finite number within [min,max] (strict input), else null. */
function numInRange(v: unknown, min: number, max: number): number | null {
  const n = strictFinite(v);
  if (n === null || n < min || n > max) return null;
  return n;
}
/** Non-negative finite price ≤ MAX_PRICE (strict input), else null (0 allowed). */
function boundedPrice(v: unknown): number | null {
  const n = strictFinite(v);
  if (n === null || n < 0 || n > MAX_PRICE) return null;
  return n;
}
/** Non-negative INTEGER-valued review count ≤ MAX_TOTAL_REVIEWS (strict), else null. */
function boundedReviewCount(v: unknown): number | null {
  const n = strictFinite(v);
  if (n === null || n < 0 || n > MAX_TOTAL_REVIEWS) return null;
  return Math.floor(n);
}

// ---- REREV2-02 ROBUST image-value validation (fail closed → null) -----------
// Accept ONLY: (A) an absolute http(s):// URL parsed by the platform URL parser
// (exact protocol, non-empty host, NO userinfo/credentials), OR (B) a safe
// root-relative "/…" path (single leading slash, no dot-segment traversal
// raw/encoded, no smuggled separators). Reject ALL C0 controls (U+0000–U+001F)
// + DEL (U+007F), whitespace, backslashes, protocol-relative "//host", and every
// other scheme. Syntactic normalization ONLY — no fetch, no DNS, no request.
function hasControlOrUnsafe(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return true; // C0 controls + DEL — not only \s
  }
  return /[\s\\]/.test(s); // whitespace + backslash
}
function safeDecode(seg: string): string | null {
  try {
    return decodeURIComponent(seg);
  } catch {
    return null; // malformed percent-encoding
  }
}
function safeRootRelativePath(s: string): boolean {
  if (s[0] !== "/" || s[1] === "/") return false; // exactly one leading slash
  const pathOnly = s.split(/[?#]/)[0]; // validate the path part; query/hash ignored
  const segments = pathOnly.split("/");
  for (const seg of segments) {
    const dec = safeDecode(seg);
    if (dec === null) return false; // malformed percent-encoding
    if (dec === "." || dec === "..") return false; // dot-segment traversal
    if (/[/\\]/.test(dec)) return false; // smuggled separator (e.g. %2f, %2e%2e%2f)
    for (let i = 0; i < dec.length; i++) {
      const c = dec.charCodeAt(i);
      if (c <= 0x1f || c === 0x7f) return false; // encoded control (e.g. %00)
    }
  }
  return true;
}
function safeImage(v: unknown): string | null {
  if (typeof v !== "string") return null;
  if (!v || v.length > MAX_IMAGE_URL_LEN) return null;
  if (hasControlOrUnsafe(v)) return null;
  if (/^https?:\/\//i.test(v)) {
    let u: URL;
    try {
      u = new URL(v);
    } catch {
      return null; // unparseable (e.g. "https://?x", "https://#x" → empty host)
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname) return null;
    if (u.username || u.password) return null; // no credentials/userinfo
    return v; // return the validated ORIGINAL string (no normalization/rewrite)
  }
  if (safeRootRelativePath(v)) return v;
  return null;
}

function minRoomFloor(rooms: unknown): number | null {
  if (!Array.isArray(rooms)) return null;
  let min = Infinity;
  for (const r of rooms) {
    const f = boundedPrice((r as any)?.floorPrice);
    if (f != null && f > 0 && f < min) min = f;
  }
  return Number.isFinite(min) ? min : null;
}

export function normalizeHotel(raw: unknown): NormalizedHotel | null {
  if (!raw || typeof raw !== "object") return null;
  const h = raw as Record<string, unknown>;
  // REV-01: the id MUST pass the bounded hotel-id validator (charset + length),
  // else the row never enters Voice-visible output or any allowlist.
  if (!isValidHotelId(h.id)) return null;
  return {
    id: h.id,
    name: str(h.name),
    city: str(h.city, 60),
    starRating: numInRange(h.starRating, STAR_RATING_MIN, STAR_RATING_MAX),
    avgRating: numInRange(h.avgRating, REVIEW_RATING_MIN, REVIEW_RATING_MAX),
    minPrice: minRoomFloor(h.rooms),
  };
}

export function normalizeHotelList(raw: unknown, max: number): NormalizedHotel[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: NormalizedHotel[] = [];
  for (const item of arr) {
    const n = normalizeHotel(item);
    if (n) out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

export function normalizeHotelDetails(raw: unknown): NormalizedHotelDetails | null {
  if (!raw || typeof raw !== "object") return null;
  const h = raw as Record<string, unknown>;
  // REV-01: validate the detail id with the bounded validator.
  if (!isValidHotelId(h.id)) return null;

  const amenities = Array.isArray(h.amenities)
    ? h.amenities.filter((a): a is string => typeof a === "string").slice(0, MAX_AMENITIES).map((a) => str(a, 40))
    : [];
  // REREV-03: bound + form-gate every image string; drop any that don't match.
  const images = Array.isArray(h.images)
    ? h.images.map(safeImage).filter((s): s is string => s !== null).slice(0, MAX_IMAGES)
    : [];
  const roomTypes = Array.isArray(h.rooms)
    ? h.rooms
        .slice(0, 12)
        .map((r) => ({ name: str((r as any)?.name, 60), floorPrice: boundedPrice((r as any)?.floorPrice) }))
        .filter((r) => r.name)
    : [];

  // Explicitly DROPPED: ownerId, agentId, phone, email, contact, description,
  // address, internal flags, reviews free-text, roomListings host data, etc.
  return {
    id: h.id,
    name: str(h.name),
    city: str(h.city, 60),
    starRating: numInRange(h.starRating, STAR_RATING_MIN, STAR_RATING_MAX),
    avgRating: numInRange(h.avgRating, REVIEW_RATING_MIN, REVIEW_RATING_MAX),
    minPrice: minRoomFloor(h.rooms),
    amenities,
    images,
    totalReviews: boundedReviewCount(h.totalReviews),
    roomTypes,
  };
}

/**
 * DERIVE the discount from the two prices we surface — never trust the raw API
 * `discount` field (documented in CLAUDE.md as stale on /api/flash/near).
 */
export function derivedDiscountPct(wasPrice: number | null, price: number | null): number | null {
  if (wasPrice == null || price == null) return null;
  if (wasPrice <= 0 || price < 0 || price > wasPrice) return null;
  return Math.round(((wasPrice - price) / wasPrice) * 100);
}

export function normalizeFlashDeal(raw: unknown): NormalizedFlashDeal | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  // REV-01: the deal id AND the tagged hotelId are bounded/validated; an invalid
  // hotelId becomes null (never enters the allowlist via getFlashDeals).
  if (!isValidHotelId(d.id)) return null;
  const price = boundedPrice(d.aiPrice);
  const wasPrice = boundedPrice(d.marketRate);
  return {
    id: d.id,
    hotelId: isValidHotelId(d.hotelId) ? d.hotelId : null,
    hotelName: str(d.hotelName ?? d.name),
    city: str(d.city, 60),
    price,
    wasPrice,
    discountPct: derivedDiscountPct(wasPrice, price),
  };
}

export function normalizeFlashList(raw: unknown, max: number): NormalizedFlashDeal[] {
  // /api/flash/near returns { deals: [...] }.
  const deals = raw && typeof raw === "object" && Array.isArray((raw as any).deals)
    ? (raw as any).deals
    : Array.isArray(raw)
      ? raw
      : [];
  const out: NormalizedFlashDeal[] = [];
  for (const item of deals) {
    const n = normalizeFlashDeal(item);
    if (n) out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

// REREV-02: `normalizeComparisonRow` (which re-normalized a CALLER-supplied
// object) is removed. compareHotels no longer accepts caller catalogue values at
// all — it resolves every comparison row from the session's TRUSTED normalized
// map (populated only by approved read adapters), so caller-controlled
// name/city/rating/price can never enter the comparison output.
