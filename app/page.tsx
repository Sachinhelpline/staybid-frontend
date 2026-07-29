// ═══════════════════════════════════════════════════════════════════════════
// Root URL — renders the Reels feed DIRECTLY (no redirect).
//
// The old behaviour was `redirect("/discover")` which added a server-side
// 307 round-trip BEFORE the user saw anything. On slow mobile networks
// that's 300-800ms of nothing — and after that the browser has to fetch
// /discover's HTML from scratch (cold).
//
// Now `/` renders the exact same component as /discover. The two URLs
// share the cache, both PWA start_url and direct staybids.in visits land
// in the feed in a single network round-trip.
//
// The previous luxury-themed homepage is still preserved at
//   app/_home-luxury-backup.tsx
// (filename starts with `_` so Next.js App Router ignores it).
// ═══════════════════════════════════════════════════════════════════════════
// v555 — DESKTOP gets a real home ("The Stage"): a cinematic hero + rows of
// cards (Flash Deals · Reels · one rail per launch zone), the streaming-service
// idiom. MOBILE is byte-identical to before — it still renders the reel feed
// directly, with no extra fetch and no extra component mounted, because
// <DesktopHome/> self-gates on matchMedia(min-width:1024px) and the swap below
// only ever flips on desktop.
"use client";
import { useEffect, useState } from "react";
import DiscoverPage from "./discover/page";
import DesktopHome from "@/components/home/DesktopHome";

/** Mobile `/` = the Stage home. Set NEXT_PUBLIC_MOBILE_HOME="0" to revert to
 *  the reel feed instantly (same fail-safe pattern as isLaunchCurationOn). */
const MOBILE_HOME_ON = process.env.NEXT_PUBLIC_MOBILE_HOME !== "0";

export default function RootPage() {
  // null = not measured yet. We hold ONE frame on a plain themed backdrop
  // rather than mounting the reel first, so a desktop visitor never sees the
  // phone player flash in before the home swaps in (and the reel's feed fetches
  // never fire on desktop at all). The critical inline CSS in app/layout.tsx
  // already paints this exact background, so the frame is invisible.
  const [desktop, setDesktop] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => setDesktop(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  if (desktop === null) return <div style={{ minHeight: "100vh" }} />;
  if (desktop) return <DesktopHome />;
  // MOBILE: the Stage home is on by default, but one env flag reverts the whole
  // surface to the reel feed with no code change —
  //   NEXT_PUBLIC_MOBILE_HOME="0"  →  mobile `/` is the reel feed again.
  // /discover and /reels are untouched either way; they remain the dedicated
  // reel surfaces, so nothing is lost — only the ENTRY point changes.
  return MOBILE_HOME_ON ? <DesktopHome /> : <DiscoverPage />;
}
