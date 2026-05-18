"use client";
// v138 — Tutorial system foundation.
// v140.1 — auth-aware seen-flag policy.
//
// Single source of truth for the 3-layer onboarding system:
//   Layer 1: Welcome Story (one-time, first launch)        — Phase 1
//   Layer 2: Per-page spotlight tours (driver.js)          — Phase 2
//   Layer 3: Floating "?" help button (always-on replay)   — Phase 4
//
// v140.1 — auth-aware "seen" rule per user spec:
//   • Anonymous users → tour shows on every NEW SESSION (fresh tab/
//     window). Within a session, in-memory state prevents repeat fire
//     when navigating back to the same page.
//   • Signed-in users → tour shows ONCE, then marked seen in
//     localStorage. Survives refreshes + tab close.
//   • Sign-in transition → any session-seen flags from the anonymous
//     phase are promoted to localStorage so users don't re-see tours
//     they already dismissed pre-login.
//
// Persistence keys:
//   sb_tutorial_lang        — KEEP across logout (device pref)
//   sb_tutorial_disabled    — KEEP across logout (device pref)
//   sb_tutorial_<key>_seen  — localStorage (signed-in only).
//                              Cleared on logout (next account = fresh tours).
// (No persistent key for anonymous users — tour always fires next session.)

import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { useAuth } from "@/lib/auth";

export type TutorialLang = "en" | "hi";
export type TutorialKey =
  | "welcome"
  | "home"
  | "hotel"
  | "bid"
  | "reels"
  | "flash"
  | "earn"
  // v141 — Phase 5: booking funnel completion
  | "explore"     // /hotels listing
  | "mybids"      // /my-bids
  | "bookings"    // /bookings
  // v142 — Phase 6: account + creator hub + support
  | "wallet"      // /wallet
  | "points"      // /points
  | "saved"       // /saved
  | "me"          // /me (IG-style profile)
  | "influencer"  // /influencer/dashboard (creator hub)
  | "verify"      // /verification
  | "complaints"; // /complaints

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
  "explore",
  "mybids",
  "bookings",
  "wallet",
  "points",
  "saved",
  "me",
  "influencer",
  "verify",
  "complaints",
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
  // v140.1 — depend on auth to gate persistence. We import inside the
  // module (no circular risk; auth never imports tutorial-store).
  const { user } = useAuth();
  const prevUserRef = useRef<typeof user>(null);

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
    explore: false,
    mybids: false,
    bookings: false,
    wallet: false,
    points: false,
    saved: false,
    me: false,
    influencer: false,
    verify: false,
    complaints: false,
  });
  const [active, setActive] = useState<TutorialKey | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // ── Hydrate from localStorage once on mount ────────────────────────────
  // For anonymous users we DELIBERATELY skip reading localStorage so the
  // tour fires fresh each session. (sessionStorage is read instead to
  // dedup within the same tab.) For signed-in users we read localStorage
  // as before.
  useEffect(() => {
    try {
      setLangState(detectInitialLang());
      setDisabledState(localStorage.getItem("sb_tutorial_disabled") === "1");
      const nextSeen = { ...seenMap };
      const isSignedIn = !!user;
      TUTORIAL_KEYS.forEach((k) => {
        if (isSignedIn) {
          nextSeen[k] = localStorage.getItem(seenKey(k)) === "1";
        } else {
          // Anonymous: only same-session dedup via sessionStorage.
          nextSeen[k] = sessionStorage.getItem(`${seenKey(k)}_session`) === "1";
        }
      });
      setSeenMap(nextSeen);
    } catch {}
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── v140.1 — Sign-in transition: promote any session-seen flags to
  // localStorage so the user doesn't re-see tours they already dismissed
  // pre-login. Triggered the moment user goes from null → signed in.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const wasAnon = !prevUserRef.current;
    const isNowSignedIn = !!user;
    if (wasAnon && isNowSignedIn) {
      try {
        const nextSeen = { ...seenMap };
        TUTORIAL_KEYS.forEach((k) => {
          const sessionFlag = sessionStorage.getItem(`${seenKey(k)}_session`) === "1";
          const lsFlag      = localStorage.getItem(seenKey(k)) === "1";
          // Use either source — whichever says "seen" wins. Promote to LS.
          const seen = sessionFlag || lsFlag;
          if (seen) {
            localStorage.setItem(seenKey(k), "1");
            nextSeen[k] = true;
          } else {
            nextSeen[k] = false;
          }
        });
        setSeenMap(nextSeen);
      } catch {}
    }
    prevUserRef.current = user;
  }, [user]);

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
        explore: false, mybids: false, bookings: false,
        wallet: false, points: false, saved: false, me: false,
        influencer: false, verify: false, complaints: false,
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
    try {
      if (user) {
        // Signed-in → persist forever
        localStorage.setItem(seenKey(k), "1");
      } else {
        // Anonymous → session-only dedup so tour doesn't repeat within
        // the same tab when user navigates back to a previously-seen
        // page. Next session (new tab/refresh) → tour fires again.
        sessionStorage.setItem(`${seenKey(k)}_session`, "1");
      }
    } catch {}
  }, [user]);

  const resetSeen = useCallback((k: TutorialKey) => {
    setSeenMap((prev) => ({ ...prev, [k]: false }));
    try {
      localStorage.removeItem(seenKey(k));
      sessionStorage.removeItem(`${seenKey(k)}_session`);
    } catch {}
  }, []);

  const resetAllSeen = useCallback(() => {
    const cleared = TUTORIAL_KEYS.reduce((acc, k) => {
      acc[k] = false;
      return acc;
    }, {} as Record<TutorialKey, boolean>);
    setSeenMap(cleared);
    try {
      TUTORIAL_KEYS.forEach((k) => {
        localStorage.removeItem(seenKey(k));
        sessionStorage.removeItem(`${seenKey(k)}_session`);
      });
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
