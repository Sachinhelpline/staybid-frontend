"use client";
// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-02A — minimal floating orb (the ONLY default UX).
//
// Renders NOTHING unless the feature is enabled AND a supported page is the
// authoritative registration. When it renders, it is ONLY a small floating orb
// plus, when a provider turn is active, a bounded ONE-LINE composer / mic gesture
// and a single status line:
//   • NO panel, NO modal/drawer/bottom-sheet, NO transcript HISTORY, NO result UI;
//   • the existing StayBid screen stays fully visible + usable behind it;
//   • NO microphone permission is requested before the explicit mic gesture;
//   • accessibility uses a non-visible aria-label + an aria-live status;
//   • component-scoped styling only (one styled-jsx block).
// ─────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { useLiveAi, type OrbState } from "./LiveAiProvider";

const STATE_LABEL: Record<OrbState, string> = {
  idle: "StayBid AI ready",
  listening: "StayBid AI listening",
  processing: "StayBid AI is thinking",
  speaking: "StayBid AI is speaking",
  error: "StayBid AI hit a problem",
  sleep: "StayBid AI is asleep — tap to activate",
};

const MAX_COMPOSER_LEN = 200;

export function LiveAiShell() {
  const { enabled, providerEnabled, registeredPageId, activated, orbState, toggle, startProvider, submitText, bargeIn, resumeAudio, audioNeedsResume } = useLiveAi();
  const [draft, setDraft] = useState("");

  // Render ONLY with the feature enabled AND a supported authoritative page.
  if (!enabled || !registeredPageId) return null;

  const label = STATE_LABEL[orbState] || STATE_LABEL.sleep;
  // The composer/mic appear ONLY when the provider path is enabled AND the session
  // has been explicitly activated. The default UX stays the single orb.
  const showComposer = providerEnabled && activated;
  // NEW-02 — when the browser's autoplay policy has BLOCKED the answer audio, surface
  // a bounded, operable control so the user can hear the reply with one tap/keypress.
  const showResume = providerEnabled && activated && audioNeedsResume;
  const speaking = orbState === "speaking" || orbState === "processing";
  // REV-15 — the session is already busy capturing/processing (listening included):
  // the mic gesture acts as STOP, never opening a SECOND microphone session.
  const busy = speaking || orbState === "listening";

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    submitText(text.slice(0, MAX_COMPOSER_LEN));
    setDraft("");
  };

  return (
    <div className="sb-liveai-orb-root" data-live-ai-orb="1">
      {/* Non-visible live region — screen-reader status only, no visible panel. */}
      <span className="sb-liveai-sr" aria-live="polite">
        {label}
      </span>
      <button
        type="button"
        className={`sb-liveai-orb sb-liveai-${orbState}`}
        aria-label={label}
        aria-pressed={activated}
        onClick={toggle}
      >
        <span className="sb-liveai-orb-core" aria-hidden="true" />
      </button>

      {showComposer && (
        <div className="sb-liveai-bar" role="group" aria-label="StayBid AI quick ask">
          <span className="sb-liveai-status" aria-hidden="true">{label}</span>
          <input
            className="sb-liveai-input"
            type="text"
            inputMode="text"
            maxLength={MAX_COMPOSER_LEN}
            placeholder="Ask about these stays…"
            aria-label="Ask StayBid AI about the stays on screen"
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_COMPOSER_LEN))}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }}
          />
          <button type="button" className="sb-liveai-send" aria-label="Send" onClick={send}>➤</button>
          {/* The mic gesture is the ONLY place a microphone permission is requested. */}
          <button
            type="button"
            className="sb-liveai-mic"
            aria-label={busy ? "Stop" : "Speak"}
            onClick={() => { if (busy) bargeIn(); else startProvider("microphone"); }}
          >
            {busy ? "■" : "🎤"}
          </button>
        </div>
      )}

      {/* NEW-02 — the autoplay-blocked "tap to hear reply" control (operable + labelled). */}
      {showResume && (
        <button
          type="button"
          className="sb-liveai-resume"
          aria-label="Tap to hear the reply"
          onClick={() => resumeAudio()}
        >
          🔈 Tap to hear reply
        </button>
      )}

      <style jsx>{`
        .sb-liveai-orb-root {
          position: fixed;
          left: 16px;
          bottom: calc(88px + env(safe-area-inset-bottom, 0px));
          z-index: 60;
          pointer-events: none;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .sb-liveai-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }
        .sb-liveai-orb {
          pointer-events: auto;
          width: 48px;
          height: 48px;
          border-radius: 999px;
          border: 1px solid rgba(214, 175, 90, 0.55);
          background: radial-gradient(circle at 32% 28%, #fff5da, #f2c650 46%, #cf9a24);
          box-shadow: 0 6px 18px rgba(60, 44, 12, 0.28);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;
          -webkit-tap-highlight-color: transparent;
        }
        .sb-liveai-orb:hover { transform: translateY(-1px); }
        .sb-liveai-orb:active { transform: scale(0.96); }
        .sb-liveai-orb-core {
          width: 16px;
          height: 16px;
          border-radius: 999px;
          background: rgba(60, 44, 12, 0.72);
        }
        .sb-liveai-sleep { filter: saturate(0.65) brightness(0.96); opacity: 0.9; }
        .sb-liveai-idle,
        .sb-liveai-listening {
          box-shadow: 0 0 0 4px rgba(242, 198, 80, 0.28), 0 6px 18px rgba(60, 44, 12, 0.28);
        }
        .sb-liveai-processing .sb-liveai-orb-core { animation: sb-liveai-pulse 1s ease-in-out infinite; }
        .sb-liveai-speaking .sb-liveai-orb-core { animation: sb-liveai-pulse 0.6s ease-in-out infinite; }
        .sb-liveai-error {
          border-color: rgba(190, 70, 70, 0.7);
          background: radial-gradient(circle at 32% 28%, #ffdede, #e88 46%, #b45);
        }
        /* A single bounded input row with one status line only. */
        .sb-liveai-bar {
          pointer-events: auto;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          max-width: min(72vw, 360px);
          padding: 4px 6px;
          border-radius: 999px;
          border: 1px solid rgba(214, 175, 90, 0.5);
          background: rgba(255, 251, 240, 0.96);
          box-shadow: 0 6px 18px rgba(60, 44, 12, 0.22);
        }
        .sb-liveai-status {
          font-size: 11px;
          color: rgba(74, 56, 32, 0.72);
          white-space: nowrap;
          max-width: 96px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .sb-liveai-input {
          flex: 1 1 auto;
          min-width: 90px;
          border: none;
          background: transparent;
          font-size: 13px;
          color: #3c2c0c;
          outline: none;
          padding: 4px 2px;
        }
        .sb-liveai-send,
        .sb-liveai-mic {
          pointer-events: auto;
          border: none;
          background: transparent;
          cursor: pointer;
          font-size: 14px;
          line-height: 1;
          min-width: 28px;
          min-height: 28px;
          border-radius: 999px;
          color: #7a5a10;
        }
        .sb-liveai-send:active,
        .sb-liveai-mic:active { transform: scale(0.94); }
        /* NEW-02 — bounded, high-contrast, operable resume control. */
        .sb-liveai-resume {
          pointer-events: auto;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          min-height: 32px;
          max-width: min(60vw, 220px);
          padding: 4px 12px;
          border-radius: 999px;
          border: 1px solid rgba(214, 175, 90, 0.6);
          background: rgba(255, 251, 240, 0.98);
          box-shadow: 0 6px 18px rgba(60, 44, 12, 0.22);
          font-size: 12px;
          font-weight: 600;
          color: #7a5a10;
          white-space: nowrap;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .sb-liveai-resume:active { transform: scale(0.96); }
        @keyframes sb-liveai-pulse {
          0%, 100% { transform: scale(0.8); opacity: 0.6; }
          50% { transform: scale(1.15); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .sb-liveai-orb,
          .sb-liveai-orb-core { animation: none !important; transition: none !important; }
        }
      `}</style>
    </div>
  );
}

export default LiveAiShell;
