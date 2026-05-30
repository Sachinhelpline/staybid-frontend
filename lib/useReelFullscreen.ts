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
   4. v247.1 — DROPPED the Fullscreen-API immersive request. On Android it
      forcefully hid the system navigation gesture bar (Sachin: reel
      "forcefully gesture button band kar deta hai"). The full-screen look
      comes entirely from the visualViewport `--reel-vh` lock + `fixed
      inset-0`, NOT from `requestFullscreen()`, so dropping the immersive
      call keeps the reel full-bleed while leaving the gesture nav visible.
      We keep only the harmless URL-bar-collapse scroll nudge (it does not
      touch the system bars).
   5. v247.1 — blend the status bar into the black reel by setting
      `theme-color` to #000 for the reel's lifetime (restored on leave) so
      there's no separate colored band at the top.

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

    // ── Blend the status bar into the black reel (no separate colored
    //    band at the top). Save the current theme-color, force #000 for
    //    the reel, restore on unmount. ───────────────────────────────
    const themeMeta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    const prevThemeColor = themeMeta?.getAttribute("content") ?? null;
    if (themeMeta) themeMeta.setAttribute("content", "#000000");

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

    // ── URL-bar collapse on first user gesture (no system-bar touch) ──
    // v247.1 — was tryFullscreen(); the requestFullscreen() immersive call
    // was REMOVED because on Android it hid the navigation gesture bar.
    // Only the scroll nudge remains: it asks Chrome/Firefox to commit to the
    // dynamic-viewport height so the URL bar collapses — it does NOT hide the
    // status or navigation bars.
    const collapseUrlBar = () => {
      if (askedRef.current) return;
      askedRef.current = true;
      try {
        window.scrollTo(0, 1);
        setTimeout(() => window.scrollTo(0, 0), 50);
      } catch {}
    };
    window.addEventListener("touchstart", collapseUrlBar, { passive: true, once: true });
    window.addEventListener("click",      collapseUrlBar, { passive: true, once: true });

    return () => {
      html.classList.remove("is-reel-page");
      body.classList.remove("is-reel-page");
      html.style.removeProperty("--reel-vh");
      body.style.height = "";
      // restore the pre-reel status-bar colour
      if (themeMeta && prevThemeColor != null) themeMeta.setAttribute("content", prevThemeColor);
      window.visualViewport?.removeEventListener("resize", updateVh);
      window.visualViewport?.removeEventListener("scroll", updateVh);
      window.removeEventListener("resize", updateVh);
      window.removeEventListener("orientationchange", updateVh);
      document.removeEventListener("fullscreenchange", updateVh);
      window.removeEventListener("touchstart", collapseUrlBar);
      window.removeEventListener("click", collapseUrlBar);
      cancelAnimationFrame(raf);
    };
  }, []);
}
