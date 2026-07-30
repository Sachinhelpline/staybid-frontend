"use client";
/* ─────────────────────────────────────────────────────────────────────
   DialerNav — Floating draggable FAB + iPhone UIPickerView (v62).

   v62 design (final, per user feedback):
   ───────────────────────────────────────
   The old crown-wheel UX confused users — items past 90° were culled so
   often only one icon was visible, and the dial column on the left
   edge overlapped content. Replaced with the iPhone-native pattern:

     1) FLOATING FAB (closed state)
        ─ Single round button, draggable anywhere on the screen.
        ─ Defaults to left-middle of viewport.
        ─ User can drag with one finger — on release it snaps to the
          nearest left/right edge so it never floats over content
          permanently. Position persists in localStorage.
        ─ Single tap (no drag) → opens the picker.
        ─ When idle ≥ 2 s: opacity dips to 0.35 so it's barely visible
          (still tappable). Touch wakes it.

     2) iPHONE PICKER (open state)
        ─ A vertical translucent column appears beside the FAB.
        ─ 5 items rendered SIMULTANEOUSLY:
              ─2 ─1  0  +1  +2   (positions relative to centre)
              tiny  med  BIG  med  tiny
        ─ Smooth continuous scaling/opacity driven by signed distance,
          not cos(angle). No 90° cliff = no items "disappearing".
        ─ Drag vertically → wheel rolls smoothly. All visible items
          move together; the one passing through the centre band grows
          to full size. Wraps around (mod N).
        ─ Centre item carries gold "selection band" + label chip
          (name + use-case).
        ─ Tap centre → navigate.
        ─ Backdrop blur dims rest of screen.
        ─ Tap backdrop OR 1.2 s idle after release → closes back to FAB.

   FAB drag mechanics:
   ───────────────────
     onTouchStart records start point + start FAB pos + start time.
     onTouchMove: if movement > 8 px → drag mode (FAB follows finger).
     onTouchEnd:
       ─ if moved → snap FAB to nearest screen edge, persist
       ─ if didn't move AND elapsed < 500 ms → open picker
   ───────────────────────────────────────────────────────────────────── */
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
// v109 — shared TierProvider. See lib/tier-store.tsx for the live
// auto-refresh wiring (storage events + custom event).
import { useTier } from "@/lib/tier-store";

type Item = {
  href: string;
  label: string;
  useCase: string;
  icon: string;
  pulse?: boolean;
  external?: boolean;
};

// v108 — Creator + Partner picker entries are tier-gated. Base list is the
// nav every signed-in user can use; CREATOR_ITEM and HOTEL_ITEM are
// inserted conditionally below, just before Profile. Hotel Partner now
// points at /partner inside this app (same Next bundle, separate
// sb_partner_token auth) rather than the abandoned external Vercel deploy.
const BASE_ITEMS: Item[] = [
  { href: "/",             label: "Home",         useCase: "home feed",          icon: "🏠" },
  { href: "/hotels",       label: "Hotels",       useCase: "browse stays",       icon: "🏨" },
  { href: "/discover",     label: "Reels",        useCase: "watch hotel reels",  icon: "🎬" },
  { href: "/flash-deals",  label: "Deals",        useCase: "live flash sales",   icon: "⚡", pulse: true },
  { href: "/bid",          label: "Bid",          useCase: "bid your own price",    icon: "🎯" },
  { href: "/my-bids",      label: "My Bids",      useCase: "your active bids",   icon: "📋" },
  { href: "/bookings",     label: "Bookings",     useCase: "your trips",         icon: "🎫" },
  { href: "/saved",        label: "Saved",        useCase: "saved places",       icon: "🔖" },
  { href: "/verification", label: "Verify",       useCase: "stay verification",  icon: "✅" },
  { href: "/wallet",       label: "Wallet",       useCase: "balance & history",  icon: "💰" },
  { href: "/points",       label: "Points",       useCase: "loyalty rewards",    icon: "⭐" },
];
const CREATOR_ITEM: Item = { href: "/influencer", label: "Creator", useCase: "creator hub",     icon: "✨" };
const HOTEL_ITEM: Item   = { href: "/partner",    label: "Partner", useCase: "hotel dashboard", icon: "🏢" };
const PROFILE_ITEM: Item = { href: "/profile",    label: "Profile", useCase: "your account",    icon: "👤" };
const FAB_SIZE = 52;                  // diameter of the floating button
const FAB_MARGIN = 12;                // distance from screen edges
const ITEM_SPACING = 60;              // px between items in the picker
const PICKER_WIDTH = 108;
const PICKER_HEIGHT = ITEM_SPACING * 5 + 40;  // 5 items + padding
const DRAG_PX_PER_ITEM = 60;          // picker scroll sensitivity
const FAB_DRAG_THRESHOLD = 8;         // px before we treat it as a drag (not tap)
const FAB_TAP_MAX_MS = 500;           // longer hold = treated as drag intent
const IDLE_CLOSE_MS = 1200;           // picker auto-closes after this long w/o touch
const FAB_IDLE_DIM_MS = 2000;         // FAB dims to 0.35 after this long w/o touch
const SNAP_MS = 380;
const LS_KEY = "sb_dialer_fab_pos";

