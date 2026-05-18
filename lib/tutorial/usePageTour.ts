"use client";
// v139 — Per-page tour hook (Tutorial Layer 2).
//
// Drop this hook at the top of any page component to auto-fire a
// driver.js spotlight tour on first visit:
//
//   usePageTour("home", HOME_STEPS, { delayMs: 900 });
//
// The hook handles all skip logic:
//   • disabled (master kill-switch)            → never fires
//   • already-seen flag                        → never fires
//   • welcome story active                     → waits, then fires when dismissed
//   • already-active tour (this or another)    → never fires
//   • first selector not on page yet           → polls 1.5s, gives up gracefully
//
// On tour completion (or Skip), markSeen() is called automatically.
//
// driver.js v1.4 docs: https://driverjs.com/docs/

import { useEffect, useRef } from "react";
import { driver, type Driver } from "driver.js";
import { useTutorial, type TutorialKey } from "./tutorial-store";
import { useLocalisedSteps, type TourStep } from "./tutorial-content";

export type UsePageTourOptions = {
  /** ms to wait after mount before firing — gives DOM time to render. Default 900ms. */
  delayMs?: number;
  /** Force fire even if seen — useful for the Phase-4 "?" help button replay. */
  force?: boolean;
  /** Disable autofire — caller wants only programmatic replay. */
  manual?: boolean;
};

export function usePageTour(
  key: TutorialKey,
  stepsKey: string,
  options: UsePageTourOptions = {},
) {
  const { hydrated, disabled, isSeen, markSeen, active, setActive, lang } = useTutorial();
  const localisedSteps = useLocalisedSteps(stepsKey, lang);
  const driverRef = useRef<Driver | null>(null);
  const polledRef = useRef(false);

  useEffect(() => {
    if (!hydrated) return;
    if (options.manual) return;
    if (disabled && !options.force) return;
    if (!options.force && isSeen(key)) return;
    if (active && active !== key) return; // another tour running — welcome / different page

    // If welcome story is still open, defer until it closes.
    // (The welcome story sets active=null on dismiss; we re-run via deps.)
    if (active === "welcome") return;

    if (!localisedSteps || localisedSteps.length === 0) return;
    if (polledRef.current) return; // never poll twice for the same mount

    polledRef.current = true;

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    // Poll for the first selector — pages with async data may still be
    // mounting their CTAs. Give up gracefully after ~1.5s.
    const tryStart = (attempt = 0) => {
      if (cancelled) return;
      const firstSel = localisedSteps[0]?.element;
      const found = firstSel ? document.querySelector(firstSel) : null;
      if (!found) {
        if (attempt > 6) return; // ~1.5s @ 250ms intervals — page just isn't ready
        pollTimer = setTimeout(() => tryStart(attempt + 1), 250);
        return;
      }
      start();
    };

    const start = () => {
      if (cancelled) return;
      try {
        const drv = driver({
          showProgress: true,
          animate: true,
          smoothScroll: true,
          allowKeyboardControl: true,
          overlayOpacity: 0.62,
          stagePadding: 6,
          stageRadius: 14,
          popoverClass: "sb-driver-popover",
          progressText: "{{current}} / {{total}}",
          nextBtnText: lang === "hi" ? "Aage →" : "Next →",
          prevBtnText: lang === "hi" ? "← Pichla" : "← Back",
          doneBtnText: lang === "hi" ? "Ho gaya ✨" : "Got it ✨",
          steps: localisedSteps.map((s) => ({
            element: s.element,
            popover: {
              title: s.title,
              description: s.description,
              side: s.side || "bottom",
              align: s.align || "center",
            },
          })),
          onDestroyed: () => {
            markSeen(key);
            setActive(null);
            driverRef.current = null;
          },
          onCloseClick: () => {
            // X button — same effect as Skip
            try { driverRef.current?.destroy(); } catch {}
          },
        });
        driverRef.current = drv;
        setActive(key);
        drv.drive();
      } catch {
        // driver.js failed — bail silently, never block the page
        polledRef.current = false;
      }
    };

    const initialTimer = setTimeout(() => tryStart(0), options.delayMs ?? 900);

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      clearTimeout(initialTimer);
      // If user navigates away mid-tour, destroy the driver.
      try { driverRef.current?.destroy(); } catch {}
      driverRef.current = null;
      polledRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, disabled, active, key, lang, options.force, options.manual]);
}
