// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-01 — allowlisted read adapters.
//
// The four active read capabilities. Each network one:
//   • routes through the policy gate + the static registry (no caller URL/method)
//   • REQUIRES a coherent VoiceTurn and derives its fetch AbortSignal FROM it
//     (REREV-01) — there is no separate caller-controlled signal; a call with no
//     valid turn fails closed
//   • fetches the EXISTING StayBid API same-origin, GET-only
//   • checks stale/aborted state before request, after fetch, and immediately
//     before ANY allowlist/trusted-map mutation or success return
//   • normalizes the result (data minimization)
//
// searchHotels / getHotelDetails ALSO record the normalized, VALIDATED hotel into
// the session's TRUSTED map, which is the ONLY source compareHotels reads from
// (REREV-02) — a caller can never inject catalogue values.
//
// PRIVACY: catalogue reads are anonymous — no customer auth token is forwarded
// into any adapter (no credential / auth header is ever set here).
//
// No React, no next/*, no @/lib imports — the only side effect is `fetch`, which
// is injectable for tests.
// ─────────────────────────────────────────────────────────────────────────
import {
  type NormalizedHotel,
  type NormalizedHotelDetails,
  type NormalizedFlashDeal,
  type HotelComparison,
  type HotelComparisonRow,
  isValidHotelId,
  MAX_SEARCH_RESULTS,
  MAX_FLASH_RESULTS,
  MAX_COMPARE_HOTELS,
} from "./contracts";
import { getDescriptor } from "./registry";
import { evaluatePolicy, type PolicyDenyReason } from "./policy";
import { type VoiceSession, type VoiceTurn } from "./session";
import { normalizeHotelList, normalizeHotelDetails, normalizeFlashList } from "./normalize";

