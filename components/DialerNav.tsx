"use client";
/* ─────────────────────────────────────────────────────────────────────
   DialerNav — Apple-Watch-crown style rotating wheel on the LEFT edge.

   Design rules (per user request, v60):
     ─ NO container border / background. The wheel chrome is invisible;
       only the round buttons themselves are visible elements.
     ─ Wheel is mostly OFF-SCREEN. Only ~30px of its right rim peeks out
       from the left edge of the screen. Items at the back of the wheel
       are hidden naturally.
     ─ NO close (✕) button. Touch wakes the wheel up; 1s after release
       it auto-snaps + dims back to idle.
     ─ Whole wheel does NOT zoom on tap. Only the button at the 3-o'clock
       "selection slot" grows — and even that growth is a side-effect of
       items rotating IN AND OUT of the slot, not a tap response.
     ─ Drag vertically to rotate; the wheel wraps around like a Rolodex.
     ─ Tap the centred item → navigate.

   Math:
     Wheel center is anchored at x = -(R - PROTRUSION), y = 50% of viewport.
     Items at angle 0° (3-o'clock) sit at x = +PROTRUSION (visible).
     Items at ±90° sit on the screen edge, half hidden.
     Items past ±90° are behind the wheel — culled.
     Per-item scale + opacity are driven by cos(angle), creating the
     natural "growing in" feel as a button arrives at centre.

   Inertia / snap:
     onTouchEnd → smooth-snap to nearest integer rotation (300ms ease).
     1s after onTouchEnd with no further touch → `active` flips to false,
     wheel dims, growth amplitude reduces. Touch again to wake.
   ───────────────────────────────────────────────────────────────────── */
