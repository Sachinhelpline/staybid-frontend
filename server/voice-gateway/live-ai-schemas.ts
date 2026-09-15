// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-02A — server-side strict schema validation.
//
// The gateway's INDEPENDENT mirror of the closed browser↔gateway protocol. It
// NEVER sanitizes a malformed input into acceptance: every validator returns a
// frozen own-data copy or null. Own-DATA-only + plain/null-prototype only (custom
// prototype / symbol / accessor / inherited / non-enumerable / unknown discriminant
// all fail closed). It also validates the PROVIDER's structured output down to the
// exact closed operation + answer-plan shapes — raw model prose is never accepted
// as an executable operation or as a fact.
//
// This module imports NO old gateway tool authority (no createToolExecutor, no
// sideband, no VoiceUiAction, no PREPARE_BID_DRAFT); it is self-contained.
// ─────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";

export const MAX_ID_LEN = 128;
export const MAX_CONTEXT_REVISION_LEN = 512;
export const MAX_TEXT_TURN_BYTES = 2_000;
export const MAX_FINAL_TRANSCRIPT_BYTES = 4_000;
export const MAX_FRAME_BYTES = 32 * 1024;
export const MAX_EPOCH = 2 ** 31 - 1;
export const MAX_VISIBLE_HOTELS = 24;
export const MAX_SELECTED_HOTELS = 4;
export const MAX_EVIDENCE_RECEIPTS = 8;
export const MAX_SDP_BYTES = 20 * 1024;
export const MIN_STARS = 3;
export const MAX_STARS = 5;
// R5A SECOND REMEDIATION (REV-NEW-02): outer length bound the strict array snapshot inspects at all
// (byte-mirror of lib/live-ai/contracts.ts). Every authority-bearing operation array is far smaller
// and each caller re-enforces its own tighter window; this only bounds the per-index inspection loop
// so a hostile huge `length` cannot force unbounded work. NOT a semantic array limit.
const MAX_OP_ARRAY_LEN = 64;

const ID_RE = /^[A-Za-z0-9._:-]+$/;
const HOTEL_ID_RE = /^[A-Za-z0-9_-]+$/;