export function DialerNav() {
  const pathname = usePathname() || "/";
  const router = useRouter();

  // v109 — shared TierProvider. isCreator + isHotelOwner are
  // independent flags (a user can be both); each picker entry appears
  // only when its matching role is active.
  const { isCreator, isHotelOwner } = useTier();
  const items = useMemo<Item[]>(() => {
    const out = [...BASE_ITEMS];
    if (isCreator)    out.push(CREATOR_ITEM);
    if (isHotelOwner) out.push(HOTEL_ITEM);
    out.push(PROFILE_ITEM);
    return out;
  }, [isCreator, isHotelOwner]);
  const N = items.length;

  // Which item index corresponds to the current pathname
  // External links (e.g. legacy external partner) never match — they live off-app.
  const activeIdx = (() => {
    if (pathname === "/") return 0;
    const i = items.findIndex(it =>
      !it.external && it.href !== "/" && (pathname === it.href || pathname.startsWith(it.href + "/"))
    );
    return i >= 0 ? i : 0;
  })();

  // FAB position (relative to viewport)
  const [fabPos, setFabPos] = useState<{ x: number; y: number }>(() => {
    if (typeof window === "undefined") return { x: 0, y: 0 };
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p?.x === "number" && typeof p?.y === "number") return p;
      }
    } catch {}
    // Default: left edge, mid-vertical
    return { x: FAB_MARGIN, y: Math.max(120, Math.round(window.innerHeight / 2 - FAB_SIZE / 2)) };
  });
  const [fabDim, setFabDim] = useState(false);   // idle-dim state
  const [open, setOpen] = useState(false);
  const [rotation, setRotation] = useState(activeIdx);
  const [snapping, setSnapping] = useState(false);
  // Once the user starts scrolling, fade out the up/down arrow hints
  // (they've understood the affordance, no need to keep distracting).
  const [interacted, setInteracted] = useState(false);

  const fabDragRef = useRef<{ sx: number; sy: number; fx: number; fy: number; moved: boolean; t: number } | null>(null);
  const pickerDragRef = useRef<{ sy: number; sr: number; moved: boolean } | null>(null);
  const fabIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pickerIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── FAB idle dim cycle ─────────────────────────────────────
  const scheduleFabIdle = useCallback(() => {
    if (fabIdleTimerRef.current) clearTimeout(fabIdleTimerRef.current);
    fabIdleTimerRef.current = setTimeout(() => setFabDim(true), FAB_IDLE_DIM_MS);
  }, []);
  const wakeFab = useCallback(() => {
    if (fabIdleTimerRef.current) clearTimeout(fabIdleTimerRef.current);
    setFabDim(false);
  }, []);
  useEffect(() => { scheduleFabIdle(); }, [scheduleFabIdle, fabPos.x, fabPos.y]);

  // ─── Picker idle close cycle ────────────────────────────────
  const schedulePickerClose = useCallback(() => {
    if (pickerIdleTimerRef.current) clearTimeout(pickerIdleTimerRef.current);
    pickerIdleTimerRef.current = setTimeout(() => setOpen(false), IDLE_CLOSE_MS);
  }, []);
  const wakePicker = useCallback(() => {
    if (pickerIdleTimerRef.current) clearTimeout(pickerIdleTimerRef.current);
  }, []);

  // Sync picker rotation when route changes (only if open or first mount)
  useEffect(() => {
    if (pickerDragRef.current) return;
    setSnapping(true);
    setRotation(activeIdx);
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
    snapTimerRef.current = setTimeout(() => setSnapping(false), SNAP_MS);
  }, [activeIdx]);

  // Close picker on route change
  useEffect(() => { setOpen(false); }, [pathname]);

  // Re-snap FAB position to nearest edge on viewport resize (so it doesn't fly off-screen)
  useEffect(() => {
    const onResize = () => {
      setFabPos(p => {
        const maxX = window.innerWidth - FAB_SIZE - FAB_MARGIN;
        const maxY = window.innerHeight - FAB_SIZE - FAB_MARGIN - 24;
        return {
          x: Math.max(FAB_MARGIN, Math.min(maxX, p.x)),
          y: Math.max(60, Math.min(maxY, p.y)),
        };
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ─── FAB drag/tap handlers ──────────────────────────────────
  const onFabStart = useCallback((cx: number, cy: number) => {
    wakeFab();
    fabDragRef.current = { sx: cx, sy: cy, fx: fabPos.x, fy: fabPos.y, moved: false, t: Date.now() };
  }, [fabPos.x, fabPos.y, wakeFab]);

  const onFabMove = useCallback((cx: number, cy: number) => {
    if (!fabDragRef.current) return;
    const dx = cx - fabDragRef.current.sx;
    const dy = cy - fabDragRef.current.sy;
    if (Math.abs(dx) + Math.abs(dy) > FAB_DRAG_THRESHOLD) fabDragRef.current.moved = true;
    if (!fabDragRef.current.moved) return;
    const maxX = window.innerWidth - FAB_SIZE - FAB_MARGIN;
    const maxY = window.innerHeight - FAB_SIZE - FAB_MARGIN - 24;
    setFabPos({
      x: Math.max(FAB_MARGIN, Math.min(maxX, fabDragRef.current.fx + dx)),
      y: Math.max(60, Math.min(maxY, fabDragRef.current.fy + dy)),
    });
  }, []);

  const onFabEnd = useCallback(() => {
    if (!fabDragRef.current) return;
    const wasDrag = fabDragRef.current.moved;
    const elapsed = Date.now() - fabDragRef.current.t;
    fabDragRef.current = null;

    if (!wasDrag && elapsed < FAB_TAP_MAX_MS) {
      // Pure tap → open picker; reset the "interacted" flag so the
      // up/down arrow hints pulse fresh for this open session.
      setOpen(true);
      setInteracted(false);
      wakePicker();
      schedulePickerClose();
      return;
    }
    // Drag ended → snap FAB to nearest left/right edge so it never sits
    // permanently over content.
    setFabPos(p => {
      const w = window.innerWidth;
      const snapped = {
        x: p.x + FAB_SIZE / 2 < w / 2 ? FAB_MARGIN : w - FAB_SIZE - FAB_MARGIN,
        y: p.y,
      };
      try { localStorage.setItem(LS_KEY, JSON.stringify(snapped)); } catch {}
      return snapped;
    });
    scheduleFabIdle();
  }, [scheduleFabIdle, schedulePickerClose, wakePicker]);

  // ─── Picker drag handlers ───────────────────────────────────
  const onPickerStart = useCallback((cy: number) => {
    wakePicker();
    setSnapping(false);
    pickerDragRef.current = { sy: cy, sr: rotation, moved: false };
  }, [rotation, wakePicker]);

  const onPickerMove = useCallback((cy: number) => {
    if (!pickerDragRef.current) return;
    const dy = cy - pickerDragRef.current.sy;
    if (Math.abs(dy) > 4 && !pickerDragRef.current.moved) {
      pickerDragRef.current.moved = true;
      // First real movement → fade out the arrow hints
      setInteracted(true);
    }
    // Downward drag → items move down, so rotation decreases (earlier items come into view)
    const next = pickerDragRef.current.sr - dy / DRAG_PX_PER_ITEM;
    setRotation(((next % N) + N) % N);
  }, []);

  const onPickerEnd = useCallback(() => {
    if (!pickerDragRef.current) return;
    const wasDrag = pickerDragRef.current.moved;
    const startRot = pickerDragRef.current.sr;
    pickerDragRef.current = null;

    setSnapping(true);
    setRotation(r => ((Math.round(r) % N) + N) % N);
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
    snapTimerRef.current = setTimeout(() => setSnapping(false), SNAP_MS);

    if (!wasDrag) {
      // Tap on centre → navigate (or open external link in new tab)
      const centreIdx = ((Math.round(startRot) % N) + N) % N;
      const target = items[centreIdx];
      if (target && target.href !== pathname) {
        if (target.external) {
          window.open(target.href, "_blank", "noopener,noreferrer");
        } else {
          router.push(target.href);
        }
      }
      setOpen(false);
      return;
    }
    schedulePickerClose();
  }, [pathname, router, schedulePickerClose]);

  // Desktop wheel-scroll on the picker
  useEffect(() => {
    if (!open) return;
    const el = document.querySelector(".dialer-picker") as HTMLElement | null;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      wakePicker();
      setSnapping(false);
      setRotation(r => {
        const next = r + Math.sign(e.deltaY) * 0.5;
        return ((next % N) + N) % N;
      });
      if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
      snapTimerRef.current = setTimeout(() => {
        setSnapping(true);
        setRotation(r => ((Math.round(r) % N) + N) % N);
        setTimeout(() => setSnapping(false), SNAP_MS);
        schedulePickerClose();
      }, 220);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [open, wakePicker, schedulePickerClose]);

  // Cleanup
  useEffect(() => () => {
    if (fabIdleTimerRef.current) clearTimeout(fabIdleTimerRef.current);
    if (pickerIdleTimerRef.current) clearTimeout(pickerIdleTimerRef.current);
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
  }, []);

  // Hide on admin / partner / onboard routes. ALSO hide on the reel-feed
  // app surface (/, /discover, /reels, /me) — those use the Instagram-
  // style bottom dock instead of the left-edge crown wheel, per design ask.
  // v221 — also hide on /bid. The FAB has `touch-action: none` which
  // means the OS receives no touch events under it. The FAB defaults
  // near the screen edges where Android's edge-back-swipe lives, so
  // when /bid renders fullscreen-style the FAB silently swallows the
  // back gesture (user report: "back karne ke liye mobile ke default
  // navigation gesture button ko forcefully block karta hai").
  // /bid is a focused workflow surface — BottomDock + the climber's
  // own X / Done buttons + the new desktop ← back chip cover nav.
  if (pathname.startsWith("/admin") ||
      pathname.startsWith("/partner") ||
      pathname.startsWith("/worker") ||
      pathname.startsWith("/agent") ||
      pathname.startsWith("/onboard") ||
      pathname.startsWith("/host") ||
      pathname.startsWith("/circle") ||   // v288 StayCircle — own chrome
      pathname.startsWith("/order") ||
      pathname.startsWith("/kiosk") ||
      pathname.startsWith("/bid") ||
      pathname === "/" ||
      pathname.startsWith("/discover") ||
      pathname.startsWith("/reels") ||
      pathname.startsWith("/me") ||
      pathname.startsWith("/saved/posts")) {
    return null;
  }

  const centreIdx = ((Math.round(rotation) % N) + N) % N;
  const centreItem = items[centreIdx];
  const activeItem = items[activeIdx];

  // Picker appears on the SAME side as the FAB so the FAB feels like the
  // "handle" of the picker — close to it.
  const fabOnLeft = typeof window !== "undefined" && fabPos.x + FAB_SIZE / 2 < window.innerWidth / 2;
  const pickerLeft = fabOnLeft
    ? fabPos.x + FAB_SIZE + 12
    : fabPos.x - PICKER_WIDTH - 12;
  const pickerTop = typeof window !== "undefined"
    ? Math.max(40, Math.min(window.innerHeight - PICKER_HEIGHT - 40, fabPos.y + FAB_SIZE / 2 - PICKER_HEIGHT / 2))
    : 100;

  return (
    <>
      <style jsx global>{`
        @keyframes dialerFabBreath {
          0%, 100% { box-shadow: 0 8px 22px rgba(140, 160, 182,0.4), 0 0 0 0 rgba(140, 160, 182,0.5), inset 0 2px 0 rgba(255,255,255,0.5); }
          50%      { box-shadow: 0 10px 28px rgba(140, 160, 182,0.55), 0 0 0 8px rgba(140, 160, 182,0), inset 0 2px 0 rgba(255,255,255,0.5); }
        }
        @keyframes dialerFabPopIn {
          0%   { transform: scale(0.6); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes dialerBackdropIn {
          from { opacity: 0; backdrop-filter: blur(0px); }
          to   { opacity: 1; backdrop-filter: blur(8px); }
        }
        @keyframes dialerPickerIn {
          from { opacity: 0; transform: scale(0.85); }
          to   { opacity: 1; transform: scale(1); }
        }

        /* ── Floating FAB ─────────────────────────────────────── */
        .dialer-fab {
          position: fixed;
          width: ${FAB_SIZE}px; height: ${FAB_SIZE}px;
          border-radius: 50%;
          background: linear-gradient(135deg, #c6d0da 0%, #a9b9c8 55%, #8198ae 100%);
          color: #1a1208;
          display: flex; align-items: center; justify-content: center;
          font-size: 1.4rem; font-weight: 800;
          border: 1px solid rgba(176, 192, 209,0.7);
          padding: 0; cursor: grab;
          outline: none;
          z-index: 60;
          touch-action: none;
          user-select: none;
          -webkit-user-select: none;
          will-change: transform, left, top, opacity;
          animation:
            dialerFabPopIn 0.4s cubic-bezier(.34,1.5,.64,1) both,
            dialerFabBreath 2.6s ease-in-out infinite;
          transition: opacity 0.55s ease, left 0.32s cubic-bezier(.34,1.4,.64,1), top 0.32s cubic-bezier(.34,1.4,.64,1);
        }
        .dialer-fab:active { cursor: grabbing; }
        .dialer-fab.is-dim { opacity: 0.42; }
        .dialer-fab.is-dragging {
          /* Skip the position transition while finger-tracking so it
             feels instant under the finger. */
          transition: opacity 0.4s ease;
        }
        @media (min-width: 768px) { .dialer-fab { display: none; } }
        /* v124.2 — hide dialer when any modal is open so it never overlaps
           a modal's left-edge content (calendar prev/next, etc.). */
        body.sb-modal-open .dialer-fab,
        body.sb-composer-open .dialer-fab { display: none !important; }

        /* ── Backdrop (picker open) ───────────────────────────── */
        .dialer-backdrop {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.55);
          backdrop-filter: blur(10px) saturate(140%);
          -webkit-backdrop-filter: blur(10px) saturate(140%);
          z-index: 58;
          animation: dialerBackdropIn 0.25s ease both;
        }

        /* ── iPhone-style picker ──────────────────────────────────────
           v64: TRUE translucent (0.25 alpha) — no "solid box" feel.
           Selection box / gold band removed — only the centre gold-pill
           item indicates selection (no rectangular bracket around it).
           Top/bottom fades kept but much subtler. */
        .dialer-picker {
          position: fixed;
          width: ${PICKER_WIDTH}px;
          height: ${PICKER_HEIGHT}px;
          z-index: 59;
          padding: 18px 0;
          border-radius: 28px;
          background: linear-gradient(180deg, rgba(22,18,32,0.22), rgba(10,8,16,0.30));
          backdrop-filter: blur(20px) saturate(160%);
          -webkit-backdrop-filter: blur(20px) saturate(160%);
          border: none;
          box-shadow:
            0 18px 50px rgba(0,0,0,0.45),
            0 4px 10px rgba(0,0,0,0.30);
          touch-action: none;
          animation: dialerPickerIn 0.32s cubic-bezier(.34,1.4,.64,1) both;
          transform-origin: center center;
        }
        /* Subtle vertical fade at top + bottom so extreme items dissolve
           into the translucent backdrop rather than getting clipped.
           No selection band — the gold centre item alone marks selection. */
        .dialer-picker::after {
          content: "";
          position: absolute; inset: 0;
          border-radius: 28px;
          background:
            linear-gradient(180deg,
              rgba(10,8,16,0.55) 0%,
              transparent 22%,
              transparent 78%,
              rgba(10,8,16,0.55) 100%);
          pointer-events: none;
        }

        /* ── Up / Down chevron hints ───────────────────────────────────
           Tells users "this list scrolls vertically". Pulsing animation
           draws the eye; they fade out once the user has interacted.
           When picker first opens, both arrows pulse so the affordance
           is immediately visible. */
        @keyframes dialerArrowPulseUp {
          0%, 100% { transform: translate(-50%, 0) scale(1); opacity: 0.55; }
          50%      { transform: translate(-50%, -4px) scale(1.15); opacity: 1; }
        }
        @keyframes dialerArrowPulseDown {
          0%, 100% { transform: translate(-50%, 0) scale(1); opacity: 0.55; }
          50%      { transform: translate(-50%, 4px) scale(1.15); opacity: 1; }
        }
        .dialer-picker-arrow {
          position: absolute;
          left: 50%;
          width: 28px;
          height: 28px;
          display: flex; align-items: center; justify-content: center;
          color: #cbd5de;
          font-size: 0.9rem;
          font-weight: 800;
          line-height: 1;
          pointer-events: none;
          filter: drop-shadow(0 0 6px rgba(140, 160, 182,0.65));
          transition: opacity 0.4s ease;
          z-index: 11;
        }
        .dialer-picker-arrow.up {
          top: -2px;
          animation: dialerArrowPulseUp 1.4s ease-in-out infinite;
        }
        .dialer-picker-arrow.down {
          bottom: -2px;
          animation: dialerArrowPulseDown 1.4s ease-in-out infinite;
        }
        /* After user interacts, arrows fade out to reduce visual noise */
        .dialer-picker.interacted .dialer-picker-arrow { opacity: 0.18; }

        /* Wheel track inside the picker — items absolutely positioned. */
        .dialer-picker-track {
          position: relative;
          width: 100%; height: 100%;
        }

        .picker-item {
          position: absolute;
          left: 50%; top: 50%;
          width: 48px; height: 48px;
          margin: -24px 0 0 -24px;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 1.4rem;
          color: rgba(255,255,255,0.92);
          /* BORDERLESS — no outline ring; just the icon sitting on
             the picker background. Centre item gets its own gold pill
             via .is-centre. */
          background: transparent;
          border: none;
          box-shadow: none;
          padding: 0; cursor: pointer; outline: none;
          will-change: transform, opacity;
          /* Subtle text shadow keeps the emoji readable against the
             translucent picker bg without needing a button background. */
          text-shadow: 0 2px 4px rgba(0,0,0,0.55);
          transition: background 0.3s ease, color 0.3s ease, box-shadow 0.4s ease;
        }
        .picker-item.snapping {
          transition:
            transform ${SNAP_MS}ms cubic-bezier(.32,1.2,.36,1),
            opacity   ${SNAP_MS}ms cubic-bezier(.32,1.2,.36,1),
            background 0.3s ease,
            color 0.3s ease,
            box-shadow 0.4s ease,
            border-color 0.3s ease;
        }
        .picker-item.is-centre {
          /* Centre item keeps the gold pill so user knows it's selected.
             Still borderless — depth comes from gradient + glow halo,
             not from an outline ring. */
          background: linear-gradient(135deg, rgba(176, 192, 209,0.98) 0%, rgba(140, 160, 182,0.98) 55%, rgba(106, 133, 160,0.98) 100%);
          color: #1a1208;
          text-shadow: none;
          box-shadow:
            0 10px 28px rgba(140, 160, 182,0.55),
            0 0 0 4px rgba(140, 160, 182,0.18),
            inset 0 2px 0 rgba(255,255,255,0.55),
            inset 0 -2px 0 rgba(120,80,0,0.3);
        }

        .picker-item-pulse {
          position: absolute;
          top: 5px; right: 7px;
          width: 7px; height: 7px;
          border-radius: 50%;
          background: #ff3859;
          box-shadow: 0 0 8px #ff3859, 0 0 0 2px rgba(20,18,30,0.95);
          pointer-events: none;
        }

        /* Floating label chip next to the picker */
        .dialer-picker-label {
          position: fixed;
          z-index: 60;
          padding: 9px 14px;
          background: linear-gradient(135deg, rgba(20,18,30,0.95), rgba(10,8,16,0.97));
          backdrop-filter: blur(16px) saturate(180%);
          -webkit-backdrop-filter: blur(16px) saturate(180%);
          border: 1px solid rgba(140, 160, 182,0.5);
          border-radius: 999px;
          box-shadow: 0 10px 28px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.1);
          display: flex; flex-direction: column; align-items: flex-start;
          gap: 2px;
          pointer-events: none;
          white-space: nowrap;
          animation: dialerPickerIn 0.32s cubic-bezier(.34,1.4,.64,1) both;
        }
        .dialer-picker-label-name {
          font-size: 0.78rem;
          font-weight: 800;
          letter-spacing: 0.04em;
          color: #cbd5de;
          line-height: 1;
        }
        .dialer-picker-label-use {
          font-size: 0.6rem;
          color: rgba(255,255,255,0.6);
          letter-spacing: 0.02em;
          line-height: 1;
        }

        /* Subtle hint dot on FAB indicating active route */
        .dialer-fab-dot {
          position: absolute;
          top: 4px; right: 4px;
          width: 7px; height: 7px;
          border-radius: 50%;
          background: #ff3859;
          box-shadow: 0 0 6px #ff3859;
          pointer-events: none;
        }
      `}</style>

      {/* ── FAB (always rendered, draggable, shows current route icon) ── */}
      <button
        className={`dialer-fab ${fabDim && !open ? "is-dim" : ""} ${fabDragRef.current?.moved ? "is-dragging" : ""}`}
        style={{ left: `${fabPos.x}px`, top: `${fabPos.y}px` }}
        aria-label={`Navigation menu (current: ${activeItem.label})`}
        onTouchStart={(e) => onFabStart(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchMove={(e) => onFabMove(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchEnd={onFabEnd}
        onTouchCancel={onFabEnd}
        onMouseDown={(e) => onFabStart(e.clientX, e.clientY)}
        onMouseMove={(e) => { if (fabDragRef.current) onFabMove(e.clientX, e.clientY); }}
        onMouseUp={onFabEnd}
        onMouseLeave={() => { if (fabDragRef.current) onFabEnd(); }}
      >
        <span>{activeItem.icon}</span>
        {items.some(it => it.pulse && it.href !== activeItem.href) && (
          <span className="dialer-fab-dot" />
        )}
      </button>

      {/* ── Backdrop + Picker (open state) ─────────────────────── */}
      {open && (
        <>
          <div className="dialer-backdrop" onClick={() => setOpen(false)} />
          <div
            className={`dialer-picker ${interacted ? "interacted" : ""}`}
            style={{ left: `${pickerLeft}px`, top: `${pickerTop}px` }}
            onTouchStart={(e) => onPickerStart(e.touches[0].clientY)}
            onTouchMove={(e) => onPickerMove(e.touches[0].clientY)}
            onTouchEnd={onPickerEnd}
            onTouchCancel={onPickerEnd}
            onMouseDown={(e) => onPickerStart(e.clientY)}
            onMouseMove={(e) => { if (pickerDragRef.current) onPickerMove(e.clientY); }}
            onMouseUp={onPickerEnd}
            onMouseLeave={() => { if (pickerDragRef.current) onPickerEnd(); }}
          >
            {/* Pulsing up/down chevrons — visual hint that the picker
                scrolls vertically. Fade out once user starts dragging
                (.interacted class). */}
            <span className="dialer-picker-arrow up" aria-hidden>▲</span>
            <span className="dialer-picker-arrow down" aria-hidden>▼</span>

            <div className="dialer-picker-track">
              {items.map((item, i) => {
                // Signed wrapped distance from centre. Range: (-N/2, N/2]
                let d = i - rotation;
                d = ((d + N / 2) % N + N) % N - N / 2;
                const absD = Math.abs(d);
                // Render 5 items max (2 above + centre + 2 below)
                if (absD > 2.5) return null;

                const y = d * ITEM_SPACING;
                // Smooth scaling: 1 at centre, 0.78, 0.55 at ±2
                const scale = Math.max(0.5, 1 - absD * 0.22);
                // Smooth opacity: 1 at centre, 0.65, 0.3 at ±2
                const opacity = Math.max(0.18, 1 - absD * 0.32);
                const isCentre = absD < 0.5;

                return (
                  <button
                    key={item.href}
                    className={`picker-item ${isCentre ? "is-centre" : ""} ${snapping ? "snapping" : ""}`}
                    style={{
                      transform: `translateY(${y.toFixed(2)}px) scale(${scale.toFixed(3)})`,
                      opacity: opacity.toFixed(3),
                      zIndex: 10 + Math.round((1 - absD) * 10),
                    }}
                    aria-label={`${item.label} — ${item.useCase}`}
                    tabIndex={isCentre ? 0 : -1}
                    onClick={(e) => {
                      e.preventDefault();
                      if (pickerDragRef.current?.moved) return;
                      if (isCentre) {
                        if (item.href !== pathname) {
                          if (item.external) {
                            window.open(item.href, "_blank", "noopener,noreferrer");
                          } else {
                            router.push(item.href);
                          }
                        }
                        setOpen(false);
                      } else {
                        // v64: tapping ANY visible item navigates directly
                        // (no "snap to centre then tap again" two-step).
                        if (item.href !== pathname) {
                          if (item.external) {
                            window.open(item.href, "_blank", "noopener,noreferrer");
                          } else {
                            router.push(item.href);
                          }
                        }
                        setOpen(false);
                      }
                    }}
                  >
                    <span>{item.icon}</span>
                    {item.pulse && !isCentre && <span className="picker-item-pulse" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Floating label chip next to the picker centre */}
          {centreItem && (
            <div
              className="dialer-picker-label"
              key={centreItem.href}
              style={{
                left: `${fabOnLeft ? pickerLeft + PICKER_WIDTH + 10 : pickerLeft - 140}px`,
                top: `${pickerTop + PICKER_HEIGHT / 2 - 18}px`,
              }}
            >
              <span className="dialer-picker-label-name">{centreItem.label}</span>
              <span className="dialer-picker-label-use">{centreItem.useCase}</span>
            </div>
          )}
        </>
      )}
    </>
  );
}
