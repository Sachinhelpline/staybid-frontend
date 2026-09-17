// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-02A — closed browser↔gateway protocol.
//
// The SINGLE client-side source of truth for:
//   • bounded identifiers / strings / frames (byte + shape bounds);
//   • the data-minimized PublishedContext the browser sends to the gateway
//     (NEVER a raw hotel object, URL, DOM node, owner/internal field or token);
//   • the CLOSED client→gateway and gateway→client frame unions, each with an
//     EXACT own-data + plain/null-prototype validator (reusing the R3-hardened
//     strictOwnDataRecord from contracts.ts — symbols / accessors / inherited /
//     custom-prototype authority are rejected BEFORE any field is read);
//   • the ProviderProposal ({proposalId, providerTurnId, operation} ONLY — the
//     operation is re-validated through the SAME closed validateOperation the
//     runtime uses, so a provider can never smuggle a url / route / selector /
//     hotelId / new op);
//   • the closed AnswerPlan kinds + bounded fields (no arbitrary provider prose);
//   • the ActionReceipt shape + outcomes;
//   • pure replay / conflict decisions (idempotent vs conflict vs stale) over a
//     deterministic canonical digest.
//
// PURE module: no I/O, no React, no next/*, no fetch/WebSocket/WebRTC. The model /
// provider NEVER constructs an OperationEnvelope, actionId, routeEpoch,
// contextRevision, authorityRef, URL, route or hotel-id authority — those are all
// browser/gateway owned and validated here.
// ─────────────────────────────────────────────────────────────────────────
import {
  strictOwnDataRecord,
  validateOperation,
  isLiveAiPageId,
  isValidHotelId,
  numInRange,
  MAX_VISIBLE_HOTELS,
  type LiveAiOperation,
  type LiveAiOperationName,
  type LiveAiPageId,
  type FacilityFact,
} from "./contracts";

// ---- bounds (the tests assert these) ----------------------------------------
export const MAX_ID_LEN = 128;
export const MIN_ID_LEN = 1;
export const MAX_CONTEXT_REVISION_LEN = 512;
export const MAX_TEXT_TURN_BYTES = 2_000;
export const MAX_FINAL_TRANSCRIPT_BYTES = 4_000;
export const MAX_PARTIAL_TRANSCRIPT_BYTES = 2_000;
export const MAX_FRAME_BYTES = 32 * 1024; // serialized non-audio frame ceiling
export const MAX_EPOCH = 2 ** 31 - 1;
export const MAX_SELECTED_HOTELS = 4;
export const MAX_EVIDENCE_RECEIPTS = 8;
export const MAX_AUDIO_CHUNK_BYTES = 12 * 1024; // raw decoded PCM per chunk
export const MAX_LANGUAGE_LEN = 8;
const MAX_OP_ARRAY_LEN = 64;

/**
 * STRICT ARRAY SNAPSHOT (R5A locked helper — R5B-THIRD-REV-04). BYTE-MIRROR of the gateway authority
 * (server/voice-gateway/live-ai-schemas.ts strictArraySnapshot) and the frozen contracts.ts copy.
 * Capture an untrusted value as a FRESH, inert, ordinary array of its own indexed DATA values, or null.
 * A hostile Array may override map / slice / keys / values / Symbol.iterator / a "length" getter so that
 * validation inspects one sequence while a frozen output ends up carrying another (e.g. positions
 * [999,999] whose map() returns [1,2], or factors ["zoom"] whose iterator yields "price"). This helper
 * defeats that class of attack by NEVER invoking any caller-owned method: it reads every index through a
 * trusted intrinsic property descriptor and rebuilds a brand-new array literal from the captured primitive
 * values, so downstream validation AND the frozen output both come from the one inert snapshot. TOTAL and
 * fail-closed: EVERY potentially-throwing reflective inspection below — Array.isArray (which THROWS on a
 * revoked Proxy), getPrototypeOf, getOwnPropertyDescriptor, Reflect.ownKeys — is inside the guard, so any
 * hostile trap fails closed to null rather than throwing out. It NEVER freezes or mutates the input.
 *
 * Rejects (→ null): a non-Array; a value whose [[Prototype]] is not exactly the intrinsic Array.prototype
 * (an Array subclass / re-parented array whose own map/slice/iterator could be hostile); a non-own or
 * accessor "length"; a non-integer / negative / over-bound length; a missing (hole / sparse) index; an
 * accessor index descriptor; any own key that is neither a canonical in-range decimal index nor "length"
 * (a symbol key, a stray named property, "00"/"-0"/"1.5", an out-of-range numeric key). The caller freezes
 * the returned fresh array after validating it.
 */
