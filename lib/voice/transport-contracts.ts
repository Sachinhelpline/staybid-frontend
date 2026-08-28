// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-02 — provider-neutral transport contracts.
//
// SB-02 adds a real /hotels Voice INTERACTION shell but connects NO production
// STT / LLM / TTS provider. This module defines the SERIALIZABLE, runtime-
// validated request/response contracts that a FUTURE provider transport will
// speak — and, just as importantly, the shapes it may NEVER contain.
//
// A transport RESPONSE is ALWAYS untrusted (it will one day be model output).
// Every field is bounded + closed. There is deliberately NO field for:
//   • an arbitrary URL / path / HTTP method / headers
//   • JavaScript / a DOM selector / a template
//   • a provider key / a database or RPC handle / a custom tool definition
// Any unrecognized/malformed contract fails CLOSED → null (never a partial).
//
// A capability proposal can only ever name one of the FOUR frozen SB-01 read
// capabilities; a UI-action proposal is re-validated by the SB-01
// validateUiAction() closed union. This module NEVER performs I/O and never
// weakens SB-01 — it only shapes + validates plain data.
//
// Pure module: no I/O, no React, no next/*, no provider imports.
// ─────────────────────────────────────────────────────────────────────────
import {
  type CapabilityName,
  type VoiceUiAction,
  isCapabilityName,
  isValidHotelId,
  validateUiAction,
  MAX_COMPARE_HOTELS,
} from "./contracts";

// ---- bounds (asserted by tests/voice/voice-ux.test.js) ----------------------
export const MAX_TRANSCRIPT_LEN = 400;
export const MAX_RESPONSE_TEXT_LEN = 800;
export const MAX_HISTORY_TURNS = 8;
export const MAX_HISTORY_CHARS = 4000;
export const MAX_VISIBLE_HOTEL_IDS = 24;
/** Hard cap on capability round-trips inside a single turn (loop guard). */
export const MAX_ACTIONS_PER_TURN = 4;

// ---- language hint (provider-neutral) ---------------------------------------
export type VoiceLanguageHint = "auto" | "hi-IN" | "en-IN";
const LANGUAGE_HINTS: readonly VoiceLanguageHint[] = Object.freeze(["auto", "hi-IN", "en-IN"]);
export function isLanguageHint(x: unknown): x is VoiceLanguageHint {
  return typeof x === "string" && (LANGUAGE_HINTS as readonly string[]).includes(x);
}

// ---- bounded conversation history (memory only; never persisted) ------------
export interface VoiceHistoryTurn {
  role: "user" | "assistant";
  text: string;
}

/** Bound a history array: keep the last MAX_HISTORY_TURNS, cap total chars, drop bad rows. */
export function boundHistory(raw: unknown): VoiceHistoryTurn[] {
  if (!Array.isArray(raw)) return [];
  const cleaned: VoiceHistoryTurn[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const r = (t as any).role;
    const text = (t as any).text;
    if (r !== "user" && r !== "assistant") continue;
    if (typeof text !== "string" || !text) continue;
    cleaned.push({ role: r, text: text.slice(0, MAX_RESPONSE_TEXT_LEN) });
  }
  // Keep only the most recent turns.
  const recent = cleaned.slice(-MAX_HISTORY_TURNS);
  // Enforce an overall character budget, oldest-dropped first.
  let total = recent.reduce((n, t) => n + t.text.length, 0);
  while (recent.length > 1 && total > MAX_HISTORY_CHARS) {
    total -= recent[0].text.length;
    recent.shift();
  }
  return recent;
}

// ---- transport REQUEST (client → future provider) ---------------------------
// A minimal, bounded envelope. Carries NO auth token, NO url, NO provider key.
export interface VoiceTransportRequest {
  transcript: string;
  languageHint: VoiceLanguageHint;
  /** Bounded prior conversation (memory only). */
  history: VoiceHistoryTurn[];
  /** The hotel ids currently visible on /hotels (already allowlisted, ≤24). */
  visibleHotelIds: string[];
  /** Monotonic identifiers — a stale/mismatched result is rejected. */
  sessionGeneration: number;
  turnId: number;
}

