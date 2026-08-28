"use client";
// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-02 — isolated /hotels Voice container.
//
// FAIL-CLOSED FLAG (UNCHANGED from SB-01): this component renders NOTHING at all
// unless NEXT_PUBLIC_VOICE_AI_BETA === "1" (exact string). With the flag off the
// normal /hotels search is completely untouched — no session, no mic, no work.
//
// When enabled it:
//   • owns the per-session hotel-id ALLOWLIST + turn foundation (createVoiceSession);
//   • seeds the allowlist with the bounded (≤24) currently-visible hotel ids;
//   • builds the typed SB-01 dispatchVoiceAction() over the page's OWN setters +
//     router (OPEN_HOTEL allowlisted, PREPARE_BID_DRAFT local-only, no write path);
//   • mounts the SB-02 stateful VoicePanel (mic/state-machine/transcript/response/
//     text-fallback). SB-02 wires NO STT/LLM/TTS provider.
//
// Mounted ONLY on /hotels (never globally). Forwards NO customer auth token into
// any Voice handler (catalogue reads are anonymous).
// ─────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  createVoiceSession,
  makeVoiceActionDispatcher,
  isVoiceBetaEnabled,
  isValidHotelId,
  MAX_VISIBLE_HOTEL_IDS,
  type VoiceSession,
  type RouterShim,
} from "@/lib/voice";

interface LocalBidDraft {
  hotelId: string;
  pricePerNight: number | null;
}

// Client-only: the Voice panel owns the microphone + state machine, which only
// exist in the browser. `ssr:false` keeps it out of SSR (and out of any isolated
// module-level require of this container), so it loads only after hydration.
const VoicePanel = dynamic(() => import("./VoicePanel"), { ssr: false });

export interface VoiceSearchControlProps {
  setCity: (v: string) => void;
  setSearch: (v: string) => void;
  setSearchOpen: (v: boolean) => void;
  setSortBy: (v: "default" | "price-asc" | "price-desc" | "rating") => void;
  setSelectedStars: (v: Set<number>) => void;
  setFilterOpen?: (v: boolean) => void;
  router: RouterShim;
  /** The hotel ids currently visible on the page (bounded to ≤24 here). */
  visibleHotelIds?: string[];
}

export default function VoiceSearchControl(props: VoiceSearchControlProps) {
  // FAIL CLOSED: render nothing at all unless the beta flag is exactly "1".
  const enabled = isVoiceBetaEnabled();

  const sessionRef = useRef<VoiceSession | null>(null);
  if (enabled && !sessionRef.current) sessionRef.current = createVoiceSession();

  // LOCAL-ONLY bid draft preview (REREV-05): in-memory, never network/persisted.
  // Populated ONLY by the dispatcher AFTER it validates + allowlist-checks the
  // action, so a rejected draft can never populate the preview.
  const [draft, setDraft] = useState<LocalBidDraft | null>(null);

  // Bound + validate the visible ids ONCE per identity change.
  const visibleHotelIds = useMemo(() => {
    const raw = Array.isArray(props.visibleHotelIds) ? props.visibleHotelIds : [];
    return Array.from(new Set(raw.filter(isValidHotelId) as string[])).slice(0, MAX_VISIBLE_HOTEL_IDS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, (props.visibleHotelIds || []).join(",")]);

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
      // PREPARE_BID_DRAFT stays local-only — the dispatcher hands us the already
      // validated + allowlist-checked draft; we only mirror it into preview state.
      // NO network, NO persistence, NO submission.
      onPrepareBidDraft: (d) => setDraft({ hotelId: d.hotelId, pricePerNight: d.pricePerNight }),
    });
    // props are stable setters from the page; recompute only on enable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  if (!enabled || !dispatch || !sessionRef.current) return null;

  return (
    <div className="sb-voice-seam" aria-label="Voice search (beta)">
      <VoicePanel
        session={sessionRef.current}
        dispatch={dispatch}
        visibleHotelIds={visibleHotelIds}
        draft={draft}
        onClearDraft={() => setDraft(null)}
        // SB-04 R2 (SB04-R1-REREV-09): the interim NEXT_PUBLIC_VOICE_AI_REALTIME flag
        // is REMOVED. The realtime + gateway path is structurally reachable whenever
        // the outer BETA gate is on, but stays fully DORMANT and fails closed at the
        // SERVER: the same-origin /api/voice/session broker returns 503 unless the
        // gateway URL + signing/issuer/audience env are all configured, and the
        // gateway itself refuses every session unless VOICE_AI_RUNTIME_ENABLED === "1"
        // with valid provider/security config. With nothing configured (today) the
        // broker 503s and VoicePanel uses the SB-02 text/mic path. So the effective
        // gate is: BETA (UI) AND RUNTIME_ENABLED + valid config (server) — no public
        // client flag can activate it.
        realtime
      />
      <style jsx>{`
        .sb-voice-seam {
          display: block;
          margin-top: 8px;
        }
      `}</style>
    </div>
  );
}