function strictArraySnapshot(x: unknown): unknown[] | null {
  try {
    if (!Array.isArray(x)) return null; // brand check — THROWS on a revoked Proxy, caught below
    if (Object.getPrototypeOf(x) !== Array.prototype) return null;
    const lenDesc = Object.getOwnPropertyDescriptor(x, "length");
    if (!lenDesc || typeof lenDesc.get === "function" || typeof lenDesc.set === "function" || !("value" in lenDesc)) return null;
    const len = lenDesc.value;
    if (typeof len !== "number" || !Number.isInteger(len) || len < 0 || len > MAX_OP_ARRAY_LEN) return null;
    const keys = Reflect.ownKeys(x);
    for (const k of keys) {
      if (k === "length") continue;
      if (typeof k === "symbol") return null;
      const n = Number(k);
      if (!(String(n) === k && Number.isInteger(n) && n >= 0 && n < len)) return null;
    }
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

// ---- identifier / primitive validators (bounded, fail-closed) ---------------
const ID_RE = /^[A-Za-z0-9._:-]+$/;
export function isValidId(v: unknown): v is string {
  return typeof v === "string" && v.length >= MIN_ID_LEN && v.length <= MAX_ID_LEN && ID_RE.test(v);
}
export function utf8Bytes(s: string): number {
  // Node + browsers: TextEncoder is available; fall back to a conservative count.
  try {
    return new TextEncoder().encode(s).length;
  } catch {
    return unescape(encodeURIComponent(s)).length;
  }
}
/** A bounded, control-char-free printable string within a UTF-8 byte budget, else null.
 *  R4-10 — REJECT (never strip) a control char: any C0 control or DEL anywhere fails the
 *  WHOLE value, so the accepted string is byte-identical to what was sent (no silent
 *  normalization that the two ends could then interpret differently). */
export function boundedText(v: unknown, maxBytes: number): string | null {
  if (typeof v !== "string" || v.length === 0) return null;
  for (let i = 0; i < v.length; i++) { const c = v.charCodeAt(i); if (c < 0x20 || c === 0x7f) return null; }
  if (utf8Bytes(v) > maxBytes) return null;
  return v;
}
export function isContextRevision(v: unknown): v is string {
  if (typeof v !== "string" || v.length < 1 || v.length > MAX_CONTEXT_REVISION_LEN) return false;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return false; // no control chars
  }
  return true;
}
export function isEpoch(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_EPOCH;
}

// ---- languages (closed) -----------------------------------------------------
export type LiveAiLanguage = "hi" | "hinglish" | "en";
export const LIVE_AI_LANGUAGES: readonly LiveAiLanguage[] = Object.freeze(["hi", "hinglish", "en"]);
export function isLiveAiLanguage(v: unknown): v is LiveAiLanguage {
  return typeof v === "string" && (LIVE_AI_LANGUAGES as readonly string[]).includes(v);
}

// ---- data-minimized published context ---------------------------------------
export interface PublishedVisibleHotel {
  position: number;
  id: string;
  name: string;
  city: string;
  minPrice: number | null;
  rating: number | null;
  parking: FacilityFact;
}
// R5B-REV-06 — the BOUNDED CANONICAL current-refinement projection of a hotels-list page: the ALREADY
// APPLIED filter/sort state (destination / query / maxPrice / parking / stars / sort) plus the resulting
// ordered ids + count, so the gateway can prove EVERY dimension of an APPLY_HOTEL_REFINEMENT against the
// TRUSTED context — never inferring success from the ordered hotel ids alone. It represents the
// already-authorized APPLY contract ONLY (no new filter authority): the same six dimensions the APPLY op
// carries. `null` on a hotel-detail page (no list refinement). The browser derives it from the same list
// snapshot as visibleHotels; the gateway grounds destination/query/orderedIds against the context.
export interface RefinementProjection {
  destination: string | null;
  query: string | null;
  maxPrice: number | null;
  parking: boolean;
  stars: number[];
  sort: string;
  orderedIds: string[];
  count: number;
}
export interface PublishedContext {
  pageId: LiveAiPageId;
  role: "anonymous" | "customer";
  destination: string | null;
  query: string | null;
  loadState: "loading" | "ready" | "error";
  /** hotels page only. */
  visibleHotels: PublishedVisibleHotel[];
  /** hotel-detail page only. */
  currentHotelId: string | null;
  validated: boolean;
  section: "rooms" | "about" | null;
  breakfast: FacilityFact | null;
  parking: FacilityFact | null;
  /** R5B-REV-06 — the canonical current-refinement projection (hotels page) or null (detail page). OPTIONAL
   *  on the wire: it is included in the validated output ONLY when the input carried it, so a context that
   *  omits it validates unchanged (its digest is stable). The production builder always includes it. */
  refinement?: RefinementProjection | null;
}

/** R3-10 — STRICT WIRE validator: it REJECTS (never normalizes) a malformed
 *  PublishedContext, with the SAME accept/reject contract + bounds as the gateway mirror
 *  (server/voice-gateway/live-ai-schemas.ts validatePublishedContext), so the browser
 *  and gateway agree bit-for-bit. A non-array `visibleHotels`, an over-bound list/string,
 *  a non-finite / negative / oversize price, an out-of-range rating, a non-boolean
 *  `validated`, an invalid facility, or ANY unknown key FAILS the whole context — nothing
 *  is sliced, truncated, or coerced. Internal on-screen NORMALIZATION happens earlier, in
 *  the pure BUILDERS (lib/live-ai/contracts.ts), which produce within-bounds data that
 *  this wire step accepts unchanged. */
// R4-10 — a bounded WIRE string: length-bounded AND control-char-free (reject C0 + DEL,
// never accept a context string carrying control chars). Empty is allowed here (a hotel
// name/city may be blank in data); destination/query reject empty at the call site.
function boundedWireStr(v: unknown, max: number): v is string {
  if (typeof v !== "string" || v.length > max) return false;
  for (let i = 0; i < v.length; i++) { const c = v.charCodeAt(i); if (c < 0x20 || c === 0x7f) return false; }
  return true;
}
export function validatePublishedContext(x: unknown): PublishedContext | null {
  // R5B-REV-08 — TOTAL + fail-closed: the preliminary Array.isArray brand check THROWS on a revoked Proxy,
  // so it (and the nested refinement validator) is inside this guard; a hostile trap returns null.
  try {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const a = strictOwnDataRecord(x, [
    "pageId", "role", "destination", "query", "loadState",
    "visibleHotels", "currentHotelId", "validated", "section", "breakfast", "parking",
    "refinement", // R5B-REV-06 — optional canonical current-refinement projection (null on detail)
  ]);
  if (!a) return null;
  if (!isLiveAiPageId(a.pageId)) return null;
  if (a.role !== "anonymous" && a.role !== "customer") return null;
  // R4-10 — destination/query are null OR a non-EMPTY control-free bounded string; the
  // builder emits null (never "") for "no value", so an empty string is malformed → reject.
  if (a.destination !== null && (a.destination === "" || !boundedWireStr(a.destination, 120))) return null;
  if (a.query !== null && (a.query === "" || !boundedWireStr(a.query, 120))) return null;
  if (a.loadState !== "loading" && a.loadState !== "ready" && a.loadState !== "error") return null;
  if (!Array.isArray(a.visibleHotels) || a.visibleHotels.length > MAX_VISIBLE_HOTELS) return null; // reject, never slice / never default to []
  const visibleHotels: PublishedVisibleHotel[] = [];
  for (const h of a.visibleHotels) { const hv = validatePublishedHotel(h); if (!hv) return null; visibleHotels.push(hv); }
  // R4-10 — visible-hotel positions must be UNIQUE and in authoritative ASCENDING order
  // (the builder assigns the TRUE visual position i+1 in display order — gaps allowed for
  // invalid rows, but never a reorder or a duplicate). A non-ascending / duplicate position
  // is malformed → reject (ordinal resolution must be unambiguous).
  for (let i = 1; i < visibleHotels.length; i++) if (visibleHotels[i].position <= visibleHotels[i - 1].position) return null;
  if (a.currentHotelId !== null && !isValidHotelId(a.currentHotelId)) return null;
  if (typeof a.validated !== "boolean") return null;                                // reject non-boolean (never coerce)
  if (a.section !== null && a.section !== "rooms" && a.section !== "about") return null;
  if (a.breakfast !== null && !isFacility(a.breakfast)) return null;                 // reject invalid facility (never → null)
  if (a.parking !== null && !isFacility(a.parking)) return null;
  // R5B-REV-06 — the optional canonical refinement projection. It is included in the output ONLY when the
  // input actually carried the key (present null → null; present object → validate; ABSENT → omitted, so the
  // validated context is field-identical to the input and its digest is unchanged). A present non-null value
  // MUST validate as a bounded RefinementProjection (reject, never coerce).
  const out: PublishedContext = {
    pageId: a.pageId as LiveAiPageId,
    role: a.role as "anonymous" | "customer",
    destination: (a.destination === null ? null : a.destination) as string | null,
    query: (a.query === null ? null : a.query) as string | null,
    loadState: a.loadState as "loading" | "ready" | "error",
    visibleHotels: Object.freeze(visibleHotels) as PublishedVisibleHotel[],
    currentHotelId: (a.currentHotelId === null ? null : a.currentHotelId) as string | null,
    validated: a.validated as boolean,
    section: (a.section === null ? null : a.section) as "rooms" | "about" | null,
    breakfast: (a.breakfast === null ? null : a.breakfast) as FacilityFact | null,
    parking: (a.parking === null ? null : a.parking) as FacilityFact | null,
  };
  if (Object.prototype.hasOwnProperty.call(a, "refinement") && a.refinement !== undefined) {
    if (a.refinement === null) out.refinement = null;
    else { const r = validateRefinementProjection(a.refinement); if (!r) return null; out.refinement = r; }
  }
  return Object.freeze(out);
  } catch { return null; }
}
// R5B-REV-06/REV-08 — validate the canonical refinement projection. TOTAL + fail-closed (every reflective
// inspection is inside the strictOwnDataRecord guard / a try wrapper; a hostile revoked Proxy / accessor /
// symbol key returns null, never throws). Bounds mirror the APPLY op contract exactly (destination/query
// bounded control-free non-empty-or-null strings; maxPrice null or finite > 0 ≤ ceiling; parking boolean;
// stars ≤ 5 distinct integers 1..5; sort a known token; orderedIds bounded valid ids; count === length).
export function validateRefinementProjection(x: unknown): RefinementProjection | null {
  try {
    if (!x || typeof x !== "object" || Array.isArray(x)) return null;
    const a = strictOwnDataRecord(x as object, ["destination", "query", "maxPrice", "parking", "stars", "sort", "orderedIds", "count"]);
    if (!a) return null;
    if (a.destination !== null && (a.destination === "" || !boundedWireStr(a.destination, 120))) return null;
    if (a.query !== null && (a.query === "" || !boundedWireStr(a.query, 120))) return null;
    if (a.maxPrice !== null && (typeof a.maxPrice !== "number" || !Number.isFinite(a.maxPrice) || a.maxPrice <= 0 || a.maxPrice > 10_000_000)) return null;
    if (typeof a.parking !== "boolean") return null;
    if (a.sort !== "default" && a.sort !== "price-asc" && a.sort !== "price-desc" && a.sort !== "rating") return null;
    // R5B-THIRD-REV-04 — STRICT ordinary-array snapshot BEFORE any element inspection (byte-mirror of the
    // gateway). A custom array prototype / accessor index / accessor length / hole / symbol key / stray key /
    // caller-controlled iterator or map / revoked Proxy all fail closed to null; validation AND output read
    // the ONE inert snapshot. ≤5 DISTINCT integers 1..5.
    const starSnap = strictArraySnapshot(a.stars);
    if (!starSnap || starSnap.length > 5) return null;
    const stars: number[] = [];
    const seenStars = new Set<number>();
    for (let i = 0; i < starSnap.length; i++) {
      const s = starSnap[i];
      if (typeof s !== "number" || !Number.isInteger(s) || s < 1 || s > 5 || seenStars.has(s)) return null;
      seenStars.add(s); stars.push(s);
    }
    const orderedIds = readOrderedHotelIds(a.orderedIds, 0, MAX_VISIBLE_HOTELS);
    if (!orderedIds) return null;
    if (typeof a.count !== "number" || !Number.isInteger(a.count) || a.count !== orderedIds.length) return null;
    return Object.freeze({
      destination: (a.destination === null ? null : a.destination) as string | null,
      query: (a.query === null ? null : a.query) as string | null,
      maxPrice: (a.maxPrice === null ? null : a.maxPrice) as number | null,
      parking: a.parking as boolean,
      stars: Object.freeze(stars) as unknown as number[],
      sort: a.sort as string,
      orderedIds: Object.freeze(orderedIds) as unknown as string[],
      count: a.count as number,
    });
  } catch { return null; }
}
function isFacility(v: unknown): v is FacilityFact {
  return v === "present" || v === "absent" || v === "unknown";
}
function validatePublishedHotel(x: unknown): PublishedVisibleHotel | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const a = strictOwnDataRecord(x, ["position", "id", "name", "city", "minPrice", "rating", "parking"]);
  if (!a) return null;
  const position = numInRange(a.position, 1, MAX_VISIBLE_HOTELS);
  if (position === null || !Number.isInteger(position)) return null;
  if (!isValidHotelId(a.id)) return null;
  if (!boundedWireStr(a.name, 200) || !boundedWireStr(a.city, 120)) return null;     // reject, never truncate
  if (a.minPrice !== null && (typeof a.minPrice !== "number" || !Number.isFinite(a.minPrice) || a.minPrice < 0 || a.minPrice > 10_000_000)) return null; // reject NaN/Infinity/negative/oversize
  if (a.rating !== null && (typeof a.rating !== "number" || !Number.isFinite(a.rating) || a.rating < 0 || a.rating > 5)) return null;
  if (!isFacility(a.parking)) return null;                                           // reject invalid facility (never → unknown)
  return {
    position,
    id: a.id as string,
    name: a.name as string,
    city: a.city as string,
    minPrice: (a.minPrice === null ? null : a.minPrice) as number | null,
    rating: (a.rating === null ? null : a.rating) as number | null,
    parking: a.parking as FacilityFact,
  };
}

// ---- correlation tuple ------------------------------------------------------
export interface Correlation {
  sessionId: string;
  turnId: string;
  generation: number;
}
function readCorrelation(a: Record<string, unknown>): Correlation | null {
  if (!isValidId(a.sessionId) || !isValidId(a.turnId)) return null;
  if (!isEpoch(a.generation)) return null;
  return { sessionId: a.sessionId as string, turnId: a.turnId as string, generation: a.generation as number };
}

// ═══════════════════════════════════════════════════════════════════════════
// CLIENT → GATEWAY frames (closed union)
// ═══════════════════════════════════════════════════════════════════════════
export type ClientFrame =
  | { t: "context.publish"; sessionId: string; turnId: string; generation: number; routeEpoch: number; contextRevision: string; context: PublishedContext }
  | { t: "turn.text"; sessionId: string; turnId: string; generation: number; text: string; languageHint?: LiveAiLanguage }
  // R3-05 — the browser ANNOUNCES it accepted a proposal + minted the actionId, BEFORE
  // executing / sending the receipt. This binds the browser-minted actionId to the
  // gateway's pending proposal under the current authority + full tuple, so a later
  // receipt must carry the EXACT accepted actionId (a forged random-actionId receipt fails).
  | { t: "action.accepted"; sessionId: string; turnId: string; generation: number; accepted: ActionAccepted }
  | { t: "action.receipt"; sessionId: string; turnId: string; generation: number; receipt: ActionReceipt }
  | { t: "answer.approve"; sessionId: string; turnId: string; generation: number; planId: string; authorityRef: string; textHash: string }
  | { t: "turn.interrupt"; sessionId: string; turnId: string; generation: number; reason: InterruptReason }
  | { t: "session.reset"; sessionId: string; generation: number }
  | { t: "session.end"; sessionId: string; generation: number; reason: "user" | "timeout" | "unmount" };

export type InterruptReason = "barge_in" | "route_change" | "context_change" | "user_cancel";
const INTERRUPT_REASONS: readonly InterruptReason[] = Object.freeze(["barge_in", "route_change", "context_change", "user_cancel"]);

export type ContextPublishFrame = Extract<ClientFrame, { t: "context.publish" }>;
export type ActionReceiptFrame = Extract<ClientFrame, { t: "action.receipt" }>;
export type ActionAcceptedFrame = Extract<ClientFrame, { t: "action.accepted" }>;

const CLIENT_FRAME_KEYS: Readonly<Record<ClientFrame["t"], readonly string[]>> = Object.freeze({
  "context.publish": ["t", "sessionId", "turnId", "generation", "routeEpoch", "contextRevision", "context"],
  "turn.text": ["t", "sessionId", "turnId", "generation", "text", "languageHint"],
  "action.accepted": ["t", "sessionId", "turnId", "generation", "accepted"],
  "action.receipt": ["t", "sessionId", "turnId", "generation", "receipt"],
  "answer.approve": ["t", "sessionId", "turnId", "generation", "planId", "authorityRef", "textHash"],
  "turn.interrupt": ["t", "sessionId", "turnId", "generation", "reason"],
  "session.reset": ["t", "sessionId", "generation"],
  "session.end": ["t", "sessionId", "generation", "reason"],
});

/** Strict validate an untrusted client frame → frozen copy, or null. Also enforces
 *  the serialized frame-size ceiling on stringifiable input. */
