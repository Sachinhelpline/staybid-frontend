"use client";
// v408/v409 — Native-feel status bar for STANDALONE PWA mode, SINGLE AUTHORITY.
//
// Installed (display: standalone), the OS paints the STATUS BAR from the page's
// <meta name="theme-color">. If it doesn't match the screen under it, users see
// a mismatched strip ("upar black screen / status bar app se match nahi").
//
// THE RECURRING BUG this fixes: multiple places used to set theme-color and
// fought each other (the reel hook forced #000 while the page led with the cream
// flash-deals rail → permanent black-strip-over-cream). This component is now the
// ONLY thing that sets theme-color (the reel hook's override was removed), so
// there is one source of truth and it can't drift back.
//
// It matches the bar to whatever is actually at the TOP of the current screen:
//   • reel family (/, /discover, /reels): CREAM when the flash-deals rail is at
//     the top (the common case), else BLACK (pure dark reel).
//   • /bid game zone (dark mountain): near-black walnut.
//   • everything else: the active theme's page bg (cream / espresso).
// A MutationObserver re-evaluates when the rail mounts/unmounts (it loads async
// and toggles with filters), so the bar always tracks the real top surface.
import { useEffect } from "react";
import { usePathname } from "next/navigation";

const REEL_ROUTES = new Set(["/", "/discover", "/reels"]);
const WALNUT_PREFIXES = ["/bid"];
const RAIL_CREAM = "#fff9ec"; // matches .fdeal-rail-wrap top gradient stop

function statusColorFor(pathname: string): string {
  if (typeof document === "undefined") return "#FAF5EB";
  if (REEL_ROUTES.has(pathname)) {
    // The flash-deals rail (cream) sits at the very top when present; otherwise
    // the dark reel is at the top.
    return document.querySelector(".fdeal-rail-wrap") ? RAIL_CREAM : "#000000";
  }
  if (WALNUT_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) return "#0d0a05";
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  return dark ? "#0F0C08" : "#FAF5EB";
}

export default function StatusBarColor() {
  const pathname = usePathname();
  useEffect(() => {
    if (typeof document === "undefined") return;
    let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
    }
    let last = "";
    const apply = () => {
      const c = statusColorFor(pathname || "/");
      if (c !== last) { last = c; meta!.setAttribute("content", c); }
    };
    apply();
    // The flash rail loads async (after its fetch), so re-check a few times
    // after mount to catch it appearing — light + no heavy DOM observer.
    const timers = [150, 500, 1200, 2500].map((t) => window.setTimeout(apply, t));
    // Re-check when the tab regains focus (theme/filters may have changed).
    document.addEventListener("visibilitychange", apply);
    return () => {
      timers.forEach(clearTimeout);
      document.removeEventListener("visibilitychange", apply);
    };
  }, [pathname]);
  return null;
}
