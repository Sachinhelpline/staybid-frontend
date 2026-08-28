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
  createGatewayClient,
  createGatewayTurnRouter,
  createAttemptOwner,
  voiceReduce,
  isBusy,
  INITIAL_VOICE_STATE,
  detectSupport,
  type VoiceState,
  type VoiceServerStatus,
  type VoiceSession,
  type AudioCapture,
  type GatewayClient,
  type GatewayTurnRouter,
  type VoiceInteraction,
  type DispatchOutcome,
} from "@/lib/voice";
// The native WebRTC media client is imported directly (not via the barrel) so the
// barrel stays free of provider naming — see lib/voice/index.ts.
import { createWebrtcSession, type WebrtcSession } from "@/lib/voice/openai-webrtc";

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
  /**
   * SB-04: opt into the OpenAI-Realtime + gateway path (native WebRTC media +
   * gateway control socket). DEFAULT false — the SB-02 text/mic-demo path is
   * unchanged. The realtime path fails closed when the same-origin broker is
   * unconfigured (503), so this stays dormant until a future preview enables it.
   */
  realtime?: boolean;
}

/** Map a provider-neutral gateway status to the local UX state (realtime path). */
const STATUS_TO_STATE: Record<VoiceServerStatus, VoiceState> = {
  listening: "LISTENING",
  transcribing: "TRANSCRIBING",
  thinking: "THINKING",
  executing: "EXECUTING_ACTION",
  speaking: "SPEAKING",
  interrupted: "INTERRUPTED",
  cancelled: "CANCELLED",
  idle: "IDLE",
};

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