export function buildTransportRequest(input: {
  transcript: unknown;
  languageHint?: unknown;
  history?: unknown;
  visibleHotelIds?: unknown;
  sessionGeneration: number;
  turnId: number;
}): VoiceTransportRequest | null {
  if (typeof input.transcript !== "string") return null;
  const transcript = input.transcript.trim().slice(0, MAX_TRANSCRIPT_LEN);
  if (!transcript) return null;
  const languageHint = isLanguageHint(input.languageHint) ? input.languageHint : "auto";
  const history = boundHistory(input.history);
  const visibleHotelIds = Array.isArray(input.visibleHotelIds)
    ? Array.from(new Set(input.visibleHotelIds.filter(isValidHotelId) as string[])).slice(0, MAX_VISIBLE_HOTEL_IDS)
    : [];
  if (!Number.isFinite(input.sessionGeneration) || !Number.isFinite(input.turnId)) return null;
  return {
    transcript,
    languageHint,
    history,
    visibleHotelIds,
    sessionGeneration: input.sessionGeneration,
    turnId: input.turnId,
  };
}

// ---- transport RESPONSE (future provider → client) — ALWAYS UNTRUSTED --------
// A CLOSED discriminated union. Note the deliberate absence of any url/method/
// headers/script/selector/key/db field on EVERY variant.
export type VoiceTransportResponse =
  | { kind: "answer"; text: string }
  | { kind: "clarify"; text: string }
  | { kind: "capability"; capability: CapabilityName; input: Record<string, unknown> }
  | { kind: "ui_action"; action: VoiceUiAction }
  | { kind: "error"; code: VoiceErrorCode };

// ---- TWO DISTINCT TRUST DOMAINS (SB02-R2-NEW-01) ----------------------------
// (A) TRANSPORT error codes — the ONLY error codes an untrusted transport/
//     provider response may legitimately carry. A provider can NEVER claim a
//     local control state (busy / stale_result / too_many_actions /
//     action_rejected are LOCAL-only and are absent here).
// (B) VoiceErrorCode — the full set of codes the INTERACTION controller may
//     surface (transport codes ∪ the local control codes). Only the interaction
//     itself may synthesize the local ones.
export type TransportErrorCode =
  | "provider_unavailable"
  | "empty_transcript"
  | "stt_timeout"
  | "stt_failed"
  | "model_timeout"
  | "model_failed"
  | "tts_failed"
  | "malformed_response"
  | "unknown_capability";

const TRANSPORT_ERROR_CODES: readonly TransportErrorCode[] = Object.freeze([
  "provider_unavailable",
  "empty_transcript",
  "stt_timeout",
  "stt_failed",
  "model_timeout",
  "model_failed",
  "tts_failed",
  "malformed_response",
  "unknown_capability",
]);
export function isTransportErrorCode(x: unknown): x is TransportErrorCode {
  return typeof x === "string" && (TRANSPORT_ERROR_CODES as readonly string[]).includes(x);
}

/** LOCAL-only control error codes — NEVER accepted from a transport/provider.
 *  (SB-04 R1: session_ended / turn_timeout are gateway-runtime control codes the
 *  gateway may surface to the browser over the control channel — still local, i.e.
 *  never valid on a provider transport response.) */
export type LocalErrorCode =
  | "action_rejected"
  | "stale_result"
  | "too_many_actions"
  | "busy"
  | "transport_invalid"
  | "session_ended"
  | "turn_timeout"
  | "cost_limit";

export type VoiceErrorCode = TransportErrorCode | LocalErrorCode;

const ERROR_CODES: readonly VoiceErrorCode[] = Object.freeze([
  ...TRANSPORT_ERROR_CODES,
  "action_rejected",
  "stale_result",
  "too_many_actions",
  "busy",
  "transport_invalid",
  "session_ended",
  "turn_timeout",
  "cost_limit",
]);
export function isVoiceErrorCode(x: unknown): x is VoiceErrorCode {
  return typeof x === "string" && (ERROR_CODES as readonly string[]).includes(x);
}

