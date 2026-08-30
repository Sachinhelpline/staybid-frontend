"use client";
// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-01A — minimal floating orb (the ONLY default UX).
//
// Renders NOTHING unless the feature is enabled AND a supported page is the
// authoritative registration. When it renders, it is ONLY a small floating
// button (the "orb"):
//   • NO panel, NO transcript UI, NO result UI, NO modal/drawer/bottom-sheet;
//   • the existing StayBid screen stays fully visible + usable behind it;
//   • NO microphone permission is requested before explicit activation (and
//     LIVE-AI-01A does not activate STT/TTS/WebRTC at all);
//   • accessibility uses a non-visible aria-label + an aria-live status;
//   • component-scoped styling only.
//
// The orb shows a minimal state (idle/listening/processing/speaking/error/
// sleep). Tapping it toggles activation on the global session.
// ─────────────────────────────────────────────────────────────────────────
import { useLiveAi, type OrbState } from "./LiveAiProvider";

// REV-14: LIVE-AI-01A has NO microphone/STT. The reachable states (sleep, idle)
// must NOT claim "listening". Accurate language only until real audio capture
// exists in a future authorized stage.
const STATE_LABEL: Record<OrbState, string> = {
  idle: "StayBid AI ready",
  listening: "StayBid AI listening",
  processing: "StayBid AI is thinking",
  speaking: "StayBid AI is speaking",
  error: "StayBid AI hit a problem",
  sleep: "StayBid AI is asleep — tap to activate",
};

export function LiveAiShell() {
  const { enabled, registeredPageId, activated, orbState, toggle } = useLiveAi();

  // Render ONLY with the feature enabled AND a supported authoritative page.
  // On an unsupported route there is no registration, so no orb (and no
  // action authority) exists.
  if (!enabled || !registeredPageId) return null;

  const label = STATE_LABEL[orbState] || STATE_LABEL.sleep;

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
      <style jsx>{`
        .sb-liveai-orb-root {
          position: fixed;
          left: 16px;
          bottom: calc(88px + env(safe-area-inset-bottom, 0px));
          z-index: 60;
          pointer-events: none;
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
        .sb-liveai-orb:hover {
          transform: translateY(-1px);
        }
        .sb-liveai-orb:active {
          transform: scale(0.96);
        }
        .sb-liveai-orb-core {
          width: 16px;
          height: 16px;
          border-radius: 999px;
          background: rgba(60, 44, 12, 0.72);
        }
        /* Minimal per-state affordance (still just the orb — no panel). */
        .sb-liveai-sleep {
          filter: saturate(0.65) brightness(0.96);
          opacity: 0.9;
        }
        .sb-liveai-idle,
        .sb-liveai-listening {
          box-shadow: 0 0 0 4px rgba(242, 198, 80, 0.28), 0 6px 18px rgba(60, 44, 12, 0.28);
        }
        .sb-liveai-processing .sb-liveai-orb-core {
          animation: sb-liveai-pulse 1s ease-in-out infinite;
        }
        .sb-liveai-speaking .sb-liveai-orb-core {
          animation: sb-liveai-pulse 0.6s ease-in-out infinite;
        }
        .sb-liveai-error {
          border-color: rgba(190, 70, 70, 0.7);
          background: radial-gradient(circle at 32% 28%, #ffdede, #e88 46%, #b45);
        }
        @keyframes sb-liveai-pulse {
          0%,
          100% {
            transform: scale(0.8);
            opacity: 0.6;
          }
          50% {
            transform: scale(1.15);
            opacity: 1;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .sb-liveai-orb,
          .sb-liveai-orb-core {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>
    </div>
  );
}

export default LiveAiShell;
