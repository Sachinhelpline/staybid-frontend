// ─────────────────────────────────────────────────────────────────────────
// StayBid Travel Buddy — voice I/O + reasoning ADAPTER BOUNDARY (offline candidate).
//
// ONE shared conversation core (lib/travel-buddy/conversation.ts) serves BOTH typed
// and voice turns. This module is the dependency-injection seam around it:
//   • STT  (speech → text)   : "off" | "simulated" | "browser"
//   • TTS  (text → speech)   : "off" | "simulated" | "device"
//   • reasoning (text → plan): "scripted" (the deterministic core) | "provider"
//
// SAFETY CONTRACT (fail-closed by construction):
//   • REAL PROVIDER EGRESS IS NOT COMPILED: the provider STT / TTS / reasoning
//     adapters below are inert stubs that resolve { ok:false, error:"provider-disabled" }
//     without touching fetch, XHR, WebSocket, audio or any key. No flag can enable them.
//   • "simulated" STT never uses a microphone: the guest picks a sample phrase and a
//     deterministic fixture returns a transcript (optionally a low-confidence or
//     mis-heard one, to exercise the review/confirm UX). Clearly labelled simulated.
//   • R1 (backward compatibility, integration candidate): a build with the preview ON and
//     NO voice flag at all keeps the PRE-Candidate01 behaviour exactly — browser
//     SpeechRecognition + browser speechSynthesis ("legacy", disclosed vendor speech service).
//     Explicit "0" switches either one OFF; "1" forces browser STT / on-device-only TTS.
//   • LIVE controller mode (P=1 + NEXT_PUBLIC_TRAVEL_BUDDY_LIVE_CONTROLLER=1): voice in AND
//     out belong to the ORIGINAL Live-AI controller (its single mic owner + audio playback);
//     Teddy never opens a second recogniser or synthesiser ("provider").
// No I/O, no React, no DOM, no network, no storage in this file.
// ─────────────────────────────────────────────────────────────────────────
import {
  parseUtterance,
  planTurn,
  type BuddyLang,
  type BuddySlots,
  type ParsedUtterance,
  type PlannerContext,
  type TurnPlan,
} from "./conversation";

// ---- configuration ----------------------------------------------------------
export type SttMode = "off" | "simulated" | "browser" | "provider";
export type TtsMode = "off" | "simulated" | "device" | "browser" | "provider";

export interface VoiceIoConfig {
  stt: SttMode;
  tts: TtsMode;
  /** Real provider-backed STT / reasoning / TTS. Always "disabled" in this candidate. */
  provider: "disabled";
}

export const DEMO_VOICE_FLAG = "NEXT_PUBLIC_TRAVEL_BUDDY_DEMO_VOICE";
export const BROWSER_STT_FLAG = "NEXT_PUBLIC_TRAVEL_BUDDY_BROWSER_STT";
export const DEVICE_TTS_FLAG = "NEXT_PUBLIC_TRAVEL_BUDDY_DEVICE_TTS";
export const LIVE_CONTROLLER_FLAG = "NEXT_PUBLIC_TRAVEL_BUDDY_LIVE_CONTROLLER";

/** Compile-time constant: there is NO real provider egress path in this build. */
export const REAL_PROVIDER_EGRESS_COMPILED = false as const;

/**
 * Resolve the voice I/O modes (exact string matching: "1" on, "0" off, anything else = unset).
 *   1. typed-only preview → no voice at all (wins over everything);
 *   2. live controller   → STT is the ORIGINAL controller's ("provider"); TTS is the controller's
 *      ("provider") unless deviceTts is "1", in which case the controller-VERIFIED answer text is
 *      spoken with ON-DEVICE voices only ("device") — the 03B compiled-answer path carries no TTS;
 *   3. browserStt "1" → browser STT; "0" → simulated if demo voice else off;
 *      unset → simulated if demo voice, else the LEGACY default "browser" (pre-Candidate01);
 *   4. deviceTts  "1" → on-device-only TTS; "0" → simulated if demo voice else off;
 *      unset → simulated if demo voice, else "browser" iff STT is the legacy browser default.
 * `provider` here describes ONLY the scripted-path adapters (never a network egress).
 */