// The ONLY input keys a capability proposal may carry (bounded, no url/method).
const CAPABILITY_INPUT_KEYS = Object.freeze(["city", "q", "id", "hotelIds"]);

function boundedCapabilityInput(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(raw as Record<string, unknown>)) {
    // Any key outside the tiny allowlist ⇒ fail closed (no url/method/headers/etc).
    if (!CAPABILITY_INPUT_KEYS.includes(k)) return null;
    out[k] = (raw as Record<string, unknown>)[k];
  }
  return out;
}

/**
 * Validate an untrusted transport response into the closed union, or null.
 * Fail closed on unknown `kind`, missing/mis-typed fields, over-long text, an
 * unknown capability, an out-of-allowlist capability-input key, or a UI action
 * the SB-01 validator rejects. Only the declared fields are ever carried.
 */
export function validateTransportResponse(x: unknown): VoiceTransportResponse | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  switch (r.kind) {
    case "answer":
    case "clarify": {
      if (typeof r.text !== "string") return null;
      const text = r.text.slice(0, MAX_RESPONSE_TEXT_LEN);
      if (!text.trim()) return null;
      return { kind: r.kind, text };
    }
    case "capability": {
      if (!isCapabilityName(r.capability)) return { kind: "error", code: "unknown_capability" };
      const input = boundedCapabilityInput(r.input);
      if (input === null) return null;
      // Defensive shape checks for the id-bearing capabilities (policy re-checks too).
      if (r.capability === "getHotelDetails" && !isValidHotelId(input.id)) return null;
      if (r.capability === "compareHotels") {
        const ids = input.hotelIds;
        if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_COMPARE_HOTELS) return null;
        if (!ids.every(isValidHotelId)) return null;
      }
      return { kind: "capability", capability: r.capability, input };
    }
    case "ui_action": {
      const action = validateUiAction(r.action);
      if (!action) return null;
      return { kind: "ui_action", action };
    }
    case "error": {
      // A transport/provider error may ONLY carry a TRANSPORT error code. A
      // LOCAL control code (busy / stale_result / too_many_actions /
      // action_rejected / transport_invalid) or any unknown code fails CLOSED →
      // null, so a provider can never claim a local concurrency/control state.
      return isTransportErrorCode(r.code) ? { kind: "error", code: r.code } : null;
    }
    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VOICE-AI-SB-04 — browser ↔ gateway CONTROL-CHANNEL contracts.
//
// SB-04 adds a dedicated Railway Voice gateway. Media (audio) rides a native
// WebRTC peer connection straight to the provider; the ONLY StayBid control that
// crosses browser↔gateway is a small, typed, provider-NEUTRAL control channel.
// This section defines those closed message unions + their runtime validators.
//
// TWO independent trust domains, mirroring the transport rule above:
//   • CLIENT control (browser → gateway): only cancel/reset/close a turn/session.
//     The browser can never inject a provider capability or a raw URL/tool.
//   • SERVER control (gateway → browser): status / a bounded transcript line for
//     DISPLAY / a validated UI action / a bounded answer|clarify / turn-complete /
//     a bounded error. A `ui_action` is re-validated by the SB-01 validateUiAction
//     closed union HERE, and MUST be re-validated AGAIN by the browser SB-01
//     dispatcher before it can touch the /hotels UI (defense in depth).
//
// Every message is size-bounded and closed. There is deliberately NO field for a
// url / method / headers / script / selector / provider key / tool definition on
// ANY variant. A malformed / unknown / oversized frame fails CLOSED → null.
// ═══════════════════════════════════════════════════════════════════════════

/** Hard byte ceiling for a single control frame (both directions). */
export const MAX_CONTROL_FRAME_BYTES = 8 * 1024;
/** Bounded transcript line surfaced to the browser for DISPLAY only. */
export const MAX_CONTROL_TRANSCRIPT_LEN = MAX_TRANSCRIPT_LEN;

// ---- CLIENT → GATEWAY (browser control) — closed union ----------------------
export type VoiceClientControl =
  | { t: "cancel_turn"; turnId: number }
  | { t: "reset_session" }
  | { t: "close_session" };

