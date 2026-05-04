"use client";
// ═══════════════════════════════════════════════════════════════════════════
// Global reel-sound store (React Context — no extra dependency)
// ───────────────────────────────────────────────────────────────────────────
// Spec parity with the zustand `useSoundStore` shape requested by the brief:
//   - isMuted: boolean  (defaults true; required by mobile autoplay policy)
//   - toggleMute(): void
//   - setMuted(m): void
// Plus:
//   - hasInteracted — true once the user has done their first mute/unmute,
//     so the "🔇 Tap to unmute" first-load overlay only shows once per device.
// All preferences persist in localStorage (sb_reel_mute, sb_reel_interacted).
//
// IMPORTANT: every reel video reads `isMuted` from this store, so flipping
// state in one reel propagates to every other reel + the right-rail mute
// button immediately.
// ═══════════════════════════════════════════════════════════════════════════
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type SoundCtx = {
  isMuted: boolean;
  hasInteracted: boolean;
  /**
   * Web-Audio gain multiplier applied on top of the native HTMLMediaElement
   * volume (which caps at 1.0). 1.0 = unchanged, >1 = amplified.
   */
  gain: number;
  toggleMute: () => void;
  setMuted: (m: boolean) => void;
  setGain: (g: number) => void;
  markInteracted: () => void;
};

const DEFAULT_GAIN = 1.8;

const Ctx = createContext<SoundCtx>({
  isMuted: true,
  hasInteracted: false,
  gain: DEFAULT_GAIN,
  toggleMute: () => {},
  setMuted: () => {},
  setGain: () => {},
  markInteracted: () => {},
});

const LS_MUTE = "sb_reel_mute";
const LS_INTERACTED = "sb_reel_interacted";
const LS_GAIN = "sb_reel_gain";

export function SoundProvider({ children }: { children: ReactNode }) {
  // SSR-safe: always start muted (browsers require muted for autoplay).
  const [isMuted, setMutedState] = useState(true);
  const [hasInteracted, setHasInteractedState] = useState(false);
  const [gain, setGainState] = useState<number>(DEFAULT_GAIN);

  // Hydrate from localStorage after mount
  useEffect(() => {
    try {
      const m = localStorage.getItem(LS_MUTE);
      if (m === "0") setMutedState(false);
      if (localStorage.getItem(LS_INTERACTED) === "1") setHasInteractedState(true);
      const g = parseFloat(localStorage.getItem(LS_GAIN) || "");
      if (!Number.isNaN(g) && g >= 0 && g <= 4) setGainState(g);
    } catch {}
  }, []);

  const setGain = useCallback((g: number) => {
    const clamped = Math.max(0, Math.min(4, g));
    setGainState(clamped);
    try { localStorage.setItem(LS_GAIN, String(clamped)); } catch {}
  }, []);

  const persist = useCallback((muted: boolean) => {
    try {
      localStorage.setItem(LS_MUTE, muted ? "1" : "0");
      localStorage.setItem(LS_INTERACTED, "1");
    } catch {}
  }, []);

  const setMuted = useCallback((m: boolean) => {
    setMutedState(m);
    setHasInteractedState(true);
    persist(m);
  }, [persist]);

  const toggleMute = useCallback(() => {
    setMutedState((m) => {
      const next = !m;
      persist(next);
      return next;
    });
    setHasInteractedState(true);
  }, [persist]);

  const markInteracted = useCallback(() => {
    setHasInteractedState(true);
    try { localStorage.setItem(LS_INTERACTED, "1"); } catch {}
  }, []);

  return (
    <Ctx.Provider value={{ isMuted, hasInteracted, gain, toggleMute, setMuted, setGain, markInteracted }}>
      {children}
    </Ctx.Provider>
  );
}

export const useSoundStore = () => useContext(Ctx);