export function resolveVoiceIo(
  textOnly: boolean,
  demoVoice: string | undefined,
  browserStt: string | undefined,
  deviceTts: string | undefined,
  liveController = false,
): VoiceIoConfig {
  if (textOnly === true) return { stt: "off", tts: "off", provider: "disabled" };
  if (liveController === true) return { stt: "provider", tts: deviceTts === "1" ? "device" : "provider", provider: "disabled" };
  const demo = demoVoice === "1";
  const stt: SttMode = browserStt === "1" ? "browser" : browserStt === "0" ? (demo ? "simulated" : "off") : demo ? "simulated" : "browser";
  const legacyStt = stt === "browser" && browserStt !== "1";
  const tts: TtsMode = deviceTts === "1" ? "device" : deviceTts === "0" ? (demo ? "simulated" : "off") : demo ? "simulated" : legacyStt ? "browser" : "off";
  return { stt, tts, provider: "disabled" };
}

// ---- STT ----------------------------------------------------------------------
export type SttFailure =
  | "permission-denied"
  | "permission-dismissed"
  | "cancelled"
  | "no-speech"
  | "provider-disabled"
  | "failed";

export interface SttResult {
  transcript: string;
  /** 0..1 engine confidence (simulated fixtures declare it; browsers may report it). */
  confidence: number;
  /** other hypotheses the engine considered (used ONLY to flag fields, never to auto-correct). */
  alternatives: string[];
  source: "simulated" | "browser" | "provider";
}

export type SttOutcome = { ok: true; result: SttResult } | { ok: false; error: SttFailure };

/** One sample phrase in the simulated-voice demo: what the guest "says" and what the engine "hears". */
export interface SimulatedUtterance {
  id: string;
  /** what the guest says (shown on the chip) */
  said: string;
  /** what the simulated engine returns (may differ: a deliberate mis-hearing) */
  heard: string;
  confidence: number;
  alternatives?: string[];
  /** force a failure outcome instead of a transcript (error-UX fixtures) */
  fail?: SttFailure;
}

export const SIMULATED_PHRASES: readonly SimulatedUtterance[] = Object.freeze([
  { id: "mus-clean", said: "Mussoorie mein 5000 tak parking wala hotel", heard: "Mussoorie mein 5000 tak parking wala hotel", confidence: 0.94 },
  { id: "ris-noisy", said: "Rishikesh mein do log, budget teen hazaar", heard: "rishikesh mein do log budget teen hazaar", confidence: 0.62 },
  { id: "goa-mishear", said: "Hotels in Goa under 6000", heard: "hotels in goa under 9000", confidence: 0.71, alternatives: ["hotels in goa under 6000"] },
  { id: "open-second", said: "दूसरा option दिखाओ", heard: "दूसरा option दिखाओ", confidence: 0.9 },
  { id: "open-it", said: "Isko kholo", heard: "isko kholo", confidence: 0.93 },
  { id: "rooms", said: "Rooms dikhao", heard: "rooms dikhao", confidence: 0.95 },
  { id: "bid", said: "Is hotel par bid lagao", heard: "is hotel par bid lagao", confidence: 0.92 },
]);

/** Error-UX fixtures (QA only; labelled as simulations). */
export const SIMULATED_FAILURES: readonly SimulatedUtterance[] = Object.freeze([
  { id: "sim-no-speech", said: "(silence)", heard: "", confidence: 0, fail: "no-speech" },
  { id: "sim-stt-error", said: "(engine error)", heard: "", confidence: 0, fail: "failed" },
]);

export interface SttAdapter {
  readonly mode: "simulated" | "provider";
  recognize(input: SimulatedUtterance | null, signal?: AbortSignal): Promise<SttOutcome>;
}

const SIM_LATENCY_MS = 650;

/**
 * Deterministic simulated STT. No microphone, no audio, no network. `wait` is injectable
 * so tests run instantly; the UI uses a short visible "hearing…" delay that a Cancel aborts.
 */
export function createSimulatedStt(wait: (ms: number, signal?: AbortSignal) => Promise<void> = abortableWait): SttAdapter {
  return {
    mode: "simulated",
    async recognize(input, signal) {
      if (!input) return { ok: false, error: "no-speech" };
      try { await wait(SIM_LATENCY_MS, signal); } catch { return { ok: false, error: "cancelled" }; }
      if (signal && signal.aborted) return { ok: false, error: "cancelled" };
      if (input.fail) return { ok: false, error: input.fail };
      const transcript = String(input.heard || "").slice(0, 300).trim();
      if (!transcript) return { ok: false, error: "no-speech" };
      const confidence = Number.isFinite(input.confidence) ? Math.max(0, Math.min(1, input.confidence)) : 0;
      return { ok: true, result: { transcript, confidence, alternatives: (input.alternatives || []).slice(0, 3), source: "simulated" } };
    },
  };
}

