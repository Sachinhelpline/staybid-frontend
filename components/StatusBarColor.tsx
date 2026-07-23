"use client";
// v408 — Native-feel status bar for STANDALONE PWA mode.
//
// When the app runs installed (display: standalone), Android/iOS paint the
// system STATUS BAR (top) using the page's <meta name="theme-color">. If that
// colour doesn't match the current screen, users see a mismatched dark strip
// on light pages ("upar black screen / status bar app se match nahi ho rahi").
//
// This mounts once (globally) and updates theme-color on every route change so
// the status bar always matches the surface underneath it:
//   • reel surfaces (/, /discover, /reels)  → black (immersive dark reel)
//   • /bid game zone (dark mountain)         → near-black walnut
//   • everything else                        → the active theme's page bg
//     (cream in light, espresso in dark) so the bar blends into the page.
//
// Pure/runtime (no manifest change → no reinstall needed). The reel's own
// useReelFullscreen also sets #000 on reel routes; this sets the SAME value so
// there is never a fight, and it GUARANTEES the colour is corrected on the
// next route even if a prior screen left it stale.
import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Visually-dark routes that must keep a dark status bar in ANY theme.
const BLACK_ROUTES = new Set(["/", "/discover", "/reels"]);
const WALNUT_PREFIXES = ["/bid"];

function statusColorFor(pathname: string): string {
  if (BLACK_ROUTES.has(pathname)) return "#000000";
  if (WALNUT_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) return "#0d0a05";
  const dark =
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "dark";
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
    meta.setAttribute("content", statusColorFor(pathname || "/"));
  }, [pathname]);
  return null;
}
