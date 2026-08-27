// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-01 — typed contracts + runtime validation.
//
// This module is the SINGLE source of truth for:
//   • bounded/canonical input validation (city, query, hotel id, rooms…)
//   • normalized read-result shapes (the ONLY fields Voice ever sees)
//   • the runtime-validated discriminated UI-action union
//
// Everything here is PURE (no I/O, no React, no next/*, no @/lib imports) so it
// can be compiled + exercised in isolation by tests/voice/voice-ai.test.js and
// reused on both the client seam and the (future) provider layer.
//
// Malformed / unknown input ALWAYS fails closed → returns null (never throws,
// never a partially-trusted object).
// ─────────────────────────────────────────────────────────────────────────

// ---- bounds (kept small + explicit; the security tests assert these) --------
export const MAX_CITY_LEN = 40;
export const MAX_QUERY_LEN = 60;
export const MAX_HOTEL_ID_LEN = 64;
export const MAX_SEARCH_RESULTS = 24;
export const MAX_FLASH_RESULTS = 24;
export const MAX_COMPARE_HOTELS = 3;
export const MAX_AMENITIES = 12;
export const MAX_IMAGES = 6;

// ---- REREV-03 data-domain bounds --------------------------------------------
// Image string length + form. Grounded in lib/sb-image.ts, which documents that
// catalogue image strings are http(s):// URLs (Supabase Storage / Unsplash).
export const MAX_IMAGE_URL_LEN = 512;
// Hotel star rating + review rating: the StayBid catalogue is a 5-star model
// (star badges + review ratings across the app), so [0..5] is the domain.
export const STAR_RATING_MIN = 0;
export const STAR_RATING_MAX = 5;
export const REVIEW_RATING_MIN = 0;
export const REVIEW_RATING_MAX = 5;
// Review count + price: no exact business ceiling is documented in the repo, so
// these are CONSERVATIVE TECHNICAL SAFETY BOUNDS (not business rules) that only
// exist to stop an extreme/unbounded value reaching the model/UI.
export const MAX_TOTAL_REVIEWS = 10_000_000; // technical safety bound
export const MAX_PRICE = 100_000_000; // ₹ — technical safety bound, not a pricing rule

// ---- capability names (the ONLY four active read capabilities) --------------
export type CapabilityName =
  | "searchHotels"
  | "getHotelDetails"
  | "getFlashDeals"
  | "compareHotels";

export const CAPABILITY_NAMES: readonly CapabilityName[] = Object.freeze([
  "searchHotels",
  "getHotelDetails",
  "getFlashDeals",
  "compareHotels",
]);

export function isCapabilityName(x: unknown): x is CapabilityName {
  return typeof x === "string" && (CAPABILITY_NAMES as readonly string[]).includes(x);
}

// ---- primitive input validators (bounded + canonical, fail-closed) ----------

/**
 * Canonicalize a city token. Trims, collapses inner whitespace, bounds length,
 * and rejects anything containing characters outside letters/space/hyphen/dot.
 * Returns a canonical lower-cased token, or null when invalid/empty.
 *
 * NOTE: this is a FORMAT canonicalizer (the security boundary). It deliberately
 * does not couple to a hard-coded city list so the catalogue can grow without a
 * code change; the underlying API still applies its own approval/curation gate.
 */