export function validateClientFrame(x: unknown): ClientFrame | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const tDesc = Object.getOwnPropertyDescriptor(x, "t");
  if (!tDesc || !("value" in tDesc) || typeof tDesc.get === "function") return null;
  const t = tDesc.value as ClientFrame["t"];
  const allowed = (CLIENT_FRAME_KEYS as Record<string, readonly string[]>)[t];
  if (!allowed) return null;
  const a = strictOwnDataRecord(x, allowed);
  if (!a) return null;
  switch (t) {
    case "context.publish": {
      const c = readCorrelation(a);
      if (!c) return null;
      if (!isEpoch(a.routeEpoch)) return null;
      if (!isContextRevision(a.contextRevision)) return null;
      const ctx = validatePublishedContext(a.context);
      if (!ctx) return null;
      return Object.freeze({ t, sessionId: c.sessionId, turnId: c.turnId, generation: c.generation, routeEpoch: a.routeEpoch as number, contextRevision: a.contextRevision as string, context: ctx });
    }
    case "turn.text": {
      const c = readCorrelation(a);
      if (!c) return null;
      const text = boundedText(a.text, MAX_TEXT_TURN_BYTES);
      if (text === null) return null;
      let languageHint: LiveAiLanguage | undefined;
      if (Object.prototype.hasOwnProperty.call(a, "languageHint")) {
        if (!isLiveAiLanguage(a.languageHint)) return null;
        languageHint = a.languageHint;
      }
      const out: Extract<ClientFrame, { t: "turn.text" }> = { t, sessionId: c.sessionId, turnId: c.turnId, generation: c.generation, text };
      if (languageHint) out.languageHint = languageHint;
      return Object.freeze(out);
    }
    case "action.accepted": {
      const c = readCorrelation(a);
      if (!c) return null;
      const accepted = validateActionAccepted(a.accepted);
      if (!accepted) return null;
      return Object.freeze({ t, sessionId: c.sessionId, turnId: c.turnId, generation: c.generation, accepted });
    }
    case "action.receipt": {
      const c = readCorrelation(a);
      if (!c) return null;
      const receipt = validateActionReceipt(a.receipt);
      if (!receipt) return null;
      return Object.freeze({ t, sessionId: c.sessionId, turnId: c.turnId, generation: c.generation, receipt });
    }
    case "answer.approve": {
      const c = readCorrelation(a);
      if (!c) return null;
      if (!isValidId(a.planId) || !isValidId(a.authorityRef)) return null;
      if (typeof a.textHash !== "string" || !/^[0-9a-f]{64}$/.test(a.textHash)) return null;
      return Object.freeze({ t, sessionId: c.sessionId, turnId: c.turnId, generation: c.generation, planId: a.planId as string, authorityRef: a.authorityRef as string, textHash: a.textHash });
    }
    case "turn.interrupt": {
      const c = readCorrelation(a);
      if (!c) return null;
      if (!INTERRUPT_REASONS.includes(a.reason as InterruptReason)) return null;
      return Object.freeze({ t, sessionId: c.sessionId, turnId: c.turnId, generation: c.generation, reason: a.reason as InterruptReason });
    }
    case "session.reset": {
      if (!isValidId(a.sessionId) || !isEpoch(a.generation)) return null;
      return Object.freeze({ t, sessionId: a.sessionId as string, generation: a.generation as number });
    }
    case "session.end": {
      if (!isValidId(a.sessionId) || !isEpoch(a.generation)) return null;
      if (a.reason !== "user" && a.reason !== "timeout" && a.reason !== "unmount") return null;
      return Object.freeze({ t, sessionId: a.sessionId as string, generation: a.generation as number, reason: a.reason });
    }
    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION PROPOSAL / RECEIPT
// ═══════════════════════════════════════════════════════════════════════════
/** The EXACT inner provider proposal — no other field is permitted. */
export interface ProviderProposal {
  proposalId: string;
  providerTurnId: string;
  operation: LiveAiOperation;
}
/** Validate a provider proposal: exact keys, valid ids, and the operation is
 *  re-validated through the SAME closed operation validator (route/url/hotelId/new
 *  op can never survive). */
export function validateProviderProposal(x: unknown): ProviderProposal | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const a = strictOwnDataRecord(x, ["proposalId", "providerTurnId", "operation"]);
  if (!a) return null;
  if (!isValidId(a.proposalId) || !isValidId(a.providerTurnId)) return null;
  const op = validateOperation(a.operation);
  if (!op) return null;
  return Object.freeze({ proposalId: a.proposalId as string, providerTurnId: a.providerTurnId as string, operation: op });
}

export type ReceiptOutcome = "acted" | "verified" | "rejected" | "stale" | "unknown";
const RECEIPT_OUTCOMES: readonly ReceiptOutcome[] = Object.freeze(["acted", "verified", "rejected", "stale", "unknown"]);
// R5B — `acted` is the ONLY NON-TERMINAL outcome (execution acknowledged, pending verification).
// The four terminal outcomes are closed + irreversible; a negative terminal permanently consumes
// the proposal authority for the session.
export type TerminalOutcome = "verified" | "rejected" | "stale" | "unknown";
export const TERMINAL_OUTCOMES: readonly TerminalOutcome[] = Object.freeze(["verified", "rejected", "stale", "unknown"]);
export function isTerminalOutcome(v: unknown): v is TerminalOutcome {
  return typeof v === "string" && (TERMINAL_OUTCOMES as readonly string[]).includes(v);
}

// R5B — the CLOSED receipt STATUS vocabulary (section 10). A receipt `status` is validated against
// this fixed set ONLY — no arbitrary bounded token is permitted (the old `/^[a-z_]+$/` shape check is
// retired). Byte-mirrored in server/voice-gateway/live-ai-schemas.ts.
export const LIVE_AI_CLOSED_STATUS: readonly string[] = Object.freeze([
  "execution_acknowledged", "verified", "invalid_operation", "wrong_page", "authority_disabled",
  "missing_ordinal", "unsupported_filter", "not_ready", "hotel_id_mismatch", "no_op",
  "stale_turn", "stale_generation", "stale_route", "stale_context", "stale_entity",
  "stale_visible_order", "verification_timeout", "result_unavailable", "execution_ambiguous", "interrupted",
]);
const CLOSED_STATUS_SET: ReadonlySet<string> = new Set(LIVE_AI_CLOSED_STATUS);
export function isClosedStatus(v: unknown): v is string { return typeof v === "string" && CLOSED_STATUS_SET.has(v); }

// R5B-REV-09 — the CLOSED legal outcome↔status compatibility matrix (section: outcome/status matrix).
// A receipt's (outcome, status) pair is legal ONLY when the status is in the outcome's allowed set;
// every contradictory combo is rejected on BOTH the client and the gateway (byte-mirror). Examples of
// the illegal pairs this closes: verified+no_op, verified+stale_context, rejected+verified,
// acted+verified, unknown+<deterministic success>. `verified` may ONLY carry "verified"; `acted` may
// ONLY carry "execution_acknowledged"; a negative outcome may NEVER carry "verified" /
// "execution_acknowledged". The sets are closed (only LIVE_AI_CLOSED_STATUS tokens appear).
export const OUTCOME_STATUS_MATRIX: Readonly<Record<ReceiptOutcome, readonly string[]>> = Object.freeze({
  verified: Object.freeze(["verified"]),
  acted: Object.freeze(["execution_acknowledged"]),
  rejected: Object.freeze([
    "invalid_operation", "wrong_page", "authority_disabled", "missing_ordinal",
    "unsupported_filter", "not_ready", "hotel_id_mismatch", "no_op", "execution_ambiguous", "interrupted",
  ]),
  stale: Object.freeze(["stale_turn", "stale_generation", "stale_route", "stale_context", "stale_entity", "stale_visible_order"]),
  unknown: Object.freeze(["verification_timeout", "result_unavailable", "execution_ambiguous", "stale_entity", "interrupted"]),
});
/** R5B-REV-09 — is this (outcome, status) pair legal per the closed matrix? Both must be closed tokens. */
export function isLegalOutcomeStatus(outcome: unknown, status: unknown): boolean {
  if (!isClosedStatus(status)) return false;
  if (typeof outcome !== "string" || !(RECEIPT_OUTCOMES as readonly string[]).includes(outcome)) return false;
  return (OUTCOME_STATUS_MATRIX[outcome as ReceiptOutcome] as readonly string[]).includes(status as string);
}

// ═══════════════════════════════════════════════════════════════════════════
// R5B-REV-01 — FULL RESULT AUTHORITY (a separately-acknowledged commitment)
// ═══════════════════════════════════════════════════════════════════════════
// The SOURCE authority (the proposal's immutable authorityRef, bound at registration + accept) and the
// RESULT authority (the authority the ACTED/VERIFIED result was OBSERVED under) are DISTINCT. A verified
// result may legitimately advance the route epoch / generation / contextRevision (APPLY/OPEN/SHOW), so the
// result authority is its OWN full tuple, independently acknowledged by the browser and INDEPENDENTLY
// re-derivable + validated by the gateway (which recomputes the authorityRef over the tuple and checks it
// equals the session's CURRENT context ack). A wrong/copied/delayed result authority — another proposal's
// result, another session's result, a stale-context result — fails that independent check.
export interface ResultAuthority {
  turnId: string;
  generation: number;
  routeEpoch: number;
  contextRevision: string;
  authorityRef: string;
  /** the full-content SHA-256 digest of the context the result was observed under (== contextRevision by
   *  construction, since the browser's contextRevision IS contextDigest(ctx); carried explicitly so the
   *  gateway binds it independently). */
  contextDigest: string;
}
const HEX64_RE = /^[0-9a-f]{64}$/;
export function validateResultAuthority(x: unknown): ResultAuthority | null {
  // R5B-REV-08 — TOTAL + fail-closed: the preliminary Array.isArray brand check THROWS on a revoked Proxy,
  // so it (and every other reflective inspection) lives inside this guard; a hostile trap returns null.
  try {
    if (!x || typeof x !== "object" || Array.isArray(x)) return null;
    const a = strictOwnDataRecord(x, ["turnId", "generation", "routeEpoch", "contextRevision", "authorityRef", "contextDigest"]);
    if (!a) return null;
    if (!isValidId(a.turnId) || !isEpoch(a.generation) || !isEpoch(a.routeEpoch)) return null;
    if (!isContextRevision(a.contextRevision) || !isValidId(a.authorityRef)) return null;
    if (typeof a.contextDigest !== "string" || !HEX64_RE.test(a.contextDigest)) return null;
    return Object.freeze({
      turnId: a.turnId as string, generation: a.generation as number, routeEpoch: a.routeEpoch as number,
      contextRevision: a.contextRevision as string, authorityRef: a.authorityRef as string, contextDigest: a.contextDigest as string,
    });
  } catch { return null; }
}

// R5B — evidence upgrades (section 14): results prove ORDERED rows (not count only); OPEN proves a
// bounded NAVIGATION destination (evidence-free OPEN can no longer verify); a section binds the exact
// HOTEL IDENTITY; a comparison proves exact positions + resolved IDs + ordering + factors + bounded
// winner (result) values. All bounded — never a raw hotel object / URL / DOM / token / model output.
export interface ResultsEvidence { kind: "results"; count: number; orderedIds: string[] }
export interface ComparisonEvidence { kind: "comparison"; positions: number[]; hotelIds: string[]; factors: ComparisonFactor[]; cheapestPosition: number | null; topRatedPosition: number | null }
export interface DetailEvidence { kind: "detail"; hotelId: string; breakfast: FacilityFact; parking: FacilityFact }
export interface UiStateEvidence { kind: "ui_state"; section: "rooms" | "about"; hotelId: string }
export interface NavigationEvidence { kind: "navigation"; hotelId: string; position: number }
export type ReceiptEvidence = ResultsEvidence | ComparisonEvidence | DetailEvidence | UiStateEvidence | NavigationEvidence;