export function abortableWait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal && signal.aborted) { reject(new Error("aborted")); return; }
    const t = setTimeout(() => { if (signal) signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new Error("aborted")); };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Map a browser SpeechRecognition error code to the shared failure vocabulary. */
export function mapBrowserSttError(code: string): SttFailure {
  if (code === "not-allowed" || code === "service-not-allowed") return "permission-denied";
  if (code === "aborted") return "cancelled";
  if (code === "no-speech") return "no-speech";
  return "failed";
}

// ---- TTS ----------------------------------------------------------------------
export type TtsOutcome = "spoken" | "simulated" | "muted" | "cancelled" | "provider-disabled";

export interface TtsAdapter {
  readonly mode: "simulated" | "provider";
  speak(text: string, lang: BuddyLang, signal?: AbortSignal): Promise<TtsOutcome>;
}

/** Simulated playback: NO audio; resolves after a readable duration (the caption is the output). */
export function createSimulatedTts(wait: (ms: number, signal?: AbortSignal) => Promise<void> = abortableWait): TtsAdapter {
  return {
    mode: "simulated",
    async speak(text, _lang, signal) {
      try { await wait(Math.max(1200, String(text || "").length * 45), signal); } catch { return "cancelled"; }
      return signal && signal.aborted ? "cancelled" : "simulated";
    },
  };
}

// ---- reasoning --------------------------------------------------------------
export interface ReasoningInput {
  text: string;
  context: PlannerContext;
  slots: BuddySlots;
  cities: readonly string[];
  lang: BuddyLang;
}
export interface ReasoningOutput { parsed: ParsedUtterance; plan: TurnPlan }

export interface ScriptedReasoning {
  readonly kind: "scripted";
  plan(input: ReasoningInput): ReasoningOutput;
}

/** The deterministic shared core — the SAME function for typed and voice turns. */
export function createScriptedReasoning(): ScriptedReasoning {
  return {
    kind: "scripted",
    plan({ text, context, slots, cities, lang }) {
      const parsed = parseUtterance(text, cities, lang);
      return { parsed, plan: planTurn(parsed, context, slots, cities) };
    },
  };
}

// ---- REAL provider adapters: inert, fail-closed stubs -------------------------
export interface ProviderReasoning {
  readonly kind: "provider";
  reply(input: ReasoningInput): Promise<{ ok: false; error: "provider-disabled" }>;
}

/**
 * The real STT → model → TTS chain is a LATER, separately approved stage. These stubs
 * exist so the seam compiles and is exercised; they perform NO I/O of any kind.
 */
export function createDisabledProviderAdapters(): { stt: SttAdapter; tts: TtsAdapter; reasoning: ProviderReasoning } {
  return {
    stt: { mode: "provider", recognize: async () => ({ ok: false, error: "provider-disabled" }) },
    tts: { mode: "provider", speak: async () => "provider-disabled" },
    reasoning: { kind: "provider", reply: async () => ({ ok: false, error: "provider-disabled" }) },
  };
}

/** Which reasoning backs the UI. With provider "disabled" this is ALWAYS the scripted core. */
export function selectReasoning(config: VoiceIoConfig): ScriptedReasoning {
  void config; // provider is "disabled" by type; nothing else can be returned
  return createScriptedReasoning();
}

// ---- copy -------------------------------------------------------------------
export const DEMO_VOICE_NOTE = {
  hinglish: "Demo voice: mic simulated hai — koi audio record ya bheja nahi jaata. Neeche ek phrase chuniye, ya type kariye.",
  en: "Demo voice: the microphone is simulated — no audio is recorded or sent. Pick a phrase below, or type.",
} as const;

export const LIVE_VOICE_NOTE = {
  hinglish: "Mic ke liye mujhe dobara tap kariye. Aapki baat pehle screen par dikhegi — confirm karke hi bhejunga.",
  en: "Tap me again to talk. I'll show what I heard first — nothing is sent until you confirm.",
} as const;

export const VOICE_OFF_NOTE = {
  hinglish: "Is build mein voice band hai — Type dabakar likhiye.",
  en: "Voice is switched off in this build — tap Type to write.",
} as const;
