"use client";
// ═══════════════════════════════════════════════════════════════════════════
// CircleDock — StayCircle's bottom nav, redesigned as a 3-step wizard (v293).
//
// The 3 core buttons now read as a numbered PHASE PROGRESSION so anyone
// instantly understands these are the steps to complete to take a portfolio
// live:
//
//   🏠 Home       → /circle              (the "Hello, Investor" home)
//   ① Property    → /circle/discover     (Step 1 · Choose & Lock Property)
//   ② Rooms       → room-tour sheet       (Step 2 · Choose & Lock Rooms)
//   ③ Plan        → /circle/build         (Step 3 · Build Your Plan · gold FAB)
//   ☰ Dashboard   → /circle/dashboard    (profile · mode-switch · account)
//
// The middle three sit on a connecting progress rail. Step ① shows ✓ once a
// property is locked; the lock count badges Step ③. `onRooms` fires the
// `sbc:rooms` event on the discover feed (nav there first from elsewhere).
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
    // Step 2 opens the room-tour sheet, which lives on the discover feed.
    if (pathname.startsWith("/circle/discover")) {
      window.dispatchEvent(new Event("sbc:rooms"));
    } else {
      router.push("/circle/discover?rooms=1");
    }
  }, [pathname, router]);

  const isHome = pathname === "/circle";
  const isProperty = pathname.startsWith("/circle/discover");
  const isPlan = pathname.startsWith("/circle/build");
  const isDash = pathname.startsWith("/circle/dashboard");
  const hasLocks = lockCount > 0;

  return (
    <nav className="sbc-dock v2" aria-label="StayCircle steps">
      {/* Home */}
      <Link href="/circle" prefetch className={`sbc-dock-end${isHome ? " on" : ""}`} aria-current={isHome ? "page" : undefined}>
        <span className="sbc-dock-glyph">🏠</span>
        <span className="sbc-dock-label">Home</span>
      </Link>

      {/* ───── the 3-step wizard rail ───── */}
      <div className="sbc-steps" role="group" aria-label="Portfolio steps">
        <span className="sbc-steps-rail" aria-hidden />

        {/* Step 1 · Property */}
        <Link
          href="/circle/discover"
          prefetch
          className={`sbc-step${isProperty ? " on" : ""}${hasLocks ? " done" : ""}`}
          aria-current={isProperty ? "page" : undefined}
        >
          <span className="sbc-step-num">{hasLocks ? "✓" : "1"}</span>
          <span className="sbc-step-label">Property</span>
        </Link>

        {/* Step 2 · Rooms */}
        <button type="button" className="sbc-step" onClick={onRooms} aria-label="Step 2 — choose and lock rooms">
          <span className="sbc-step-num">2</span>
          <span className="sbc-step-label">Rooms</span>
        </button>

        {/* Step 3 · Plan (gold FAB) */}
        <Link
          href="/circle/build"
          prefetch
          className={`sbc-step fab${isPlan ? " on" : ""}`}
          aria-current={isPlan ? "page" : undefined}
        >
          {lockCount > 0 && <span className="sbc-dock-badge">{lockCount > 9 ? "9+" : lockCount}</span>}
          <span className="sbc-step-num">3</span>
          <span className="sbc-step-label">Plan</span>
        </Link>
      </div>

      {/* Dashboard */}
      <Link href="/circle/dashboard" prefetch className={`sbc-dock-end${isDash ? " on" : ""}`} aria-current={isDash ? "page" : undefined}>
        <span className="sbc-dock-glyph">☰</span>
        <span className="sbc-dock-label">Dashboard</span>
      </Link>
    </nav>
  );
}
