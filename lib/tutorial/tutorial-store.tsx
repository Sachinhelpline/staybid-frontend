"use client";
// v138 — Tutorial system foundation.
//
// Single source of truth for the 3-layer onboarding system:
//   Layer 1: Welcome Story (one-time, first launch)        — Phase 1 (current)
//   Layer 2: Per-page spotlight tours (driver.js)          — Phase 2
//   Layer 3: Floating "?" help button (always-on replay)   — Phase 4
//
// The provider exposes:
//   • language (en | hi) with persistent localStorage backing
//   • per-section seen-flags (welcome, home, hotel, bid, reels, flash, earn)
//   • master kill-switch (sb_tutorial_disabled)
//   • markSeen / resetSeen / startTour / replayAll helpers
//
// Persistence keys (per CLAUDE.md v132.14 logout contract):
//   sb_tutorial_lang        — KEEP across logout (device pref)
//   sb_tutorial_disabled    — KEEP across logout (device pref)
//   sb_tutorial_<key>_seen  — cleared on logout (next account = fresh tour)
//
// The two device-pref keys are added to lib/auth.tsx KEEP allow-list in v138.

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";

export type TutorialLang = "en" | "hi";
export type TutorialKey =
  | "welcome"
  | "home"
  | "hotel"
  | "bid"
  | "reels"
  | "flash"
  | "earn";

type TutorialCtx = {
  /** Current language preference. Default = device language fallback. */
  lang: TutorialLang;
  setLang: (next: TutorialLang) => void;

  /** Master kill-switch — when true, no tour ever fires. */
  disabled: boolean;
  setDisabled: (next: boolean) => void;

  /** Has the user seen a particular tour yet? */
  isSeen: (key: TutorialKey) => boolean;

  /** Mark a tour as seen — sets sb_tutorial_<key>_seen = "1". */
  markSeen: (key: TutorialKey) => void;

  /** Reset a single tour (for the "Replay" CTA in /me drawer). */
  resetSeen: (key: TutorialKey) => void;

  /** Reset ALL tours — re-shows everything from scratch. */
  resetAllSeen: () => void;

  /** Currently active tour key (used by WelcomeStory + Phase-2 tours). */
  active: TutorialKey | null;
  setActive: (key: TutorialKey | null) => void;

  /** Imperative trigger — opens a tour if not seen & not disabled. */
  startTour: (key: TutorialKey, opts?: { force?: boolean }) => void;

  /** Replay any tour even if seen (for /me drawer "Replay" buttons). */
  replayTour: (key: TutorialKey) => void;

  /** Has the provider hydrated from localStorage yet? Prevents SSR flash. */
  hydrated: boolean;
};

const TutorialContext = createContext<TutorialCtx>({
  lang: "en",
  setLang: () => {},
  disabled: false,
  setDisabled: () => {},
  isSeen: () => false,
  markSeen: () => {},
  resetSeen: () => {},
  resetAllSeen: () => {},
  active: null,
  setActive: () => {},
  startTour: () => {},
  replayTour: () => {},
  hydrated: false,
});

const TUTORIAL_KEYS: TutorialKey[] = [
  "welcome",
  "home",
  "hotel",
  "bid",
  "reels",
  "flash",
  "earn",
];

const seenKey = (k: TutorialKey) => `sb_tutorial_${k}_seen`;

function detectInitialLang(): TutorialLang {
  if (typeof window === "undefined") return "en";
  try {
    const saved = localStorage.getItem("sb_tutorial_lang") as TutorialLang | null;
    if (saved === "en" || saved === "hi") return saved;
  } catch {}
  // Hindi fallback when the device language starts with "hi" (hi, hi-IN, etc.).
  try {
    const nav = (navigator.language || "en").toLowerCase();
    if (nav.startsWith("hi")) return "hi";
  } catch {}
  return "en";
}

