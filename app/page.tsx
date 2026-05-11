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
"use client";
import DiscoverPage from "./discover/page";

export default function RootPage() {
  return <DiscoverPage />;
}