export interface ActionReceipt {
  receiptId: string;
  proposalId: string;
  providerTurnId: string;
  actionId: string;
  /** R4-05 — the GATEWAY-issued execution commitment (executionNonce) this action was
   *  authorized under. The browser echoes it on every receipt so the gateway can bind the
   *  receipt to the exact proposal it committed; a receipt without the exact nonce fails. */
  executionNonce: string;
  authorityRef: string;
  operation: LiveAiOperationName;
  outcome: ReceiptOutcome;
  status: string; // LiveAiStatus (validated as a bounded id-like token)
  /** R5B-REV-01 — the FULL result authority the ACTED/VERIFIED result was observed under (distinct from
   *  the source `authorityRef`). Optional on the wire: a pre-ack REJECTION carries none; a verified/acted
   *  receipt MUST carry it, and the gateway independently re-derives + validates it before advancing. */
  resultAuthority?: ResultAuthority;
  evidence?: ReceiptEvidence;
}

const OP_NAME_SET: ReadonlySet<string> = new Set([
  "APPLY_HOTEL_REFINEMENT", "READ_CURRENT_RESULTS", "COMPARE_VISIBLE_HOTELS",
  "OPEN_VISIBLE_HOTEL", "READ_CURRENT_HOTEL_FACTS", "SHOW_HOTEL_SECTION",
]);
// R5B-REV-01/04 — the operation-specific source/result-authority partition (byte-mirror of the gateway
// live-ai-schemas.ts). SOURCE-BOUND read/compare/detail operations keep EXACTLY their source authority;
// only the three ADVANCEABLE UI-local mutating operations may advance to a separately-validated result
// authority. Every operation is classified here or has NO trusted evidence authority (fail closed).
const SOURCE_BOUND_OPS: ReadonlySet<string> = new Set(["READ_CURRENT_RESULTS", "COMPARE_VISIBLE_HOTELS", "READ_CURRENT_HOTEL_FACTS"]);
const ADVANCEABLE_OPS: ReadonlySet<string> = new Set(["APPLY_HOTEL_REFINEMENT", "OPEN_VISIBLE_HOTEL", "SHOW_HOTEL_SECTION"]);
// R5B-REV-04 — the OP-SPECIFIC authority a verified receipt's TRUSTED EVIDENCE is recorded under. A
// SOURCE-BOUND read/compare/detail keeps the exact SOURCE authority (which equals its result authority —
// it never advances). An ADVANCEABLE APPLY/OPEN/SHOW records the gateway-validated RESULT authority (the
// advanced authority the follow-up plan will run under), so its trusted evidence does NOT go stale after a
// legitimate context advance and can still support the terminal verified explanation. An advanceable op
// with no result authority, or an unknown operation, has NO trusted evidence authority (null → not stored).
export function trustedEvidenceAuthority(operation: string, sourceAuthorityRef: string, resultAuthority: ResultAuthority | null | undefined): string | null {
  if (SOURCE_BOUND_OPS.has(operation)) return sourceAuthorityRef;
  if (ADVANCEABLE_OPS.has(operation)) return resultAuthority && typeof resultAuthority.authorityRef === "string" ? resultAuthority.authorityRef : null;
  return null;
}
export function validateActionReceipt(x: unknown): ActionReceipt | null {
  // R5B-REV-08 — TOTAL + fail-closed (the preliminary Array.isArray brand check + every nested validator
  // — resultAuthority + evidence — are inside this guard; a hostile revoked Proxy / accessor returns null).
  try {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const a = strictOwnDataRecord(x, [
    "receiptId", "proposalId", "providerTurnId", "actionId", "executionNonce", "authorityRef", "operation", "outcome", "status", "resultAuthority", "evidence",
  ]);
  if (!a) return null;
  if (!isValidId(a.receiptId) || !isValidId(a.proposalId) || !isValidId(a.providerTurnId)) return null;
  if (!isValidId(a.actionId) || !isValidId(a.executionNonce) || !isValidId(a.authorityRef)) return null;
  if (typeof a.operation !== "string" || !OP_NAME_SET.has(a.operation)) return null;
  if (!RECEIPT_OUTCOMES.includes(a.outcome as ReceiptOutcome)) return null;
  if (!isClosedStatus(a.status)) return null; // R5B — closed status vocabulary ONLY
  // R5B-REV-09 — the (outcome, status) pair MUST be legal per the closed compatibility matrix
  // (verified+no_op, acted+verified, rejected+verified, unknown+deterministic-success … all reject).
  if (!isLegalOutcomeStatus(a.outcome, a.status)) return null;
  // R5B-REV-01 — the optional full result authority (present on acted/verified; the gateway re-derives it).
  let resultAuthority: ResultAuthority | undefined;
  if (Object.prototype.hasOwnProperty.call(a, "resultAuthority")) {
    const ra = validateResultAuthority(a.resultAuthority);
    if (!ra) return null;
    resultAuthority = ra;
  }
  let evidence: ReceiptEvidence | undefined;
  if (Object.prototype.hasOwnProperty.call(a, "evidence")) {
    // Evidence is allowed ONLY for a verified outcome.
    if (a.outcome !== "verified") return null;
    const ev = validateEvidence(a.evidence);
    if (!ev) return null;
    evidence = ev;
  }
  const out: ActionReceipt = {
    receiptId: a.receiptId as string,
    proposalId: a.proposalId as string,
    providerTurnId: a.providerTurnId as string,
    actionId: a.actionId as string,
    executionNonce: a.executionNonce as string,
    authorityRef: a.authorityRef as string,
    operation: a.operation as LiveAiOperationName,
    outcome: a.outcome as ReceiptOutcome,
    status: a.status as string,
  };
  if (resultAuthority) out.resultAuthority = resultAuthority;
  if (evidence) out.evidence = evidence;
  return Object.freeze(out);
  } catch { return null; }
}
// R3-05 — the ACTION-ACCEPTED announcement: the browser binds its minted actionId to a
// proposal under the current authority. Exact keys, valid ids, closed operation name.
export interface ActionAccepted {
  /** R5B — the GATEWAY-minted receipt identity for THIS proposal (delivered as trusted
   *  action.proposal metadata). The browser ECHOES it here and on the receipt; it may never mint
   *  its own. One proposal = one immutable receipt identity for the whole lifecycle. */
  receiptId: string;
  proposalId: string;
  providerTurnId: string;
  actionId: string;
  /** R4-05 — the GATEWAY-issued execution commitment the browser binds its actionId to. */
  executionNonce: string;
  operation: LiveAiOperationName;
  authorityRef: string;
}
export function validateActionAccepted(x: unknown): ActionAccepted | null {
  try { // R5B-REV-08 — TOTAL + fail-closed (preliminary Array.isArray brand check inside the guard).
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const a = strictOwnDataRecord(x, ["receiptId", "proposalId", "providerTurnId", "actionId", "executionNonce", "operation", "authorityRef"]);
  if (!a) return null;
  if (!isValidId(a.receiptId) || !isValidId(a.proposalId) || !isValidId(a.providerTurnId) || !isValidId(a.actionId) || !isValidId(a.executionNonce) || !isValidId(a.authorityRef)) return null;
  if (typeof a.operation !== "string" || !OP_NAME_SET.has(a.operation)) return null;
  return Object.freeze({
    receiptId: a.receiptId as string,
    proposalId: a.proposalId as string,
    providerTurnId: a.providerTurnId as string,
    actionId: a.actionId as string,
    executionNonce: a.executionNonce as string,
    operation: a.operation as LiveAiOperationName,
    authorityRef: a.authorityRef as string,
  });
  } catch { return null; }
}
// R5B — bounded ordered hotel-id list (0..max, each a valid hotel id, DISTINCT, order preserved).
// R5B-THIRD-REV-04 — STRICT ordinary-array snapshot (byte-mirror of the gateway) before element checks:
// custom prototype / accessor index/length / hole / symbol / stray key / hostile iterator/map / revoked
// Proxy fail closed; validation + output read the ONE inert snapshot.
function readOrderedHotelIds(v: unknown, min: number, max: number): string[] | null {
  const snap = strictArraySnapshot(v);
  if (!snap || snap.length < min || snap.length > max) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < snap.length; i++) { const h = snap[i]; if (!isValidHotelId(h) || seen.has(h as string)) return null; seen.add(h as string); out.push(h as string); }
  return out;
}
function readEvidenceFactors(v: unknown): ComparisonFactor[] | null {
  const snap = strictArraySnapshot(v);
  if (!snap || snap.length < 1 || snap.length > COMPARISON_FACTORS.length) return null;
  const out: ComparisonFactor[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < snap.length; i++) { const f = snap[i]; if (!COMPARISON_FACTORS.includes(f as ComparisonFactor) || seen.has(f as string)) return null; seen.add(f as string); out.push(f as ComparisonFactor); }
  return out;
}
function okNullablePos(v: unknown): boolean {
  return v === null || (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_VISIBLE_HOTELS);
}
function validateEvidence(x: unknown): ReceiptEvidence | null {
  // R5B-REV-08 — TOTAL + fail-closed: the preliminary Array.isArray brand check AND the getOwnPropertyDescriptor
  // "kind" read both THROW on a hostile revoked Proxy, so the whole nested-evidence validation is guarded.
  try {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const kindDesc = Object.getOwnPropertyDescriptor(x, "kind");
  if (!kindDesc || !("value" in kindDesc)) return null;
  const kind = kindDesc.value;
  if (kind === "results") {
    // R5B — ORDERED rows, not count only: orderedIds is the exact on-screen id order + count == length.
    const a = strictOwnDataRecord(x, ["kind", "count", "orderedIds"]);
    if (!a) return null;
    const count = numInRange(a.count, 0, MAX_VISIBLE_HOTELS);
    if (count === null || !Number.isInteger(count)) return null;
    const orderedIds = readOrderedHotelIds(a.orderedIds, 0, MAX_VISIBLE_HOTELS);
    if (!orderedIds || orderedIds.length !== count) return null;
    return Object.freeze({ kind: "results", count, orderedIds: Object.freeze(orderedIds) as string[] });
  }
  if (kind === "comparison") {
    // R5B — exact positions + resolved IDs (same order/count) + factors + bounded winner values.
    const a = strictOwnDataRecord(x, ["kind", "positions", "hotelIds", "factors", "cheapestPosition", "topRatedPosition"]);
    if (!a) return null;
    // R5B-THIRD-REV-04 — snapshot positions to a fresh inert array (its .map is now the intrinsic
    // Array.prototype.map, never a caller override); a hostile positions array fails closed.
    const posSnap = strictArraySnapshot(a.positions);
    if (!posSnap) return null;
    const positions = posSnap.map((p) => numInRange(p, 1, MAX_VISIBLE_HOTELS));
    if (positions.some((p) => p === null || !Number.isInteger(p)) || positions.length < 2 || positions.length > MAX_SELECTED_HOTELS) return null;
    const hotelIds = readOrderedHotelIds(a.hotelIds, positions.length, positions.length);
    if (!hotelIds) return null;
    const factors = readEvidenceFactors(a.factors);
    if (!factors) return null;
    if (!okNullablePos(a.cheapestPosition) || !okNullablePos(a.topRatedPosition)) return null;
    return Object.freeze({
      kind: "comparison",
      positions: Object.freeze(positions as number[]) as number[],
      hotelIds: Object.freeze(hotelIds) as string[],
      factors: Object.freeze(factors) as ComparisonFactor[],
      cheapestPosition: (a.cheapestPosition === null ? null : a.cheapestPosition) as number | null,
      topRatedPosition: (a.topRatedPosition === null ? null : a.topRatedPosition) as number | null,
    });
  }
  if (kind === "detail") {
    const a = strictOwnDataRecord(x, ["kind", "hotelId", "breakfast", "parking"]);
    if (!a || !isValidHotelId(a.hotelId) || !isFacility(a.breakfast) || !isFacility(a.parking)) return null;
    return Object.freeze({ kind: "detail", hotelId: a.hotelId as string, breakfast: a.breakfast, parking: a.parking });
  }
  if (kind === "ui_state") {
    // R5B — a section binds the exact HOTEL IDENTITY (not the section alone).
    const a = strictOwnDataRecord(x, ["kind", "section", "hotelId"]);
    if (!a || (a.section !== "rooms" && a.section !== "about") || !isValidHotelId(a.hotelId)) return null;
    return Object.freeze({ kind: "ui_state", section: a.section, hotelId: a.hotelId as string });
  }
  if (kind === "navigation") {
    // R5B — OPEN destination evidence: the exact hotel identity + the source ordinal it resolved from.
    const a = strictOwnDataRecord(x, ["kind", "hotelId", "position"]);
    if (!a || !isValidHotelId(a.hotelId)) return null;
    const position = numInRange(a.position, 1, MAX_VISIBLE_HOTELS);
    if (position === null || !Number.isInteger(position)) return null;
    return Object.freeze({ kind: "navigation", hotelId: a.hotelId as string, position });
  }
  return null;
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════
// ANSWER PLAN (closed kinds, bounded fields) — no arbitrary provider prose
// ═══════════════════════════════════════════════════════════════════════════
export type AnswerPlanKind = "clarification" | "page_facts" | "comparison" | "action_status" | "advice" | "unknown";
const ANSWER_KINDS: readonly AnswerPlanKind[] = Object.freeze(["clarification", "page_facts", "comparison", "action_status", "advice", "unknown"]);

export type ComparisonFactor = "price" | "rating" | "parking" | "breakfast";
const COMPARISON_FACTORS: readonly ComparisonFactor[] = Object.freeze(["price", "rating", "parking", "breakfast"]);
export type AdviceSignal =
  | "lower_price" | "higher_rating" | "parking_present" | "parking_unknown"
  | "breakfast_present" | "breakfast_unknown" | "fits_budget" | "no_verified_match";
const ADVICE_SIGNALS: readonly AdviceSignal[] = Object.freeze([
  "lower_price", "higher_rating", "parking_present", "parking_unknown",
  "breakfast_present", "breakfast_unknown", "fits_budget", "no_verified_match",
]);
export type ClarificationCode = "which_city" | "what_budget" | "which_hotels" | "which_facility" | "rephrase";
const CLARIFICATION_CODES: readonly ClarificationCode[] = Object.freeze(["which_city", "what_budget", "which_hotels", "which_facility", "rephrase"]);
export type UnknownReason = "no_context" | "not_supported" | "insufficient_evidence" | "off_topic";
const UNKNOWN_REASONS: readonly UnknownReason[] = Object.freeze(["no_context", "not_supported", "insufficient_evidence", "off_topic"]);

export interface AnswerPlanBase {
  planId: string;
  providerTurnId: string;
  kind: AnswerPlanKind;
  language: LiveAiLanguage;
  evidenceReceiptIds: string[];
}
export type AnswerPlan =
  | (AnswerPlanBase & { kind: "clarification"; questionCode: ClarificationCode })
  | (AnswerPlanBase & { kind: "page_facts"; selectedHotelIds: string[] })
  | (AnswerPlanBase & { kind: "comparison"; selectedHotelIds: string[]; factors: ComparisonFactor[] })
  | (AnswerPlanBase & { kind: "action_status"; proposalId: string; receiptId: string; outcome: ReceiptOutcome })
  | (AnswerPlanBase & { kind: "advice"; selectedHotelIds: string[]; signals: AdviceSignal[] })
  | (AnswerPlanBase & { kind: "unknown"; reason: UnknownReason });

function readReceiptIds(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  if (v.length > MAX_EVIDENCE_RECEIPTS) return null;
  const out: string[] = [];
  for (const r of v) {
    if (!isValidId(r)) return null;
    out.push(r);
  }
  return out;
}
function readHotelIds(v: unknown, max: number): string[] | null {
  if (!Array.isArray(v)) return null;
  if (v.length < 1 || v.length > max) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const h of v) {
    if (!isValidHotelId(h)) return null;
    if (seen.has(h)) return null;
    seen.add(h);
    out.push(h);
  }
  return out;
}
export function validateAnswerPlan(x: unknown): AnswerPlan | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const kindDesc = Object.getOwnPropertyDescriptor(x, "kind");
  if (!kindDesc || !("value" in kindDesc)) return null;
  const kind = kindDesc.value as AnswerPlanKind;
  if (!ANSWER_KINDS.includes(kind)) return null;
  const perKind: Record<AnswerPlanKind, readonly string[]> = {
    clarification: ["planId", "providerTurnId", "kind", "language", "evidenceReceiptIds", "questionCode"],
    page_facts: ["planId", "providerTurnId", "kind", "language", "evidenceReceiptIds", "selectedHotelIds"],
    comparison: ["planId", "providerTurnId", "kind", "language", "evidenceReceiptIds", "selectedHotelIds", "factors"],
    action_status: ["planId", "providerTurnId", "kind", "language", "evidenceReceiptIds", "proposalId", "receiptId", "outcome"],
    advice: ["planId", "providerTurnId", "kind", "language", "evidenceReceiptIds", "selectedHotelIds", "signals"],
    unknown: ["planId", "providerTurnId", "kind", "language", "evidenceReceiptIds", "reason"],
  };
  const a = strictOwnDataRecord(x, perKind[kind]);
  if (!a) return null;
  if (!isValidId(a.planId) || !isValidId(a.providerTurnId)) return null;
  if (!isLiveAiLanguage(a.language)) return null;
  const evidenceReceiptIds = readReceiptIds(a.evidenceReceiptIds);
  if (!evidenceReceiptIds) return null;
  const base = { planId: a.planId as string, providerTurnId: a.providerTurnId as string, language: a.language, evidenceReceiptIds };
  switch (kind) {
    case "clarification":
      if (!CLARIFICATION_CODES.includes(a.questionCode as ClarificationCode)) return null;
      return Object.freeze({ ...base, kind, questionCode: a.questionCode as ClarificationCode });
    case "page_facts": {
      const selectedHotelIds = readHotelIds(a.selectedHotelIds, MAX_SELECTED_HOTELS);
      if (!selectedHotelIds) return null;
      return Object.freeze({ ...base, kind, selectedHotelIds });
    }
    case "comparison": {
      const selectedHotelIds = readHotelIds(a.selectedHotelIds, MAX_SELECTED_HOTELS);
      if (!selectedHotelIds || selectedHotelIds.length < 2) return null;
      if (!Array.isArray(a.factors) || a.factors.length < 1 || a.factors.length > COMPARISON_FACTORS.length) return null;
      const factors: ComparisonFactor[] = [];
      const seen = new Set<string>();
      for (const f of a.factors) {
        if (!COMPARISON_FACTORS.includes(f as ComparisonFactor) || seen.has(f)) return null;
        seen.add(f); factors.push(f as ComparisonFactor);
      }
      return Object.freeze({ ...base, kind, selectedHotelIds, factors });
    }
    case "action_status":
      if (!isValidId(a.proposalId) || !isValidId(a.receiptId)) return null;
      if (!RECEIPT_OUTCOMES.includes(a.outcome as ReceiptOutcome)) return null;
      return Object.freeze({ ...base, kind, proposalId: a.proposalId as string, receiptId: a.receiptId as string, outcome: a.outcome as ReceiptOutcome });
    case "advice": {
      const selectedHotelIds = readHotelIds(a.selectedHotelIds, MAX_SELECTED_HOTELS);
      if (!selectedHotelIds) return null;
      if (!Array.isArray(a.signals) || a.signals.length < 1 || a.signals.length > ADVICE_SIGNALS.length) return null;
      const signals: AdviceSignal[] = [];
      const seen = new Set<string>();
      for (const s of a.signals) {
        if (!ADVICE_SIGNALS.includes(s as AdviceSignal) || seen.has(s)) return null;
        seen.add(s); signals.push(s as AdviceSignal);
      }
      return Object.freeze({ ...base, kind, selectedHotelIds, signals });
    }
    case "unknown":
      if (!UNKNOWN_REASONS.includes(a.reason as UnknownReason)) return null;
      return Object.freeze({ ...base, kind, reason: a.reason as UnknownReason });
    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GATEWAY → CLIENT frames (closed union)
// ═══════════════════════════════════════════════════════════════════════════
export type TurnState = "listening" | "transcribing" | "thinking" | "acting" | "speaking" | "idle";
const TURN_STATES: readonly TurnState[] = Object.freeze(["listening", "transcribing", "thinking", "acting", "speaking", "idle"]);
export type TurnErrorCode =
  | "provider_unavailable" | "provider_error" | "invalid_output" | "timeout"
  | "budget_exceeded" | "stale" | "unsupported";
const TURN_ERROR_CODES: readonly TurnErrorCode[] = Object.freeze([
  "provider_unavailable", "provider_error", "invalid_output", "timeout", "budget_exceeded", "stale", "unsupported",
]);

export interface PcmFormat { encoding: "pcm16"; sampleRate: 24000; channels: 1 }
export const FIXED_PCM_FORMAT: Readonly<PcmFormat> = Object.freeze({ encoding: "pcm16", sampleRate: 24000, channels: 1 });

// ── LIVE-AI-03B — compiled-answer envelope (IC02) carried over the wire ──────
// A STRUCTURAL mirror of the IC02 CompiledAnswerEnvelope for the `answer.compiled` frame.
// This validator proves ONLY the wire shape/bounds; the AUTHORITATIVE verification (versions,
// semanticHash, deterministic rerender == canonicalText, textHash, stale-binding) is performed
// by the browser-safe consumer (lib/live-ai/compiled-answer-consumer.ts). A malformed shape is
// dropped here; a well-formed but TAMPERED envelope is rejected by the consumer.
export interface CompiledAnswerBinding {
  sessionId: string; turnId: string; generation: number; pageId: "hotels" | "hotel-detail";
  role: "anonymous" | "customer"; routeEpoch: number; contextRevision: string; authorityRef: string; contextDigest: string;
}
export interface CompiledAnswerEnvelope {
  contractVersion: string; compilerVersion: string; templateCatalogVersion: string;
  answerId: string; planId: string; binding: CompiledAnswerBinding;
  compiledOutcome: string; disposition: "IC02_ACCEPTED"; language: LiveAiLanguage;
  semanticAtoms: readonly unknown[]; evidenceCommitments: readonly unknown[];
  canonicalText: string; semanticHash: string; textHash: string;
}
const COMPILED_ENVELOPE_KEYS: readonly string[] = Object.freeze([
  "contractVersion", "compilerVersion", "templateCatalogVersion", "answerId", "planId", "binding",
  "compiledOutcome", "disposition", "language", "semanticAtoms", "evidenceCommitments", "canonicalText", "semanticHash", "textHash",
]);
const COMPILED_BINDING_KEYS: readonly string[] = Object.freeze([
  "sessionId", "turnId", "generation", "pageId", "role", "routeEpoch", "contextRevision", "authorityRef", "contextDigest",
]);
const IC02_MAX_CANONICAL_TEXT_BYTES = 4000;
const IC02_MAX_SEMANTIC_ATOMS = 28;   // IC02_MAX_RESPONSE_CLAIMS(8)*3 + 4
const IC02_MAX_EVIDENCE_RECORDS = 8;
function exactOwnKeys(x: unknown, allowed: readonly string[]): Record<string, unknown> | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const keys = Object.keys(x as Record<string, unknown>);
  if (keys.length !== allowed.length) return null;
  for (const k of allowed) if (!Object.prototype.hasOwnProperty.call(x, k)) return null;
  return x as Record<string, unknown>;
}
function validateCompiledBinding(x: unknown): CompiledAnswerBinding | null {
  const a = exactOwnKeys(x, COMPILED_BINDING_KEYS);
  if (!a) return null;
  if (!isValidId(a.sessionId) || !isValidId(a.turnId) || !isValidId(a.authorityRef)) return null;
  if (!isEpoch(a.generation) || !isEpoch(a.routeEpoch)) return null;
  if (a.pageId !== "hotels" && a.pageId !== "hotel-detail") return null;
  if (a.role !== "anonymous" && a.role !== "customer") return null;
  if (!isContextRevision(a.contextRevision)) return null;
  if (typeof a.contextDigest !== "string" || !HEX64_RE.test(a.contextDigest)) return null;
  return Object.freeze({
    sessionId: a.sessionId as string, turnId: a.turnId as string, generation: a.generation as number,
    pageId: a.pageId as "hotels" | "hotel-detail", role: a.role as "anonymous" | "customer",
    routeEpoch: a.routeEpoch as number, contextRevision: a.contextRevision as string,
    authorityRef: a.authorityRef as string, contextDigest: a.contextDigest as string,
  });
}
export function validateCompiledAnswerEnvelope(x: unknown): CompiledAnswerEnvelope | null {
  try {
    const a = exactOwnKeys(x, COMPILED_ENVELOPE_KEYS);
    if (!a) return null;
    if (typeof a.contractVersion !== "string" || !a.contractVersion) return null;
    if (typeof a.compilerVersion !== "string" || !a.compilerVersion) return null;
    if (typeof a.templateCatalogVersion !== "string" || !a.templateCatalogVersion) return null;
    if (!isValidId(a.answerId) || !isValidId(a.planId)) return null;
    const binding = validateCompiledBinding(a.binding);
    if (!binding) return null;
    if (typeof a.compiledOutcome !== "string" || !a.compiledOutcome) return null;
    if (a.disposition !== "IC02_ACCEPTED") return null;
    if (!isLiveAiLanguage(a.language)) return null;
    if (!Array.isArray(a.semanticAtoms) || a.semanticAtoms.length < 1 || a.semanticAtoms.length > IC02_MAX_SEMANTIC_ATOMS) return null;
    if (!Array.isArray(a.evidenceCommitments) || a.evidenceCommitments.length > IC02_MAX_EVIDENCE_RECORDS) return null;
    if (boundedText(a.canonicalText, IC02_MAX_CANONICAL_TEXT_BYTES) === null) return null;
    if (typeof a.semanticHash !== "string" || !HEX64_RE.test(a.semanticHash)) return null;
    if (typeof a.textHash !== "string" || !HEX64_RE.test(a.textHash)) return null;
    return Object.freeze({
      contractVersion: a.contractVersion, compilerVersion: a.compilerVersion, templateCatalogVersion: a.templateCatalogVersion,
      answerId: a.answerId as string, planId: a.planId as string, binding,
      compiledOutcome: a.compiledOutcome, disposition: "IC02_ACCEPTED", language: a.language as LiveAiLanguage,
      semanticAtoms: Object.freeze(a.semanticAtoms.slice()), evidenceCommitments: Object.freeze(a.evidenceCommitments.slice()),
      canonicalText: a.canonicalText as string, semanticHash: a.semanticHash as string, textHash: a.textHash as string,
    });
  } catch { return null; }
}

export type ServerFrame =
  | { t: "connection.ready"; sessionId: string; gatewaySessionId: string }
  | { t: "context.ack"; sessionId: string; turnId: string; generation: number; routeEpoch: number; contextRevision: string; authorityRef: string }
  | { t: "transcript.partial"; sessionId: string; turnId: string; generation: number; seq: number; text: string; language: LiveAiLanguage }
  | { t: "transcript.final"; sessionId: string; turnId: string; generation: number; providerTurnId: string; text: string; language: LiveAiLanguage }
  | { t: "turn.state"; sessionId: string; turnId: string; generation: number; state: TurnState }
  | { t: "action.proposal"; sessionId: string; turnId: string; generation: number; authorityRef: string; executionNonce: string; receiptId: string; proposal: ProviderProposal }
  // R5B — the gateway ACKNOWLEDGES a valid receipt lifecycle update. The ACK proves gateway
  // lifecycle acceptance (NOT execution/verification); the browser promotes a terminal verified
  // receipt into its trusted evidence map ONLY after the correlated ACK arrives.
  // R5B-REV-06 — the ACK carries the CANONICAL TERMINAL RECEIPT COMMITMENT (a SHA-256 over receiptId +
  // proposalId + providerTurnId + actionId + executionNonce + operation + outcome + status + source
  // authorityRef + result authority + evidence). The browser promotes a held terminal-verified receipt
  // ONLY when the ACK's commitment EXACTLY equals the commitment it computed for the receipt it sent — a
  // copied / fabricated ACK-shaped frame (wrong or absent commitment) never promotes.
  | { t: "action.receipt.ack"; sessionId: string; turnId: string; generation: number; receiptId: string; proposalId: string; outcome: ReceiptOutcome; closed: boolean; commitment: string }
  | { t: "answer.plan"; sessionId: string; turnId: string; generation: number; authorityRef: string; plan: AnswerPlan }
  // LIVE-AI-03B — the compiled IC02 answer envelope (the ONLY rendered 03B answer path).
  | { t: "answer.compiled"; sessionId: string; turnId: string; generation: number; authorityRef: string; envelope: CompiledAnswerEnvelope }
  | { t: "audio.start"; sessionId: string; turnId: string; generation: number; planId: string; audioId: string; format: PcmFormat }
  | { t: "audio.chunk"; sessionId: string; turnId: string; generation: number; audioId: string; seq: number; bytes: string }
  | { t: "audio.end"; sessionId: string; turnId: string; generation: number; audioId: string; finalSeq: number }
  | { t: "turn.error"; sessionId: string; turnId: string; generation: number; code: TurnErrorCode }
  | { t: "session.killed"; sessionId: string; code: "runtime_killed" }
  | { t: "session.ended"; sessionId: string; reason: "user" | "timeout" | "unmount" | "closed" };

const SERVER_FRAME_KEYS: Readonly<Record<ServerFrame["t"], readonly string[]>> = Object.freeze({
  "connection.ready": ["t", "sessionId", "gatewaySessionId"],
  "context.ack": ["t", "sessionId", "turnId", "generation", "routeEpoch", "contextRevision", "authorityRef"],
  "transcript.partial": ["t", "sessionId", "turnId", "generation", "seq", "text", "language"],
  "transcript.final": ["t", "sessionId", "turnId", "generation", "providerTurnId", "text", "language"],
  "turn.state": ["t", "sessionId", "turnId", "generation", "state"],
  "action.proposal": ["t", "sessionId", "turnId", "generation", "authorityRef", "executionNonce", "receiptId", "proposal"],
  "action.receipt.ack": ["t", "sessionId", "turnId", "generation", "receiptId", "proposalId", "outcome", "closed", "commitment"],
  "answer.plan": ["t", "sessionId", "turnId", "generation", "authorityRef", "plan"],
  "answer.compiled": ["t", "sessionId", "turnId", "generation", "authorityRef", "envelope"],
  "audio.start": ["t", "sessionId", "turnId", "generation", "planId", "audioId", "format"],
  "audio.chunk": ["t", "sessionId", "turnId", "generation", "audioId", "seq", "bytes"],
  "audio.end": ["t", "sessionId", "turnId", "generation", "audioId", "finalSeq"],
  "turn.error": ["t", "sessionId", "turnId", "generation", "code"],
  "session.killed": ["t", "sessionId", "code"],
  "session.ended": ["t", "sessionId", "reason"],
});

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
function isBase64Bounded(v: unknown, maxDecodedBytes: number): v is string {
  if (typeof v !== "string") return false;
  if (v.length % 4 !== 0) return false;
  if (!BASE64_RE.test(v)) return false;
  // decoded bytes ≈ len/4*3 - padding
  const pad = v.endsWith("==") ? 2 : v.endsWith("=") ? 1 : 0;
  const decoded = (v.length / 4) * 3 - pad;
  return decoded >= 0 && decoded <= maxDecodedBytes;
}

/** Strict validate an untrusted gateway frame → frozen copy, or null. */
export function validateServerFrame(x: unknown): ServerFrame | null {
  // R5B-REV-08 — TOTAL + fail-closed: the preliminary Array.isArray brand check AND the getOwnPropertyDescriptor
  // "t" read both THROW on a hostile revoked Proxy, so the WHOLE server-frame validation (including the R5B
  // action.receipt.ack + action.proposal + nested receipt/plan/refinement validators) is inside this guard.
  try {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const tDesc = Object.getOwnPropertyDescriptor(x, "t");
  if (!tDesc || !("value" in tDesc) || typeof tDesc.get === "function") return null;
  const t = tDesc.value as ServerFrame["t"];
  const allowed = (SERVER_FRAME_KEYS as Record<string, readonly string[]>)[t];
  if (!allowed) return null;
  const a = strictOwnDataRecord(x, allowed);
  if (!a) return null;
  switch (t) {
    case "connection.ready":
      if (!isValidId(a.sessionId) || !isValidId(a.gatewaySessionId)) return null;
      return Object.freeze({ t, sessionId: a.sessionId as string, gatewaySessionId: a.gatewaySessionId as string });
    case "context.ack":
      if (!isValidId(a.sessionId) || !isValidId(a.turnId) || !isEpoch(a.generation) || !isEpoch(a.routeEpoch)) return null;
      if (!isContextRevision(a.contextRevision) || !isValidId(a.authorityRef)) return null;
      return Object.freeze({ t, sessionId: a.sessionId as string, turnId: a.turnId as string, generation: a.generation as number, routeEpoch: a.routeEpoch as number, contextRevision: a.contextRevision as string, authorityRef: a.authorityRef as string });
    case "transcript.partial": {
      const c = readCorrelation(a);
      if (!c) return null;
      const seq = numInRange(a.seq, 0, MAX_EPOCH);
      if (seq === null || !Number.isInteger(seq)) return null;
      const text = boundedText(a.text, MAX_PARTIAL_TRANSCRIPT_BYTES);
      if (text === null || !isLiveAiLanguage(a.language)) return null;
      return Object.freeze({ t, ...c, seq, text, language: a.language });
    }
    case "transcript.final": {
      const c = readCorrelation(a);
      if (!c) return null;
      if (!isValidId(a.providerTurnId)) return null;
      const text = boundedText(a.text, MAX_FINAL_TRANSCRIPT_BYTES);
      if (text === null || !isLiveAiLanguage(a.language)) return null;
      return Object.freeze({ t, ...c, providerTurnId: a.providerTurnId as string, text, language: a.language });
    }
    case "turn.state": {
      const c = readCorrelation(a);
      if (!c || !TURN_STATES.includes(a.state as TurnState)) return null;
      return Object.freeze({ t, ...c, state: a.state as TurnState });
    }
    case "action.proposal": {
      const c = readCorrelation(a);
      // R4-05/R5B — the GATEWAY-issued execution commitment (executionNonce) AND the GATEWAY-minted
      // receipt identity (receiptId) are REQUIRED frame fields (gateway metadata, NOT provider data);
      // a proposal frame missing either is rejected. The browser binds its actionId to the nonce and
      // ECHOES the receiptId thereafter (it may never mint its own).
      if (!c || !isValidId(a.authorityRef) || !isValidId(a.executionNonce) || !isValidId(a.receiptId)) return null;
      const proposal = validateProviderProposal(a.proposal);
      if (!proposal) return null;
      return Object.freeze({ t, ...c, authorityRef: a.authorityRef as string, executionNonce: a.executionNonce as string, receiptId: a.receiptId as string, proposal });
    }
    case "action.receipt.ack": {
      const c = readCorrelation(a);
      if (!c || !isValidId(a.receiptId) || !isValidId(a.proposalId)) return null;
      if (!RECEIPT_OUTCOMES.includes(a.outcome as ReceiptOutcome)) return null;
      if (typeof a.closed !== "boolean") return null;
      // R5B-REV-06 — the canonical terminal-receipt commitment (SHA-256 hex).
      if (typeof a.commitment !== "string" || !HEX64_RE.test(a.commitment)) return null;
      return Object.freeze({ t, ...c, receiptId: a.receiptId as string, proposalId: a.proposalId as string, outcome: a.outcome as ReceiptOutcome, closed: a.closed, commitment: a.commitment });
    }
    case "answer.plan": {
      const c = readCorrelation(a);
      if (!c || !isValidId(a.authorityRef)) return null;
      const plan = validateAnswerPlan(a.plan);
      if (!plan) return null;
      return Object.freeze({ t, ...c, authorityRef: a.authorityRef as string, plan });
    }
    case "answer.compiled": {
      const c = readCorrelation(a);
      if (!c || !isValidId(a.authorityRef)) return null;
      const envelope = validateCompiledAnswerEnvelope(a.envelope);
      if (!envelope) return null;
      return Object.freeze({ t, ...c, authorityRef: a.authorityRef as string, envelope });
    }
    case "audio.start": {
      const c = readCorrelation(a);
      if (!c || !isValidId(a.planId) || !isValidId(a.audioId)) return null;
      if (!validatePcmFormat(a.format)) return null;
      return Object.freeze({ t, ...c, planId: a.planId as string, audioId: a.audioId as string, format: FIXED_PCM_FORMAT });
    }
    case "audio.chunk": {
      const c = readCorrelation(a);
      if (!c || !isValidId(a.audioId)) return null;
      const seq = numInRange(a.seq, 0, MAX_EPOCH);
      if (seq === null || !Number.isInteger(seq)) return null;
      if (!isBase64Bounded(a.bytes, MAX_AUDIO_CHUNK_BYTES)) return null;
      return Object.freeze({ t, ...c, audioId: a.audioId as string, seq, bytes: a.bytes as string });
    }
    case "audio.end": {
      const c = readCorrelation(a);
      if (!c || !isValidId(a.audioId)) return null;
      const finalSeq = numInRange(a.finalSeq, 0, MAX_EPOCH);
      if (finalSeq === null || !Number.isInteger(finalSeq)) return null;
      return Object.freeze({ t, ...c, audioId: a.audioId as string, finalSeq });
    }
    case "turn.error": {
      const c = readCorrelation(a);
      if (!c || !TURN_ERROR_CODES.includes(a.code as TurnErrorCode)) return null;
      return Object.freeze({ t, ...c, code: a.code as TurnErrorCode });
    }
    case "session.killed":
      if (!isValidId(a.sessionId) || a.code !== "runtime_killed") return null;
      return Object.freeze({ t, sessionId: a.sessionId as string, code: "runtime_killed" });
    case "session.ended":
      if (!isValidId(a.sessionId)) return null;
      if (a.reason !== "user" && a.reason !== "timeout" && a.reason !== "unmount" && a.reason !== "closed") return null;
      return Object.freeze({ t, sessionId: a.sessionId as string, reason: a.reason });
    default:
      return null;
  }
  } catch { return null; }
}
function validatePcmFormat(x: unknown): boolean {
  if (!x || typeof x !== "object") return false;
  const a = strictOwnDataRecord(x, ["encoding", "sampleRate", "channels"]);
  if (!a) return false;
  return a.encoding === "pcm16" && a.sampleRate === 24000 && a.channels === 1;
}

// ═══════════════════════════════════════════════════════════════════════════
// REPLAY / CONFLICT decisions (pure) over a deterministic canonical digest
// ═══════════════════════════════════════════════════════════════════════════
/** Deterministic canonical digest string of any bounded JSON-able value.
 *  Fixed key ordering + null-normalized undefined, so identical content → identical
 *  digest and different content → different digest. NOT a cryptographic hash. */
export function canonicalDigest(value: unknown): string {
  return "d:" + stableStringify(value);
}
function stableStringify(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  if (typeof v === "object") {
    const keys = Object.keys(v as Record<string, unknown>).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify((v as Record<string, unknown>)[k])).join(",") + "}";
  }
  return "null";
}