export function canonicalCity(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  if (trimmed.length > MAX_CITY_LEN) return null;
  // letters (incl. common accents), spaces, hyphen, apostrophe, dot only.
  if (!/^[A-Za-zÀ-ɏ .'-]+$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

/** Bounded free-text search query. Returns a trimmed string, or null. */
export function boundedQuery(input: unknown): string | null {
  if (typeof input !== "string") return null;
  // Drop ASCII control chars (code < 0x20 and DEL 0x7F) via char-code filter,
  // then collapse whitespace. No control-char literals in source.
  const cleaned = Array.from(input)
    .filter((ch) => { const c = ch.charCodeAt(0); return c >= 0x20 && c !== 0x7f; })
    .join("")
    .trim()
    .replace(/\s+/g, " ");
  if (!cleaned) return null;
  if (cleaned.length > MAX_QUERY_LEN) return null;
  return cleaned;
}

/** A StayBid hotel id (CUID-ish TEXT). Bounded + charset-restricted. */
export function isValidHotelId(input: unknown): input is string {
  return (
    typeof input === "string" &&
    input.length > 0 &&
    input.length <= MAX_HOTEL_ID_LEN &&
    // CUIDs / auto-<id> — alnum, underscore, hyphen only. No slashes/dots/scheme.
    /^[A-Za-z0-9_-]+$/.test(input)
  );
}

/** Clamp an arbitrary requested count into [1, max]. */
export function clampCount(n: unknown, max: number): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1) return 1;
  return Math.min(v, max);
}

// ---- normalized read-result shapes (Voice NEVER sees the raw rows) ----------
export interface NormalizedHotel {
  id: string;
  name: string;
  city: string;
  starRating: number | null;
  avgRating: number | null;
  minPrice: number | null;
}

export interface NormalizedHotelDetails extends NormalizedHotel {
  amenities: string[];
  images: string[];
  totalReviews: number | null;
  roomTypes: Array<{ name: string; floorPrice: number | null }>;
}

export interface NormalizedFlashDeal {
  id: string;
  hotelId: string | null;
  hotelName: string;
  city: string;
  price: number | null;
  wasPrice: number | null;
  /** DERIVED from (wasPrice, price) — never the raw API `discount` field. */
  discountPct: number | null;
}

export interface HotelComparisonRow {
  id: string;
  name: string;
  city: string;
  starRating: number | null;
  avgRating: number | null;
  minPrice: number | null;
}

export interface HotelComparison {
  hotels: HotelComparisonRow[];
  cheapestId: string | null;
  topRatedId: string | null;
}

// ---- the runtime-validated UI action union ----------------------------------
// A CLOSED discriminated union. There is deliberately NO free-form url/route/
// selector/href field anywhere — a destination can only ever be an allowlisted
// hotel id (OPEN_HOTEL) that the dispatcher re-checks before routing.

export type VoiceUiAction =
  | { type: "FOCUS_SEARCH" }
  | { type: "APPLY_SEARCH"; city: string | null; query: string | null }
  | {
      type: "APPLY_FILTERS";
      sort?: "default" | "price-asc" | "price-desc" | "rating";
      stars?: number[];
    }
  | { type: "SHOW_RESULTS" }
  | { type: "OPEN_HOTEL"; hotelId: string }
  | { type: "SHOW_FLASH_DEALS"; city: string | null }
  | { type: "SHOW_COMPARISON"; hotelIds: string[] }
  | { type: "PREPARE_BID_DRAFT"; hotelId: string; pricePerNight: number | null };

export const UI_ACTION_TYPES: readonly VoiceUiAction["type"][] = Object.freeze([
  "FOCUS_SEARCH",
  "APPLY_SEARCH",
  "APPLY_FILTERS",
  "SHOW_RESULTS",
  "OPEN_HOTEL",
  "SHOW_FLASH_DEALS",
  "SHOW_COMPARISON",
  "PREPARE_BID_DRAFT",
]);

const SORT_VALUES = ["default", "price-asc", "price-desc", "rating"] as const;

/**
 * Runtime-validate an untrusted candidate into a VoiceUiAction, or null.
 * Unknown `type`, missing/mis-typed fields, or ANY extra structure that would
 * imply an arbitrary destination → null (fail closed). Only the fields declared
 * for each variant are read; nothing else is ever carried through.
 */
export function validateUiAction(x: unknown): VoiceUiAction | null {
  if (!x || typeof x !== "object") return null;
  const a = x as Record<string, unknown>;
  switch (a.type) {
    case "FOCUS_SEARCH":
      return { type: "FOCUS_SEARCH" };
    case "SHOW_RESULTS":
      return { type: "SHOW_RESULTS" };
    case "APPLY_SEARCH": {
      const city = a.city == null ? null : canonicalCity(a.city);
      const query = a.query == null ? null : boundedQuery(a.query);
      // If a value was supplied but failed validation, reject the whole action.
      if (a.city != null && city === null) return null;
      if (a.query != null && query === null) return null;
      return { type: "APPLY_SEARCH", city, query };
    }
    case "APPLY_FILTERS": {
      const out: Extract<VoiceUiAction, { type: "APPLY_FILTERS" }> = { type: "APPLY_FILTERS" };
      if (a.sort != null) {
        if (!(SORT_VALUES as readonly unknown[]).includes(a.sort)) return null;
        out.sort = a.sort as (typeof SORT_VALUES)[number];
      }
      if (a.stars != null) {
        if (!Array.isArray(a.stars)) return null;
        const stars = a.stars
          .map((s) => Math.floor(Number(s)))
          .filter((s) => Number.isFinite(s) && s >= 1 && s <= 5);
        out.stars = Array.from(new Set(stars));
      }
      return out;
    }
    case "OPEN_HOTEL":
      if (!isValidHotelId(a.hotelId)) return null;
      return { type: "OPEN_HOTEL", hotelId: a.hotelId };
    case "SHOW_FLASH_DEALS": {
      const city = a.city == null ? null : canonicalCity(a.city);
      if (a.city != null && city === null) return null;
      return { type: "SHOW_FLASH_DEALS", city };
    }
    case "SHOW_COMPARISON": {
      if (!Array.isArray(a.hotelIds)) return null;
      const ids = a.hotelIds.filter(isValidHotelId) as string[];
      if (ids.length === 0 || ids.length !== a.hotelIds.length) return null;
      if (ids.length > MAX_COMPARE_HOTELS) return null;
      return { type: "SHOW_COMPARISON", hotelIds: Array.from(new Set(ids)) };
    }
    case "PREPARE_BID_DRAFT": {
      if (!isValidHotelId(a.hotelId)) return null;
      const price =
        a.pricePerNight == null || !Number.isFinite(Number(a.pricePerNight))
          ? null
          : Math.max(0, Math.floor(Number(a.pricePerNight)));
      return { type: "PREPARE_BID_DRAFT", hotelId: a.hotelId, pricePerNight: price };
    }
    default:
      return null;
  }
}
