// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-04 — gateway runtime schemas (fail-closed).
//
// The gateway is a SEPARATE Node service; it cannot import the Next app's
// lib/voice modules. These are its OWN bounded, closed validators for:
//   • the session-create body (SDP + flags), with hard size bounds;
//   • client→gateway control frames (cancel/reset/close only);
//   • gateway→browser control frames (status/transcript/result/ui_action/…);
//   • an untrusted PROVIDER sideband event (a tool call), and the four tool input
//     schemas — the ONLY tools that exist;
//   • the closed UI-action union the gateway may forward to the browser.
//
// Everything fails CLOSED → null / false. There is deliberately NO url/method/
// header/script/selector/key field on any accepted shape. This module mirrors the
// SB-01 security contract without duplicating any business logic (no ranking/
// pricing) — it validates shapes only.
// ─────────────────────────────────────────────────────────────────────────

export const MAX_SDP_BYTES = 16 * 1024;
export const MAX_BODY_BYTES = 24 * 1024;
export const MAX_CONTROL_FRAME_BYTES = 8 * 1024;
export const MAX_PROVIDER_EVENT_BYTES = 16 * 1024;
export const MAX_TEXT_LEN = 800;
export const MAX_TRANSCRIPT_LEN = 400;
export const MAX_CITY_LEN = 40;
export const MAX_QUERY_LEN = 60;
export const MAX_HOTEL_ID_LEN = 64;
export const MAX_COMPARE_HOTELS = 3;

// R2 (SB04-R1-REREV-06): bound UNTRUSTED input by UTF-8 BYTES, not UTF-16 code
// units — a multi-byte string (e.g. Hindi) is far larger in bytes than in `.length`,
// so a `.length` gate under-counts and lets an oversized payload through. Uses
// TextEncoder (available in the gateway's Node runtime) so no Buffer dependency.
const UTF8 = new TextEncoder();
export function utf8ByteLength(s: string): number {
  return UTF8.encode(s).length;
}

// ---- primitive validators (mirror SB-01 contracts.ts, shape-only) -----------
export function isValidHotelId(x: unknown): x is string {
  return typeof x === "string" && x.length > 0 && x.length <= MAX_HOTEL_ID_LEN && /^[A-Za-z0-9_-]+$/.test(x);
}
export function canonicalCity(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const trimmed = x.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > MAX_CITY_LEN) return null;
  if (!/^[A-Za-zÀ-ɏ .'-]+$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}
export function boundedQuery(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const cleaned = Array.from(x)
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c >= 0x20 && c !== 0x7f;
    })
    .join("")
    .trim()
    .replace(/\s+/g, " ");
  if (!cleaned || cleaned.length > MAX_QUERY_LEN) return null;
  return cleaned;
}

// ---- SDP + session-create body ----------------------------------------------
export function validateSdp(x: unknown, maxBytes = MAX_SDP_BYTES): string | null {
  if (typeof x !== "string" || !x || utf8ByteLength(x) > maxBytes) return null;
  if (!/^v=0/m.test(x) || !/^m=audio /m.test(x)) return null;
  for (let i = 0; i < x.length; i++) {
    const c = x.charCodeAt(i);
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return null;
  }
  return x;
}

// R3 (SB04-R2-REREV-10): the bounded ordered visible-context candidate list. The
// browser's on-screen hotel ids are UNTRUSTED INPUT — this only bounds/validates
// the SHAPE (≤24, valid id syntax, deduplicated, ORDER preserved). The gateway
// still independently SERVER-VERIFIES each candidate before it is authoritative.
export const MAX_VISIBLE_CONTEXT = 24;
export function validateVisibleHotelIds(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of x) {
    if (!isValidHotelId(v)) continue; // drop invalid; never a URL/path/instruction
    if (seen.has(v)) continue; // dedup, order preserved (first occurrence wins)
    seen.add(v);
    out.push(v);
    if (out.length >= MAX_VISIBLE_CONTEXT) break;
  }
  return out;
}

export interface SessionCreateBody {
  sdp: string;
  authenticated: boolean;
  visibleHotelIds: string[];
}
export function validateSessionCreateBody(x: unknown): SessionCreateBody | null {
  if (!x || typeof x !== "object") return null;
  const b = x as Record<string, unknown>;
  const sdp = validateSdp(b.sdp);
  if (!sdp) return null;
  return { sdp, authenticated: b.authenticated === true, visibleHotelIds: validateVisibleHotelIds(b.visibleHotelIds) };
}

