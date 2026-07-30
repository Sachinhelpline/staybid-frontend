"use client";

// v450 — global top route-progress bar (perceived-speed pass).
//
// The App Router gives no built-in "navigation in progress" signal, so tapping
// a nav item on a route WITHOUT a loading.tsx used to sit on the frozen old
// page with zero feedback until the destination's client JS mounted. This thin
// gold bar starts the instant an internal link is tapped (or on back/forward)
// and completes when the new route commits — so every navigation feels
// responsive regardless of whether the destination has its own skeleton.
//
// Safety: the click listener is a PASSIVE bubble-phase reader — it only starts
// a visual bar, never calls preventDefault/stopPropagation, so it cannot
// interfere with the reel immersive/back-gesture handlers or any Link routing.
// pointer-events:none on the bar itself. A hard safety timeout guarantees the
// bar can never hang (e.g. a same-route tap we didn't detect as a no-op).

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export default function RouteProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  const running = useRef(false);
  const trickle = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safety = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = () => {
    if (trickle.current) { clearInterval(trickle.current); trickle.current = null; }
    if (hideT.current) { clearTimeout(hideT.current); hideT.current = null; }
    if (safety.current) { clearTimeout(safety.current); safety.current = null; }
  };

  const start = () => {
    if (running.current) return;
    running.current = true;
    clearTimers();
    setVisible(true);
    setProgress(8);
    // trickle toward 90% — decelerating so it never visually "completes" early
    trickle.current = setInterval(() => {
      setProgress((p) => {
        if (p >= 90) return p;
        const inc = p < 50 ? 9 : p < 75 ? 4 : 1.5;
        return Math.min(90, p + inc);
      });
    }, 240);
    // the bar can never hang: force-finish after 8s even if no route change fires
    safety.current = setTimeout(finish, 8000);
  };

  const finish = () => {
    if (!running.current) return;
    running.current = false;
    clearTimers();
    setProgress(100);
    hideT.current = setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 260);
  };

  // Detect navigation START — internal link taps + browser back/forward.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement)?.closest?.("a");
      if (!a) return;
      const href = a.getAttribute("href");
      const target = a.getAttribute("target");
      if (!href || (target && target !== "_self") || a.hasAttribute("download")) return;
      if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      let url: URL;
      try { url = new URL(href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin) return; // external — full page load, skip
      if (url.pathname === window.location.pathname && url.search === window.location.search) return; // no-op
      start();
    };
    const onPop = () => start();
    document.addEventListener("click", onClick);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  // Route COMMITTED (pathname or query changed) → finish. (No-op on first mount
  // because `running` is false until a navigation actually starts.)
  useEffect(() => {
    finish();
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search]);

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        height: 2.5,
        width: `${progress}%`,
        maxWidth: "100%",
        zIndex: 2147483000,
        pointerEvents: "none",
        opacity: visible ? 1 : 0,
        background: "linear-gradient(90deg,#748da6,#a9b9c8 55%,#cbd5de)",
        boxShadow: "0 0 8px rgba(140, 160, 182,0.65)",
        borderTopRightRadius: 2,
        borderBottomRightRadius: 2,
        transition: "width 0.24s ease, opacity 0.26s ease",
      }}
    />
  );
}
