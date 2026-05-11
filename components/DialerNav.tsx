"use client";
/* ─────────────────────────────────────────────────────────────────────
   DialerNav — Apple-Watch-crown style rotating wheel (v61).

   v61 changes per user feedback:
     1) Slower scroll → 80 px / item (was 40). More deliberate, smoother.
     2) Smoother snap → 480 ms with even softer easing.
     3) Translucent glass buttons (backdrop-filter blur).
     4) Each item carries a "use-case" sublabel (e.g. Home → "your stays").
     5) Floating label chip fades in next to the centred item with both
        the item name AND its purpose so any user knows what's there.
     6) Idle state: WHOLE dialer drops to opacity 0.35 — barely visible
        silhouette on the screen edge. Content behind stays readable.
     7) Root has pointer-events: none. Only the items + an invisible
        "wake-zone" strip on the rim are tappable, so content elsewhere
        on the screen edge isn't blocked.
     8) Touch wake-zone OR any item to wake the wheel. Drag-anywhere on
        the rim works because the wake-zone owns the drag handlers too.

   Behaviour reminders (unchanged from v60):
     • Wheel mostly off-screen — only ~32 px of rim peeks out.
     • Drag vertically to rotate. Wraps mod N.
     • Tap a centred item → navigate.
     • 1 s after release → idle (opacity drops, glow softens).
     • Whole wheel never zooms on tap; only individual items grow as
       they arrive at the 3-o'clock slot via cos(angle) scale.
   ───────────────────────────────────────────────────────────────────── */
