"use client";
/* ──────────────────────────────────────────────────────────────────────
   useReelFullscreen — bulletproof reel viewport lock.

   "Kabhi fullscreen hota hai, kabhi nahi" root cause:
   ---------------------------------------------------
   • `100dvh` is supposed to track the dynamic viewport height (excluding
     mobile chrome) but Android Chrome / Samsung Internet still gives 8–
     20px of phantom space at the bottom when the URL bar is shown.
   • iOS Safari does not honour `requestFullscreen()` outside <video>.
   • Stale service-worker chunks can serve an older HTML that's missing
     the `.is-reel-page` body lock, so the same device flips between
     fullscreen-ok and fullscreen-broken between visits.

   Fix:
   ----
   1. Read the REAL visible viewport height from `window.visualViewport`
      (iOS 13+ / Chrome 61+) and write it to `--reel-vh` in pixels.
      All reel CSS reads this var instead of `100dvh`.
   2. Re-read on resize, scroll, fullscreenchange, and orientationchange
      so the lock survives URL-bar appear/disappear.
   3. Pin html+body via `is-reel-page` class with overscroll-behavior
      kill so swipe-down doesn't trigger pull-to-refresh.
   4. Best-effort `requestFullscreen()` on first user gesture (Android
      Chrome / Firefox honour this; iOS Safari silently no-ops which is
      fine — the visualViewport-driven lock alone is enough there).

   Call this once from /discover and /reels page components.
   ────────────────────────────────────────────────────────────────────── */
import { useEffect, useRef } from "react";

export function useReelFullscreen() {
  const askedRef = useRef(false);

  useEffect(() => {
    // ── Apply body class lock ───────────────────────────────────────
    const html = document.documentElement;
    const body = document.body;
    html.classList.add("is-reel-page");
    body.classList.add("is-reel-page");

    // ── Update --reel-vh on every viewport change ──────────────────
    let raf = 0;
    const updateVh = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const vv = window.visualViewport;
        const h = vv?.height ?? window.innerHeight ?? document.documentElement.clientHeight;
        // round to avoid sub-pixel layout shimmer
        const px = Math.round(h);
        html.style.setProperty("--reel-vh", `${px}px`);
        body.style.height = `${px}px`;
      });
    };
    updateVh();

    // visualViewport fires on URL-bar show/hide. resize covers desktop.
    window.visualViewport?.addEventListener("resize", updateVh);
    window.visualViewport?.addEventListener("scroll", updateVh);
    window.addEventListener("resize", updateVh);
    window.addEventListener("orientationchange", updateVh);
    document.addEventListener("fullscreenchange", updateVh);

    // ── Best-effort fullscreen on first user gesture (Android only) ──
    const tryFullscreen = () => {
      if (askedRef.current) return;
      askedRef.current = true;
      try {
        const el: any = document.documentElement;
        const req =
          el.requestFullscreen ||
          el.webkitRequestFullscreen ||
          el.mozRequestFullScreen ||
          el.msRequestFullscreen;
        if (req && !document.fullscreenElement) {
          req.call(el).catch(() => {});
        }
        // Scroll trick: forces Chrome/Firefox to commit to dynamic-viewport
        // height immediately so URL bar collapses.
        window.scrollTo(0, 1);
        setTimeout(() => window.scrollTo(0, 0), 50);
      } catch {}
    };
    window.addEventListener("touchstart", tryFullscreen, { passive: true, once: true });
    window.addEventListener("click",      tryFullscreen, { passive: true, once: true });

    return () => {
      html.classList.remove("is-reel-page");
      body.classList.remove("is-reel-page");
      html.style.removeProperty("--reel-vh");
      body.style.height = "";
      window.visualViewport?.removeEventListener("resize", updateVh);
      window.visualViewport?.removeEventListener("scroll", updateVh);
      window.removeEventListener("resize", updateVh);
      window.removeEventListener("orientationchange", updateVh);
      document.removeEventListener("fullscreenchange", updateVh);
      window.removeEventListener("touchstart", tryFullscreen);
      window.removeEventListener("click", tryFullscreen);
      cancelAnimationFrame(raf);
    };
  }, []);
}