import { useEffect, useRef, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";

type Item = {
  href: string;
  label: string;
  icon: string;
  pulse?: boolean;
};

const ITEMS: Item[] = [
  { href: "/",            label: "Home",    icon: "🏠" },
  { href: "/hotels",      label: "Hotels",  icon: "🏨" },
  { href: "/discover",    label: "Reels",   icon: "🎬" },
  { href: "/flash-deals", label: "Deals",   icon: "⚡", pulse: true },
  { href: "/bid",         label: "Bid",     icon: "🎯" },
  { href: "/profile",     label: "Profile", icon: "👤" },
];

const N = ITEMS.length;
const ANGLE_STEP = 360 / N;       // 60°
const WHEEL_R = 110;              // wheel radius
const PROTRUSION = 32;            // px of the rim that pokes out from the screen edge
const WHEEL_CX = -(WHEEL_R - PROTRUSION);  // wheel centre X relative to screen left (-78)
const IDLE_MS = 1000;             // auto-dim after this long with no touch
const SNAP_MS = 320;              // snap-to-nearest animation duration
const DRAG_PX_PER_ITEM = 40;      // dial sensitivity — drag this many px to advance 1 item

export function DialerNav() {
  const pathname = usePathname() || "/";
  const router = useRouter();

  // Which ITEMS index corresponds to the current pathname
  const activeIdx = (() => {
    if (pathname === "/") return 0;
    const i = ITEMS.findIndex(it =>
      it.href !== "/" && (pathname === it.href || pathname.startsWith(it.href + "/"))
    );
    return i >= 0 ? i : 0;
  })();

  // Rotation in fractional items. 0 = ITEMS[0] at 3-o'clock.
  const [rotation, setRotation] = useState(activeIdx);
  // "active" = user touched within the last IDLE_MS milliseconds
  const [active, setActive] = useState(false);
  // "snapping" = a smooth rotation animation is in flight (post-release)
  const [snapping, setSnapping] = useState(false);

  const dragRef = useRef<{ startY: number; startRot: number; moved: boolean } | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When user navigates to a new route, rotate so that route is at centre
  useEffect(() => {
    if (dragRef.current) return; // don't fight an in-progress drag
    setSnapping(true);
    setRotation(activeIdx);
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
    snapTimerRef.current = setTimeout(() => setSnapping(false), SNAP_MS);
  }, [activeIdx]);

  // Schedule the auto-dim
  const scheduleIdle = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => setActive(false), IDLE_MS);
  }, []);

  // Wake the wheel (called whenever the user touches it)
  const wake = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    setActive(true);
  }, []);

  const onStart = useCallback((clientY: number) => {
    wake();
    setSnapping(false);
    dragRef.current = { startY: clientY, startRot: rotation, moved: false };
  }, [rotation, wake]);

  const onMove = useCallback((clientY: number) => {
    if (!dragRef.current) return;
    const dy = clientY - dragRef.current.startY;
    if (Math.abs(dy) > 3) dragRef.current.moved = true;
    // Downward drag → items rotate forward (toward higher index)
    const next = dragRef.current.startRot + dy / DRAG_PX_PER_ITEM;
    setRotation(((next % N) + N) % N);
  }, []);

  const onEnd = useCallback(() => {
    if (!dragRef.current) return;
    const wasDrag = dragRef.current.moved;
    const startRot = dragRef.current.startRot;
    dragRef.current = null;

    // Snap to nearest integer
    setSnapping(true);
    setRotation(r => ((Math.round(r) % N) + N) % N);
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
    snapTimerRef.current = setTimeout(() => setSnapping(false), SNAP_MS);

    // Pure tap (no drag) → navigate to centre item
    if (!wasDrag) {
      const centreIdx = ((Math.round(startRot) % N) + N) % N;
      const target = ITEMS[centreIdx];
      if (target && target.href !== pathname) {
        router.push(target.href);
      }
    }

    scheduleIdle();
  }, [pathname, router, scheduleIdle]);

  // Wheel scroll (desktop trackpad / mouse wheel)
  useEffect(() => {
    const root = document.querySelector(".dialer-root") as HTMLElement | null;
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      wake();
      setSnapping(false);
      setRotation(r => {
        const next = r + Math.sign(e.deltaY) * 0.6;
        return ((next % N) + N) % N;
      });
      // Treat wheel scroll like a drag — snap to nearest after a beat, then idle
      if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
      snapTimerRef.current = setTimeout(() => {
        setSnapping(true);
        setRotation(r => ((Math.round(r) % N) + N) % N);
        setTimeout(() => setSnapping(false), SNAP_MS);
        scheduleIdle();
      }, 180);
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [wake, scheduleIdle]);

  // Cleanup timers on unmount
  useEffect(() => () => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
  }, []);

  // Hide on admin / partner / onboard routes
  if (pathname.startsWith("/admin") ||
      pathname.startsWith("/partner") ||
      pathname.startsWith("/onboard")) {
    return null;
  }

  return (
    <>
      <style jsx global>{`
        @keyframes dialerSheen {
          0%, 100% { background-position: 0% 50%; }
          50%      { background-position: 100% 50%; }
        }
        @keyframes dialerHintNudge {
          0%, 100% { transform: translateX(0); }
          50%      { transform: translateX(2px); }
        }

        .dialer-root {
          position: fixed;
          left: 0;
          top: 50%;
          /* Tall enough to contain the entire visible arc (+ R either side). */
          height: 320px;
          width: ${PROTRUSION + 16}px;
          transform: translateY(-50%);
          z-index: 50;
          touch-action: none;
          /* No background, no border — just a container for the floating
             buttons. The user should NOT see this rect. */
        }
        @media (min-width: 768px) { .dialer-root { display: none; } }

        .dialer-wheel {
          position: relative;
          width: 100%; height: 100%;
          /* Subtle scale-up while the user is actively interacting so the
             whole wheel "wakes up" — but only the items grow visibly; the
             wheel itself has no chrome. */
          transition: transform 0.4s cubic-bezier(.34,1.4,.64,1);
        }
        .dialer-wheel.is-active { transform: scale(1.05); }

        .dialer-item {
          position: absolute;
          left: 0;
          top: 50%;
          width: 38px; height: 38px;
          margin: -19px 0 0 -19px;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          background: linear-gradient(180deg, rgba(30,26,42,0.95), rgba(10,8,16,0.95));
          color: rgba(255,255,255,0.78);
          font-size: 1.05rem;
          border: none;
          padding: 0;
          cursor: pointer;
          /* Depth — these are the only visible UI in the navbar */
          box-shadow:
            0 6px 16px rgba(0,0,0,0.55),
            0 2px 5px rgba(0,0,0,0.35),
            inset 0 1px 0 rgba(255,255,255,0.10),
            inset 0 -1px 0 rgba(0,0,0,0.4);
          will-change: transform, opacity;
          /* No transition on transform during drag — JS sets it every frame. */
          transition: background 0.3s ease, color 0.3s ease, box-shadow 0.3s ease;
          /* Drop the focus ring outline (only show on keyboard nav) */
          outline: none;
        }
        .dialer-item.snapping {
          transition:
            transform ${SNAP_MS}ms cubic-bezier(.34,1.4,.64,1),
            opacity   ${SNAP_MS}ms ease,
            background 0.3s ease,
            color 0.3s ease,
            box-shadow 0.3s ease;
        }
        .dialer-item:focus-visible {
          box-shadow:
            0 0 0 2px rgba(240,180,41,0.65),
            0 6px 16px rgba(0,0,0,0.55);
        }

        /* The centred (3-o'clock) item — gold, glowing, bigger feel.
           The scale is set inline (driven by cosine of angle to centre)
           so it's already big; this class just colorizes it. */
        .dialer-item.is-centre {
          background: linear-gradient(135deg, #f0d060 0%, #f0b429 55%, #c9911a 100%);
          color: #1a1208;
          box-shadow:
            0 8px 22px rgba(240,180,41,0.45),
            0 2px 6px rgba(0,0,0,0.35),
            inset 0 2px 0 rgba(255,255,255,0.55),
            inset 0 -2px 0 rgba(120,80,0,0.3);
        }
        .dialer-wheel.is-active .dialer-item.is-centre {
          /* While actively engaged, the centre glows brighter + has a soft halo */
          box-shadow:
            0 10px 30px rgba(240,180,41,0.75),
            0 0 0 5px rgba(240,180,41,0.18),
            inset 0 2px 0 rgba(255,255,255,0.6),
            inset 0 -2px 0 rgba(120,80,0,0.3);
        }

        .dialer-item-pulse {
          position: absolute;
          top: 6px; right: 7px;
          width: 6px; height: 6px;
          border-radius: 50%;
          background: #ff3859;
          box-shadow: 0 0 6px #ff3859;
        }

        /* Idle-state subtle hint chevron — peeks out at the centred item's
           right edge when wheel is dim. Disappears on touch (.is-active). */
        .dialer-hint {
          position: absolute;
          left: ${PROTRUSION + 6}px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 0.55rem;
          color: rgba(240,180,41,0.55);
          font-weight: 800;
          letter-spacing: 0.1em;
          animation: dialerHintNudge 1.8s ease-in-out infinite;
          pointer-events: none;
          transition: opacity 0.3s ease;
          opacity: 1;
        }
        .dialer-wheel.is-active ~ .dialer-hint,
        .dialer-wheel.is-active .dialer-hint {
          opacity: 0;
        }
      `}</style>

      <div
        className="dialer-root"
        onTouchStart={(e) => onStart(e.touches[0].clientY)}
        onTouchMove={(e) => onMove(e.touches[0].clientY)}
        onTouchEnd={onEnd}
        onTouchCancel={onEnd}
        onMouseDown={(e) => { onStart(e.clientY); }}
        onMouseMove={(e) => { if (dragRef.current) onMove(e.clientY); }}
        onMouseUp={onEnd}
        onMouseLeave={() => { if (dragRef.current) onEnd(); }}
      >
        <div className={`dialer-wheel ${active ? "is-active" : ""}`}>
          {ITEMS.map((item, i) => {
            // Angle (degrees) from 3-o'clock position. Positive = below.
            let angle = (i - rotation) * ANGLE_STEP;
            // Normalize to [-180, 180]
            angle = ((angle % 360) + 540) % 360 - 180;

            // Cull items behind the wheel (rendered, but not on the visible side).
            // cos(±90°) = 0 ; allow a small overshoot so they fade smoothly.
            if (Math.cos(angle * Math.PI / 180) < -0.15) return null;

            const rad = angle * Math.PI / 180;
            const cosA = Math.cos(rad);
            const sinA = Math.sin(rad);
            const x = WHEEL_CX + cosA * WHEEL_R;
            const y = sinA * WHEEL_R;

            // Scale: centre = big, edges = small. Active state amplifies.
            const baseScale = active ? 0.55 : 0.45;
            const scaleVar  = active ? 0.75 : 0.55;
            const scale = baseScale + Math.max(0, cosA) * scaleVar;

            // Opacity fades as the item rotates toward 90°+
            const opacity = Math.max(0.15, cosA * 1.1);
            const isCentre = Math.abs(angle) < ANGLE_STEP / 2;

            return (
              <button
                key={item.href}
                className={`dialer-item ${isCentre ? "is-centre" : ""} ${snapping ? "snapping" : ""}`}
                aria-label={item.label}
                style={{
                  transform: `translate(${x}px, ${y}px) scale(${scale.toFixed(3)})`,
                  opacity: opacity.toFixed(3),
                  zIndex: 10 + Math.round(cosA * 10),
                }}
                tabIndex={isCentre ? 0 : -1}
              >
                <span>{item.icon}</span>
                {item.pulse && !isCentre && <span className="dialer-item-pulse" />}
              </button>
            );
          })}
          <span className="dialer-hint" aria-hidden>›</span>
        </div>
      </div>
    </>
  );
}