export function validateClientControl(x: unknown): VoiceClientControl | null {
  if (!x || typeof x !== "object") return null;
  const m = x as Record<string, unknown>;
  switch (m.t) {
    case "cancel_turn":
      if (!Number.isFinite(m.turnId)) return null;
      return { t: "cancel_turn", turnId: m.turnId as number };
    case "reset_session":
      return { t: "reset_session" };
    case "close_session":
      return { t: "close_session" };
    default:
      return null;
  }
}

// ---- GATEWAY → BROWSER (server control) — closed union -----------------------
// The fixed, provider-neutral status vocabulary (mirrors the SB-02 UX states the
// browser already knows; the browser maps these to its own state machine).
export type VoiceServerStatus =
  | "listening"
  | "transcribing"
  | "thinking"
  | "executing"
  | "speaking"
  | "interrupted"
  | "cancelled"
  | "idle";

const SERVER_STATUSES: readonly VoiceServerStatus[] = Object.freeze([
  "listening",
  "transcribing",
  "thinking",
  "executing",
  "speaking",
  "interrupted",
  "cancelled",
  "idle",
]);
export function isServerStatus(x: unknown): x is VoiceServerStatus {
  return typeof x === "string" && (SERVER_STATUSES as readonly string[]).includes(x);
}

export type VoiceServerControl =
  | { t: "status"; status: VoiceServerStatus; turnId: number }
  | { t: "transcript"; role: "user" | "assistant"; text: string; turnId: number }
  | { t: "result"; kind: "answer" | "clarify"; text: string; turnId: number }
  | { t: "ui_action"; action: VoiceUiAction; turnId: number }
  | { t: "turn_complete"; turnId: number }
  | { t: "error"; code: VoiceErrorCode; turnId: number };

function boundedTurnId(v: unknown): number | null {
  if (!Number.isFinite(v)) return null;
  const n = Math.floor(v as number);
  if (n < 0) return null;
  return n;
}

/**
 * Validate an untrusted GATEWAY→browser control frame into the closed union, or
 * null. Fail closed on unknown `t`, missing/mis-typed fields, over-long text, a
 * bad turn id, or a UI action the SB-01 validator rejects. Only declared fields
 * are ever carried. Byte-size is enforced separately by the socket layer.
 */
export function validateServerControl(x: unknown): VoiceServerControl | null {
  if (!x || typeof x !== "object") return null;
  const m = x as Record<string, unknown>;
  const turnId = boundedTurnId(m.turnId);
  if (turnId === null) return null;
  switch (m.t) {
    case "status": {
      if (!isServerStatus(m.status)) return null;
      return { t: "status", status: m.status, turnId };
    }
    case "transcript": {
      if (m.role !== "user" && m.role !== "assistant") return null;
      if (typeof m.text !== "string") return null;
      const text = m.text.slice(0, MAX_CONTROL_TRANSCRIPT_LEN);
      if (!text.trim()) return null;
      return { t: "transcript", role: m.role, text, turnId };
    }
    case "result": {
      if (m.kind !== "answer" && m.kind !== "clarify") return null;
      if (typeof m.text !== "string") return null;
      const text = m.text.slice(0, MAX_RESPONSE_TEXT_LEN);
      if (!text.trim()) return null;
      return { t: "result", kind: m.kind, text, turnId };
    }
    case "ui_action": {
      const action = validateUiAction(m.action);
      if (!action) return null;
      return { t: "ui_action", action, turnId };
    }
    case "turn_complete":
      return { t: "turn_complete", turnId };
    case "error": {
      if (!isVoiceErrorCode(m.code)) return null;
      return { t: "error", code: m.code, turnId };
    }
    default:
      return null;
  }
}

/** Serialize + size-guard a client control frame (fail closed if oversized). */
export function encodeClientControl(msg: VoiceClientControl): string | null {
  const validated = validateClientControl(msg);
  if (!validated) return null;
  const s = JSON.stringify(validated);
  if (typeof s !== "string" || s.length > MAX_CONTROL_FRAME_BYTES) return null;
  return s;
}
