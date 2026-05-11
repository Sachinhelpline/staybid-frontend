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
    <Link
      href="/discover"
      prefetch
      aria-label="Switch to Discovery reels mode"
      className="relative flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[0.72rem] font-semibold overflow-hidden transition-transform active:scale-95"
      style={{
        background: "linear-gradient(135deg, rgba(240,180,41,0.22), rgba(240,180,41,0.05))",
        border: "1px solid rgba(240,180,41,0.45)",
        color: "#f0b429",
        boxShadow: "0 2px 8px rgba(201,145,26,0.2), inset 0 1px 0 rgba(255,255,255,0.22)",
      }}
    >
      <span>✨</span>
      <span>Explore</span>
    </Link>
  );
}
