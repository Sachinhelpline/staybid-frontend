"use client";
// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-01 — isolated /hotels UI seam.
//
// This packet builds the INTEGRATION SEAM ONLY. There is NO microphone, NO STT,
// NO model, NO TTS, NO provider here — those are future packets. The control:
//   • is DISABLED by default and mounts nothing unless NEXT_PUBLIC_VOICE_AI_BETA
//     === "1" (fail closed) — so the normal /hotels search is untouched;
//   • owns a per-session hotel-id allowlist + turn foundation (createVoiceSession);
//   • wires the typed dispatchVoiceAction() to the page's OWN setters + router.
//
// It is mounted ONLY on /hotels (never globally in app/layout.tsx). It forwards
// NO customer auth token into any Voice handler (catalogue reads are anonymous).
// ─────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from "react";
import {
  createVoiceSession,
  makeVoiceActionDispatcher,
  isVoiceBetaEnabled,
  type VoiceSession,
  type RouterShim,
} from "@/lib/voice";

export interface VoiceSearchControlProps {
  setCity: (v: string) => void;
  setSearch: (v: string) => void;
  setSearchOpen: (v: boolean) => void;
  setSortBy: (v: "default" | "price-asc" | "price-desc" | "rating") => void;
  setSelectedStars: (v: Set<number>) => void;
  setFilterOpen?: (v: boolean) => void;
  router: RouterShim;
}

export default function VoiceSearchControl(props: VoiceSearchControlProps) {
  // FAIL CLOSED: render nothing at all unless the beta flag is exactly "1".
  const enabled = isVoiceBetaEnabled();

  const sessionRef = useRef<VoiceSession | null>(null);
  if (enabled && !sessionRef.current) sessionRef.current = createVoiceSession();

  const [draftNote, setDraftNote] = useState<string | null>(null);

  const dispatch = useMemo(() => {
    if (!enabled || !sessionRef.current) return null;
    const session = sessionRef.current;
    return makeVoiceActionDispatcher({
      setCity: props.setCity,
      setSearch: props.setSearch,
      setSearchOpen: props.setSearchOpen,
      setSortBy: props.setSortBy,
      setSelectedStars: props.setSelectedStars,
      setFilterOpen: props.setFilterOpen,
      router: props.router,
      isHotelAllowlisted: (id: string) => session.hasHotelId(id),
      onPrepareBidDraft: (draft) =>
        // LOCAL preview state only — nothing is submitted, paid, or persisted.
        setDraftNote(`Draft ready: ${draft.hotelId}${draft.pricePerNight != null ? ` @ ₹${draft.pricePerNight}` : ""}`),
    });
    // props are stable setters from the page; intentionally recompute only on enable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  if (!enabled || !dispatch) return null;

  return (
    <div className="sb-voice-seam" aria-label="Voice search (beta)">
      <button
        type="button"
        className="sb-voice-seam-btn"
        // No mic/STT in this packet — the seam routes a typed action through the
        // same validated dispatcher a future provider will use.
        onClick={() => dispatch({ type: "FOCUS_SEARCH" })}
        title="Voice search (beta)"
      >
        <span aria-hidden>🎙️</span>
        <span>Voice search</span>
        <span className="sb-voice-seam-tag">beta</span>
      </button>
      {draftNote && <span className="sb-voice-seam-note">{draftNote}</span>}
      <style jsx>{`
        .sb-voice-seam {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .sb-voice-seam-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-height: 40px;
          padding: 0 14px;
          border-radius: 999px;
          border: 1px solid rgba(0, 0, 0, 0.12);
          background: #fff;
          font-size: 0.86rem;
          font-weight: 600;
          cursor: pointer;
        }
        .sb-voice-seam-tag {
          font-size: 0.62rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #b26a00;
        }
        .sb-voice-seam-note {
          font-size: 0.72rem;
          color: rgba(0, 0, 0, 0.6);
        }
      `}</style>
    </div>
  );
}