/**
 * REV-06 — a synchronous, DEPENDENCY-FREE SHA-256 (FIPS 180-4). Used so the browser
 * can produce a CRYPTOGRAPHICALLY collision-resistant context digest INLINE (Web
 * Crypto is async-only, which would make context publish async); the gateway
 * independently recomputes its OWN SHA-256 authority and never trusts a
 * caller-selected hash. NOT a keyed MAC — it is an integrity digest; the authority
 * binding is the server's SHA-256 authorityRef over the full tuple (incl. generation).
 */
export function sha256Hex(input: string): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const rr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  // UTF-8 bytes.
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let c = input.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) { bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
    else if (c >= 0xd800 && c <= 0xdbff) { const c2 = input.charCodeAt(++i); c = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
    else { bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
  }
  const l = bytes.length; const bitLen = l * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push((bitLen / Math.pow(2, i * 8)) & 0xff);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a, h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Array(64);
  for (let j = 0; j < bytes.length; j += 64) {
    for (let i = 0; i < 16; i++) w[i] = ((bytes[j + i * 4] << 24) | (bytes[j + i * 4 + 1] << 16) | (bytes[j + i * 4 + 2] << 8) | bytes[j + i * 4 + 3]) >>> 0;
    for (let i = 16; i < 64; i++) { const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3); const s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0; }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25); const ch = (e & f) ^ (~e & g); const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22); const maj = (a & b) ^ (a & c) ^ (b & c); const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4) + hex(h5) + hex(h6) + hex(h7);
}

