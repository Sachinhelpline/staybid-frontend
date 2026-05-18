"use client";
// v143 — Listens for imperative `triggerTour` calls from anywhere in
// the app and fires the matching driver.js tour.
//
// Why a separate mount component?
//   usePageTour is a hook tied to a page component's lifecycle. Modal/
//   drawer tours need to fire AFTER a user gesture (tap Negotiate, tap
//   a flash deal card) — not on page mount. The cleanest pattern is
//   for handlers to call triggerTour(key) which sets a pending-trigger
//   state on the store; this component (mounted once globally in
//   layout.tsx) watches that state and runs the same polling +
//   driver.js logic that usePageTour uses for page-level tours.
//
// On tour destroy: markSeen(key) is called automatically, setActive
// resets, and pendingTrigger clears. Standard skip-logic in
// triggerTour (disabled / seen / another tour active) is enforced at
// the store level — this component just handles the firing.

import { useEffect, useRef } from "react";
import { driver, type Driver } from "driver.js";
import { useTutorial } from "@/lib/tutorial/tutorial-store";
import { useLocalisedSteps } from "@/lib/tutorial/tutorial-content";

export function TutorialTriggerMount() {
  const {
    pendingTrigger, clearPendingTrigger,
    lang, markSeen, setActive,
  } = useTutorial();
  const driverRef = useRef<Driver | null>(null);
  const handledRef = useRef<string | null>(null);

  // Pull the steps for the currently-pending key. useLocalisedSteps
  // is called unconditionally to satisfy hook rules; returns null when
  // there's nothing pending.
  const stepsKey = pendingTrigger?.key ?? "";
  const localisedSteps = useLocalisedSteps(stepsKey, lang);

  useEffect(() => {
    if (!pendingTrigger) return;
    const handleKey = `${pendingTrigger.key}-${Date.now()}`;
    if (handledRef.current === pendingTrigger.key) return;
    if (!localisedSteps || localisedSteps.length === 0) {
      clearPendingTrigger();
      return;
    }

    handledRef.current = pendingTrigger.key;
    const key = pendingTrigger.key;
    const delayMs = pendingTrigger.opts.delayMs ?? 350;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const tryStart = (attempt = 0) => {
      if (cancelled) return;
      const firstSel = localisedSteps[0]?.element;
      const found = firstSel ? document.querySelector(firstSel) : null;
      if (!found) {
        if (attempt > 10) {
          // Modal didn't mount in expected window — abort, clear.
          clearPendingTrigger();
          handledRef.current = null;
          return;
        }
        pollTimer = setTimeout(() => tryStart(attempt + 1), 200);
        return;
      }
      start();
    };

    const advance = (drv: any, delta: 1 | -1) => {
      const currentIdx = typeof drv.getActiveIndex === "function" ? (drv.getActiveIndex() ?? 0) : 0;
      const targetIdx = currentIdx + delta;
      const targetStep = localisedSteps[targetIdx];
      if (!targetStep) {
        if (delta > 0) drv.moveNext();
        else drv.movePrevious();
        return;
      }
      try {
        window.dispatchEvent(new CustomEvent("sb:tour-prep", {
          detail: { key, fromIndex: currentIdx, toIndex: targetIdx, nextElement: targetStep.element },
        }));
      } catch {}
      const startedAt = Date.now();
      const tryMove = () => {
        if (cancelled) return;
        const found = document.querySelector(targetStep.element) as HTMLElement | null;
        const elapsed = Date.now() - startedAt;
        if (found || elapsed > 1200) {
          // v144 — scroll the element's nearest scrollable ancestor
          // into view BEFORE driver.js measures. Critical for modal/
          // drawer interiors where driver.js's smoothScroll only
          // affects the window — which a `position: fixed` modal
          // ignores. Calling scrollIntoView on the element delegates
          // to the modal's overflow:auto inner container so the
          // spotlight lands on a visible target.
          if (found) {
            try {
              found.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
            } catch {}
            // Brief delay so scroll settles before driver positions
            // the popover.
            setTimeout(() => {
              if (delta > 0) drv.moveNext();
              else drv.movePrevious();
            }, 180);
          } else {
            if (delta > 0) drv.moveNext();
            else drv.movePrevious();
          }
        } else {
          requestAnimationFrame(tryMove);
        }
      };
      setTimeout(tryMove, 30);
    };

    const start = () => {
      if (cancelled) return;
      // v144 — scroll the first step's element into the modal's
      // visible region before driver.js measures it. See advance()
      // for the same rationale on subsequent steps.
      try {
        const first = document.querySelector(localisedSteps[0].element) as HTMLElement | null;
        if (first) first.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      } catch {}
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
          onNextClick: (_el, _step, { driver: drv }) => advance(drv, 1),
          onPrevClick: (_el, _step, { driver: drv }) => advance(drv, -1),
          onDestroyed: () => {
            markSeen(key);
            setActive(null);
            try {
              window.dispatchEvent(new CustomEvent("sb:tour-end", { detail: { key } }));
            } catch {}
            driverRef.current = null;
            clearPendingTrigger();
            handledRef.current = null;
          },
          onCloseClick: () => {
            try { driverRef.current?.destroy(); } catch {}
          },
        });
        driverRef.current = drv;
        setActive(key);
        drv.drive();
      } catch {
        clearPendingTrigger();
        handledRef.current = null;
      }
    };

    const initial = setTimeout(() => tryStart(0), delayMs);

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      clearTimeout(initial);
      try { driverRef.current?.destroy(); } catch {}
      driverRef.current = null;
      handledRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTrigger]);

  return null;
}
