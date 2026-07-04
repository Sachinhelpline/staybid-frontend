"use client";
// ═══════════════════════════════════════════════════════════════════════════
// CircleDock — StayCircle's Instagram-style bottom nav (v290).
//
// Owns navigation across the /circle vertical the same way BottomDock owns
// the StayBid reel surfaces. Mounted once in app/circle/layout.tsx so it
// appears on every /circle page. 5 slots:
//
//   🎬 Reels     → /circle          (the immersive discover feed)
//   🛏 Rooms     → room-selector sheet (dispatches `sbc:rooms`; nav to /circle
//                  first if elsewhere so the discover page can open the sheet)
//   💎 Invest    → /circle/build     (center gold FAB)
//   📊 Portfolio → /circle/me
//   ◎ StayBid    → /                 (back to the main app)
//
// The bundle-lock count (localStorage `sb_circle_locks_v1`) shows as a badge
// on the Invest slot.
// ═══════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LOCKS_KEY = "sb_circle_locks_v1";

function readLockCount(): number {
  try {
    const raw = localStorage.getItem(LOCKS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

export function CircleDock() {
  const pathname = usePathname() || "/circle";
  const router = useRouter();
  const [lockCount, setLockCount] = useState(0);

  // Keep the bundle badge in sync — refresh on mount, on lock changes broadcast
  // by the discover page, and whenever the tab regains focus.
  useEffect(() => {
    const refresh = () => setLockCount(readLockCount());
    refresh();
    const onStorage = (e: StorageEvent) => { if (e.key === LOCKS_KEY) refresh(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("sbc:locks-change", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("sbc:locks-change", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [pathname]);

  const onRooms = useCallback(() => {
    // On /circle the discover feed listens for this and opens the room sheet.
    // Elsewhere, land on /circle first (the event fires again on mount there).
    if (pathname === "/circle") {
      window.dispatchEvent(new Event("sbc:rooms"));
    } else {
      router.push("/circle?rooms=1");
    }
  }, [pathname, router]);

  const isReels = pathname === "/circle";
  const isInvest = pathname.startsWith("/circle/build");
  const isPortfolio = pathname.startsWith("/circle/me");

  return (
    <nav className="sbc-dock" aria-label="StayCircle navigation">
      <Link href="/circle" prefetch className={`sbc-dock-item${isReels ? " on" : ""}`} aria-current={isReels ? "page" : undefined}>
        <span className="sbc-dock-glyph">🎬</span>
        <span className="sbc-dock-label">Reels</span>
      </Link>

      <button type="button" className="sbc-dock-item" onClick={onRooms} aria-label="Room selector">
        <span className="sbc-dock-glyph">🛏</span>
        <span className="sbc-dock-label">Rooms</span>
      </button>

      <Link href="/circle/build" prefetch className={`sbc-dock-item center${isInvest ? " on" : ""}`} aria-current={isInvest ? "page" : undefined}>
        {lockCount > 0 && <span className="sbc-dock-badge">{lockCount > 9 ? "9+" : lockCount}</span>}
        <span className="sbc-dock-glyph">💎</span>
        <span className="sbc-dock-label">Invest</span>
      </Link>

      <Link href="/circle/me" prefetch className={`sbc-dock-item${isPortfolio ? " on" : ""}`} aria-current={isPortfolio ? "page" : undefined}>
        <span className="sbc-dock-glyph">📊</span>
        <span className="sbc-dock-label">Portfolio</span>
      </Link>

      <Link href="/" className="sbc-dock-item">
        <span className="sbc-dock-glyph">◎</span>
        <span className="sbc-dock-label">StayBid</span>
      </Link>
    </nav>
  );
}