/**
 * REV-06 — a cryptographically collision-resistant, fixed-length (64 hex chars),
 * full-content digest of a bounded canonical value. Any difference anywhere — even at
 * the very end of a 24-hotel payload — changes the digest (SHA-256, not a fold).
 */
export function contextDigest(value: unknown): string {
  return sha256Hex(stableStringify(value));
}

// R5B-REV-07 — the sentinel actionId a PRE-ACCEPT terminal is committed under (byte-mirror of the gateway
// live-ai-schemas.ts). A proposal that NEVER reached action.accepted has no bound actionId; the sentinel
// (outside the id charset, so it can never be a real actionId) replaces the fabricated one in the terminal
// audit/commitment, so a pre-accept terminal deterministically commits to the "no accepted action id" shape
// and no later browser actionId can revive it. Printable ASCII only (no control byte).
export const UNACCEPTED_ACTION_ID = "#unaccepted#";
/**
 * R5B-REV-06 — the CANONICAL TERMINAL-RECEIPT COMMITMENT: a SHA-256 over the fixed, ordered tuple of
 * EVERY identity + authority + result field of a receipt (receiptId, proposalId, providerTurnId,
 * actionId, executionNonce, operation, outcome, status, SOURCE authorityRef, the full RESULT authority,
 * and the bounded evidence). The browser computes this for the receipt it SENDS and holds it; the gateway
 * recomputes it from the receipt it ACCEPTED and returns it in action.receipt.ack. The browser promotes a
 * held terminal-verified receipt into trusted evidence ONLY when the ACK's commitment equals its own — a
 * copied / fabricated / wrong-content ACK-shaped frame can never match (the fields fold in the
 * gateway-minted receiptId + executionNonce a forger cannot know). Deterministic (sorted-key canonical).
 */
