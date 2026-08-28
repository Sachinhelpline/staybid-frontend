// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-02 — deterministic Voice UX state machine.
//
// A PURE reducer. No I/O, no timers, no React, no browser globals. The client
// container (components/voice/VoicePanel.tsx) owns the side effects (mic, audio,
// transport, cleanup); this module owns ONLY the legal state graph so every
// transition is testable in isolation.
//
// Contract:
//   • an event with no edge from the current state is a NO-OP (state unchanged,
//     changed:false) — an invalid transition can never corrupt state;
//   • RESET is reachable from ANY state → then CLEANUP returns a fresh IDLE;
//   • CANCEL is reachable from every live/in-flight state;
//   • the graph never lands in a "stuck" state — ERROR and CANCELLED always have
//     a path back to IDLE.
//
// Pure module: no I/O, no React, no next/*, no @/lib imports.
// ─────────────────────────────────────────────────────────────────────────

export type VoiceState =
  | "IDLE"
  | "REQUESTING_PERMISSION"
  | "LISTENING"
  | "TRANSCRIBING"
  | "THINKING"
  | "EXECUTING_ACTION"
  | "SPEAKING"
  | "INTERRUPTED"
  | "CANCELLED"
  | "ERROR"
  | "RESET";

export const VOICE_STATES: readonly VoiceState[] = Object.freeze([
  "IDLE",
  "REQUESTING_PERMISSION",
  "LISTENING",
  "TRANSCRIBING",
  "THINKING",
  "EXECUTING_ACTION",
  "SPEAKING",
  "INTERRUPTED",
  "CANCELLED",
  "ERROR",
  "RESET",
]);

export type VoiceEvent =
  | "START" // begin a voice turn
  | "RECORDER_STARTED" // recorder confirmed started → LISTENING (REREV-02)
  | "PERMISSION_GRANTED" // (compat alias for RECORDER_STARTED)
  | "PERMISSION_DENIED" // denied OR mic/recorder unavailable OR recorder-start failure
  | "STOP" // user stop OR max-duration cutoff
  | "TRANSCRIPT_OK" // non-empty transcript ready
  | "TRANSCRIPT_FAIL" // empty / STT timeout / STT failure
  | "SUBMIT_TEXT" // text-fallback input (no mic)
  | "ACTION_APPROVED" // model proposed an allowlisted capability/action
  | "ACTION_RESULT_OK" // capability returned → back to reasoning
  | "ACTION_REJECTED" // policy/dispatcher refused → error
  | "RESPONSE_READY" // safe answer/clarification, no TTS → idle
  | "SPEAK" // begin optional spoken response (TTS foundation)
  | "SPEAK_COMPLETE"
  | "INTERRUPT" // barge-in / stop while speaking
  | "CANCEL" // user cancel / navigation
  | "CLEANUP" // finish cleanup of a transient state
  | "RETRY" // retry voice after an error
  | "RESET"; // hard reset from ANY state

export const VOICE_EVENTS: readonly VoiceEvent[] = Object.freeze([
  "START",
  "RECORDER_STARTED",
  "PERMISSION_GRANTED",
  "PERMISSION_DENIED",
  "STOP",
  "TRANSCRIPT_OK",
  "TRANSCRIPT_FAIL",
  "SUBMIT_TEXT",
  "ACTION_APPROVED",
  "ACTION_RESULT_OK",
  "ACTION_REJECTED",
  "RESPONSE_READY",
  "SPEAK",
  "SPEAK_COMPLETE",
  "INTERRUPT",
  "CANCEL",
  "CLEANUP",
  "RETRY",
  "RESET",
]);

// Per-state legal edges. Anything not listed is a NO-OP.
// CANCEL and RESET are handled globally below (reachable from every state).
const EDGES: Record<VoiceState, Partial<Record<VoiceEvent, VoiceState>>> = {
  IDLE: {
    START: "REQUESTING_PERMISSION",
    SUBMIT_TEXT: "THINKING", // text fallback without the mic
  },
  REQUESTING_PERMISSION: {
    // LISTENING only once the recorder has actually started (REREV-02).
    RECORDER_STARTED: "LISTENING",
    PERMISSION_GRANTED: "LISTENING", // compat alias
    PERMISSION_DENIED: "ERROR",
  },
  LISTENING: {
    STOP: "TRANSCRIBING",
  },
  TRANSCRIBING: {
    TRANSCRIPT_OK: "THINKING",
    TRANSCRIPT_FAIL: "ERROR",
  },
  THINKING: {
    ACTION_APPROVED: "EXECUTING_ACTION",
    RESPONSE_READY: "IDLE", // no TTS wired in SB-02
    SPEAK: "SPEAKING",
    TRANSCRIPT_FAIL: "ERROR",
    ACTION_REJECTED: "ERROR",
  },
  EXECUTING_ACTION: {
    ACTION_RESULT_OK: "THINKING",
    RESPONSE_READY: "IDLE",
    ACTION_REJECTED: "ERROR",
  },
  SPEAKING: {
    SPEAK_COMPLETE: "IDLE",
    INTERRUPT: "INTERRUPTED",
  },
  INTERRUPTED: {
    CLEANUP: "IDLE",
  },
  CANCELLED: {
    CLEANUP: "IDLE",
    START: "REQUESTING_PERMISSION",
  },
  ERROR: {
    RETRY: "REQUESTING_PERMISSION",
    SUBMIT_TEXT: "THINKING", // text fallback survives an error
    CLEANUP: "IDLE",
  },
  RESET: {
    CLEANUP: "IDLE",
  },
};

// States from which an in-flight CANCEL is meaningful.
const CANCELLABLE: ReadonlySet<VoiceState> = new Set<VoiceState>([
  "REQUESTING_PERMISSION",
  "LISTENING",
  "TRANSCRIBING",
  "THINKING",
  "EXECUTING_ACTION",
  "SPEAKING",
]);

export interface VoiceTransition {
  state: VoiceState;
  changed: boolean;
}

export function isVoiceState(x: unknown): x is VoiceState {
  return typeof x === "string" && (VOICE_STATES as readonly string[]).includes(x as string);
}

/**
 * Pure transition. RESET is reachable from ANY state (→ RESET). CANCEL is
 * reachable from any in-flight state (→ CANCELLED). Everything else follows the
 * per-state edge table; an event with no edge is a NO-OP (changed:false).
 */
export function voiceReduce(state: VoiceState, event: VoiceEvent): VoiceTransition {
  if (!isVoiceState(state)) return { state: "IDLE", changed: false };

  // Global RESET — always allowed, from every state.
  if (event === "RESET") {
    return { state: "RESET", changed: state !== "RESET" };
  }
  // Global CANCEL — from any in-flight state.
  if (event === "CANCEL") {
    if (CANCELLABLE.has(state)) return { state: "CANCELLED", changed: true };
    return { state, changed: false };
  }

  const next = EDGES[state][event];
  if (next === undefined) return { state, changed: false };
  return { state: next, changed: next !== state };
}

export const INITIAL_VOICE_STATE: VoiceState = "IDLE";

/** True when the machine is doing in-flight work (used to gate a second START). */
export function isBusy(state: VoiceState): boolean {
  return CANCELLABLE.has(state);
}
