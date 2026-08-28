"use client";
// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-02 — /hotels Voice interaction shell.
//
// A DORMANT but technically-real Voice UI: real user-gesture mic permission +
// capture, the deterministic UX state machine, transcript/response surfaces, a
// text fallback, stop/cancel/reset, and a LOCAL bid-draft preview — all wired to
// the frozen SB-01 action bridge through an INJECTED transport. SB-02 ships NO
// STT/LLM/TTS provider, so the default transport fails closed and the mic path
// has no transcriber — nothing is faked.
//
// Correctness invariants (SB-02 R1 remediation):
//   • LISTENING is entered ONLY on the capture "recorder started" signal — never
//     merely because start() returned a Promise (REREV-02).
//   • cancel() invalidates BOTH the audio attempt AND the in-flight interaction
//     turn; a late submit result is dropped before any UI mutation (REREV-03).
//   • every async result is gated on the interaction generation captured before
//     the await — a superseded/cancelled result never updates the UI.
//   • a rejected dispatch never shows an "Applied" success (REREV-04).
//   • the local bid-draft preview is real, in-memory, NOT submitted (REREV-05).
//
// Mounted ONLY by VoiceSearchControl (client-only via next/dynamic), which
// renders nothing unless NEXT_PUBLIC_VOICE_AI_BETA === "1". No browser global is
// touched at module load — everything lives inside effects/handlers.
// ─────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import {
  createVoiceInteraction,
  createAudioCapture,
  voiceReduce,
  isBusy,
  INITIAL_VOICE_STATE,
  detectSupport,
  type VoiceState,
  type VoiceSession,
  type AudioCapture,
  type VoiceInteraction,
  type DispatchOutcome,
} from "@/lib/voice";

export interface VoiceBidDraft {
  hotelId: string;
  pricePerNight: number | null;
}

export interface VoicePanelProps {
  session: VoiceSession;
  dispatch: (candidate: unknown) => DispatchOutcome;
  /** Bounded (≤24) currently-visible hotel ids from /hotels. */
  visibleHotelIds: string[];
  /** The current local bid-draft preview (owned by VoiceSearchControl), or null. */
  draft: VoiceBidDraft | null;
  /** Clear the local draft preview (on reset / new turn). */
  onClearDraft: () => void;
}

const STATE_LABEL: Record<VoiceState, string> = {
  IDLE: "Ready",
  REQUESTING_PERMISSION: "Requesting microphone…",
  LISTENING: "Listening…",
  TRANSCRIBING: "Processing…",
  THINKING: "Thinking…",
  EXECUTING_ACTION: "Working…",
  SPEAKING: "Speaking…",
  INTERRUPTED: "Stopped",
  CANCELLED: "Cancelled",
  ERROR: "Not available",
  RESET: "Reset",
};