export function terminalReceiptCommitment(r: {
  receiptId: string; proposalId: string; providerTurnId: string; actionId: string; executionNonce: string;
  operation: string; outcome: string; status: string; authorityRef: string;
  resultAuthority?: ResultAuthority; evidence?: ReceiptEvidence;
}): string {
  return sha256Hex(stableStringify({
    receiptId: r.receiptId, proposalId: r.proposalId, providerTurnId: r.providerTurnId,
    actionId: r.actionId, executionNonce: r.executionNonce, operation: r.operation,
    outcome: r.outcome, status: r.status, authorityRef: r.authorityRef,
    resultAuthority: r.resultAuthority ?? null, evidence: r.evidence ?? null,
  }));
}

/**
 * R3-08 — the CANONICAL, DETERMINISTIC spoken text for a validated AnswerPlan.
 * This is the EXACT text the gateway will voice (no server recomposition after
 * approval): the browser renders it, hashes the exact UTF-8 bytes (approvedTextHash),
 * and sends that hash in answer.approve; the gateway independently renders the SAME
 * text (a byte-identical mirror in server/voice-gateway/live-ai-schemas.ts), verifies
 * the hash, and voices exactly it. There is NO separate "compact plan key" and NO
 * differing separator algorithm (the R2-NEW-01 U+001F-vs-empty-string divergence is
 * removed) — the single hashed artifact IS the spoken text itself. Bounded to 400 chars.
 */
export function renderPlanSpokenText(plan: AnswerPlan): string {
  const L = plan.language;
  let s: string;
  switch (plan.kind) {
    case "clarification":
      s = triLang(L,
        { which_city: "Which city are you looking at?", what_budget: "What's your budget per night?", which_hotels: "Which stays should I compare?", which_facility: "Which facility do you mean?", rephrase: "Could you say that another way?" }[plan.questionCode],
        { which_city: "Kaunsa city dekh rahe hain?", what_budget: "Aapka budget per night kitna hai?", which_hotels: "Kaunse stays compare karun?", which_facility: "Kaunsi facility ki baat hai?", rephrase: "Thoda dobara bata dijiye?" }[plan.questionCode],
        { which_city: "\u0915\u094c\u0928-\u0938\u093e \u0936\u0939\u0930 \u0926\u0947\u0916 \u0930\u0939\u0947 \u0939\u0948\u0902?", what_budget: "\u092a\u094d\u0930\u0924\u093f \u0930\u093e\u0924 \u092c\u091c\u091f \u0915\u093f\u0924\u0928\u093e \u0939\u0948?", which_hotels: "\u0915\u094c\u0928-\u0938\u0947 \u0938\u094d\u091f\u0947 \u0924\u0941\u0932\u0928\u093e \u0915\u0930\u0942\u0901?", which_facility: "\u0915\u094c\u0928-\u0938\u0940 \u0938\u0941\u0935\u093f\u0927\u093e?", rephrase: "\u0925\u094b\u0921\u093c\u093e \u0926\u094b\u092c\u093e\u0930\u093e \u092c\u0924\u093e\u0907\u090f?" }[plan.questionCode]);
      break;
    case "page_facts":
      s = triLang(L, `Here are the details for ${plan.selectedHotelIds.length} stay(s) on screen.`, `Screen par ${plan.selectedHotelIds.length} stay ki detail yahan hai.`, `\u0938\u094d\u0915\u094d\u0930\u0940\u0928 \u092a\u0930 ${plan.selectedHotelIds.length} \u0938\u094d\u091f\u0947 \u0915\u093e \u0935\u093f\u0935\u0930\u0923\u0964`);
      break;
    case "comparison":
      s = triLang(L, `Comparing ${plan.selectedHotelIds.length} stays on ${plan.factors.join(", ")}.`, `${plan.selectedHotelIds.length} stays ko ${plan.factors.join(", ")} par compare kiya.`, `${plan.selectedHotelIds.length} \u0938\u094d\u091f\u0947 \u0915\u0940 \u0924\u0941\u0932\u0928\u093e: ${plan.factors.join(", ")}\u0964`);
      break;
    case "action_status":
      s = triLang(L, `That's ${plan.outcome}.`, `Wo ${plan.outcome} hai.`, `\u0935\u0939 ${plan.outcome} \u0939\u0948\u0964`);
      break;
    case "advice":
      s = triLang(L, `Based on the current results: ${plan.signals.join(", ")}.`, `Current results ke hisaab se: ${plan.signals.join(", ")}.`, `\u092e\u094c\u091c\u0942\u0926\u093e \u0928\u0924\u0940\u091c\u094b\u0902 \u0915\u0947 \u0906\u0927\u093e\u0930 \u092a\u0930: ${plan.signals.join(", ")}\u0964`);
      break;
    case "unknown":
    default:
      s = triLang(L, "I don't have that information.", "Wo jankari nahi hai.", "\u0935\u0939 \u091c\u093e\u0928\u0915\u093e\u0930\u0940 \u0928\u0939\u0940\u0902\u0964");
      break;
  }
  return s.slice(0, 400);
}
function triLang(lang: LiveAiLanguage, en: string, hinglish: string, hi: string): string {
  return lang === "en" ? en : lang === "hinglish" ? hinglish : hi;
}
/** R3-08 — the approved-text hash: SHA-256 over the EXACT UTF-8 spoken text. */
export function approvedTextHash(plan: AnswerPlan): string {
  return sha256Hex(renderPlanSpokenText(plan));
}