// ---- client → gateway control frames (closed) -------------------------------
export type ClientControl =
  | { t: "cancel_turn"; turnId: number }
  | { t: "reset_session" }
  | { t: "close_session" };

export function validateClientControl(x: unknown): ClientControl | null {
  if (!x || typeof x !== "object") return null;
  const m = x as Record<string, unknown>;
  switch (m.t) {
    case "cancel_turn":
      if (!Number.isFinite(m.turnId)) return null;
      return { t: "cancel_turn", turnId: Math.floor(m.turnId as number) };
    case "reset_session":
      return { t: "reset_session" };
    case "close_session":
      return { t: "close_session" };
    default:
      return null;
  }
}

// ---- gateway → browser control frames (closed) — the gateway EMITS these -----
export type ServerStatus =
  | "listening"
  | "transcribing"
  | "thinking"
  | "executing"
  | "speaking"
  | "interrupted"
  | "cancelled"
  | "idle";

// ---- the closed UI-action union the gateway may forward ----------------------
export type UiAction =
  | { type: "FOCUS_SEARCH" }
  | { type: "APPLY_SEARCH"; city: string | null; query: string | null }
  | { type: "SHOW_RESULTS" }
  | { type: "OPEN_HOTEL"; hotelId: string }
  | { type: "SHOW_FLASH_DEALS"; city: string | null }
  | { type: "SHOW_COMPARISON"; hotelIds: string[] }
  | { type: "PREPARE_BID_DRAFT"; hotelId: string; pricePerNight: number | null };