export default function VoicePanel({
  session,
  dispatch,
  visibleHotelIds,
  draft,
  onClearDraft,
  realtime = false,
}: VoicePanelProps) {
  const [state, setState] = useState<VoiceState>(INITIAL_VOICE_STATE);
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [textInput, setTextInput] = useState("");

  const interactionRef = useRef<VoiceInteraction | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  // SB-04 realtime refs (created lazily, only when the realtime path is used).
  const webrtcRef = useRef<WebrtcSession | null>(null);
  const gatewayRef = useRef<GatewayClient | null>(null);
  const routerRef = useRef<GatewayTurnRouter | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // R2/R3 (SB04-R2-REREV-09/11): the component attempt-ownership STATE MACHINE —
  // the tested `createAttemptOwner` from lib/voice (VoicePanel delegates the actual
  // runtime decision to that exact tested code). Every realtime start begins a new
  // attempt; a Stop / re-start / teardown invalidates, so an in-flight start whose
  // attempt is superseded aborts silently — it never enters LISTENING and never
  // tears down the NEWER attempt's resources.
  const attemptOwnerRef = useRef<ReturnType<typeof createAttemptOwner> | null>(null);
  if (!attemptOwnerRef.current) attemptOwnerRef.current = createAttemptOwner();

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
      teardownRealtime();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tear down every SB-04 realtime resource (WebRTC media, control socket, turn
  // router). Idempotent; a stale gateway frame after this can never mutate the UI.
  function teardownRealtime() {
    // Invalidate any in-flight realtime start (REREV-07/09) via the tested owner.
    attemptOwnerRef.current?.invalidate();
    if (gatewayRef.current) {
      gatewayRef.current.dispose();
      gatewayRef.current = null;
    }
    if (webrtcRef.current) {
      webrtcRef.current.dispose();
      webrtcRef.current = null;
    }
    if (routerRef.current) {
      routerRef.current.reset();
      routerRef.current = null;
    }
    if (audioRef.current) {
      try {
        (audioRef.current as any).srcObject = null;
      } catch {
        /* no-op */
      }
    }
  }

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
    // Realtime path: Stop ends the live Voice session (closes the socket + media).
    // A single mic path owns the mic at a time — realtime uses WebRTC, the SB-02
    // demo uses MediaRecorder; the two never run together (one Start handler wins).
    if (realtime) {
      const activeTurn = routerRef.current?.activeTurnId() ?? -1;
      if (gatewayRef.current && activeTurn >= 0) gatewayRef.current.cancelTurn(activeTurn);
      if (gatewayRef.current) gatewayRef.current.closeSession();
      if (routerRef.current) routerRef.current.cancel();
      teardownRealtime();
      apply("STOP");
      apply("CLEANUP");
      return;
    }
    // Drive the post-recording transition from the capture promise resolution.
    if (captureRef.current) captureRef.current.stop();
  }

  function cancelVoice() {
    apply("CANCEL"); // → CANCELLED
    if (captureRef.current) captureRef.current.cancel();
    // REREV-03 + R1-NEW-02: invalidate any in-flight interaction turn AND release
    // the active submission slot so a fresh submission can start.
    if (interactionRef.current) interactionRef.current.cancel();
    // SB-04: signal the gateway to cancel the active turn (capture the id BEFORE
    // the local cancel bumps it to no-turn), invalidate the router so a later
    // frame is stale, then tear the media/socket down.
    const activeTurn = routerRef.current?.activeTurnId() ?? -1;
    if (gatewayRef.current && activeTurn >= 0) gatewayRef.current.cancelTurn(activeTurn);
    if (routerRef.current) routerRef.current.cancel();
    teardownRealtime();
    setTranscript("");
    apply("CLEANUP"); // → IDLE
  }

  function resetVoice() {
    apply("RESET"); // → RESET
    if (captureRef.current) captureRef.current.dispose();
    captureRef.current = null;
    if (interactionRef.current) interactionRef.current.reset();
    teardownRealtime();
    setTranscript("");
    setResponse(null);
    setNote(null);
    setTextInput("");
    onClearDraft();
    apply("CLEANUP"); // → IDLE
  }

  // ── SB-04 realtime path (native WebRTC media + gateway control socket) ──────
  // Dormant by default (realtime === false). When enabled AND the same-origin
  // broker is configured, it: acquires the mic (gesture), builds a WebRTC offer,
  // exchanges it via /api/voice/session, opens the ONE control socket, and routes
  // validated control frames through the SB-01 dispatcher with turn ownership.
  async function startRealtimeVoice() {
    if (isBusy(state)) return;
    if (typeof window === "undefined") return;
    const t = voiceReduce(state, state === "ERROR" ? "RETRY" : "START");
    if (t.state !== "REQUESTING_PERMISSION") return;
    setResponse(null);
    setNote(null);
    setState(t.state);
    teardownRealtime(); // invalidates prior attempts; begin the NEW one
    const attempt = attemptOwnerRef.current!.begin();
    const superseded = () => attempt.superseded();

    const webrtc = createWebrtcSession();
    webrtcRef.current = webrtc;
    const started = await webrtc.start({
      onTranscript: (line) => setTranscript(line.text),
      onRemoteAudio: (stream) => {
        if (audioRef.current) {
          try {
            (audioRef.current as any).srcObject = stream;
          } catch {
            /* no-op */
          }
        }
      },
    });
    // A newer attempt / Stop took over during mic acquisition → drop THIS webrtc
    // (never the newer attempt's ref) and abort silently.
    if (superseded()) {
      webrtc.dispose();
      return;
    }
    if (!started || !started.ok) {
      setNote("Couldn't start the microphone. You can type your request instead.");
      apply("PERMISSION_DENIED");
      teardownRealtime();
      return;
    }

    const router = createGatewayTurnRouter({
      session,
      dispatch,
      hooks: {
        onStatus: (status) => setState(STATUS_TO_STATE[status]),
        onTranscript: (line) => setTranscript(line.text),
        onResult: (r) => setResponse(r.text),
        onAction: (outcome) => {
          if (outcome.ok) setResponse(`Applied: ${outcome.action}`);
          else setNote(`That action was not allowed (${outcome.reason}).`);
        },
        onTurnComplete: () => setState("IDLE"),
        onError: (code) => {
          setNote(`Voice error (${code}).`);
          setState("ERROR");
        },
      },
    });
    routerRef.current = router;
    router.beginTurn();

    const gateway = createGatewayClient(
      {
        fetchImpl: (path, init) => window.fetch(path, init as any) as any,
        WebSocketCtor: (url, protocols) => new WebSocket(url, protocols) as any,
      },
      {
        // R4 (SB04-R3-REREV-09): control frames are ATTEMPT-BOUND. This callback
        // belongs to THIS attempt's GatewayClient, so it (a) drops every frame the
        // moment the attempt is superseded and (b) routes ONLY to the router
        // captured for this attempt (`router`, a closure local) — never to a newer
        // attempt's router via routerRef.current. A delayed frame from old attempt
        // A can therefore never mutate attempt B's router/UI/allowlist/turn.
        onServerControl: (msg) => {
          if (superseded()) return;
          router.handleServerControl(msg);
        },
        // R3 (SB04-R2-REREV-09): losing the authoritative control socket after the
        // session is live is FATAL. If THIS attempt is still current, tear down all
        // realtime resources (media/tracks/remote audio/gateway) and surface an error;
        // a STALE (older-generation) socket close never tears down a newer attempt.
        onClose: () => {
          if (superseded()) return;
          teardownRealtime();
          setNote("Voice connection closed. You can type your request instead.");
          setState("ERROR");
        },
        onError: () => {
          if (superseded()) return;
          teardownRealtime();
          setNote("Voice connection error. You can type your request instead.");
          setState("ERROR");
        },
      },
    );
    gatewayRef.current = gateway;
    // R3 (REREV-10): forward the bounded on-screen hotel ids so the gateway can
    // server-verify them and let the model resolve "the second one" without a search.
    const res = await gateway.start(started.offerSdp, visibleHotelIds);
    if (superseded()) {
      // A newer attempt / Stop took over during the broker exchange.
      gateway.dispose();
      webrtc.dispose();
      return;
    }
    if (!res.ok) {
      setNote(
        res.code === "broker_failed"
          ? "Voice assistant isn't connected in this beta yet."
          : "Couldn't connect the voice assistant. You can type instead.",
      );
      apply("PERMISSION_DENIED");
      teardownRealtime();
      return;
    }
    // LISTENING only when the answer is applied to the CURRENT attempt (a late /
    // superseded answer returns false and never enters LISTENING). Double-guard:
    // the WebRTC session re-checks ownership internally AND the component generation
    // must still be current.
    const applied = await webrtc.acceptAnswer(res.broker.answerSdp);
    if (superseded()) {
      gateway.dispose();
      webrtc.dispose();
      return;
    }
    if (!applied) {
      setNote("Voice connection was interrupted. You can type your request instead.");
      apply("PERMISSION_DENIED");
      teardownRealtime();
      return;
    }
    setState("LISTENING");
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
      {/* SB-04: remote provider audio sink (realtime path). Muted/inert until a
          real WebRTC answer attaches a stream — no audio is ever persisted. */}
      {realtime && <audio ref={audioRef} autoPlay aria-hidden className="sb-vp-audio" />}
      <div className="sb-vp-row">
        {!listening ? (
          <button
            type="button"
            className="sb-vp-btn sb-vp-mic"
            onClick={realtime ? startRealtimeVoice : startVoice}
            aria-label="Start voice"
          >
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
        .sb-vp-audio {
          display: none;
        }
      `}</style>
    </div>
  );
}
