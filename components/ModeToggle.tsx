"use client";
// Single replaceable toggle — sits next to LocationChip.
// On any non-/discover route: shows "✨ Explore" → goes to /discover
// On /discover:               the same visual chip ("☰ Compare") is rendered
//                             INSIDE the reel page itself (since navbar is hidden there).
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

export function ModeToggle() {
  const pathname = usePathname() || "";
  const router = useRouter();

  // Prefetch the destination on mount so the Explore↔Compare swap is
  // instant the first time the user taps it (no waterfall load).
  useEffect(() => {
    if (pathname.startsWith("/discover") || pathname.startsWith("/partner")) return;
    try { router.prefetch("/discover"); } catch {}
  }, [pathname, router]);

  // On /discover the navbar is hidden entirely, so this component only
  // renders the "to /discover" state. The discover page renders its own
  // matching chip to return to /hotels.
  if (pathname.startsWith("/discover") || pathname.startsWith("/partner")) return null;

  return (
    // v585 — the same premium tonal-glass chip as the rest of the desktop
    // bar (nav3d-* system in components/Navbar.tsx, where this mounts). Was a
    // dull washed-gold pill the owner flagged; ✨ keeps its identity.
    <Link
      href="/discover"
      prefetch
      aria-label="Switch to Discovery reels mode"
      className="nav3d-chip nav3d-eq relative"
    >
      <span>✨</span>
      <span>Explore</span>
    </Link>
  );
}