import { useEffect, useRef, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";

type Item = {
  href: string;
  label: string;
  useCase: string;
  icon: string;
  pulse?: boolean;
};

const ITEMS: Item[] = [
  { href: "/",            label: "Home",    useCase: "your stays",      icon: "🏠" },
  { href: "/hotels",      label: "Hotels",  useCase: "browse stays",    icon: "🏨" },
  { href: "/discover",    label: "Reels",   useCase: "watch hotel reels", icon: "🎬" },
  { href: "/flash-deals", label: "Deals",   useCase: "live flash sales",  icon: "⚡", pulse: true },
  { href: "/bid",         label: "Bid",     useCase: "name your price",   icon: "🎯" },
  { href: "/profile",     label: "Profile", useCase: "your account",      icon: "👤" },
];

const N = ITEMS.length;
const ANGLE_STEP = 360 / N;           // 60°
const WHEEL_R = 110;                  // wheel radius
const PROTRUSION = 36;                // visible rim width
const WHEEL_CX = -(WHEEL_R - PROTRUSION);  // -74
const IDLE_MS = 1000;                 // auto-dim delay
const SNAP_MS = 480;                  // snap-to-nearest duration (v61: was 320)
const DRAG_PX_PER_ITEM = 80;          // v61: was 40 — slower, smoother

export function DialerNav() {
  const pathname = usePathname() || "/";
  const router = useRouter();

  // Which ITEMS index corresponds to current pathname
  const activeIdx = (() => {
    if (pathname === "/") return 0;
    const i = ITEMS.findIndex(it =>
      it.href !== "/" && (pathname === it.href || pathname.startsWith(it.href + "/"))
    );
    return i >= 0 ? i : 0;
  })();

  const [rotation, setRotation] = useState(activeIdx);
  const [active, setActive] = useState(false);
  const [snapping, setSnapping] = useState(false);

  const dragRef = useRef<{ startY: number; startRot: number; moved: boolean } | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync wheel to active route on navigation
  useEffect(() => {
    if (dragRef.current) return;
    setSnapping(true);
    setRotation(activeIdx);
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
    snapTimerRef.current = setTimeout(() => setSnapping(false), SNAP_MS);
  }, [activeIdx]);

  const scheduleIdle = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => setActive(false), IDLE_MS);
  }, []);

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
    if (Math.abs(dy) > 4) dragRef.current.moved = true;
    const next = dragRef.current.startRot + dy / DRAG_PX_PER_ITEM;
    setRotation(((next % N) + N) % N);
  }, []);

  const onEnd = useCallback(() => {
    if (!dragRef.current) return;
    const wasDrag = dragRef.current.moved;
    const startRot = dragRef.current.startRot;
    dragRef.current = null;

    setSnapping(true);
    setRotation(r => ((Math.round(r) % N) + N) % N);
    if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
    snapTimerRef.current = setTimeout(() => setSnapping(false), SNAP_MS);

    // Pure tap → navigate
    if (!wasDrag) {
      const centreIdx = ((Math.round(startRot) % N) + N) % N;
      const target = ITEMS[centreIdx];
      if (target && target.href !== pathname) {
        router.push(target.href);
      }
    }
    scheduleIdle();
  }, [pathname, router, scheduleIdle]);

  // Desktop wheel-scroll
  useEffect(() => {
    const zone = document.querySelector(".dialer-wake-zone") as HTMLElement | null;
    if (!zone) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      wake();
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
        scheduleIdle();
      }, 220);
    };
    zone.addEventListener("wheel", onWheel, { passive: false });
    return () => zone.removeEventListener("wheel", onWheel);
  }, [wake, scheduleIdle]);

  // Cleanup
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

  // Currently centred item (for the floating label)
  const centreIdx = ((Math.round(rotation) % N) + N) % N;
  const centreItem = ITEMS[centreIdx];

  return (
    <>
      <style jsx global>{`
        @keyframes dialerLabelIn {
          0%   { opacity: 0; transform: translate(8px, -50%); }
          100% { opacity: 1; transform: translate(0, -50%); }
        }
        @keyframes dialerBreath {
          0%, 100% { box-shadow: 0 6px 18px rgba(240,180,41,0.4), 0 0 0 0 rgba(240,180,41,0.5), inset 0 1px 0 rgba(255,255,255,0.5); }
          50%      { box-shadow: 0 6px 22px rgba(240,180,41,0.5), 0 0 0 6px rgba(240,180,41,0), inset 0 1px 0 rgba(255,255,255,0.5); }
        }
        @keyframes dialerHintNudge {
          0%, 100% { transform: translateY(-50%) translateX(0); }
          50%      { transform: translateY(-50%) translateX(3px); }
        }

        .dialer-root {
          position: fixed;
          left: 0;
          top: 50%;
          width: 64px;
          height: 320px;
          transform: translateY(-50%);
          z-index: 50;
          /* The container itself is INVISIBLE — only the wake-zone strip
             and the round items inside it are tappable. Content elsewhere
             on the screen flows through unobstructed. */
          pointer-events: none;
          /* Smooth idle ↔ active opacity transition. The user always sees
             SOMETHING — when idle, it's a faint silhouette so they know
             the dial exists; when active, it's full strength. */
          transition: opacity 0.55s ease;
          opacity: 0.42;
        }
        .dialer-root.is-active { opacity: 1; }
        @media (min-width: 768px) { .dialer-root { display: none; } }

        /* Invisible touch strip along the visible rim. The user can drag
           anywhere along this zone — not just on a specific button —
           which matches the Apple-Watch-crown feel where you can spin
           it from any contact point. */
        .dialer-wake-zone {
          position: absolute;
          left: 0;
          top: 0;
          width: ${PROTRUSION + 12}px;
          height: 100%;
          pointer-events: auto;
          touch-action: none;
          cursor: grab;
        }
        .dialer-wake-zone:active { cursor: grabbing; }

        .dialer-wheel {
          position: relative;
          width: 100%; height: 100%;
          transition: transform 0.45s cubic-bezier(.34,1.3,.64,1);
          pointer-events: none;
        }
        .dialer-root.is-active .dialer-wheel {
          transform: scale(1.06);
        }

        .dialer-item {
          position: absolute;
          left: 0;
          top: 50%;
          width: 42px; height: 42px;
          margin: -21px 0 0 -21px;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 1.15rem;
          color: rgba(255,255,255,0.85);
          /* Glassmorphism — translucent + blur instead of solid */
          background:
            linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.02));
          backdrop-filter: blur(12px) saturate(140%);
          -webkit-backdrop-filter: blur(12px) saturate(140%);
          border: 1px solid rgba(255,255,255,0.14);
          box-shadow:
            0 6px 16px rgba(0,0,0,0.5),
            0 2px 5px rgba(0,0,0,0.3),
            inset 0 1px 0 rgba(255,255,255,0.18),
            inset 0 -1px 0 rgba(0,0,0,0.3);
          padding: 0; cursor: pointer; outline: none;
          pointer-events: auto;
          will-change: transform, opacity;
          transition: background 0.3s ease, color 0.3s ease, box-shadow 0.4s ease, border-color 0.3s ease;
        }
        .dialer-item.snapping {
          transition:
            transform ${SNAP_MS}ms cubic-bezier(.32,1.2,.36,1),
            opacity   ${SNAP_MS}ms cubic-bezier(.32,1.2,.36,1),
            background 0.3s ease,
            color 0.3s ease,
            box-shadow 0.4s ease,
            border-color 0.3s ease;
        }

        /* Centred (3-o'clock) item */
        .dialer-item.is-centre {
          background:
            linear-gradient(135deg, rgba(255,225,140,0.95) 0%, rgba(240,180,41,0.95) 55%, rgba(201,145,26,0.95) 100%);
          color: #1a1208;
          border-color: rgba(255,231,140,0.7);
          box-shadow:
            0 8px 22px rgba(240,180,41,0.45),
            0 2px 6px rgba(0,0,0,0.35),
            inset 0 2px 0 rgba(255,255,255,0.55),
            inset 0 -2px 0 rgba(120,80,0,0.3);
        }
        .dialer-root.is-active .dialer-item.is-centre {
          /* Breathing glow halo while wheel is actively engaged */
          animation: dialerBreath 2.2s ease-in-out infinite;
        }

        .dialer-item-pulse {
          position: absolute;
          top: 6px; right: 8px;
          width: 7px; height: 7px;
          border-radius: 50%;
          background: #ff3859;
          box-shadow: 0 0 8px #ff3859, 0 0 0 2px rgba(20,18,30,0.95);
          pointer-events: none;
        }

        /* Floating label chip — fades in next to the centred item.
           Shows the item NAME (bold) + its USE-CASE (light). Tells any
           first-time user what each slot is for. */
        .dialer-label {
          position: absolute;
          left: ${PROTRUSION + 22}px;
          top: 50%;
          padding: 7px 12px 7px 14px;
          background: linear-gradient(135deg, rgba(20,18,30,0.92), rgba(10,8,16,0.95));
          backdrop-filter: blur(14px) saturate(180%);
          -webkit-backdrop-filter: blur(14px) saturate(180%);
          border: 1px solid rgba(240,180,41,0.45);
          border-radius: 999px;
          box-shadow: 0 6px 18px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.1);
          display: flex; flex-direction: column; align-items: flex-start;
          gap: 1px;
          pointer-events: none;
          white-space: nowrap;
          animation: dialerLabelIn 0.4s cubic-bezier(.34,1.4,.64,1) both;
          /* Show only when wheel is active. While idle, the label hides so
             the screen is clean. */
          opacity: 0;
          transition: opacity 0.4s ease, transform 0.4s ease;
          transform: translateY(-50%) translateX(-6px);
        }
        .dialer-root.is-active .dialer-label {
          opacity: 1;
          transform: translateY(-50%) translateX(0);
        }
        .dialer-label-name {
          font-size: 0.72rem;
          font-weight: 800;
          letter-spacing: 0.04em;
          color: #fbd26a;
          line-height: 1;
        }
        .dialer-label-use {
          font-size: 0.56rem;
          color: rgba(255,255,255,0.55);
          letter-spacing: 0.02em;
          line-height: 1;
        }

        /* Idle hint chevron — peeks at the centred-item position when
           the wheel is dim, hinting "swipe me". Fades on active. */
        .dialer-hint {
          position: absolute;
          left: ${PROTRUSION + 4}px;
          top: 50%;
          font-size: 0.58rem;
          font-weight: 800;
          color: rgba(240,180,41,0.7);
          letter-spacing: 0.1em;
          animation: dialerHintNudge 1.8s ease-in-out infinite;
          pointer-events: none;
          transition: opacity 0.4s ease;
          opacity: 1;
        }
        .dialer-root.is-active .dialer-hint { opacity: 0; }
      `}</style>

      <div className={`dialer-root ${active ? "is-active" : ""}`}>
        {/* Invisible drag/wake zone — covers the visible rim so the user
            can grab the wheel anywhere along it, not just one button. */}
        <div
          className="dialer-wake-zone"
          onTouchStart={(e) => onStart(e.touches[0].clientY)}
          onTouchMove={(e) => onMove(e.touches[0].clientY)}
          onTouchEnd={onEnd}
          onTouchCancel={onEnd}
          onMouseDown={(e) => onStart(e.clientY)}
          onMouseMove={(e) => { if (dragRef.current) onMove(e.clientY); }}
          onMouseUp={onEnd}
          onMouseLeave={() => { if (dragRef.current) onEnd(); }}
        />

        <div className="dialer-wheel">
          {ITEMS.map((item, i) => {
            let angle = (i - rotation) * ANGLE_STEP;
            angle = ((angle % 360) + 540) % 360 - 180;

            const rad = angle * Math.PI / 180;
            const cosA = Math.cos(rad);
            const sinA = Math.sin(rad);
            if (cosA < -0.15) return null;

            const x = WHEEL_CX + cosA * WHEEL_R;
            const y = sinA * WHEEL_R;

            const baseScale = active ? 0.6 : 0.5;
            const scaleVar  = active ? 0.7 : 0.5;
            const scale = baseScale + Math.max(0, cosA) * scaleVar;
            const opacity = Math.max(0.15, cosA * 1.1);
            const isCentre = Math.abs(angle) < ANGLE_STEP / 2;

            return (
              <button
                key={item.href}
                className={`dialer-item ${isCentre ? "is-centre" : ""} ${snapping ? "snapping" : ""}`}
                aria-label={`${item.label} — ${item.useCase}`}
                style={{
                  transform: `translate(${x}px, ${y}px) scale(${scale.toFixed(3)})`,
                  opacity: opacity.toFixed(3),
                  zIndex: 10 + Math.round(cosA * 10),
                }}
                tabIndex={isCentre ? 0 : -1}
                onClick={(e) => {
                  e.preventDefault();
                  // If this is a fresh click (no drag), navigate; otherwise
                  // the wake-zone drag handlers manage it.
                  if (!dragRef.current) {
                    wake();
                    if (isCentre && item.href !== pathname) {
                      router.push(item.href);
                    } else if (!isCentre) {
                      setSnapping(true);
                      setRotation(i);
                      setTimeout(() => setSnapping(false), SNAP_MS);
                    }
                    scheduleIdle();
                  }
                }}
              >
                <span>{item.icon}</span>
                {item.pulse && !isCentre && <span className="dialer-item-pulse" />}
              </button>
            );
          })}
        </div>

        {/* Floating "what is this" label — only visible when wheel is active.
            Shows name + use-case for the currently-centred item. */}
        {centreItem && (
          <div key={centreItem.href} className="dialer-label">
            <span className="dialer-label-name">{centreItem.label}</span>
            <span className="dialer-label-use">{centreItem.useCase}</span>
          </div>
        )}

        <span className="dialer-hint" aria-hidden>›</span>
      </div>
    </>
  );
}
