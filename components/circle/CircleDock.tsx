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
import type { MouseEvent as ReactMouseEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { basketCount as m2BasketCount, onBasketChange as onM2BasketChange } from "@/lib/circle/model2-basket";

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

// v357 — on the Model-2 B2B journey the same dock reads a DIFFERENT progression:
// Browse → Tour → Pay. Rendered when the path is under /circle/model2/*.
function Model2Steps({ pathname }: { pathname: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const refresh = () => setCount(m2BasketCount());
    refresh();
    return onM2BasketChange(refresh);
  }, [pathname]);
  const onBrowse = pathname === "/circle/model2/browse" || pathname === "/circle/model2";
  const onTour = /^\/circle\/model2\/[^/]+$/.test(pathname) && !onBrowse && !pathname.endsWith("/review") && !pathname.endsWith("/selling");
  const onPay = pathname.startsWith("/circle/model2/review");
  const hasItems = count > 0;
  return (
    <div className="sbc-steps" role="group" aria-label="Model 2 steps">
      <span className="sbc-steps-rail" aria-hidden />
      <Link href="/circle/model2/browse" prefetch className={`sbc-step${onBrowse ? " on" : ""}${hasItems || onTour || onPay ? " done" : ""}`} aria-current={onBrowse ? "page" : undefined}>
        <span className="sbc-step-num">{hasItems || onTour || onPay ? "✓" : "1"}</span>
        <span className="sbc-step-label">Browse</span>
      </Link>
      <Link href="/circle/model2/browse" prefetch className={`sbc-step${onTour ? " on" : ""}`} aria-current={onTour ? "page" : undefined}>
        <span className="sbc-step-num">2</span>
        <span className="sbc-step-label">Tour</span>
      </Link>
      <Link href="/circle/model2/review" prefetch className={`sbc-step fab${onPay ? " on" : ""}`} aria-current={onPay ? "page" : undefined}>
        {count > 0 && <span className="sbc-dock-badge">{count > 9 ? "9+" : count}</span>}
        <span className="sbc-step-num">3</span>
        <span className="sbc-step-label">Pay</span>
      </Link>
    </div>
  );
}

export function CircleDock() {
  const pathname = usePathname() || "/circle";
  const router = useRouter();
  const [lockCount, setLockCount] = useState(0);
  // Whether the room-tour overlay is currently open on /circle/discover. The
  // overlay's state lives in the discover page; it broadcasts sbc:rooms-state
  // so the dock can light up the correct step + let Property close the overlay.
  const [roomsOpen, setRoomsOpen] = useState(false);

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

  // Sync the overlay state broadcast by the discover page.
  useEffect(() => {
    const onState = (e: Event) => {
      const open = !!(e as CustomEvent<{ open?: boolean }>).detail?.open;
      setRoomsOpen(open);
    };
    window.addEventListener("sbc:rooms-state", onState);
    return () => window.removeEventListener("sbc:rooms-state", onState);
  }, []);

  // The overlay only exists on /circle/discover — if we're anywhere else it's
  // definitely closed (guards against a stale broadcast after navigation).
  const onDiscover = pathname.startsWith("/circle/discover");
  const roomsActive = onDiscover && roomsOpen;

  const onRooms = useCallback(() => {
    // Step 2 opens the room-tour sheet, which lives on the discover feed.
    if (pathname.startsWith("/circle/discover")) {
      window.dispatchEvent(new Event("sbc:rooms"));
    } else {
      router.push("/circle/discover?rooms=1");
    }
  }, [pathname, router]);

  // Step 1 "Property": when we're already on the discover feed, ALWAYS close any
  // open room sheet + prevent the same-URL <Link> navigation. This no longer
  // gates on the `roomsOpen` mirror (a broadcast that could lag → tapping
  // Property fired a no-op same-URL nav that left the sheet stuck). Property =
  // "show the property feed" → dispatch close (a harmless no-op if already
  // closed). Only when we're NOT on discover does the <Link> navigate there.
  const onProperty = useCallback((e: ReactMouseEvent) => {
    if (onDiscover) {
      e.preventDefault();
      window.dispatchEvent(new Event("sbc:rooms-close"));
    }
    // else let the <Link> navigate to /circle/discover normally.
  }, [onDiscover]);

  const isHome = pathname === "/circle";
  // Property step is "active" only when the property feed is actually showing
  // (on discover AND the room overlay is closed).
  const isProperty = onDiscover && !roomsOpen;
  const isPlan = pathname.startsWith("/circle/build");
  const isDash = pathname.startsWith("/circle/dashboard");
  const hasLocks = lockCount > 0;
  const onModel2 = pathname.startsWith("/circle/model2");

  return (
    <nav className={`sbc-dock v2${roomsActive ? " rooms-open" : ""}`} aria-label="StayCircle steps">
      {/* Home */}
      <Link href="/circle" prefetch className={`sbc-dock-end${isHome ? " on" : ""}`} aria-current={isHome ? "page" : undefined}>
        <span className="sbc-dock-glyph">🏠</span>
        <span className="sbc-dock-label">Home</span>
      </Link>

      {/* ───── the 3-step wizard rail (Model-2 journey swaps the labels) ───── */}
      {onModel2 ? <Model2Steps pathname={pathname} /> : (
      <div className="sbc-steps" role="group" aria-label="Portfolio steps">
        <span className="sbc-steps-rail" aria-hidden />

        {/* Step 1 · Property */}
        <Link
          href="/circle/discover"
          prefetch
          onClick={onProperty}
          className={`sbc-step${isProperty ? " on" : ""}${hasLocks ? " done" : ""}`}
          aria-current={isProperty ? "page" : undefined}
        >
          <span className="sbc-step-num">{hasLocks ? "✓" : "1"}</span>
          <span className="sbc-step-label">Property</span>
        </Link>

        {/* Step 2 · Rooms */}
        <button
          type="button"
          className={`sbc-step${roomsActive ? " on" : ""}`}
          onClick={onRooms}
          aria-current={roomsActive ? "page" : undefined}
          aria-label="Step 2 — choose and lock rooms"
        >
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
      )}

      {/* Dashboard */}
      <Link href="/circle/dashboard" prefetch className={`sbc-dock-end${isDash ? " on" : ""}`} aria-current={isDash ? "page" : undefined}>
        <span className="sbc-dock-glyph">☰</span>
        <span className="sbc-dock-label">Dashboard</span>
      </Link>
    </nav>
  );
}
