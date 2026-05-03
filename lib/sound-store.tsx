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
  toggleMute: () => void;
  setMuted: (m: boolean) => void;
  markInteracted: () => void;
};

const Ctx = createContext<SoundCtx>({
  isMuted: true,
  hasInteracted: false,
  toggleMute: () => {},
  setMuted: () => {},
  markInteracted: () => {},
});

const LS_MUTE = "sb_reel_mute";
const LS_INTERACTED = "sb_reel_interacted";

export function SoundProvider({ children }: { children: ReactNode }) {
  // SSR-safe: always start muted (browsers require muted for autoplay).
  const [isMuted, setMutedState] = useState(true);
  const [hasInteracted, setHasInteractedState] = useState(false);

  // Hydrate from localStorage after mount
  useEffect(() => {
    try {
      const m = localStorage.getItem(LS_MUTE);
      if (m === "0") setMutedState(false);
      if (localStorage.getItem(LS_INTERACTED) === "1") setHasInteractedState(true);
    } catch {}
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
    <Ctx.Provider value={{ isMuted, hasInteracted, toggleMute, setMuted, markInteracted }}>
      {children}
    </Ctx.Provider>
  );
}

export const useSoundStore = () => useContext(Ctx);
