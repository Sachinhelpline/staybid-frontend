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
   6. v247.2 / v247.3 — "double-back to exit" guard. Dropping the immersive
      request (point 4) also removed the only thing that was absorbing
      Android's edge back-gesture, so a single back-swipe began exiting the
      reel instantly (Sachin: "bahut jaldi back chala jata hai"). We restore
      that buffer WITHOUT immersive via a history sentinel: the first back is
      swallowed (toast shown), only a deliberate second back within 2s
      actually leaves. Fail-safe — a real double-back always exits, the arm
      auto-clears, and the handler no-ops off a reel page so it can never
      hijack back elsewhere. v247.3 fixed the guard not holding: the sentinel
      must SPREAD Next.js's history.state (not overwrite it) or the App Router
      loses its `tree`/`__NA` state and navigates away anyway.

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

    // ── Back-gesture guard — "double-back to exit" (v247.3) ─────────
    // Re-adds the back-swipe buffer the immersive Fullscreen API used to
    // provide, but without hiding the gesture nav. A sentinel history entry
    // catches the first back; only a deliberate second back (within 2s)
    // leaves. Fail-safe by design:
    //   • a real double-back ALWAYS exits — the user is never trapped,
    //   • `armed` auto-clears after 2s,
    //   • the handler no-ops the instant we're off a reel page (class check),
    //     so a listener that loses the unmount race (see hotels/[id] v227)
    //     can't hijack the back button on a non-reel route.
    //
    // v247.3 — CRITICAL FIX: the v247.2 sentinel wrote `{reelGuard:true}` as
    // the whole history.state, which WIPED Next.js App Router's own state
    // (the `tree` / `__NA` / `key` keys it stores there). With its state gone,
    // the App Router mis-handled the resulting popstate and navigated away —
    // so the guard never actually held ("bahut jaldi back ja raha hai"). We
    // now SPREAD Next's existing state and only add our marker, and push with
    // the explicit current URL, so Next's router stays intact and treats the
    // sentinel as a normal same-route entry.
    let armed = false;
    let armTimer: ReturnType<typeof setTimeout> | undefined;
    let leaving = false;
    let toastEl: HTMLDivElement | null = null;

    // Prime/re-prime our sentinel without clobbering Next's router state.
    const primeSentinel = () => {
      try {
        window.history.pushState(
          { ...(window.history.state as Record<string, unknown> | null), reelGuard: true },
          "",
          window.location.href,
        );
      } catch {}
    };

    const clearToast = () => { toastEl?.remove(); toastEl = null; };
    const showToast = () => {
      clearToast();
      const el = document.createElement("div");
      el.textContent = "Press back again to exit";
      el.setAttribute("role", "status");
      el.style.cssText =
        "position:fixed;left:50%;bottom:96px;transform:translateX(-50%);" +
        "z-index:2147483647;background:rgba(0,0,0,0.82);color:#fff;" +
        "padding:10px 18px;border-radius:9999px;font-size:13px;font-weight:500;" +
        "pointer-events:none;backdrop-filter:blur(8px);text-align:center;" +
        "max-width:80vw;box-shadow:0 4px 18px rgba(0,0,0,0.45);" +
        "opacity:0;transition:opacity .18s ease";
      body.appendChild(el);
      toastEl = el;
      requestAnimationFrame(() => { if (toastEl === el) el.style.opacity = "1"; });
      setTimeout(() => {
        if (toastEl === el) { el.style.opacity = "0"; setTimeout(clearToast, 220); }
      }, 1500);
    };

    const onPopState = () => {
      // Off the reel (e.g. lost the unmount race) → never guard back.
      if (!body.classList.contains("is-reel-page")) return;
      if (leaving) return;
      if (armed) {
        // deliberate 2nd back inside the window → let them out for real
        armed = false;
        if (armTimer) clearTimeout(armTimer);
        clearToast();
        leaving = true;
        window.history.back();
        return;
      }
      // first back → swallow: re-prime the sentinel + toast + 2s window
      armed = true;
      primeSentinel();
      showToast();
      if (armTimer) clearTimeout(armTimer);
      armTimer = setTimeout(() => { armed = false; }, 2000);
    };

    // prime exactly ONE sentinel so the first back has something to pop.
    // (Just one: Next's route-settle uses replaceState — it rewrites the
    // current entry's state but never removes our entry, so a single sentinel
    // survives. Priming two would make the double-back land on the leftover
    // sentinel instead of actually leaving the reel.)
    primeSentinel();
    window.addEventListener("popstate", onPopState);

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
      // ── tear down the back-gesture guard ──
      window.removeEventListener("popstate", onPopState);
      if (armTimer) clearTimeout(armTimer);
      clearToast();
      // If our sentinel is still the active entry (component unmounted while
      // sitting on it, not via a forward nav), pop it so we don't leave a
      // stray history step behind. For normal forward nav the top state is
      // the new page's, so history is left untouched.
      if (!leaving && window.history.state?.reelGuard) {
        leaving = true;
        window.history.back();
      }
      cancelAnimationFrame(raf);
    };
  }, []);
}