// R5A — server-side mirrors of the TRUSTED page-builder canonicalizers, BYTE-IDENTICAL in logic
// to lib/live-ai/contracts.ts canonicalCity / boundedQuery. Used ONLY as reject-not-normalize
// EQUALITY ORACLES inside validateModelOperation (a value is accepted only when it is ALREADY in
// canonical form — i.e. the canonicalizer would not change it), so the gateway and the browser
// accept/reject an external operation's destination/query IDENTICALLY. NEVER used to transform a
// returned authority value.
const MAX_CITY_LEN = 40;
const MAX_QUERY_LEN = 60;
const CITY_RE = /^[A-Za-zÀ-ɏ .'-]+$/;
function canonicalCity(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > MAX_CITY_LEN) return null;
  if (!CITY_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}
function boundedQuery(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const cleaned = Array.from(input)
    .filter((ch) => { const c = ch.charCodeAt(0); return c >= 0x20 && c !== 0x7f; })
    .join("")
    .trim()
    .replace(/\s+/g, " ");
  if (!cleaned || cleaned.length > MAX_QUERY_LEN) return null;
  return cleaned;
}

/** Own-DATA record with the R3 prototype rule; symbols/accessors/undeclared keys reject.
 *  R5A-REMEDIATION (REV-NEW-02): TOTAL, fail-closed — a hostile Proxy trap on getPrototypeOf /
 *  ownKeys / getOwnPropertyDescriptor throws are caught and become null (never throw out). */
export function strictRecord(x: unknown, allowed: readonly string[]): Record<string, unknown> | null {
  // R5A SECOND REMEDIATION (REV-NEW-01): TOTAL, fail-closed. The `Array.isArray(x)` brand check —
  // which THROWS on a REVOKED Proxy — now lives INSIDE the guard alongside every other reflective
  // inspection (getPrototypeOf / ownKeys / getOwnPropertyDescriptor), so a hostile trap fails closed
  // to null rather than throwing OUT of the exported validator.
  try {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const proto = Object.getPrototypeOf(x);
  if (proto !== Object.prototype && proto !== null) return null;
  const out: Record<string, unknown> = Object.create(null);
  for (const k of Reflect.ownKeys(x)) {
    if (typeof k === "symbol") return null;
    if (!allowed.includes(k)) return null;
    const d = Object.getOwnPropertyDescriptor(x, k);
    if (!d || typeof d.get === "function" || typeof d.set === "function" || !("value" in d)) return null;
    out[k] = d.value;
  }
  return out;
  } catch {
    return null; // any hostile reflective-trap exception → fail closed
  }
}

/**
 * STRICT ARRAY SNAPSHOT (R5A SECOND REMEDIATION — REV-NEW-02). BYTE-MIRROR of the client authority
 * (lib/live-ai/contracts.ts strictArraySnapshot). Capture an untrusted value as a FRESH, inert,
 * ordinary array of its own indexed DATA values, or null. A hostile Array may override map / slice /
 * keys / values / Symbol.iterator / a "length" getter so that validation inspects one sequence while
 * a frozen output ends up carrying another (e.g. positions [999,999] whose map() returns [1,2], or
 * factors ["zoom"] whose iterator yields "price"). This helper defeats that class of attack by NEVER
 * invoking any caller-owned method: it reads every index through a trusted intrinsic property
 * descriptor and rebuilds a brand-new array literal from the captured primitive values, so downstream
 * validation AND the frozen output both come from the one inert snapshot. TOTAL and fail-closed:
 * EVERY potentially-throwing reflective inspection below — `Array.isArray` (which THROWS on a revoked
 * Proxy), getPrototypeOf, getOwnPropertyDescriptor, Reflect.ownKeys — is inside the guard, so any
 * hostile trap fails closed to null rather than throwing out. It NEVER freezes or mutates the input.
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
export function isId(v: unknown): v is string {
  return typeof v === "string" && v.length >= 1 && v.length <= MAX_ID_LEN && ID_RE.test(v);
}
export function isHotelId(v: unknown): v is string {
  return typeof v === "string" && v.length >= 1 && v.length <= 64 && HOTEL_ID_RE.test(v);
}
export function isEpoch(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_EPOCH;
}
function utf8Len(s: string): number { return Buffer.byteLength(s, "utf8"); }
export function boundedText(v: unknown, maxBytes: number): string | null {
  // R4-10 — REJECT (never strip) a control char: any C0 control or DEL fails the whole
  // value, byte-identical to the browser's boundedText, so the two ends never diverge.
  if (typeof v !== "string" || v.length === 0) return null;
  for (let i = 0; i < v.length; i++) { const c = v.charCodeAt(i); if (c < 0x20 || c === 0x7f) return null; }
  if (utf8Len(v) > maxBytes) return null;
  return v;
}
export function isContextRevision(v: unknown): v is string {
  if (typeof v !== "string" || v.length < 1 || v.length > MAX_CONTEXT_REVISION_LEN) return false;
  for (let i = 0; i < v.length; i++) { const c = v.charCodeAt(i); if (c < 0x20 || c === 0x7f) return false; }
  return true;
}
function num(v: unknown, min: number, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) return null;
  return v;
}

export type LiveAiLanguage = "hi" | "hinglish" | "en";
export function isLanguage(v: unknown): v is LiveAiLanguage { return v === "hi" || v === "hinglish" || v === "en"; }

// ── session-create body (from the broker: assertion is separate). The browser
//    supplies its OWN protocol sessionId (it owns that id); the gateway only echoes
//    it back in frames + mints its own gatewaySessionId. ────────────────────────
export type SessionCreateBody = { mode: "text"; sessionId: string } | { mode: "microphone"; sessionId: string; sdp: string };
export function validateSessionCreateBody(x: unknown): SessionCreateBody | null {
  const modeDesc = x && typeof x === "object" ? Object.getOwnPropertyDescriptor(x, "mode") : undefined;
  if (!modeDesc || !("value" in modeDesc)) return null;
  if (modeDesc.value === "text") {
    const a = strictRecord(x, ["mode", "sessionId"]);
    if (!a || !isId(a.sessionId)) return null;
    return Object.freeze({ mode: "text", sessionId: a.sessionId as string });
  }
  if (modeDesc.value === "microphone") {
    const a = strictRecord(x, ["mode", "sessionId", "sdp"]);
    if (!a || !isId(a.sessionId) || typeof a.sdp !== "string" || !a.sdp || a.sdp.length > MAX_SDP_BYTES) return null;
    return Object.freeze({ mode: "microphone", sessionId: a.sessionId as string, sdp: a.sdp as string });
  }
  return null;
}

// ── inbound CLIENT frames over the control socket ────────────────────────────
export type InboundKind = "context.publish" | "turn.text" | "action.accepted" | "action.receipt" | "answer.approve" | "turn.interrupt" | "session.reset" | "session.end";
export interface InboundFrame {
  t: InboundKind;
  sessionId: string;
  turnId?: string;
  generation: number;
  // shape kept loose here — the orchestrator only needs correlation + kind + a
  // validated payload; the browser is the authority, the gateway never executes.
  payload: Record<string, unknown>;
}
const INTERRUPT_REASONS = ["barge_in", "route_change", "context_change", "user_cancel"];
export function validateInboundFrame(x: unknown): InboundFrame | null {
  const tDesc = x && typeof x === "object" ? Object.getOwnPropertyDescriptor(x, "t") : undefined;
  if (!tDesc || !("value" in tDesc)) return null;
  const t = tDesc.value as InboundKind;
  const keys: Record<InboundKind, readonly string[]> = {
    "context.publish": ["t", "sessionId", "turnId", "generation", "routeEpoch", "contextRevision", "context"],
    "turn.text": ["t", "sessionId", "turnId", "generation", "text", "languageHint"],
    "action.accepted": ["t", "sessionId", "turnId", "generation", "accepted"],
    "action.receipt": ["t", "sessionId", "turnId", "generation", "receipt"],
    "answer.approve": ["t", "sessionId", "turnId", "generation", "planId", "authorityRef", "textHash"],
    "turn.interrupt": ["t", "sessionId", "turnId", "generation", "reason"],
    "session.reset": ["t", "sessionId", "generation"],
    "session.end": ["t", "sessionId", "generation", "reason"],
  };
  const allowed = keys[t];
  if (!allowed) return null;
  const a = strictRecord(x, allowed);
  if (!a) return null;
  if (!isId(a.sessionId) || !isEpoch(a.generation)) return null;
  if (t === "session.reset" || t === "session.end") {
    if (t === "session.end" && a.reason !== "user" && a.reason !== "timeout" && a.reason !== "unmount") return null;
    return Object.freeze({ t, sessionId: a.sessionId as string, generation: a.generation as number, payload: Object.create(null) });
  }
  if (!isId(a.turnId)) return null;
  const payload: Record<string, unknown> = Object.create(null);
  if (t === "context.publish") {
    if (!isEpoch(a.routeEpoch) || !isContextRevision(a.contextRevision)) return null;
    // REV-05/REV-10 — the gateway INDEPENDENTLY validates the context to the closed
    // PublishedContext shape + bounds (strict reject, never opaque passthrough), so
    // no arbitrary field / secret / oversize payload survives into a reasoning call.
    const ctx = validatePublishedContext(a.context);
    if (!ctx) return null;
    payload.routeEpoch = a.routeEpoch; payload.contextRevision = a.contextRevision; payload.context = ctx;
  } else if (t === "turn.text") {
    const text = boundedText(a.text, MAX_TEXT_TURN_BYTES);
    if (text === null) return null;
    if (Object.prototype.hasOwnProperty.call(a, "languageHint") && !isLanguage(a.languageHint)) return null;
    payload.text = text;
    if (a.languageHint !== undefined) payload.languageHint = a.languageHint;
  } else if (t === "action.accepted") {
    // R3-05 — the accepted-action announcement; validated strictly in the control socket.
    if (!a.accepted || typeof a.accepted !== "object") return null;
    payload.accepted = a.accepted;
  } else if (t === "action.receipt") {
    if (!a.receipt || typeof a.receipt !== "object") return null;
    payload.receipt = a.receipt;
  } else if (t === "answer.approve") {
    // REV-08 — the browser's approval for an emitted answer plan (gates TTS).
    if (!isId(a.planId) || !isId(a.authorityRef)) return null;
    if (typeof a.textHash !== "string" || !/^[0-9a-f]{64}$/.test(a.textHash)) return null;
    payload.planId = a.planId; payload.authorityRef = a.authorityRef; payload.textHash = a.textHash;
  } else if (t === "turn.interrupt") {
    if (!INTERRUPT_REASONS.includes(a.reason as string)) return null;
    payload.reason = a.reason;
  }
  return Object.freeze({ t, sessionId: a.sessionId as string, turnId: a.turnId as string, generation: a.generation as number, payload });
}

// ── PROVIDER structured output → closed operation (mirror of the browser) ─────
export type OperationName = "APPLY_HOTEL_REFINEMENT" | "READ_CURRENT_RESULTS" | "COMPARE_VISIBLE_HOTELS" | "OPEN_VISIBLE_HOTEL" | "READ_CURRENT_HOTEL_FACTS" | "SHOW_HOTEL_SECTION";
const OP_KEYS: Record<OperationName, readonly string[]> = {
  APPLY_HOTEL_REFINEMENT: ["op", "destination", "query", "maxPrice", "parking", "sort", "stars"],
  READ_CURRENT_RESULTS: ["op"],
  COMPARE_VISIBLE_HOTELS: ["op", "positions", "factors"],
  OPEN_VISIBLE_HOTEL: ["op", "position"],
  READ_CURRENT_HOTEL_FACTS: ["op"],
  SHOW_HOTEL_SECTION: ["op", "section"],
};
const SORTS = ["default", "price-asc", "price-desc", "rating"];
export function validateModelOperation(x: unknown): Record<string, unknown> | null {
  // R5A-REMEDIATION (REV-NEW-02): TOTAL, fail-closed for arbitrary JS input — a hostile Proxy trap
  // anywhere (discriminant read, strictRecord, nested-array iteration) fails closed to null.
  try {
  const opDesc = x && typeof x === "object" ? Object.getOwnPropertyDescriptor(x, "op") : undefined;
  if (!opDesc || !("value" in opDesc)) return null;
  const op = opDesc.value;
  // R5A-REMEDIATION (REV-NEW-02): the discriminant MUST be a primitive string BEFORE any property
  // lookup — never trigger a Symbol.toPrimitive / valueOf / toString coercion hook to obtain
  // operation authority (OP_KEYS[op] would coerce a non-string key).
  if (typeof op !== "string") return null;
  const allowed = OP_KEYS[op as OperationName];
  if (!allowed) return null;
  const a = strictRecord(x, allowed);
  if (!a) return null;
  const out: Record<string, unknown> = Object.create(null);
  out.op = op;
  switch (op) {
    case "READ_CURRENT_RESULTS":
    case "READ_CURRENT_HOTEL_FACTS":
      return Object.freeze(out);
    case "OPEN_VISIBLE_HOTEL": {
      const pos = num(a.position, 1, MAX_VISIBLE_HOTELS);
      if (pos === null || !Number.isInteger(pos)) return null;
      out.position = pos; return Object.freeze(out);
    }
    case "COMPARE_VISIBLE_HOTELS": {
      // R5A SECOND REMEDIATION (REV-NEW-02): SNAPSHOT both arrays to fresh inert copies via trusted
      // descriptor capture (never caller map/slice/iterator/for-of/new Set(untrusted)) BEFORE any
      // validation — byte-for-byte with the client authority (lib/live-ai/contracts.ts
      // validateOperation) — so a hostile Array cannot make validation inspect one sequence while the
      // frozen output carries another (e.g. positions [999,999] whose map() returns [1,2], or factors
      // ["zoom"] whose iterator yields "price"). EXACT positions: length 2..MAX, each a STRICT
      // in-range integer, DISTINCT (duplicate REJECTS — never dedupe), ORDER GIVEN (never sort).
      // Factors: length 1..N, each recognized, DISTINCT, order given. Distinctness is an O(n²) scan on
      // the FRESH snapshot, never new Set(<untrusted>).
      const posSnap = strictArraySnapshot(a.positions);
      if (!posSnap) return null;
      if (posSnap.length < 2 || posSnap.length > MAX_SELECTED_HOTELS) return null;
      for (let i = 0; i < posSnap.length; i++) {
        const p = num(posSnap[i], 1, MAX_VISIBLE_HOTELS);
        if (p === null || !Number.isInteger(p)) return null;
      }
      const pnums = posSnap as number[];
      for (let i = 0; i < pnums.length; i++) for (let j = i + 1; j < pnums.length; j++) if (pnums[i] === pnums[j]) return null; // duplicate → reject
      const facSnap = strictArraySnapshot(a.factors);
      if (!facSnap) return null;
      if (facSnap.length < 1 || facSnap.length > FACTORS.length) return null;
      for (let i = 0; i < facSnap.length; i++) if (!FACTORS.includes(facSnap[i] as string)) return null; // unknown factor → reject
      const factors = facSnap as string[];
      for (let i = 0; i < factors.length; i++) for (let j = i + 1; j < factors.length; j++) if (factors[i] === factors[j]) return null; // duplicate → reject
      // FREEZE the fresh snapshot copies before returning (browser immutability parity); the copies
      // are new (`.slice()` on the trusted-prototype snapshot), never the caller-owned input arrays.
      out.positions = Object.freeze(pnums.slice()); out.factors = Object.freeze(factors.slice()); return Object.freeze(out);
    }
    case "SHOW_HOTEL_SECTION": {
      if (a.section !== "rooms" && a.section !== "about") return null;
      out.section = a.section; return Object.freeze(out);
    }
    case "APPLY_HOTEL_REFINEMENT": {
      // R5A — REJECT-not-normalize external operation authority, byte-for-byte with the browser
      // (lib/live-ai/contracts.ts validateOperation): destination/query are accepted ONLY in their
      // ALREADY-CANONICAL form (an EQUALITY ORACLE over the SAME canonicalCity / boundedQuery — a
      // value the canonicalizer would trim / lowercase / collapse REFUSES the op), maxPrice is a
      // STRICT positive number in-bound (no numeric-string coercion), stars are STRICTLY DESCENDING
      // (no dedupe/sort), and a NULL field is "not part of this refinement" (skip). At least one
      // non-null valid field must survive, else the refinement is empty and refused.
      let touched = false;
      const has = (k: string) => Object.prototype.hasOwnProperty.call(a, k);
      if (has("destination") && a.destination !== null) {
        if (typeof a.destination !== "string" || canonicalCity(a.destination) !== a.destination) return null;
        out.destination = a.destination; touched = true;
      }
      if (has("query") && a.query !== null) {
        if (typeof a.query !== "string" || boundedQuery(a.query) !== a.query) return null;
        out.query = a.query; touched = true;
      }
      if (has("maxPrice") && a.maxPrice !== null) {
        if (typeof a.maxPrice !== "number" || !Number.isFinite(a.maxPrice) || a.maxPrice <= 0 || a.maxPrice > 10_000_000) return null;
        out.maxPrice = a.maxPrice; touched = true;
      }
      if (has("parking") && a.parking !== null) {
        if (typeof a.parking !== "boolean") return null;
        out.parking = a.parking; touched = true;
      }
      if (has("sort") && a.sort !== null) {
        if (!SORTS.includes(a.sort as string)) return null;
        out.sort = a.sort; touched = true;
      }
      if (has("stars") && a.stars !== null) {
        // R5A SECOND REMEDIATION (REV-NEW-02): SNAPSHOT the array to a fresh inert copy via trusted
        // descriptor capture (never the caller's map/slice/iterator) BEFORE validating — byte-for-byte
        // with the client — so a hostile Array cannot make validation inspect one sequence while the
        // frozen output carries another (e.g. stars [1] whose map() returns [5]). Length 1..(MAX-MIN+1);
        // each a STRICT integer in [MIN,MAX]; ALREADY strictly DESCENDING (⇒ unique + no reorder) —
        // refuse, never dedupe/sort/coerce/repair.
        const snap = strictArraySnapshot(a.stars);
        if (!snap) return null;
        if (snap.length < 1 || snap.length > MAX_STARS - MIN_STARS + 1) return null;
        for (let i = 0; i < snap.length; i++) {
          const s = num(snap[i], MIN_STARS, MAX_STARS);
          if (s === null || !Number.isInteger(s)) return null;
        }
        const arr = snap as number[];
        for (let i = 1; i < arr.length; i++) if (!(arr[i] < arr[i - 1])) return null;
        // FREEZE the fresh snapshot copy (browser immutability parity).
        out.stars = Object.freeze(arr.slice()); touched = true;
      }
      if (!touched) return null;
      return Object.freeze(out);
    }
    default:
      return null;
  }
  } catch {
    return null; // any hostile reflective-trap / nested-array-inspection exception → fail closed
  }
}

// ── PROVIDER structured answer plan (gateway stamps planId/providerTurnId) ────
export type AnswerKind = "clarification" | "page_facts" | "comparison" | "action_status" | "advice" | "unknown";
const ANSWER_KEYS: Record<AnswerKind, readonly string[]> = {
  clarification: ["kind", "language", "questionCode", "evidenceReceiptIds"],
  page_facts: ["kind", "language", "selectedHotelIds", "evidenceReceiptIds"],
  comparison: ["kind", "language", "selectedHotelIds", "factors", "evidenceReceiptIds"],
  action_status: ["kind", "language", "proposalId", "receiptId", "outcome", "evidenceReceiptIds"],
  advice: ["kind", "language", "selectedHotelIds", "signals", "evidenceReceiptIds"],
  unknown: ["kind", "language", "reason", "evidenceReceiptIds"],
};
const CLAR_CODES = ["which_city", "what_budget", "which_hotels", "which_facility", "rephrase"];
const FACTORS = ["price", "rating", "parking", "breakfast"];
const SIGNALS = ["lower_price", "higher_rating", "parking_present", "parking_unknown", "breakfast_present", "breakfast_unknown", "fits_budget", "no_verified_match"];
const OUTCOMES = ["acted", "verified", "rejected", "stale", "unknown"];
const UNK_REASONS = ["no_context", "not_supported", "insufficient_evidence", "off_topic"];

function hotelIds(v: unknown, max: number): string[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > max) return null;
  const seen = new Set<string>(); const out: string[] = [];
  for (const h of v) { if (!isHotelId(h) || seen.has(h)) return null; seen.add(h); out.push(h); }
  return out;
}
function receiptIds(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > MAX_EVIDENCE_RECEIPTS) return null;
  const out: string[] = [];
  for (const r of v) { if (!isId(r)) return null; out.push(r); }
  return out;
}
// ── strict PUBLISHED CONTEXT (REV-05/REV-10 — the gateway INDEPENDENTLY validates
//    the browser's context to the SAME closed shape + bounds; malformed values are
//    REJECTED, never sanitized, so no arbitrary field / secret / oversize payload
//    can reach a future reasoning adapter as "context") ─────────────────────────
const FACILITY = ["present", "absent", "unknown"];
function isFacility(v: unknown): boolean { return v === "present" || v === "absent" || v === "unknown"; }
// R4-10 — a bounded WIRE string: length-bounded AND control-char-free (reject C0 + DEL,
// mirroring the browser's boundedWireStr). Empty allowed here (name/city may be blank);
// destination/query reject empty at the call site.
function boundedStr(v: unknown, max: number): boolean {
  if (typeof v !== "string" || v.length > max) return false;
  for (let i = 0; i < v.length; i++) { const c = v.charCodeAt(i); if (c < 0x20 || c === 0x7f) return false; }
  return true;
}

function validateContextHotel(x: unknown): Record<string, unknown> | null {
  const a = strictRecord(x, ["position", "id", "name", "city", "minPrice", "rating", "parking"]);
  if (!a) return null;
  const position = num(a.position, 1, MAX_VISIBLE_HOTELS);
  if (position === null || !Number.isInteger(position)) return null;
  if (!isHotelId(a.id)) return null;
  if (!boundedStr(a.name, 200) || !boundedStr(a.city, 120)) return null;
  if (a.minPrice !== null && (typeof a.minPrice !== "number" || !Number.isFinite(a.minPrice) || a.minPrice < 0 || a.minPrice > 10_000_000)) return null;
  if (a.rating !== null && (typeof a.rating !== "number" || !Number.isFinite(a.rating) || a.rating < 0 || a.rating > 5)) return null;
  if (!isFacility(a.parking)) return null;
  return Object.freeze({ position, id: a.id, name: a.name, city: a.city, minPrice: a.minPrice, rating: a.rating, parking: a.parking });
}
/** Strict-reject validator (frozen copy or null) — the gateway mirror of the closed
 *  PublishedContext. Any malformed / oversize / unknown field fails the WHOLE context. */
export function validatePublishedContext(x: unknown): Record<string, unknown> | null {
  // R5B-THIRD-REV-03 — TOTAL, fail-closed boundary. The ENTIRE validation (every nested Array.isArray
  // brand check, `for..of` iteration, descriptor read, discriminant read, and helper call —
  // validateContextHotel / validateRefinementProjection) runs INSIDE this guard, so a hostile revoked
  // Proxy anywhere in the context tree (at visibleHotels, a nested hotel item, refinement, …) fails
  // closed to null rather than throwing OUT of the exported gateway validator.
  try {
  const a = strictRecord(x, ["pageId", "role", "destination", "query", "loadState", "visibleHotels", "currentHotelId", "validated", "section", "breakfast", "parking", "refinement"]);
  if (!a) return null;
  if (a.pageId !== "hotels" && a.pageId !== "hotel-detail") return null;
  if (a.role !== "anonymous" && a.role !== "customer") return null;
  // R4-10 — destination/query: null OR a non-EMPTY control-free bounded string (the
  // builder emits null, never "", for "no value" — so "" is malformed → reject).
  if (a.destination !== null && (a.destination === "" || !boundedStr(a.destination, 120))) return null;
  if (a.query !== null && (a.query === "" || !boundedStr(a.query, 120))) return null;
  if (a.loadState !== "loading" && a.loadState !== "ready" && a.loadState !== "error") return null;
  if (!Array.isArray(a.visibleHotels) || a.visibleHotels.length > MAX_VISIBLE_HOTELS) return null;
  const hotels: Record<string, unknown>[] = [];
  for (const h of a.visibleHotels) { const hv = validateContextHotel(h); if (!hv) return null; hotels.push(hv); }
  // R4-10 — visible-hotel positions UNIQUE + authoritative ASCENDING order (gaps allowed
  // for invalid rows; never a reorder or duplicate). Non-ascending / duplicate → reject.
  for (let i = 1; i < hotels.length; i++) if ((hotels[i].position as number) <= (hotels[i - 1].position as number)) return null;
  if (a.currentHotelId !== null && !isHotelId(a.currentHotelId)) return null;
  if (typeof a.validated !== "boolean") return null;
  if (a.section !== null && a.section !== "rooms" && a.section !== "about") return null;
  if (a.breakfast !== null && !isFacility(a.breakfast)) return null;
  if (a.parking !== null && !isFacility(a.parking)) return null;
  // R5B-REV-06 — the optional canonical refinement projection. Included in the output ONLY when the input
  // carried the key (present null → null; present object → validate; ABSENT → omitted, so the validated
  // context is field-identical to the input and its digest is unchanged). A present non-null value MUST
  // validate as a bounded RefinementProjection (reject, never coerce).
  const out: Record<string, unknown> = {
    pageId: a.pageId, role: a.role, destination: a.destination, query: a.query, loadState: a.loadState,
    visibleHotels: Object.freeze(hotels), currentHotelId: a.currentHotelId, validated: a.validated,
    section: a.section, breakfast: a.breakfast, parking: a.parking,
  };
  if (Object.prototype.hasOwnProperty.call(a, "refinement") && a.refinement !== undefined) {
    if (a.refinement === null) out.refinement = null;
    else { const r = validateRefinementProjection(a.refinement); if (!r) return null; out.refinement = r; }
  }
  return Object.freeze(out);
  } catch { return null; } // R5B-THIRD-REV-03 — any hostile reflective-trap exception → fail closed
}
export interface RefinementProjectionShape { destination: string | null; query: string | null; maxPrice: number | null; parking: boolean; stars: number[]; sort: string; orderedIds: string[]; count: number; }
// R5B-REV-06/REV-08 — validate the canonical refinement projection (byte-mirror of the client
// lib/live-ai/protocol.ts validateRefinementProjection). TOTAL + fail-closed: every reflective inspection
// is inside the strictRecord guard / this try wrapper, so a hostile revoked Proxy / accessor / symbol key
// returns null, never throws. Bounds mirror the APPLY op contract exactly.
export function validateRefinementProjection(x: unknown): RefinementProjectionShape | null {
  try {
    const a = strictRecord(x, ["destination", "query", "maxPrice", "parking", "stars", "sort", "orderedIds", "count"]);
    if (!a) return null;
    if (a.destination !== null && (a.destination === "" || !boundedStr(a.destination, 120))) return null;
    if (a.query !== null && (a.query === "" || !boundedStr(a.query, 120))) return null;
    if (a.maxPrice !== null && (typeof a.maxPrice !== "number" || !Number.isFinite(a.maxPrice) || a.maxPrice <= 0 || a.maxPrice > 10_000_000)) return null;
    if (typeof a.parking !== "boolean") return null;
    if (a.sort !== "default" && a.sort !== "price-asc" && a.sort !== "price-desc" && a.sort !== "rating") return null;
    // R5B-THIRD-REV-04 — STRICT ordinary-array snapshot (byte-mirror of the client) before element checks:
    // custom prototype / accessor index/length / hole / symbol / stray key / hostile iterator/map / revoked
    // Proxy fail closed; validation + output read the ONE inert snapshot. ≤5 DISTINCT integers 1..5.
    const starSnap = strictArraySnapshot(a.stars);
    if (!starSnap || starSnap.length > 5) return null;
    const stars: number[] = [];
    const seenStars = new Set<number>();
    for (let i = 0; i < starSnap.length; i++) {
      const s = starSnap[i];
      if (typeof s !== "number" || !Number.isInteger(s) || s < 1 || s > 5 || seenStars.has(s)) return null;
      seenStars.add(s); stars.push(s);
    }
    const idSnap = strictArraySnapshot(a.orderedIds);
    if (!idSnap || idSnap.length > MAX_VISIBLE_HOTELS) return null;
    const orderedIds: string[] = [];
    const seenIds = new Set<string>();
    for (let i = 0; i < idSnap.length; i++) {
      const id = idSnap[i];
      if (!isHotelId(id) || seenIds.has(id as string)) return null;
      seenIds.add(id as string); orderedIds.push(id as string);
    }
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

// ── strict ACTION RECEIPT (REV-05 — the gateway independently validates the exact
//    receipt shape before recording a verified receipt id; a fabricated
//    {receiptId, outcome:"verified"} with no real correlation / evidence is REJECTED) ─
const RECEIPT_OUTCOMES = ["acted", "verified", "rejected", "stale", "unknown"];
// R5B — `acted` is the ONLY non-terminal outcome; these four are terminal + irreversible.
export const TERMINAL_OUTCOMES = ["verified", "rejected", "stale", "unknown"];
export function isTerminalOutcome(v: unknown): boolean { return typeof v === "string" && TERMINAL_OUTCOMES.includes(v); }
const RECEIPT_OPS = ["APPLY_HOTEL_REFINEMENT", "READ_CURRENT_RESULTS", "COMPARE_VISIBLE_HOTELS", "OPEN_VISIBLE_HOTEL", "READ_CURRENT_HOTEL_FACTS", "SHOW_HOTEL_SECTION"];
// R5B-REV-01/04 — the operation-specific source/result-authority partition (byte-mirror of the client
// lib/live-ai/protocol.ts). SOURCE-BOUND read/compare/detail operations keep EXACTLY their source
// authority; only the three ADVANCEABLE UI-local mutating operations may advance to a separately-validated
// result authority. Every operation is classified here or has NO trusted evidence authority (fail closed).
const SOURCE_BOUND_OPS: ReadonlySet<string> = new Set(["READ_CURRENT_RESULTS", "COMPARE_VISIBLE_HOTELS", "READ_CURRENT_HOTEL_FACTS"]);
const ADVANCEABLE_OPS: ReadonlySet<string> = new Set(["APPLY_HOTEL_REFINEMENT", "OPEN_VISIBLE_HOTEL", "SHOW_HOTEL_SECTION"]);
// R5B-REV-04 — the OP-SPECIFIC authority a verified receipt's TRUSTED EVIDENCE is recorded under. A
// SOURCE-BOUND read/compare/detail keeps the exact SOURCE authority (which equals its result authority —
// it never advances). An ADVANCEABLE APPLY/OPEN/SHOW records the gateway-validated RESULT authority (the
// advanced authority the follow-up plan will run under), so its trusted evidence does NOT go stale after a
// legitimate context advance and can still support the terminal verified explanation. An advanceable op
// with no result authority, or an unknown operation, has NO trusted evidence authority (null → not stored).
export function trustedEvidenceAuthority(operation: string, sourceAuthorityRef: string, resultAuthority: ResultAuthorityShape | null | undefined): string | null {
  if (SOURCE_BOUND_OPS.has(operation)) return sourceAuthorityRef;
  if (ADVANCEABLE_OPS.has(operation)) return resultAuthority && typeof resultAuthority.authorityRef === "string" ? resultAuthority.authorityRef : null;
  return null;
}
// R5B — the CLOSED receipt STATUS vocabulary (section 10), byte-mirror of lib/live-ai/protocol.ts.
// A status is validated against this fixed set ONLY (the old `/^[a-z_]+$/` shape check is retired).
export const LIVE_AI_CLOSED_STATUS = [
  "execution_acknowledged", "verified", "invalid_operation", "wrong_page", "authority_disabled",
  "missing_ordinal", "unsupported_filter", "not_ready", "hotel_id_mismatch", "no_op",
  "stale_turn", "stale_generation", "stale_route", "stale_context", "stale_entity",
  "stale_visible_order", "verification_timeout", "result_unavailable", "execution_ambiguous", "interrupted",
];
const CLOSED_STATUS_SET = new Set(LIVE_AI_CLOSED_STATUS);
function isClosedStatus(v: unknown): boolean { return typeof v === "string" && CLOSED_STATUS_SET.has(v); }

// R5B-REV-09 — the CLOSED legal outcome↔status compatibility matrix (byte-mirror of
// lib/live-ai/protocol.ts OUTCOME_STATUS_MATRIX). A receipt's (outcome, status) pair is legal ONLY when
// the status is in the outcome's allowed set; contradictory combos (verified+no_op, acted+verified,
// rejected+verified, unknown+deterministic-success …) are rejected on client AND gateway.
export const OUTCOME_STATUS_MATRIX: Readonly<Record<string, readonly string[]>> = Object.freeze({
  verified: ["verified"],
  acted: ["execution_acknowledged"],
  rejected: ["invalid_operation", "wrong_page", "authority_disabled", "missing_ordinal", "unsupported_filter", "not_ready", "hotel_id_mismatch", "no_op", "execution_ambiguous", "interrupted"],
  stale: ["stale_turn", "stale_generation", "stale_route", "stale_context", "stale_entity", "stale_visible_order"],
  unknown: ["verification_timeout", "result_unavailable", "execution_ambiguous", "stale_entity", "interrupted"],
});
export function isLegalOutcomeStatus(outcome: unknown, status: unknown): boolean {
  if (!isClosedStatus(status)) return false;
  if (typeof outcome !== "string" || !RECEIPT_OUTCOMES.includes(outcome)) return false;
  const allowed = OUTCOME_STATUS_MATRIX[outcome];
  return !!allowed && allowed.includes(status as string);
}

// R5B-REV-01 — FULL RESULT AUTHORITY shape (byte-mirror of lib/live-ai/protocol.ts ResultAuthority). The
// gateway re-derives + validates the authority independently in the lifecycle store (live-ai-sessions.ts);
// here it only strict-validates the wire shape.
const HEX64_RE = /^[0-9a-f]{64}$/;
export interface ResultAuthorityShape { turnId: string; generation: number; routeEpoch: number; contextRevision: string; authorityRef: string; contextDigest: string; }
export function validateResultAuthority(x: unknown): ResultAuthorityShape | null {
  const a = strictRecord(x, ["turnId", "generation", "routeEpoch", "contextRevision", "authorityRef", "contextDigest"]);
  if (!a) return null;
  if (!isId(a.turnId) || !isEpoch(a.generation) || !isEpoch(a.routeEpoch)) return null;
  if (!isContextRevision(a.contextRevision) || !isId(a.authorityRef)) return null;
  if (typeof a.contextDigest !== "string" || !HEX64_RE.test(a.contextDigest)) return null;
  return Object.freeze({ turnId: a.turnId as string, generation: a.generation as number, routeEpoch: a.routeEpoch as number, contextRevision: a.contextRevision as string, authorityRef: a.authorityRef as string, contextDigest: a.contextDigest as string });
}
const EVIDENCE_FACTORS = ["price", "rating", "parking", "breakfast"];
// R5B — bounded ordered hotel-id list (min..max, valid ids, DISTINCT, order preserved). Byte-mirror
// of lib/live-ai/protocol.ts readOrderedHotelIds.
// R5B-THIRD-REV-04 — STRICT ordinary-array snapshot (byte-mirror of the client) before element checks:
// custom prototype / accessor index/length / hole / symbol / stray key / hostile iterator/map / revoked
// Proxy fail closed; validation + output read the ONE inert snapshot.
function evOrderedHotelIds(v: unknown, min: number, max: number): string[] | null {
  const snap = strictArraySnapshot(v);
  if (!snap || snap.length < min || snap.length > max) return null;
  const out: string[] = []; const seen = new Set<string>();
  for (let i = 0; i < snap.length; i++) { const h = snap[i]; if (!isHotelId(h) || seen.has(h as string)) return null; seen.add(h as string); out.push(h as string); }
  return out;
}
function evFactors(v: unknown): string[] | null {
  const snap = strictArraySnapshot(v);
  if (!snap || snap.length < 1 || snap.length > EVIDENCE_FACTORS.length) return null;
  const out: string[] = []; const seen = new Set<string>();
  for (let i = 0; i < snap.length; i++) { const f = snap[i]; if (!EVIDENCE_FACTORS.includes(f as string) || seen.has(f as string)) return null; seen.add(f as string); out.push(f as string); }
  return out;
}
function okNullablePos(v: unknown): boolean { return v === null || (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_VISIBLE_HOTELS); }
function validateReceiptEvidence(x: unknown): Record<string, unknown> | null {
  // R5B-THIRD-REV-03 — TOTAL, fail-closed boundary. Every reflective inspection below (the discriminant
  // descriptor read, each nested array brand check / iteration inside evOrderedHotelIds / evFactors /
  // strictRecord) runs INSIDE this guard, so a hostile revoked Proxy at the evidence root OR at a nested
  // orderedIds / positions / hotelIds / factors array fails closed to null rather than throwing OUT.
  try {
  const kindDesc = x && typeof x === "object" ? Object.getOwnPropertyDescriptor(x, "kind") : undefined;
  if (!kindDesc || !("value" in kindDesc)) return null;
  const kind = kindDesc.value;
  if (kind === "results") {
    const a = strictRecord(x, ["kind", "count", "orderedIds"]); if (!a) return null;
    const c = num(a.count, 0, MAX_VISIBLE_HOTELS); if (c === null || !Number.isInteger(c)) return null;
    const ids = evOrderedHotelIds(a.orderedIds, 0, MAX_VISIBLE_HOTELS); if (!ids || ids.length !== c) return null; // R5B — ordered rows, not count only
    return Object.freeze({ kind, count: c, orderedIds: Object.freeze(ids) });
  }
  if (kind === "comparison") {
    const a = strictRecord(x, ["kind", "positions", "hotelIds", "factors", "cheapestPosition", "topRatedPosition"]); if (!a) return null;
    // R5B-THIRD-REV-04 — snapshot positions to a fresh inert array (its .map is the intrinsic
    // Array.prototype.map, never a caller override); a hostile positions array fails closed.
    const posSnap = strictArraySnapshot(a.positions); if (!posSnap) return null;
    const ps = posSnap.map((p) => num(p, 1, MAX_VISIBLE_HOTELS)); if (ps.some((p) => p === null || !Number.isInteger(p)) || ps.length < 2 || ps.length > MAX_SELECTED_HOTELS) return null;
    const ids = evOrderedHotelIds(a.hotelIds, ps.length, ps.length); if (!ids) return null; // R5B — resolved ids, same order/count
    const fs = evFactors(a.factors); if (!fs) return null;
    if (!okNullablePos(a.cheapestPosition) || !okNullablePos(a.topRatedPosition)) return null;
    // R5B-FOURTH-REV-01 — FREEZE the positions output (mirror the client + the sibling hotelIds/factors).
    // `ps` is a FRESH inert array from the trusted snapshot's intrinsic map (never an alias back to the
    // untrusted input), so freezing it in place makes the accepted authority immutable without any
    // sort/dedupe/coercion/repair — the ordering + exact numeric validation are preserved.
    return Object.freeze({ kind, positions: Object.freeze(ps), hotelIds: Object.freeze(ids), factors: Object.freeze(fs), cheapestPosition: a.cheapestPosition, topRatedPosition: a.topRatedPosition });
  }
  if (kind === "detail") { const a = strictRecord(x, ["kind", "hotelId", "breakfast", "parking"]); if (!a || !isHotelId(a.hotelId) || !isFacility(a.breakfast) || !isFacility(a.parking)) return null; return Object.freeze({ kind, hotelId: a.hotelId, breakfast: a.breakfast, parking: a.parking }); }
  if (kind === "ui_state") { const a = strictRecord(x, ["kind", "section", "hotelId"]); if (!a || (a.section !== "rooms" && a.section !== "about") || !isHotelId(a.hotelId)) return null; return Object.freeze({ kind, section: a.section, hotelId: a.hotelId }); }
  if (kind === "navigation") { const a = strictRecord(x, ["kind", "hotelId", "position"]); if (!a || !isHotelId(a.hotelId)) return null; const pos = num(a.position, 1, MAX_VISIBLE_HOTELS); if (pos === null || !Number.isInteger(pos)) return null; return Object.freeze({ kind, hotelId: a.hotelId, position: pos }); }
  return null;
  } catch { return null; } // R5B-THIRD-REV-03 — any hostile reflective-trap exception → fail closed
}
// R3-05 — the strict ACTION-ACCEPTED payload: the browser binds its minted actionId to a
// proposal under the current authority. Exact keys, valid ids, closed operation name.
export function validateActionAccepted(x: unknown): Record<string, unknown> | null {
  // R5B — the browser ECHOES the gateway-minted receiptId here (it may never mint its own).
  const a = strictRecord(x, ["receiptId", "proposalId", "providerTurnId", "actionId", "executionNonce", "operation", "authorityRef"]);
  if (!a) return null;
  if (!isId(a.receiptId) || !isId(a.proposalId) || !isId(a.providerTurnId) || !isId(a.actionId) || !isId(a.executionNonce) || !isId(a.authorityRef)) return null;
  if (typeof a.operation !== "string" || !RECEIPT_OPS.includes(a.operation)) return null;
  return Object.freeze({ receiptId: a.receiptId, proposalId: a.proposalId, providerTurnId: a.providerTurnId, actionId: a.actionId, executionNonce: a.executionNonce, operation: a.operation, authorityRef: a.authorityRef });
}
// R3-05 — OPERATION-SPECIFIC evidence: a VERIFIED receipt must carry evidence of the RIGHT
// kind for its operation (OPEN may verify with detail evidence OR none; a UI_LOCAL
// refinement is never "verified"). A wrong-kind / missing-required / illegitimate
// verification is rejected — a semantically-incoherent receipt can't correlate.
export function evidenceMatchesOperation(operation: string, evidence?: { kind?: unknown } | null): boolean {
  const kind = evidence && typeof (evidence as { kind?: unknown }).kind === "string" ? (evidence as { kind: string }).kind : null;
  switch (operation) {
    case "READ_CURRENT_RESULTS": return kind === "results";
    case "COMPARE_VISIBLE_HOTELS": return kind === "comparison";
    case "READ_CURRENT_HOTEL_FACTS": return kind === "detail";
    case "SHOW_HOTEL_SECTION": return kind === "ui_state";
    // R5B — OPEN can no longer verify EVIDENCE-FREE: it REQUIRES bounded navigation destination
    // evidence (a `detail` receipt for the destination remains acceptable too).
    case "OPEN_VISIBLE_HOTEL": return kind === "navigation" || kind === "detail";
    // R5B-REV-02 — APPLY now COMPLETES to verified: its evidence is the authoritative READY resulting
    // result set (a `results` receipt), reconciled against the current post-refinement context.
    case "APPLY_HOTEL_REFINEMENT": return kind === "results";
    default: return false;
  }
}
// R4-05B — OPERATION-SPECIFIC SEMANTIC binding: beyond the evidence KIND, a VERIFIED receipt
// must reflect the INTENDED RESULT of the exact proposal — the right ENTITY / STATE, not merely
// the right kind. The gateway checks this against the registered proposal's operation spec AND
// the session's CURRENT published context (both gateway-held). Evidence from the WRONG hotel,
// WRONG section, WRONG compared set, or a result-count that cannot exist under the current
// on-screen context is REJECTED. If the spec/context an operation needs is absent ⇒ reject
// (fail closed — a verified result the gateway cannot corroborate is never trusted).
export function evidenceMatchesProposalSemantics(
  operation: string,
  operationSpec: Record<string, unknown> | null | undefined,
  evidence: { kind?: unknown; [k: string]: unknown } | null | undefined,
  context: unknown,
  // R5B-REV-02/03 — the IMMUTABLE source hotel identity resolved at REGISTRATION (OPEN's target ordinal
  // → trusted hotel id from the source LIST; SHOW's source DETAIL currentHotelId). The destination /
  // result context can NOT re-resolve it (an honest detail destination publishes visibleHotels: []), and
  // the browser/model never supplies authoritative hotel identity — it is bound from the trusted source.
  sourceResolvedHotelId?: string | null,
): boolean {
  // R5B-THIRD-REV-03 — TOTAL, fail-closed boundary. The ENTIRE semantic match (the context brand check,
  // every ctxHotels / ctxOrderedIds / ctxPositionSet / positionToHotelId / ctxComparisonWinners
  // iteration, and each nested Array.isArray / discriminant / property read) runs INSIDE this guard, so a
  // hostile revoked Proxy at context, evidence, or any nested array/object fails closed to false, never throws.
  try {
  const ctx = context && typeof context === "object" && !Array.isArray(context) ? (context as Record<string, unknown>) : null;
  const kind = evidence && typeof evidence.kind === "string" ? (evidence.kind as string) : null;
  switch (operation) {
    case "APPLY_HOTEL_REFINEMENT": {
      // R5B-REV-02 — APPLY verifies against the AUTHORITATIVE READY resulting results context:
      //   • `results` evidence whose ordered ids EXACTLY equal the current on-screen result set
      //     (the "same hotels authority" / "exact resulting canonical filters" observable proof);
      //   • the resulting context is a READY hotels page (authoritative ready-result observation);
      //   • the EXACT proposal filters that are observable in context (destination / query) equal the
      //     resulting context (a mismatched resulting filter set never verifies; a late result for a
      //     DIFFERENT refinement carries a different result set / result authority and is rejected).
      if (kind !== "results") return false;
      if (!ctx || ctx.pageId !== "hotels" || ctx.loadState !== "ready") return false;
      const rows = ctxOrderedIds(ctx);
      const ids = Array.isArray(evidence!.orderedIds) ? (evidence!.orderedIds as string[]) : null;
      const c = typeof evidence!.count === "number" ? (evidence!.count as number) : null;
      if (rows === null || ids === null || c === null) return false;
      if (c !== rows.length || ids.length !== rows.length) return false;
      for (let i = 0; i < rows.length; i++) if (ids[i] !== rows[i]) return false;
      // R5B-REV-06 — prove EVERY requested APPLY dimension against the TRUSTED canonical refinement
      // projection (never inferring success from the ordered ids alone). The projection is first GROUNDED
      // in the context (its destination / query / ordered ids must equal the on-screen context), then every
      // NON-NULL requested dimension (destination/query/maxPrice/parking/stars/sort) must EXACTLY satisfy the
      // projected value. A null/absent dimension is "not requested" (not clear-state authority), unchecked.
      const ref = ctx.refinement && typeof ctx.refinement === "object" && !Array.isArray(ctx.refinement) ? (ctx.refinement as Record<string, unknown>) : null;
      if (!ref) return false;                                              // APPLY requires the canonical projection
      if (ref.destination !== ctx.destination || ref.query !== ctx.query) return false; // grounded in context
      const refIds = Array.isArray(ref.orderedIds) ? (ref.orderedIds as string[]) : null;
      if (refIds === null || refIds.length !== rows.length) return false;
      for (let i = 0; i < rows.length; i++) if (refIds[i] !== rows[i]) return false;   // projection ids == on-screen
      if (operationSpec) {
        const hasOwn = (k: string) => Object.prototype.hasOwnProperty.call(operationSpec, k);
        if (hasOwn("destination") && operationSpec!.destination !== null && ref.destination !== operationSpec!.destination) return false;
        if (hasOwn("query") && operationSpec!.query !== null && ref.query !== operationSpec!.query) return false;
        if (hasOwn("maxPrice") && operationSpec!.maxPrice !== null && ref.maxPrice !== operationSpec!.maxPrice) return false;
        if (hasOwn("parking") && ref.parking !== operationSpec!.parking) return false;  // parking boolean: present == requested
        if (hasOwn("sort") && ref.sort !== operationSpec!.sort) return false;
        if (hasOwn("stars") && Array.isArray(operationSpec!.stars)) {
          const reqStars = (operationSpec!.stars as number[]).slice().sort((x, y) => x - y);
          const projStars = (Array.isArray(ref.stars) ? (ref.stars as number[]) : []).slice().sort((x, y) => x - y);
          if (reqStars.length !== projStars.length || reqStars.some((v, i) => v !== projStars[i])) return false; // exact star SET
        }
      }
      return true;
    }
    case "OPEN_VISIBLE_HOTEL": {
      // R5B-REV-02 — OPEN verifies ONLY with bounded destination evidence (navigation | detail). The
      // source ordinal was resolved to a trusted hotel id AT REGISTRATION (while the source list was
      // valid); the DESTINATION context can NOT re-resolve it (an honest detail destination publishes
      // visibleHotels: []), and the browser/model must never supply the authoritative hotel identity.
      // Verification binds the trusted destination context's currentHotelId (the authoritative
      // destination identity) to the STORED source-resolved hotel id, and requires the evidence to
      // corroborate that same id. A wrong first destination therefore never verifies (and, once the
      // proposal terminalizes, later manual navigation can never retroactively recover it).
      if (kind !== "navigation" && kind !== "detail") return false;
      const src = typeof sourceResolvedHotelId === "string" ? sourceResolvedHotelId : null;
      if (src === null) return false;                              // no stored source resolution ⇒ never verifies
      const destId = ctx && typeof ctx.currentHotelId === "string" ? (ctx.currentHotelId as string) : null;
      if (destId === null || destId !== src) return false;         // wrong / absent destination hotel ⇒ never verifies
      if (evidence!.hotelId !== src) return false;                 // evidence corroborates the stored source id
      // R5B-THIRD-REV-02 — NAVIGATION evidence must ALSO bind the EXACT immutable proposed source ordinal.
      // Binding the resolved destination hotel id alone is insufficient: a navigation receipt reporting
      // position 1 must NOT verify a proposal for position 2 even when the resolved hotel happens to match
      // (or a caller reshapes the source list). Both ordinals are re-validated as STRICT in-range integers
      // and required EXACTLY equal — no sorting, clamping, coercion, or repair. DETAIL evidence preserves
      // the honest-destination behavior (a detail page carries no list ordinal, so none is required).
      if (kind === "navigation") {
        const proposedPos = num(operationSpec ? operationSpec.position : undefined, 1, MAX_VISIBLE_HOTELS);
        if (proposedPos === null || !Number.isInteger(proposedPos)) return false; // absent / invalid proposed ordinal ⇒ never verifies
        const observedPos = num(evidence!.position, 1, MAX_VISIBLE_HOTELS);
        if (observedPos === null || !Number.isInteger(observedPos)) return false; // absent / invalid evidence ordinal ⇒ never verifies
        if (observedPos !== proposedPos) return false;                            // EXACT proposed ordinal — no sort/clamp/coerce
      }
      return true;
    }
    case "SHOW_HOTEL_SECTION": {
      if (kind !== "ui_state") return false;
      const want = operationSpec && (operationSpec.section === "rooms" || operationSpec.section === "about") ? operationSpec.section : null;
      if (want === null || evidence!.section !== want) return false; // observed section == requested section
      // R5B-REV-03 — SHOW binds the IMMUTABLE source hotel identity captured at REGISTRATION (the
      // current validated source hotel), not merely the requested section. The trusted result context's
      // currentHotelId (authoritative, never browser-supplied) MUST equal the stored source hotel id, and
      // the evidence must corroborate it — so SHOW proposed on hotel A can never verify a section on hotel B.
      const src = typeof sourceResolvedHotelId === "string" ? sourceResolvedHotelId : null;
      if (src === null) return false;
      const cur = ctx && typeof ctx.currentHotelId === "string" ? (ctx.currentHotelId as string) : null;
      if (cur === null || cur !== src) return false;               // result hotel == stored source hotel
      return cur === evidence!.hotelId;                            // evidence corroborates
    }
    case "COMPARE_VISIBLE_HOTELS": {
      if (kind !== "comparison") return false;
      const want = operationSpec && Array.isArray(operationSpec.positions) ? (operationSpec.positions as number[]) : null;
      const wantFactors = operationSpec && Array.isArray(operationSpec.factors) ? (operationSpec.factors as string[]) : null;
      const got = Array.isArray(evidence!.positions) ? (evidence!.positions as number[]) : null;
      const gotIds = Array.isArray(evidence!.hotelIds) ? (evidence!.hotelIds as string[]) : null;
      const gotFactors = Array.isArray(evidence!.factors) ? (evidence!.factors as string[]) : null;
      // R5B-REV-04 — COMPLETE semantic comparison: EXACT requested positions (same length + EXACT ORDER),
      // EXACT corresponding on-screen hotel ids (position i ↔ hotelIds[i]), EXACT requested factors (same
      // length + order — no factor substitution), and the winner positions (cheapest / top-rated) DERIVED
      // DETERMINISTICALLY from the trusted bounded context (minPrice / rating over the compared positions)
      // — a subset / superset / reorder / wrong-id / substituted-factor / fabricated-winner comparison is rejected.
      if (!want || !got || !gotIds || !wantFactors || !gotFactors) return false;
      if (got.length < 2 || got.length !== gotIds.length || got.length !== want.length) return false;
      if (wantFactors.length !== gotFactors.length) return false;
      for (let i = 0; i < wantFactors.length; i++) if (wantFactors[i] !== gotFactors[i]) return false; // exact factors + order
      const ctxPositions = ctxPositionSet(ctx);
      if (ctxPositions === null) return false;
      for (let i = 0; i < got.length; i++) {
        const p = got[i];
        if (p !== want[i]) return false;                            // EXACT requested order (not just membership)
        if (!ctxPositions.has(p)) return false;                     // real on-screen
        if (positionToHotelId(ctx, p) !== gotIds[i]) return false;  // exact position→id, in order
      }
      const winners = ctxComparisonWinners(ctx, got);
      const evCheap = (evidence!.cheapestPosition ?? null) as number | null;
      const evTop = (evidence!.topRatedPosition ?? null) as number | null;
      if (evCheap !== winners.cheapest || evTop !== winners.topRated) return false; // recomputed winners must match
      return true;
    }
    case "READ_CURRENT_HOTEL_FACTS": {
      if (kind !== "detail") return false;
      const cur = ctx && typeof ctx.currentHotelId === "string" ? (ctx.currentHotelId as string) : null;
      if (cur === null || cur !== evidence!.hotelId) return false;
      // R5B-REV-04 — the claimed tri-state facts MUST equal the trusted detail context facts (never a
      // false facility fact). ctx.breakfast/parking are null when unknown → the evidence must carry
      // "unknown"; present/absent/unknown are preserved exactly.
      const cbf = ctx!.breakfast == null ? "unknown" : ctx!.breakfast;
      const cpk = ctx!.parking == null ? "unknown" : ctx!.parking;
      if (evidence!.breakfast !== cbf || evidence!.parking !== cpk) return false;
      return true;
    }
    case "READ_CURRENT_RESULTS": {
      if (kind !== "results") return false;
      // R5B — ORDERED result identity: the receipt's orderedIds must equal the CURRENT on-screen
      // hotels in EXACT position order (a matching count alone is insufficient).
      const rows = ctxOrderedIds(ctx);
      const ids = Array.isArray(evidence!.orderedIds) ? (evidence!.orderedIds as string[]) : null;
      const c = typeof evidence!.count === "number" ? (evidence!.count as number) : null;
      if (rows === null || ids === null || c === null) return false;
      if (c !== rows.length || ids.length !== rows.length) return false;
      for (let i = 0; i < rows.length; i++) if (ids[i] !== rows[i]) return false;
      return true;
    }
    default:
      return false;
  }
  } catch { return false; } // R5B-THIRD-REV-03 — any hostile reflective-trap exception → fail closed
}
function ctxHotels(ctx: Record<string, unknown> | null): Record<string, unknown>[] | null {
  if (!ctx || !Array.isArray(ctx.visibleHotels)) return null;
  return ctx.visibleHotels as Record<string, unknown>[];
}
function ctxVisibleCount(ctx: Record<string, unknown> | null): number | null {
  const h = ctxHotels(ctx);
  return h ? h.length : null;
}
// R5B — the CURRENT on-screen hotel ids in EXACT ascending-position order (or null if any row is
// malformed). Used for READ ordered-result identity verification.
function ctxOrderedIds(ctx: Record<string, unknown> | null): string[] | null {
  const h = ctxHotels(ctx);
  if (!h) return null;
  const rows: { pos: number; id: string }[] = [];
  for (const row of h) {
    if (typeof row.position !== "number" || typeof row.id !== "string") return null;
    rows.push({ pos: row.position, id: row.id as string });
  }
  rows.sort((a, b) => a.pos - b.pos);
  return rows.map((r) => r.id);
}
function positionToHotelId(ctx: Record<string, unknown> | null, position: number): string | null {
  const h = ctxHotels(ctx);
  if (!h) return null;
  for (const row of h) if (typeof row.position === "number" && row.position === position && typeof row.id === "string") return row.id as string;
  return null;
}
// R5B-REV-02/03 — resolve the IMMUTABLE source hotel identity for OPEN / SHOW AT REGISTRATION, while the
// source context is still the authoritative validated context. OPEN resolves its target ordinal against
// the source LIST (positionToHotelId); SHOW captures the source DETAIL page's currentHotelId. Every other
// operation has no bound source hotel (null). The browser/model never supplies this — it is derived purely
// from the trusted published source context the gateway already validated + stored (session.lastContext).
export function resolveSourceHotelId(operation: string, operationSpec: Record<string, unknown> | null | undefined, context: unknown): string | null {
  const ctx = context && typeof context === "object" && !Array.isArray(context) ? (context as Record<string, unknown>) : null;
  if (operation === "OPEN_VISIBLE_HOTEL") {
    const pos = operationSpec && typeof operationSpec.position === "number" ? (operationSpec.position as number) : null;
    return pos === null ? null : positionToHotelId(ctx, pos);
  }
  if (operation === "SHOW_HOTEL_SECTION") {
    return ctx && typeof ctx.currentHotelId === "string" ? (ctx.currentHotelId as string) : null;
  }
  return null;
}
function ctxPositionSet(ctx: Record<string, unknown> | null): Set<number> | null {
  const h = ctxHotels(ctx);
  if (!h) return null;
  const s = new Set<number>();
  for (const row of h) if (typeof row.position === "number") s.add(row.position);
  return s;
}
// R5B-REV-04 — DETERMINISTICALLY re-derive the comparison winners (cheapest by minPrice, top-rated by
// rating) over the compared positions, from the trusted bounded context. BYTE-IDENTICAL in logic to the
// client runtime's resolveComparison (iterate positions in the GIVEN order; strict `<` / `>` so the FIRST
// position wins a tie; a null price/rating never wins). The receipt's claimed winners must equal these.
function ctxComparisonWinners(ctx: Record<string, unknown> | null, positions: number[]): { cheapest: number | null; topRated: number | null } {
  const h = ctxHotels(ctx);
  if (!h) return { cheapest: null, topRated: null };
  let cheapest: number | null = null, cheapestVal = Infinity;
  let topRated: number | null = null, topVal = -Infinity;
  for (const pos of positions) {
    const row = h.find((r) => typeof r.position === "number" && r.position === pos);
    if (!row) continue;
    const mp = typeof row.minPrice === "number" && Number.isFinite(row.minPrice) ? (row.minPrice as number) : null;
    const rt = typeof row.rating === "number" && Number.isFinite(row.rating) ? (row.rating as number) : null;
    if (mp !== null && mp < cheapestVal) { cheapestVal = mp; cheapest = pos; }
    if (rt !== null && rt > topVal) { topVal = rt; topRated = pos; }
  }
  return { cheapest, topRated };
}
export function validateActionReceipt(x: unknown): Record<string, unknown> | null {
  // R5B-THIRD-REV-03 — TOTAL, fail-closed boundary. Every nested read (strictRecord, validateResultAuthority,
  // validateReceiptEvidence and the array helpers they reach) runs INSIDE this guard, so a hostile revoked
  // Proxy at the receipt root or at any nested resultAuthority / evidence value fails closed to null.
  try {
  const a = strictRecord(x, ["receiptId", "proposalId", "providerTurnId", "actionId", "executionNonce", "authorityRef", "operation", "outcome", "status", "resultAuthority", "evidence"]);
  if (!a) return null;
  if (!isId(a.receiptId) || !isId(a.proposalId) || !isId(a.providerTurnId) || !isId(a.actionId) || !isId(a.executionNonce) || !isId(a.authorityRef)) return null;
  if (typeof a.operation !== "string" || !RECEIPT_OPS.includes(a.operation)) return null;
  if (!RECEIPT_OUTCOMES.includes(a.outcome as string)) return null;
  if (!isClosedStatus(a.status)) return null; // R5B — closed status vocabulary ONLY
  // R5B-REV-09 — the (outcome, status) pair MUST be legal per the closed compatibility matrix.
  if (!isLegalOutcomeStatus(a.outcome, a.status)) return null;
  const out: Record<string, unknown> = { receiptId: a.receiptId, proposalId: a.proposalId, providerTurnId: a.providerTurnId, actionId: a.actionId, executionNonce: a.executionNonce, authorityRef: a.authorityRef, operation: a.operation, outcome: a.outcome, status: a.status };
  // R5B-REV-01 — the optional full result authority (present on acted/verified; the store re-derives it).
  if (Object.prototype.hasOwnProperty.call(a, "resultAuthority")) {
    const ra = validateResultAuthority(a.resultAuthority);
    if (!ra) return null;
    out.resultAuthority = ra;
  }
  if (Object.prototype.hasOwnProperty.call(a, "evidence")) {
    if (a.outcome !== "verified") return null;             // evidence ONLY for verified
    const ev = validateReceiptEvidence(a.evidence);
    if (!ev) return null;
    out.evidence = ev;
  }
  return Object.freeze(out);
  } catch { return null; } // R5B-THIRD-REV-03 — any hostile reflective-trap exception → fail closed
}

// ── full-content canonical digest (REV-06 — deterministic, fixed-length, folds the
//    ENTIRE canonical context so two large contexts that differ only late produce
//    different digests; the authorityRef sha256 additionally binds it) ───────────
export function canonicalString(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalString).join(",") + "]";
  if (typeof v === "object") { const ks = Object.keys(v as Record<string, unknown>).sort(); return "{" + ks.map((k) => JSON.stringify(k) + ":" + canonicalString((v as Record<string, unknown>)[k])).join(",") + "}"; }
  return "null";
}
/** REV-06 — the gateway's OWN cryptographic (SHA-256) digest of the full canonical
 *  context. Collision-resistant by construction; the authorityRef binds this + the
 *  complete tuple (incl. generation). The gateway NEVER trusts a caller-selected hash. */
export function sha256Hex(input: string): string { return createHash("sha256").update(input, "utf8").digest("hex"); }
export function contextDigest(value: unknown): string { return sha256Hex(canonicalString(value)); }

// R5B-REV-07 — the sentinel actionId the gateway commits a PRE-ACCEPT terminal under (byte-mirror of the
// client). A proposal that NEVER reached action.accepted has no bound actionId; the browser-supplied
// actionId on such a receipt was never accepted and must NOT appear in the terminal audit/commitment. This
// sentinel — which can never be a real actionId (the '#' is outside the id charset ID_RE, so isId rejects
// it) — replaces the fabricated actionId so the pre-accept terminal deterministically commits to the "no
// accepted action id" shape, and no later browser actionId can revive authority or change that committed
// pre-accept receipt. Printable ASCII only (no control byte) so the source never degrades to a binary blob.
export const UNACCEPTED_ACTION_ID = "#unaccepted#";
/** R5B-REV-06 — the CANONICAL TERMINAL-RECEIPT COMMITMENT (byte-mirror of lib/live-ai/protocol.ts
 *  terminalReceiptCommitment): a SHA-256 over the fixed, ordered tuple of every identity + authority +
 *  result field of the receipt (incl. the SOURCE authorityRef, the full RESULT authority, and the
 *  evidence). The gateway recomputes this from the receipt it accepted and returns it in
 *  action.receipt.ack; the browser promotes a held terminal-verified receipt ONLY when the ACK's
 *  commitment equals its own. canonicalString is the SAME sorted-key algorithm the client uses. */
export function terminalReceiptCommitment(r: Record<string, unknown>): string {
  return sha256Hex(canonicalString({
    receiptId: r.receiptId, proposalId: r.proposalId, providerTurnId: r.providerTurnId,
    actionId: r.actionId, executionNonce: r.executionNonce, operation: r.operation,
    outcome: r.outcome, status: r.status, authorityRef: r.authorityRef,
    resultAuthority: (r.resultAuthority ?? null), evidence: (r.evidence ?? null),
  }));
}

// ── R3-08 — the CANONICAL deterministic spoken text, a BYTE-IDENTICAL mirror of the
//    client renderer (lib/live-ai/protocol.ts renderPlanSpokenText). The gateway voices
//    EXACTLY this text and the approved-text hash (SHA-256 over the exact UTF-8) must
//    equal the browser's — there is ONE shared algorithm and NO differing separator
//    (the R2-NEW-01 divergence is removed). A golden cross-vector test asserts parity.
function triLang(lang: string, en: string, hinglish: string, hi: string): string {
  return lang === "en" ? en : lang === "hinglish" ? hinglish : hi;
}
export function renderPlanSpokenText(plan: Record<string, unknown>): string {
  const L = plan.language as string;
  const kind = plan.kind as string;
  const ids = Array.isArray(plan.selectedHotelIds) ? (plan.selectedHotelIds as string[]) : [];
  const factors = Array.isArray(plan.factors) ? (plan.factors as string[]) : [];
  const signals = Array.isArray(plan.signals) ? (plan.signals as string[]) : [];
  const qc = plan.questionCode as "which_city" | "what_budget" | "which_hotels" | "which_facility" | "rephrase";
  let s: string;
  switch (kind) {
    case "clarification":
      s = triLang(L,
        { which_city: "Which city are you looking at?", what_budget: "What's your budget per night?", which_hotels: "Which stays should I compare?", which_facility: "Which facility do you mean?", rephrase: "Could you say that another way?" }[qc],
        { which_city: "Kaunsa city dekh rahe hain?", what_budget: "Aapka budget per night kitna hai?", which_hotels: "Kaunse stays compare karun?", which_facility: "Kaunsi facility ki baat hai?", rephrase: "Thoda dobara bata dijiye?" }[qc],
        { which_city: "कौन-सा शहर देख रहे हैं?", what_budget: "प्रति रात बजट कितना है?", which_hotels: "कौन-से स्टे तुलना करूँ?", which_facility: "कौन-सी सुविधा?", rephrase: "थोड़ा दोबारा बताइए?" }[qc]);
      break;
    case "page_facts":
      s = triLang(L, `Here are the details for ${ids.length} stay(s) on screen.`, `Screen par ${ids.length} stay ki detail yahan hai.`, `स्क्रीन पर ${ids.length} स्टे का विवरण।`);
      break;
    case "comparison":
      s = triLang(L, `Comparing ${ids.length} stays on ${factors.join(", ")}.`, `${ids.length} stays ko ${factors.join(", ")} par compare kiya.`, `${ids.length} स्टे की तुलना: ${factors.join(", ")}।`);
      break;
    case "action_status":
      s = triLang(L, `That's ${plan.outcome}.`, `Wo ${plan.outcome} hai.`, `वह ${plan.outcome} है।`);
      break;
    case "advice":
      s = triLang(L, `Based on the current results: ${signals.join(", ")}.`, `Current results ke hisaab se: ${signals.join(", ")}.`, `मौजूदा नतीजों के आधार पर: ${signals.join(", ")}।`);
      break;
    case "unknown":
    default:
      s = triLang(L, "I don't have that information.", "Wo jankari nahi hai.", "वह जानकारी नहीं।");
      break;
  }
  return s.slice(0, 400);
}
/** R3-08 — SHA-256 over the exact UTF-8 spoken text (byte-identical to the client). */
export function approvedTextHash(plan: Record<string, unknown>): string {
  return sha256Hex(renderPlanSpokenText(plan));
}

// ── R3-08 — SEMANTIC evidence binding (shared rule, mirrored on the client in
//    lib/live-ai/protocol.ts). A factual plan is only voiceable when EVERY cited
//    receipt is verified UNDER THE CURRENT AUTHORITY (an old turn/generation/context
//    receipt can never support a current plan), carries read-evidence of a compatible
//    TYPE, and every referenced hotel is present in the CURRENT on-screen context. ───
export interface EvidenceReceiptRef {
  proposalId: string;
  operation: string;
  outcome: string;
  authorityRef: string;
  // R5B — the bounded evidence upgrades (ordered result ids / resolved comparison ids + factors +
  // WINNER positions / navigation destination / section-bound identity / detail TRI-STATE facts) travel
  // here for R5B-REV-05 field-level plan + deterministic advice-signal support.
  evidence?: { kind: string; hotelId?: string; positions?: number[]; count?: number; section?: string; orderedIds?: string[]; hotelIds?: string[]; factors?: string[]; cheapestPosition?: number | null; topRatedPosition?: number | null; breakfast?: string; parking?: string };
}
export interface EvidenceCtx {
  getReceipt: (id: string) => EvidenceReceiptRef | undefined;
  currentAuthorityRef: string | null;
  contextHotelIds: ReadonlySet<string>;
  // R4-08 — resolve a comparison receipt's on-screen position to its current hotel id.
  positionToHotelId?: (position: number) => string | null;
}
// R4-08 — FIELD-BY-FIELD plan evidence (byte-mirror of lib/live-ai/protocol.ts). Each answer
// KIND is validated against the COMPLETE correlated verified receipt tuple — never a generic
// "a receipt exists" unlock, and never an old-turn/generation/context receipt.
export function evidenceSupportsPlan(plan: Record<string, unknown>, ctx: EvidenceCtx): boolean {
  const kind = plan.kind as string;
  // clarification / unknown carry no factual claim → no evidence required.
  if (kind === "clarification" || kind === "unknown") return true;
  const ids = Array.isArray(plan.evidenceReceiptIds) ? (plan.evidenceReceiptIds as string[]) : [];
  if (ids.length === 0) return false;
  const cited = ids.map((id) => ctx.getReceipt(id));
  if (cited.some((r) => !r)) return false;                                    // an unknown / unverified id
  if (!ctx.currentAuthorityRef) return false;
  // an OLD-turn/generation/context receipt (different authority) cannot support a current plan.
  if (cited.some((r) => (r as EvidenceReceiptRef).authorityRef !== ctx.currentAuthorityRef)) return false;
  const list = cited as EvidenceReceiptRef[];
  if (kind === "action_status") {
    // the reported action must be the EXACT correlated verified receipt: cited, FOR the plan's
    // proposal, and its verified outcome equals the plan's reported outcome.
    const rid = plan.receiptId as string;
    const pid = plan.proposalId as string;
    const oc = plan.outcome as string;
    if (typeof rid !== "string" || !ids.includes(rid)) return false;
    const r = ctx.getReceipt(rid);
    if (!r) return false;
    if (r.proposalId !== pid) return false;                                   // wrong action
    if (r.outcome !== oc) return false;                                       // wrong reported outcome
    return true;
  }
  // fact kinds — page_facts / comparison / advice: must rest on ACTUAL read evidence.
  const hasRead = list.some((r) => r.evidence && (r.evidence.kind === "results" || r.evidence.kind === "detail" || r.evidence.kind === "comparison"));
  if (!hasRead) return false;                                                 // no actual read evidence (e.g. only ui_state)
  const sel = Array.isArray(plan.selectedHotelIds) ? (plan.selectedHotelIds as string[]) : [];
  if (sel.length === 0) return false;
  if (sel.some((h) => !ctx.contextHotelIds.has(h))) return false;             // references an off-screen hotel
  if (kind === "page_facts") {
    // EACH stated hotel needs a DETAIL receipt for THAT hotel; a results-count receipt alone
    // (which names no hotel) cannot authorize facts about any specific visible hotel.
    const detailHotels = new Set(list.filter((r) => r.evidence && r.evidence.kind === "detail" && typeof r.evidence.hotelId === "string").map((r) => r.evidence!.hotelId as string));
    if (!sel.every((h) => detailHotels.has(h))) return false;
  }
  if (kind === "comparison") {
    // R5B-REV-05 (byte-mirror of lib/live-ai/protocol.ts) — the compared hotels AND the claimed comparison
    // FACTORS must both come from ONE exact cited verified comparison receipt: its compared ids cover every
    // selected hotel, AND its factors EXACTLY equal the plan's factors (same length + order + values). A
    // subset / superset / reordered / substituted factor set (price-only evidence authorizing a parking
    // comparison) is rejected — a claimed factor must EXIST in compatible exact cited verified evidence.
    const planFactors = Array.isArray((plan as { factors?: unknown }).factors) ? ((plan as { factors: string[] }).factors) : [];
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
      const compared = new Set<string>();
      if (Array.isArray(ev.hotelIds)) { for (const id of ev.hotelIds) if (typeof id === "string") compared.add(id); }
      else if (Array.isArray(ev.positions)) { for (const p of ev.positions) { const id = ctx.positionToHotelId ? ctx.positionToHotelId(p) : null; if (id) compared.add(id); } }
      if (compared.size > 0 && sel.every((h) => compared.has(h))) { matched = true; break; }
    }
    if (!matched) return false;
  }
  if (kind === "advice") {
    // R5B-REV-05 — DETERMINISTIC advice signals (byte-mirror of lib/live-ai/protocol.ts): EVERY claimed
    // signal must be backed by the EXACT verified underlying value (a comparison winner among the
    // selected, a detail tri-state fact); an ungroundable signal (absent / unknown / ambiguous, or
    // `fits_budget` which bounded evidence cannot prove) downgrades the whole plan. Only
    // `no_verified_match` needs no positive proof.
    const signals = Array.isArray((plan as { signals?: unknown }).signals) ? ((plan as { signals: string[] }).signals) : [];
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
    const backs = (set: Set<string>): boolean => sel.some((h) => set.has(h));
    for (const g of signals) {
      switch (g) {
        // R5B-REV-05 (option B) — no_verified_match is REFUSED as an evidence-backed factual signal in R5B
        // (it must NOT be accepted merely because generic READ evidence exists); any plan claiming it downgrades.
        case "no_verified_match": return false;
        case "lower_price": if (!backs(cheapestIds)) return false; break;
        case "higher_rating": if (!backs(topRatedIds)) return false; break;
        case "parking_present": if (!backs(parkPresent)) return false; break;
        case "parking_unknown": if (!backs(parkUnknown)) return false; break;
        case "breakfast_present": if (!backs(bfPresent)) return false; break;
        case "breakfast_unknown": if (!backs(bfUnknown)) return false; break;
        case "fits_budget": return false;
        default: return false;
      }
    }
  }
  return true;
}

export function validateModelAnswer(x: unknown): Record<string, unknown> | null {
  const kindDesc = x && typeof x === "object" ? Object.getOwnPropertyDescriptor(x, "kind") : undefined;
  if (!kindDesc || !("value" in kindDesc)) return null;
  const kind = kindDesc.value as AnswerKind;
  const allowed = ANSWER_KEYS[kind];
  if (!allowed) return null;
  const a = strictRecord(x, allowed);
  if (!a || !isLanguage(a.language)) return null;
  const evidenceReceiptIds = receiptIds(a.evidenceReceiptIds);
  if (!evidenceReceiptIds) return null;
  const out: Record<string, unknown> = Object.create(null);
  out.kind = kind; out.language = a.language; out.evidenceReceiptIds = evidenceReceiptIds;
  switch (kind) {
    case "clarification": if (!CLAR_CODES.includes(a.questionCode as string)) return null; out.questionCode = a.questionCode; return Object.freeze(out);
    case "page_facts": { const s = hotelIds(a.selectedHotelIds, MAX_SELECTED_HOTELS); if (!s) return null; out.selectedHotelIds = s; return Object.freeze(out); }
    case "comparison": {
      const s = hotelIds(a.selectedHotelIds, MAX_SELECTED_HOTELS); if (!s || s.length < 2) return null;
      if (!Array.isArray(a.factors) || a.factors.length < 1) return null;
      const seen = new Set<string>(); const factors: string[] = [];
      for (const f of a.factors) { if (!FACTORS.includes(f as string) || seen.has(f)) return null; seen.add(f); factors.push(f as string); }
      out.selectedHotelIds = s; out.factors = factors; return Object.freeze(out);
    }
    case "action_status": if (!isId(a.proposalId) || !isId(a.receiptId) || !OUTCOMES.includes(a.outcome as string)) return null; out.proposalId = a.proposalId; out.receiptId = a.receiptId; out.outcome = a.outcome; return Object.freeze(out);
    case "advice": {
      const s = hotelIds(a.selectedHotelIds, MAX_SELECTED_HOTELS); if (!s) return null;
      if (!Array.isArray(a.signals) || a.signals.length < 1) return null;
      const seen = new Set<string>(); const signals: string[] = [];
      for (const g of a.signals) { if (!SIGNALS.includes(g as string) || seen.has(g)) return null; seen.add(g); signals.push(g as string); }
      out.selectedHotelIds = s; out.signals = signals; return Object.freeze(out);
    }
    case "unknown": if (!UNK_REASONS.includes(a.reason as string)) return null; out.reason = a.reason; return Object.freeze(out);
    default: return null;
  }
}
