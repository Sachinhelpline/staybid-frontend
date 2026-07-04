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
   5. v247.1 — blend the status bar into the black reel by setting
      `theme-color` to #000 for the reel's lifetime (restored on leave) so
      there's no separate colored band at the top.

   Back-gesture history (v247.1 → v247.4) — READ BEFORE TOUCHING #4:
   -----------------------------------------------------------------
   v247.1 dropped the `requestFullscreen()` immersive request to stop Android
   hiding the navigation gesture pill (Sachin: reel "forcefully gesture button
   band kar deta hai"). But that immersive call was ALSO the only thing
   absorbing Android's edge back-gesture — without it a single back-swipe
   exited the reel instantly ("bahut jaldi back ja raha hai, kaam hi nahi kar
   pa rahe"). v247.2 + v247.3 tried to restore the buffer in software (a
   history-sentinel "double-back to exit" guard, then a Next.js-state-
   preserving variant) — BOTH failed on-device: Next.js App Router owns
   back-navigation and tore through the sentinel regardless. There is no web
   API to suppress ONLY the system back-gesture while keeping the nav pill
   visible. So v247.4 RESTORED the immersive request (#4): it is the only
   reliable back-gesture absorber. The reel is immersive like Instagram /
   TikTok / YT Shorts (system nav pill hidden during viewing); the user
   navigates via the app's own bottom nav bar, which stays visible, so they
   are never trapped. ⚠️ Do NOT remove #4 again without a replacement that
   actually holds the back gesture in this Next.js app.

   Call this once from /discover and /reels page components.

   opts.immersive (default TRUE):
   -----------------------------
   When false, the viewport lock (#1–#3 + the status-bar blend #5) all stay,
   but the native `requestFullscreen()` immersive request (#4) is SKIPPED —
   so the browser is never FORCED into system fullscreen. Used by the
   StayCircle property/room reels (/circle/discover), where Sachin does not
   want the forced-fullscreen behaviour. The full-bleed reel layout is
   unchanged (it's driven by `--reel-vh` + `.is-reel-page`, not the
   fullscreen API); only the forced native fullscreen goes away.
   ────────────────────────────────────────────────────────────────────── */
import { useEffect, useRef } from "react";

export function useReelFullscreen(opts?: { immersive?: boolean }) {
  const immersive = opts?.immersive !== false; // default: true (StayBid reels)
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

    // ── Immersive fullscreen on first user gesture (Android) ─────────
    // v247.4 — RESTORED (was removed in v247.1). This is the only reliable
    // way to stop Android's edge back-gesture from instantly exiting the
    // reel: in fullscreen the first edge-swipe exits fullscreen instead of
    // navigating back. iOS Safari no-ops requestFullscreen, which is fine.
    // The system nav pill is hidden during the reel (like IG/TikTok) — the
    // app's own bottom nav bar stays visible for navigation. See the header
    // note before changing this.
    const tryFullscreen = () => {
      if (askedRef.current) return;
      askedRef.current = true;
      try {
        const el = document.documentElement as HTMLElement & {
          webkitRequestFullscreen?: () => Promise<void>;
          mozRequestFullScreen?: () => Promise<void>;
          msRequestFullscreen?: () => Promise<void>;
        };
        const req =
          el.requestFullscreen ||
          el.webkitRequestFullscreen ||
          el.mozRequestFullScreen ||
          el.msRequestFullscreen;
        if (req && !document.fullscreenElement) {
          const r = req.call(el);
          if (r && typeof (r as Promise<void>).catch === "function") {
            (r as Promise<void>).catch(() => {});
          }
        }
        // Scroll trick: forces Chrome/Firefox to commit to dynamic-viewport
        // height immediately so the URL bar collapses.
        window.scrollTo(0, 1);
        setTimeout(() => window.scrollTo(0, 0), 50);
      } catch {}
    };
    // immersive=false (StayCircle) → keep the viewport lock but never force
    // native fullscreen. Everything above (--reel-vh, is-reel-page, theme
    // blend) still applies, so the reel stays full-bleed without the forced
    // system-fullscreen the property/room screens complained about.
    if (immersive) {
      window.addEventListener("touchstart", tryFullscreen, { passive: true, once: true });
      window.addEventListener("click",      tryFullscreen, { passive: true, once: true });
    }

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
      window.removeEventListener("touchstart", tryFullscreen);
      window.removeEventListener("click", tryFullscreen);
      // leave fullscreen when the user navigates away from the reel
      try {
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
      } catch {}
      cancelAnimationFrame(raf);
    };
  }, [immersive]);
}