export type ReplayDecision = "idempotent" | "conflict" | "fresh";
/**
 * Decide how to treat a keyed submission (context tuple / text turn / receipt).
 * `store` maps a correlation KEY → the digest last accepted for it.
 *   • no prior entry → "fresh" (record it);
 *   • same digest → "idempotent" (same content re-sent);
 *   • different digest for the SAME key → "conflict" (reject; never overwrite).
 */
export function decideReplay(store: Map<string, string>, key: string, digest: string): ReplayDecision {
  const prior = store.get(key);
  if (prior === undefined) return "fresh";
  return prior === digest ? "idempotent" : "conflict";
}

// ── R3-08 — SEMANTIC evidence binding (the CLIENT mirror of the gateway rule in
//    server/voice-gateway/live-ai-schemas.ts evidenceSupportsPlan). The browser only
//    APPROVES (→ voices) a factual plan when every cited receipt is verified UNDER THE
//    CURRENT AUTHORITY, carries compatible read-evidence, and every referenced hotel is
//    on-screen in the current context. Same rule → same accept/reject on both sides. ──
// R4-08 — the COMPLETE bounded correlated verified receipt kept for factual support: the
// proposal it correlates to, its verified outcome, the executable authority it was verified
// under, and its EXACT bounded evidence (results count / comparison positions / detail hotel
// facts / ui section). evidenceSupportsPlan validates each plan KIND field-by-field against
// this — never a generic "a receipt exists" unlock.
export interface EvidenceReceiptRef {
  proposalId: string;
  operation: string;
  outcome: string;
  authorityRef: string;
  // R5B — the bounded evidence upgrades (ordered result ids / resolved comparison ids + factors +
  // WINNER positions / navigation destination / section-bound hotel identity / detail TRI-STATE facts)
  // travel here for R5B-REV-05 field-level plan + deterministic advice-signal support.
  evidence?: { kind: string; hotelId?: string; positions?: number[]; count?: number; section?: string; orderedIds?: string[]; hotelIds?: string[]; factors?: string[]; cheapestPosition?: number | null; topRatedPosition?: number | null; breakfast?: string; parking?: string };
}
export interface EvidenceCtx {
  getReceipt: (id: string) => EvidenceReceiptRef | undefined;
  currentAuthorityRef: string | null;
  contextHotelIds: ReadonlySet<string>;
  /** R4-08 — resolve an on-screen position (a comparison receipt cites positions) to its
   *  current hotel id, so a comparison plan's selectedHotelIds can be bound to the hotels a
   *  verified comparison receipt actually compared. */
  positionToHotelId?: (position: number) => string | null;
}
export function evidenceSupportsPlan(plan: AnswerPlan, ctx: EvidenceCtx): boolean {
  const kind = plan.kind;
  // clarification / unknown carry no factual claim → no evidence required.
  if (kind === "clarification" || kind === "unknown") return true;
  const ids = plan.evidenceReceiptIds;
  if (ids.length === 0) return false;
  const cited = ids.map((id) => ctx.getReceipt(id));
  if (cited.some((r) => !r)) return false;                                   // an unknown / unverified id
  if (!ctx.currentAuthorityRef) return false;
  // R4-08 — an OLD-turn/generation/context receipt (different authority) can never support a
  // current factual plan.
  if (cited.some((r) => (r as EvidenceReceiptRef).authorityRef !== ctx.currentAuthorityRef)) return false;
  const list = cited as EvidenceReceiptRef[];
  if (kind === "action_status") {
    // R4-08 — the reported action must be the EXACT correlated verified receipt: the cited
    // receipt is one of the plan's evidence ids, is FOR the plan's proposal, and its verified
    // outcome equals the plan's reported outcome (a success claim needs a verified success).
    const rid = (plan as { receiptId: string }).receiptId;
    const pid = (plan as { proposalId: string }).proposalId;
    const oc = (plan as { outcome: string }).outcome;
    if (typeof rid !== "string" || !ids.includes(rid)) return false;
    const r = ctx.getReceipt(rid);
    if (!r) return false;
    if (r.proposalId !== pid) return false;                                  // wrong action
    if (r.outcome !== oc) return false;                                      // wrong reported outcome
    return true;
  }
  // fact kinds — page_facts / comparison / advice: must rest on ACTUAL read evidence.
  const hasRead = list.some((r) => r.evidence && (r.evidence.kind === "results" || r.evidence.kind === "detail" || r.evidence.kind === "comparison"));
  if (!hasRead) return false;                                                // no read evidence (e.g. only ui_state)
  const sel = (plan as { selectedHotelIds?: string[] }).selectedHotelIds || [];
  if (sel.length === 0) return false;
  if (sel.some((h) => !ctx.contextHotelIds.has(h))) return false;            // references an off-screen hotel
  if (kind === "page_facts") {
    // R4-08 — EACH stated hotel needs a DETAIL receipt for THAT hotel. A results-count receipt
    // alone (which identifies no hotel) cannot authorize facts about any specific visible hotel.
    const detailHotels = new Set(list.filter((r) => r.evidence && r.evidence.kind === "detail" && typeof r.evidence.hotelId === "string").map((r) => r.evidence!.hotelId as string));
    if (!sel.every((h) => detailHotels.has(h))) return false;
  }
  if (kind === "comparison") {
    // R5B-REV-05 — the compared hotels AND the claimed comparison FACTORS must both come from ONE exact
    // cited verified comparison receipt: its compared ids cover every selected hotel, AND its factors EXACTLY
    // equal the plan's factors (same length + order + values). A subset / superset / reordered / substituted
    // factor set (e.g. price-only evidence authorizing a parking comparison) is rejected — a claimed factor
    // must EXIST in compatible exact cited verified comparison evidence.
    const planFactors = (plan as { factors?: string[] }).factors || [];
    if (planFactors.length === 0) return false;
    let matched = false;
    for (const r of list) {
      const ev = r.evidence;
      if (!ev || ev.kind !== "comparison") continue;
      const evFactors = Array.isArray(ev.factors) ? ev.factors : null;
      if (!evFactors || evFactors.length !== planFactors.length) continue;
      let factorsExact = true;
      for (let i = 0; i < planFactors.length; i++) if (planFactors[i] !== evFactors[i]) { factorsExact = false; break; }
      if (!factorsExact) continue;
      // this comparison receipt's factors match the plan exactly — do its compared ids cover every selected hotel?
      const compared = new Set<string>();
      if (Array.isArray(ev.hotelIds)) { for (const id of ev.hotelIds) if (typeof id === "string") compared.add(id); }
      else if (Array.isArray(ev.positions)) { for (const p of ev.positions) { const id = ctx.positionToHotelId ? ctx.positionToHotelId(p) : null; if (id) compared.add(id); } }
      if (compared.size > 0 && sel.every((h) => compared.has(h))) { matched = true; break; }
    }
    if (!matched) return false;
  }
  if (kind === "advice") {
    // R5B-REV-05 — DETERMINISTIC advice signals: EVERY claimed signal must be backed by the EXACT
    // verified underlying value in the cited evidence (a comparison winner among the selected, a
    // detail tri-state fact). A signal we cannot ground — absent / unknown / ambiguous, or one
    // (`fits_budget`) the bounded evidence cannot prove — is NEVER manufactured; it downgrades the
    // whole plan. Only `no_verified_match` needs no positive proof.
    const signals = (plan as { signals?: string[] }).signals || [];
    const cheapestIds = new Set<string>(), topRatedIds = new Set<string>();
    const parkPresent = new Set<string>(), parkUnknown = new Set<string>();
    const bfPresent = new Set<string>(), bfUnknown = new Set<string>();
    for (const r of list) {
      const ev = r.evidence; if (!ev) continue;
      if (ev.kind === "comparison") {
        const resolve = (pos: number | null | undefined): string | null => {
          if (pos === null || pos === undefined) return null;
          if (Array.isArray(ev.positions) && Array.isArray(ev.hotelIds)) { const i = ev.positions.indexOf(pos); if (i >= 0 && typeof ev.hotelIds[i] === "string") return ev.hotelIds[i]; }
          return ctx.positionToHotelId ? ctx.positionToHotelId(pos) : null;
        };
        const ch = resolve(ev.cheapestPosition); if (ch) cheapestIds.add(ch);
        const tr = resolve(ev.topRatedPosition); if (tr) topRatedIds.add(tr);
      } else if (ev.kind === "detail" && typeof ev.hotelId === "string") {
        if (ev.parking === "present") parkPresent.add(ev.hotelId); else if (ev.parking === "unknown") parkUnknown.add(ev.hotelId);
        if (ev.breakfast === "present") bfPresent.add(ev.hotelId); else if (ev.breakfast === "unknown") bfUnknown.add(ev.hotelId);
      }
    }
    const backs = (set: Set<string>): boolean => sel.some((h) => set.has(h)); // a selected hotel carries the signal
    for (const g of signals) {
      switch (g) {
        // R5B-REV-05 (option B) — no_verified_match is REFUSED as an evidence-backed factual signal in R5B:
        // it must NOT be accepted merely because generic READ evidence exists, and R5B does not deterministically
        // prove it from bounded verified criteria, so any plan claiming it downgrades (never voiced).
        case "no_verified_match": return false;
        case "lower_price": if (!backs(cheapestIds)) return false; break;
        case "higher_rating": if (!backs(topRatedIds)) return false; break;
        case "parking_present": if (!backs(parkPresent)) return false; break;
        case "parking_unknown": if (!backs(parkUnknown)) return false; break;
        case "breakfast_present": if (!backs(bfPresent)) return false; break;
        case "breakfast_unknown": if (!backs(bfUnknown)) return false; break;
        case "fits_budget": return false; // no budget/price in bounded evidence → never manufacturable
        default: return false;
      }
    }
  }
  return true;
}