export function validateUiAction(x: unknown): UiAction | null {
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
      if (a.city != null && city === null) return null;
      if (a.query != null && query === null) return null;
      return { type: "APPLY_SEARCH", city, query };
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
      if (ids.length === 0 || ids.length !== a.hotelIds.length || ids.length > MAX_COMPARE_HOTELS) return null;
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

// ---- provider sideband event (a tool call) — ALWAYS UNTRUSTED ----------------
// The ONLY four tool names that exist. There is no fifth business tool.
export const TOOL_NAMES = Object.freeze([
  "searchHotels",
  "getHotelDetails",
  "getFlashDeals",
  "compareHotels",
]);
export type ToolName = (typeof TOOL_NAMES)[number];
export function isToolName(x: unknown): x is ToolName {
  return typeof x === "string" && (TOOL_NAMES as readonly string[]).includes(x);
}

// R2 (SB04-R1-REREV-04): every translated provider event may carry the provider's
// own response id so the gateway can bind it to the StayBid turn that OWNS that
// response (and discard events from a superseded/sealed response). It is a bounded,
// opaque token — never trusted as anything but an identity key.
export const MAX_PROVIDER_ID_LEN = 128;
export function boundedProviderId(x: unknown): string | null {
  if (typeof x !== "string" || !x || x.length > MAX_PROVIDER_ID_LEN) return null;
  return /^[A-Za-z0-9_.:-]+$/.test(x) ? x : null;
}

export type ProviderToolCall = {
  kind: "tool_call";
  callId: string;
  tool: ToolName;
  input: Record<string, unknown>;
  responseId?: string;
};
export type ProviderAnswer = { kind: "answer" | "clarify"; text: string; responseId?: string };
// R4 (SB04-R3-REREV-11): the `ui_action` provider-event kind is REMOVED — there is
// no documented provider event that carries a StayBid UI action, and no invented
// one may exist. Navigation intent now rides the DOCUMENTED function-call path
// (getHotelDetails + presentationIntent:"OPEN"); the gateway itself proposes the
// typed OPEN_HOTEL browser frame after the fixed trusted read succeeds.
// R2 (REREV-04): the provider signals the START of a response (a StayBid turn owns it).
// R6 (SB04-R5-REREV-02): a response.created may echo the server-generated non-secret
// `request_id` we set in `response.create.response.metadata` (documented in the current
// OpenAI Realtime API — response metadata is echoed in the response lifecycle events).
// It is defense-in-depth ON TOP of strict serialization: the scheduler binds a response
// only when this exactly matches the single outstanding request.
export type ProviderResponseBegin = { kind: "response_begin"; responseId: string; requestId?: string };
// R2 (REREV-03): REAL provider token usage (from response.done) — the authoritative
// cost signal. Bounded non-negative integers; the pricing table converts to cents.
export type ProviderUsage = {
  kind: "usage";
  responseId?: string;
  inputTextTokens: number;
  cachedInputTextTokens: number;
  outputTextTokens: number;
  inputAudioTokens: number;
  cachedInputAudioTokens: number;
  outputAudioTokens: number;
};
// R2 (REREV-01): an input-audio transcription result — display-only user transcript.
export type ProviderTranscript = { kind: "transcript"; role: "user"; text: string; responseId?: string };
// R6 (SB04-R5-REREV-02): response.done is a LIFECYCLE-TERMINAL event, distinct from the
// trustworthiness of its usage. It ALWAYS carries the response id so the serialized slot
// can learn the response ended and free itself; `usage` is present ONLY when at least one
// token field is a usable count (else the conservative reservation is retained, never
// refunded — but the response still becomes terminal/sealed).
export type ProviderUsageTokens = {
  inputTextTokens: number;
  cachedInputTextTokens: number;
  outputTextTokens: number;
  inputAudioTokens: number;
  cachedInputAudioTokens: number;
  outputAudioTokens: number;
};
export type ProviderResponseDone = { kind: "response_done"; responseId: string; usage?: ProviderUsageTokens };
export type ProviderEvent =
  | ProviderToolCall
  | ProviderAnswer
  | ProviderResponseBegin
  | ProviderUsage
  | ProviderResponseDone
  | ProviderTranscript;

const MAX_TOKENS = 50_000_000;
// R3 (SB04-R2-REREV-03): a token field is USABLE only when it is a finite, ≥0
// number (or numeric string). `null` means "not a usable count" — the caller must
// NOT treat an absent/malformed field as a valid zero (that would let a broken
// usage payload refund the conservative reservation).
function usableTokenCount(x: unknown): number | null {
  if (x === undefined || x === null) return null;
  const n = typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(Math.floor(n), MAX_TOKENS);
}

// EXACT per-tool input key allowlists (SB04-SRC-REV-10). Each tool accepts ONLY
// its own keys; ANY other key (id/hotelIds on search, url/method/headers/host,
// etc.) fails the whole call CLOSED. No shared broad key set with silent ignores.
const TOOL_INPUT_KEYS: Record<ToolName, readonly string[]> = {
  searchHotels: Object.freeze(["city", "q"]),
  // R4 (SB04-R3-REREV-11): the CLOSED optional navigation-intent enum. The value set
  // is exactly {"OPEN"} — no generic action name, no URL/path/method — and it rides
  // the DOCUMENTED function-call path of this existing tool (no fifth tool).
  getHotelDetails: Object.freeze(["id", "presentationIntent"]),
  getFlashDeals: Object.freeze(["city"]),
  compareHotels: Object.freeze(["hotelIds"]),
};

function strictToolInput(tool: ToolName, raw: unknown): Record<string, unknown> | null {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const allowed = TOOL_INPUT_KEYS[tool];
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(raw as Record<string, unknown>)) {
    if (!allowed.includes(k)) return null; // any out-of-tool key ⇒ fail closed
    out[k] = (raw as Record<string, unknown>)[k];
  }
  return out;
}

/**
 * Validate an untrusted provider sideband event into the closed union, or null.
 * A tool call must name one of the four tools with a bounded, allowlisted input;
 * an answer/clarify is bounded text; a ui_action is re-validated by the closed
 * union. Everything else fails CLOSED.
 */