export function TutorialProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<TutorialLang>("en");
  const [disabled, setDisabledState] = useState<boolean>(false);
  const [seenMap, setSeenMap] = useState<Record<TutorialKey, boolean>>({
    welcome: false,
    home: false,
    hotel: false,
    bid: false,
    reels: false,
    flash: false,
    earn: false,
  });
  const [active, setActive] = useState<TutorialKey | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // ── Hydrate from localStorage once on mount ────────────────────────────
  useEffect(() => {
    try {
      setLangState(detectInitialLang());
      setDisabledState(localStorage.getItem("sb_tutorial_disabled") === "1");
      const nextSeen = { ...seenMap };
      TUTORIAL_KEYS.forEach((k) => {
        nextSeen[k] = localStorage.getItem(seenKey(k)) === "1";
      });
      setSeenMap(nextSeen);
    } catch {}
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Cross-tab sync: language + disabled flag ───────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (e.key === "sb_tutorial_lang") {
        const v = e.newValue as TutorialLang | null;
        if (v === "en" || v === "hi") setLangState(v);
      } else if (e.key === "sb_tutorial_disabled") {
        setDisabledState(e.newValue === "1");
      } else if (e.key.startsWith("sb_tutorial_") && e.key.endsWith("_seen")) {
        // Re-hydrate seen flags
        const next = { ...seenMap };
        TUTORIAL_KEYS.forEach((k) => {
          try {
            next[k] = localStorage.getItem(seenKey(k)) === "1";
          } catch {}
        });
        setSeenMap(next);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Logout broadcast: reset seen-flags so re-login = fresh tour ────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onLogout = () => {
      setSeenMap({
        welcome: false, home: false, hotel: false,
        bid: false, reels: false, flash: false, earn: false,
      });
      setActive(null);
    };
    window.addEventListener("sb:logout", onLogout);
    return () => window.removeEventListener("sb:logout", onLogout);
  }, []);

  const setLang = useCallback((next: TutorialLang) => {
    setLangState(next);
    try { localStorage.setItem("sb_tutorial_lang", next); } catch {}
  }, []);

  const setDisabled = useCallback((next: boolean) => {
    setDisabledState(next);
    try {
      if (next) localStorage.setItem("sb_tutorial_disabled", "1");
      else localStorage.removeItem("sb_tutorial_disabled");
    } catch {}
  }, []);

  const isSeen = useCallback((k: TutorialKey) => seenMap[k] === true, [seenMap]);

  const markSeen = useCallback((k: TutorialKey) => {
    setSeenMap((prev) => ({ ...prev, [k]: true }));
    try { localStorage.setItem(seenKey(k), "1"); } catch {}
  }, []);

  const resetSeen = useCallback((k: TutorialKey) => {
    setSeenMap((prev) => ({ ...prev, [k]: false }));
    try { localStorage.removeItem(seenKey(k)); } catch {}
  }, []);

  const resetAllSeen = useCallback(() => {
    const cleared = TUTORIAL_KEYS.reduce((acc, k) => {
      acc[k] = false;
      return acc;
    }, {} as Record<TutorialKey, boolean>);
    setSeenMap(cleared);
    try {
      TUTORIAL_KEYS.forEach((k) => localStorage.removeItem(seenKey(k)));
    } catch {}
  }, []);

  const startTour = useCallback(
    (k: TutorialKey, opts?: { force?: boolean }) => {
      if (!hydrated) return;
      if (disabled && !opts?.force) return;
      if (seenMap[k] && !opts?.force) return;
      setActive(k);
    },
    [hydrated, disabled, seenMap],
  );

  const replayTour = useCallback((k: TutorialKey) => {
    resetSeen(k);
    setActive(k);
  }, [resetSeen]);

  return (
    <TutorialContext.Provider
      value={{
        lang, setLang,
        disabled, setDisabled,
        isSeen, markSeen, resetSeen, resetAllSeen,
        active, setActive,
        startTour, replayTour,
        hydrated,
      }}
    >
      {children}
    </TutorialContext.Provider>
  );
}

export const useTutorial = () => useContext(TutorialContext);