export type FetchLike = (
  path: string,
  init?: { method?: string; signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface AdapterCtx {
  session: VoiceSession;
  /**
   * REREV-01: a coherent VoiceTurn is REQUIRED for every network adapter. The
   * fetch signal is derived from `turn.signal`; there is no separate optional
   * caller signal. A missing/malformed turn fails the call closed.
   */
  turn: VoiceTurn;
  fetchImpl?: FetchLike;
}

export type AdapterResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      reason: PolicyDenyReason | "request_failed" | "aborted" | "id_mismatch" | "no_turn_context";
    };

/** REREV-01: reject a ctx without a usable VoiceTurn (fail closed). */
function invalidTurn(ctx: AdapterCtx): boolean {
  const t = ctx && (ctx.turn as unknown as VoiceTurn);
  return (
    !t ||
    typeof t.isStale !== "function" ||
    typeof t.cancel !== "function" ||
    !t.signal ||
    typeof t.signal !== "object"
  );
}

/** REREV-01: a result is stale if the turn's signal aborted OR it was superseded/reset. */
function isStale(ctx: AdapterCtx): boolean {
  return Boolean(ctx.turn.signal.aborted) || ctx.turn.isStale();
}

function resolveFetch(ctx: AdapterCtx): FetchLike {
  if (ctx.fetchImpl) return ctx.fetchImpl;
  // Same-origin global fetch. Path is relative ("/api/…"), so no base URL is
  // ever chosen by the caller.
  return ((path: string, init?: any) => (globalThis.fetch as any)(path, init)) as FetchLike;
}

async function doGet(ctx: AdapterCtx, path: string): Promise<unknown> {
  const f = resolveFetch(ctx);
  // REREV-01: the fetch signal is the TURN's signal — nothing else.
  const res = await f(path, { method: "GET", signal: ctx.turn.signal });
  if (!res || !res.ok) throw new Error("request_failed");
  return res.json();
}

// ---- 1. searchHotels ---------------------------------------------------------
export async function searchHotels(
  ctx: AdapterCtx,
  input: { city?: string | null; q?: string | null },
): Promise<AdapterResult<NormalizedHotel[]>> {
  if (invalidTurn(ctx)) return { ok: false, reason: "no_turn_context" };
  if (isStale(ctx)) return { ok: false, reason: "aborted" };
  const decision = evaluatePolicy({ capability: "searchHotels", input: input as any }, ctx.session);
  if (!decision.ok) return { ok: false, reason: decision.reason };
  const built = getDescriptor("searchHotels").build!({ city: input.city, q: input.q });
  if (!built) return { ok: false, reason: "malformed_input" };
  try {
    const raw = await doGet(ctx, built.path);
    // REREV-01: reject a result that resolved after the turn was superseded/aborted
    // (even if the fetch impl ignored the abort) BEFORE any state mutation/return.
    if (isStale(ctx)) return { ok: false, reason: "aborted" };
    const hotels = raw && typeof raw === "object" ? (raw as any).hotels : raw;
    const normalized = normalizeHotelList(hotels, MAX_SEARCH_RESULTS);
    // Seed the allowlist AND the trusted map with exactly the validated records.
    ctx.session.allowHotelIds(normalized.map((h) => h.id));
    normalized.forEach((h) => ctx.session.trustHotel(h));
    return { ok: true, data: normalized };
  } catch (e: any) {
    if (e?.name === "AbortError") return { ok: false, reason: "aborted" };
    return { ok: false, reason: "request_failed" };
  }
}

// ---- 2. getHotelDetails (allowlist-gated) -----------------------------------
export async function getHotelDetails(
  ctx: AdapterCtx,
  input: { id: string },
): Promise<AdapterResult<NormalizedHotelDetails>> {
  if (invalidTurn(ctx)) return { ok: false, reason: "no_turn_context" };
  if (isStale(ctx)) return { ok: false, reason: "aborted" };
  const decision = evaluatePolicy({ capability: "getHotelDetails", input: input as any }, ctx.session);
  if (!decision.ok) return { ok: false, reason: decision.reason };
  const built = getDescriptor("getHotelDetails").build!({ id: input.id });
  if (!built) return { ok: false, reason: "malformed_input" };
  try {
    const raw = await doGet(ctx, built.path);
    // REREV-01: reject a superseded/aborted result before it can be used.
    if (isStale(ctx)) return { ok: false, reason: "aborted" };
    const hotel = raw && typeof raw === "object" ? (raw as any).hotel : raw;
    const normalized = normalizeHotelDetails(hotel);
    if (!normalized) return { ok: false, reason: "request_failed" };
    // REV-01: the returned normalized id MUST exactly equal the requested
    // allowlisted id. A mismatched response can neither be returned NOR expand
    // the allowlist to a different id.
    if (normalized.id !== input.id) return { ok: false, reason: "id_mismatch" };
    // REREV-02: this approved path legitimately surfaces the hotel → record a
    // trusted NormalizedHotel projection (base fields only) for comparison.
    ctx.session.trustHotel({
      id: normalized.id,
      name: normalized.name,
      city: normalized.city,
      starRating: normalized.starRating,
      avgRating: normalized.avgRating,
      minPrice: normalized.minPrice,
    });
    return { ok: true, data: normalized };
  } catch (e: any) {
    if (e?.name === "AbortError") return { ok: false, reason: "aborted" };
    return { ok: false, reason: "request_failed" };
  }
}

// ---- 3. getFlashDeals (read-only, canonical city) ---------------------------
export async function getFlashDeals(
  ctx: AdapterCtx,
  input: { city?: string | null },
): Promise<AdapterResult<NormalizedFlashDeal[]>> {
  if (invalidTurn(ctx)) return { ok: false, reason: "no_turn_context" };
  if (isStale(ctx)) return { ok: false, reason: "aborted" };
  const decision = evaluatePolicy({ capability: "getFlashDeals", input: input as any }, ctx.session);
  if (!decision.ok) return { ok: false, reason: decision.reason };
  const built = getDescriptor("getFlashDeals").build!({ city: input.city });
  if (!built) return { ok: false, reason: "malformed_input" };
  try {
    const raw = await doGet(ctx, built.path);
    // REREV-01: reject a superseded/aborted result before allowlist mutation.
    if (isStale(ctx)) return { ok: false, reason: "aborted" };
    const normalized = normalizeFlashList(raw, MAX_FLASH_RESULTS);
    // Deal hotel ids are allowlisted (open/detail), but a flash deal carries NO
    // rating/price, so it does NOT populate the trusted comparison map — a
    // flash-only hotel therefore can't be compared until it is fully read.
    ctx.session.allowHotelIds(normalized.map((d) => d.hotelId).filter(Boolean) as string[]);
    return { ok: true, data: normalized };
  } catch (e: any) {
    if (e?.name === "AbortError") return { ok: false, reason: "aborted" };
    return { ok: false, reason: "request_failed" };
  }
}

// ---- 4. compareHotels (PURE — no fetch, IDs only) ---------------------------
// REREV-02: takes IDs ONLY. Every comparison row is resolved from the session's
// TRUSTED normalized map (populated only by approved read adapters). The caller
// cannot supply name/city/rating/price; an unknown/untrusted id fails closed.
export function compareHotels(
  session: VoiceSession,
  hotelIds: unknown[],
): AdapterResult<HotelComparison> {
  if (!Array.isArray(hotelIds) || hotelIds.length === 0) return { ok: false, reason: "compare_empty" };
  if (hotelIds.length > MAX_COMPARE_HOTELS) return { ok: false, reason: "compare_too_many" };

  const rows: HotelComparisonRow[] = [];
  for (const id of hotelIds) {
    if (!isValidHotelId(id)) return { ok: false, reason: "hotel_id_invalid" };
    const trusted = session.getTrustedHotel(id);
    // Fail closed: an id that was never surfaced with validated data (or only via
    // flash) has no trusted record → not comparable.
    if (!trusted) return { ok: false, reason: "hotel_id_not_allowlisted" };
    rows.push({
      id: trusted.id,
      name: trusted.name,
      city: trusted.city,
      starRating: trusted.starRating,
      avgRating: trusted.avgRating,
      minPrice: trusted.minPrice,
    });
  }

  let cheapestId: string | null = null;
  let cheapest = Infinity;
  let topRatedId: string | null = null;
  let topRated = -Infinity;
  for (const r of rows) {
    if (r.minPrice != null && r.minPrice < cheapest) {
      cheapest = r.minPrice;
      cheapestId = r.id;
    }
    if (r.avgRating != null && r.avgRating > topRated) {
      topRated = r.avgRating;
      topRatedId = r.id;
    }
  }
  return { ok: true, data: { hotels: rows, cheapestId, topRatedId } };
}