export function validateProviderEvent(x: unknown): ProviderEvent | null {
  if (!x || typeof x !== "object") return null;
  const e = x as Record<string, unknown>;
  const responseId = e.responseId === undefined ? undefined : boundedProviderId(e.responseId) ?? undefined;
  // A responseId that was SUPPLIED but is malformed fails the whole event closed.
  if (e.responseId !== undefined && responseId === undefined) return null;
  switch (e.kind) {
    case "answer":
    case "clarify": {
      if (typeof e.text !== "string") return null;
      const text = e.text.slice(0, MAX_TEXT_LEN);
      if (!text.trim()) return null;
      return { kind: e.kind, text, responseId };
    }
    case "response_begin": {
      const rid = boundedProviderId(e.responseId);
      if (!rid) return null;
      // R6: an OPTIONAL echoed request-id (defense-in-depth). A supplied-but-malformed
      // request id fails the whole event closed (never a silently-ignored correlation).
      const requestId = e.requestId === undefined ? undefined : boundedProviderId(e.requestId) ?? undefined;
      if (e.requestId !== undefined && requestId === undefined) return null;
      return { kind: "response_begin", responseId: rid, requestId };
    }
    case "response_done": {
      const rid = boundedProviderId(e.responseId);
      if (!rid) return null; // a terminal event with no response id has no owner → closed
      const fields = {
        inputTextTokens: usableTokenCount(e.inputTextTokens),
        cachedInputTextTokens: usableTokenCount(e.cachedInputTextTokens),
        outputTextTokens: usableTokenCount(e.outputTextTokens),
        inputAudioTokens: usableTokenCount(e.inputAudioTokens),
        cachedInputAudioTokens: usableTokenCount(e.cachedInputAudioTokens),
        outputAudioTokens: usableTokenCount(e.outputAudioTokens),
      };
      const anyUsable = Object.values(fields).some((v) => v !== null);
      // Terminal ALWAYS; usage present only when trustworthy (else reservation retained).
      const done: ProviderResponseDone = { kind: "response_done", responseId: rid };
      if (anyUsable) {
        done.usage = {
          inputTextTokens: fields.inputTextTokens ?? 0,
          cachedInputTextTokens: fields.cachedInputTextTokens ?? 0,
          outputTextTokens: fields.outputTextTokens ?? 0,
          inputAudioTokens: fields.inputAudioTokens ?? 0,
          cachedInputAudioTokens: fields.cachedInputAudioTokens ?? 0,
          outputAudioTokens: fields.outputAudioTokens ?? 0,
        };
      }
      return done;
    }
    case "usage": {
      const fields = {
        inputTextTokens: usableTokenCount(e.inputTextTokens),
        cachedInputTextTokens: usableTokenCount(e.cachedInputTextTokens),
        outputTextTokens: usableTokenCount(e.outputTextTokens),
        inputAudioTokens: usableTokenCount(e.inputAudioTokens),
        cachedInputAudioTokens: usableTokenCount(e.cachedInputAudioTokens),
        outputAudioTokens: usableTokenCount(e.outputAudioTokens),
      };
      // R3 (REREV-03): a usage event is valid ONLY if at least one token field is
      // a usable count. An all-absent/all-malformed "usage" is NOT a valid zero —
      // it fails closed (null → no usage event → the conservative reservation is
      // retained, never refunded).
      const anyUsable = Object.values(fields).some((v) => v !== null);
      if (!anyUsable) return null;
      return {
        kind: "usage",
        responseId,
        inputTextTokens: fields.inputTextTokens ?? 0,
        cachedInputTextTokens: fields.cachedInputTextTokens ?? 0,
        outputTextTokens: fields.outputTextTokens ?? 0,
        inputAudioTokens: fields.inputAudioTokens ?? 0,
        cachedInputAudioTokens: fields.cachedInputAudioTokens ?? 0,
        outputAudioTokens: fields.outputAudioTokens ?? 0,
      };
    }
    case "transcript": {
      if (e.role !== "user" || typeof e.text !== "string") return null;
      const text = e.text.slice(0, MAX_TRANSCRIPT_LEN);
      if (!text.trim()) return null;
      return { kind: "transcript", role: "user", text, responseId };
    }
    case "tool_call": {
      if (!isToolName(e.tool)) return null;
      if (typeof e.callId !== "string" || !e.callId || e.callId.length > 128) return null;
      const input = strictToolInput(e.tool, e.input);
      if (input === null) return null;
      // EXACT per-tool value checks (the executor re-checks + policy re-checks).
      if (e.tool === "searchHotels") {
        if (input.city != null && (typeof input.city !== "string" || input.city.length > MAX_CITY_LEN)) return null;
        if (input.q != null && (typeof input.q !== "string" || input.q.length > MAX_QUERY_LEN)) return null;
      }
      if (e.tool === "getHotelDetails") {
        if (!isValidHotelId(input.id)) return null;
        // R4 (REREV-11): the ONLY accepted intent value is the closed enum "OPEN".
        if (input.presentationIntent !== undefined && input.presentationIntent !== "OPEN") return null;
      }
      if (e.tool === "getFlashDeals") {
        if (input.city != null && (typeof input.city !== "string" || input.city.length > MAX_CITY_LEN)) return null;
      }
      if (e.tool === "compareHotels") {
        const ids = input.hotelIds;
        if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_COMPARE_HOTELS) return null;
        if (!ids.every(isValidHotelId)) return null;
      }
      return { kind: "tool_call", callId: e.callId, tool: e.tool, input, responseId };
    }
    default:
      return null;
  }
}