export default function VoicePanel({ session, dispatch, visibleHotelIds, draft, onClearDraft }: VoicePanelProps) {
  const [state, setState] = useState<VoiceState>(INITIAL_VOICE_STATE);
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [textInput, setTextInput] = useState("");

  const interactionRef = useRef<VoiceInteraction | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);

  if (!interactionRef.current) {
    // nullTransport by default — SB-02 wires NO provider. Same-origin fetch for
    // the SB-01 read adapters is resolved lazily by the adapters themselves.
    interactionRef.current = createVoiceInteraction({ session, dispatch });
  }

  // Keep the session allowlist seeded with the currently-visible hotel ids.
  useEffect(() => {
    session.allowHotelIds(visibleHotelIds);
  }, [session, visibleHotelIds]);

  // Cleanup media + interaction on unmount / navigation.
  useEffect(() => {
    return () => {
      if (captureRef.current) captureRef.current.dispose();
      if (interactionRef.current) interactionRef.current.reset();
    };
  }, []);

  function apply(event: Parameters<typeof voiceReduce>[1]) {
    setState((prev) => voiceReduce(prev, event).state);
  }

  function startVoice() {
    if (isBusy(state)) return; // never spawn a parallel recorder
    // State-aware entry (SB02-R1-NEW-01): from ERROR the correct transition is
    // RETRY (ERROR+START is NOT a valid edge). Start the mic ONLY if the reducer
    // actually moves us into REQUESTING_PERMISSION — otherwise NO mic side effect.
    const startEvent = state === "ERROR" ? "RETRY" : "START";
    const t = voiceReduce(state, startEvent);
    if (t.state !== "REQUESTING_PERMISSION") return; // invalid → zero capture
    setResponse(null);
    setNote(null);
    setState(t.state); // → REQUESTING_PERMISSION
    const support = detectSupport();
    if (!support.getUserMedia || !support.mediaRecorder) {
      setNote("Microphone recording isn't supported in this browser. You can type instead.");
      apply("PERMISSION_DENIED"); // → ERROR
      return;
    }
    const capture = createAudioCapture();
    captureRef.current = capture;
    // LISTENING is entered ONLY from the recorder-started signal (REREV-02).
    const p = capture.start({ onStarted: () => apply("RECORDER_STARTED") });
    if (!p) {
      apply("PERMISSION_DENIED");
      return;
    }
    p.then((res: any) => {
      if (!res || res.failure === "cancelled") {
        // cancel/dispose owns the UI transition — do nothing here.
        return;
      }
      if (res.ok) {
        // Recording finished (stop button OR the 20s auto-cutoff). SB-02 has no
        // STT provider, so no transcript can be produced → fail closed honestly.
        apply("STOP"); // LISTENING → TRANSCRIBING (no-op if already left LISTENING)
        apply("TRANSCRIPT_FAIL"); // → ERROR
        setNote("Speech recognition isn't connected in this beta yet — please type your request.");
        return;
      }
      if (res.failure === "permission_denied") {
        setNote("Microphone permission was denied. You can type your request instead.");
        apply("PERMISSION_DENIED"); // → ERROR
      } else if (res.failure === "unsupported") {
        setNote("Microphone recording isn't supported here. You can type instead.");
        apply("PERMISSION_DENIED");
      } else if (res.failure === "too_large") {
        apply("STOP");
        apply("TRANSCRIPT_FAIL");
        setNote("That recording was too long. Please try a shorter request or type it.");
      } else {
        // no_audio_track / recorder_error — before LISTENING was reached.
        setNote("Couldn't start recording. You can type your request instead.");
        apply("PERMISSION_DENIED");
      }
    });
  }

  function stopVoice() {
    // Drive the post-recording transition from the capture promise resolution.
    if (captureRef.current) captureRef.current.stop();
  }

  function cancelVoice() {
    apply("CANCEL"); // → CANCELLED
    if (captureRef.current) captureRef.current.cancel();
    // REREV-03 + R1-NEW-02: invalidate any in-flight interaction turn AND release
    // the active submission slot so a fresh submission can start.
    if (interactionRef.current) interactionRef.current.cancel();
    setTranscript("");
    apply("CLEANUP"); // → IDLE
  }

  function resetVoice() {
    apply("RESET"); // → RESET
    if (captureRef.current) captureRef.current.dispose();
    captureRef.current = null;
    if (interactionRef.current) interactionRef.current.reset();
    setTranscript("");
    setResponse(null);
    setNote(null);
    setTextInput("");
    onClearDraft();
    apply("CLEANUP"); // → IDLE
  }

  async function submitText() {
    const text = textInput.trim();
    if (!text) return;
    const interaction = interactionRef.current!;
    // Single-flight ownership lives in the interaction (R1-NEW-02): gate a second
    // concurrent submission here, and the interaction refuses it too (returns
    // "busy") so a stale finally can never clear a newer submission's slot.
    if (interaction.isBusy()) return;
    setTranscript(text);
    setResponse(null);
    setNote(null);
    setTextInput("");
    apply("SUBMIT_TEXT"); // → THINKING
    const myGen = interaction.currentGeneration();
    const outcome = await interaction.submit({ transcript: text, visibleHotelIds });
    // Suppress ALL UI effects if this submission was superseded by cancel/reset
    // (its generation changed) — a stale result never mutates the UI.
    if (interaction.currentGeneration() !== myGen) return;

    // R2-NEW-01 recovery: a LOCAL busy (a concurrent submission owns the slot)
    // is normally prevented by the pre-submit isBusy() gate above; if a race
    // ever surfaces it AFTER we entered THINKING, recover DETERMINISTICALLY back
    // to IDLE (never leave THINKING, never fake a success response).
    if (!outcome.ok && outcome.code === "busy") {
      setNote("A voice request is already in progress — please wait for it to finish.");
      apply("RESPONSE_READY"); // THINKING → IDLE
      return;
    }

    if (outcome.ok && (outcome.kind === "answer" || outcome.kind === "clarify")) {
      setResponse(outcome.text);
      apply("RESPONSE_READY"); // → IDLE
    } else if (outcome.ok && outcome.kind === "ui_action") {
      // Only a genuinely accepted action reports success (REREV-04).
      setResponse(`Applied: ${outcome.action.type}`);
      apply("RESPONSE_READY");
    } else if (!outcome.ok) {
      setNote(
        outcome.code === "provider_unavailable"
          ? "Voice assistant isn't connected in this beta yet."
          : outcome.code === "action_rejected"
            ? `That action was not allowed (${outcome.detail || "rejected"}).`
            : `Couldn't complete that (${outcome.code}).`,
      );
      apply("TRANSCRIPT_FAIL"); // → ERROR
    }
  }

  const listening = state === "LISTENING" || state === "REQUESTING_PERMISSION";

  return (
    <div className="sb-vp" aria-label="Voice assistant (beta)">
      <div className="sb-vp-row">
        {!listening ? (
          <button type="button" className="sb-vp-btn sb-vp-mic" onClick={startVoice} aria-label="Start voice">
            <span aria-hidden>🎙️</span> Start voice
          </button>
        ) : (
          <button
            type="button"
            className="sb-vp-btn sb-vp-stop"
            onClick={stopVoice}
            aria-label="Stop recording"
            disabled={state === "REQUESTING_PERMISSION"}
          >
            <span aria-hidden>⏹</span> Stop
          </button>
        )}
        {isBusy(state) && (
          <button type="button" className="sb-vp-btn sb-vp-ghost" onClick={cancelVoice} aria-label="Cancel">
            Cancel
          </button>
        )}
        <button type="button" className="sb-vp-btn sb-vp-ghost" onClick={resetVoice} aria-label="Reset voice">
          Reset
        </button>
        <span className="sb-vp-status" aria-hidden>
          {STATE_LABEL[state]}
        </span>
      </div>

      {/* Live region — announces state changes, response + errors to AT. */}
      <div className="sb-vp-live" role="status" aria-live="polite">
        {STATE_LABEL[state]}
        {transcript ? ` · You: ${transcript}` : ""}
        {response ? ` · ${response}` : ""}
        {note ? ` · ${note}` : ""}
      </div>

      {transcript && <p className="sb-vp-transcript">“{transcript}”</p>}
      {response && <p className="sb-vp-response">{response}</p>}
      {note && <p className="sb-vp-note">{note}</p>}

      {/* LOCAL bid-draft preview — in-memory only, explicitly NOT submitted. */}
      {draft && (
        <div className="sb-vp-draft" role="note">
          <strong>Prepared bid draft (not submitted):</strong> hotel {draft.hotelId}
          {draft.pricePerNight != null ? ` @ ₹${draft.pricePerNight}/night` : ""}. Review and place it yourself on
          the hotel page — nothing has been submitted.
        </div>
      )}

      {/* Text fallback — always available (works with no mic / provider). */}
      <div className="sb-vp-fallback">
        <label className="sb-vp-lbl" htmlFor="sb-vp-text">
          Or type your request
        </label>
        <div className="sb-vp-fallback-row">
          <input
            id="sb-vp-text"
            className="sb-vp-input"
            type="text"
            value={textInput}
            maxLength={400}
            placeholder="e.g. show hotels in Manali"
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitText();
            }}
          />
          <button type="button" className="sb-vp-btn sb-vp-send" onClick={submitText} aria-label="Send request">
            Send
          </button>
        </div>
      </div>

      <style jsx>{`
        .sb-vp {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-width: 440px;
        }
        .sb-vp-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .sb-vp-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-height: 40px;
          min-width: 40px;
          padding: 0 14px;
          border-radius: 999px;
          border: 1px solid rgba(0, 0, 0, 0.12);
          background: #fff;
          font-size: 0.86rem;
          font-weight: 600;
          cursor: pointer;
        }
        .sb-vp-btn:disabled {
          opacity: 0.55;
          cursor: default;
        }
        .sb-vp-mic {
          background: #fff7ec;
          border-color: #eabb6a;
        }
        .sb-vp-stop {
          background: #fdecec;
          border-color: #e39a9a;
        }
        .sb-vp-ghost {
          background: transparent;
        }
        .sb-vp-send {
          background: #1f2937;
          color: #fff;
          border-color: #1f2937;
        }
        .sb-vp-status {
          font-size: 0.72rem;
          color: rgba(0, 0, 0, 0.55);
        }
        .sb-vp-live {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          white-space: nowrap;
        }
        .sb-vp-transcript {
          margin: 0;
          font-size: 0.86rem;
          font-style: italic;
          color: rgba(0, 0, 0, 0.72);
        }
        .sb-vp-response {
          margin: 0;
          font-size: 0.86rem;
          color: rgba(0, 0, 0, 0.82);
        }
        .sb-vp-note {
          margin: 0;
          font-size: 0.76rem;
          color: #a15c00;
        }
        .sb-vp-draft {
          font-size: 0.78rem;
          color: #334155;
          background: #f1f5f9;
          border: 1px solid #cbd5e1;
          border-radius: 10px;
          padding: 8px 10px;
        }
        .sb-vp-fallback {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .sb-vp-lbl {
          font-size: 0.7rem;
          font-weight: 600;
          color: rgba(0, 0, 0, 0.55);
        }
        .sb-vp-fallback-row {
          display: flex;
          gap: 6px;
        }
        .sb-vp-input {
          flex: 1 1 auto;
          min-height: 40px;
          padding: 0 12px;
          border-radius: 10px;
          border: 1px solid rgba(0, 0, 0, 0.16);
          font-size: 0.86rem;
        }
      `}</style>
    </div>
  );
}
