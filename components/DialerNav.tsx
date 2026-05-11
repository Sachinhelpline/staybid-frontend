"use client";
/* ─────────────────────────────────────────────────────────────────────
   DialerNav — left-edge rotating wheel navigation (iPod click-wheel UX).

   Closed state (default):
     ─ A compact 56-wide vertical capsule hugging the LEFT edge of the
       screen, centred vertically. Shows the active page as a single 3D
       button + a row of tiny dots indicating other items.
     ─ A subtle pulse animates so users notice it.

   Open state (after tap):
     ─ Capsule expands to a rotatable wheel — items wrap on an arc that
       bulges into the screen.
     ─ User drags vertically (or scroll-wheels) to rotate items past
       the centre "selection" zone.
     ─ Centre item is the biggest, glows gold, has a permanent indicator
       chevron pointing into the screen.
     ─ Tapping the centre item navigates to that route.
     ─ Tapping anywhere outside → wheel collapses back to closed state.

   3D feel:
     ─ Each item rendered with rotateX based on distance from centre
       (perspective creates the illusion of a wheel rotating in space).
     ─ Active centre item: scale 1.18 + drop-shadow gold glow.
     ─ Items further from centre: progressively scaled down + faded.

   Why a wheel (not a dock):
     ─ Floating dock at bottom occupied 84px of vertical space — bad on
       phones with bottom gesture bars and small viewports.
     ─ Wheel on the edge keeps the screen surface clear; users invoke nav
       only when they need it.
     ─ Modern, distinctive, mirrors curved-screen Samsung Edge / iPhone
       Reachability gestures.
   ───────────────────────────────────────────────────────────────────── */
import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
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

const ITEM_HEIGHT = 64;     // px between items on the wheel
const SNAP_THRESHOLD = 0.5; // fraction of item height to snap on release

export function DialerNav() {
  const pathname = usePathname() || "/";
  const router = useRouter();

  // Compute which item index corresponds to the current pathname
  const activeIdx = (() => {
    if (pathname === "/") return 0;
    const i = ITEMS.findIndex(it =>
      it.href !== "/" && (pathname === it.href || pathname.startsWith(it.href + "/"))
    );
    return i >= 0 ? i : 0;
  })();

  // Wheel rotation in items (fractional during drag). 0 = ITEMS[0] centred.
  const [rotation, setRotation] = useState(activeIdx);
  const [open, setOpen] = useState(false);
  const dragRef = useRef<{ startY: number; startRotation: number } | null>(null);
  const wheelRef = useRef<HTMLDivElement>(null);

  // Sync wheel position when route changes
  useEffect(() => {
    setRotation(activeIdx);
  }, [activeIdx]);

  // Close wheel on route change
  useEffect(() => { setOpen(false); }, [pathname]);

  // ESC / outside click → close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Drag handlers
  const onTouchStart = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (!open) return;
    const y = "touches" in e ? e.touches[0].clientY : e.clientY;
    dragRef.current = { startY: y, startRotation: rotation };
  }, [open, rotation]);

  const onTouchMove = useCallback((e: React.TouchEvent | MouseEvent) => {
    if (!open || !dragRef.current) return;
    const y = "touches" in e ? (e as React.TouchEvent).touches[0].clientY : (e as MouseEvent).clientY;
    const dy = y - dragRef.current.startY;
    // negative dy → finger moved up → rotate toward later items
    const next = dragRef.current.startRotation - dy / ITEM_HEIGHT;
    // Clamp to valid range
    const clamped = Math.max(0, Math.min(ITEMS.length - 1, next));
    setRotation(clamped);
  }, [open]);

  const onTouchEnd = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    // Snap to nearest integer
    setRotation(r => Math.round(r));
  }, []);

  // Wheel-scroll support (desktop trackpad / mouse wheel)
  const onWheel = useCallback((e: WheelEvent) => {
    if (!open) return;
    e.preventDefault();
    setRotation(r => {
      const next = r + Math.sign(e.deltaY) * 0.5;
      return Math.max(0, Math.min(ITEMS.length - 1, next));
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = wheelRef.current;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("mousemove", onTouchMove as any);
    document.addEventListener("mouseup", onTouchEnd);
    return () => {
      el.removeEventListener("wheel", onWheel);
      document.removeEventListener("mousemove", onTouchMove as any);
      document.removeEventListener("mouseup", onTouchEnd);
    };
  }, [open, onWheel, onTouchMove, onTouchEnd]);

  const centreIdx = Math.round(rotation);
  const centreItem = ITEMS[centreIdx];

  // Hide on admin / partner / onboard routes
  if (pathname.startsWith("/admin") ||
      pathname.startsWith("/partner") ||
      pathname.startsWith("/onboard")) {
    return null;
  }

  const handleCentreTap = () => {
    if (!open) {
      setOpen(true);
      return;
    }
    // If wheel was rotated to a different item, navigate there
    if (centreItem && pathname !== centreItem.href) {
      router.push(centreItem.href);
    }
    setOpen(false);
  };

  return (
    <>
      <style jsx global>{`
        @keyframes dialerPopIn {
          0%   { transform: translateY(-50%) translateX(-50%); opacity: 0; }
          100% { transform: translateY(-50%) translateX(0); opacity: 1; }
        }
        @keyframes dialerPulse {
          0%, 100% { box-shadow: 0 8px 22px rgba(0,0,0,0.45), 0 0 0 0 rgba(240,180,41,0.45), inset 0 1px 0 rgba(255,255,255,0.32); }
          50%      { box-shadow: 0 8px 26px rgba(0,0,0,0.5), 0 0 0 6px rgba(240,180,41,0), inset 0 1px 0 rgba(255,255,255,0.32); }
        }
        @keyframes dialerGlow {
          0%, 100% { filter: drop-shadow(0 4px 8px rgba(240,180,41,0.55)); }
          50%      { filter: drop-shadow(0 6px 14px rgba(240,180,41,0.85)); }
        }
        @keyframes dialerHint {
          0%, 100% { transform: translateX(0); }
          50%      { transform: translateX(3px); }
        }

        .dialer-root {
          position: fixed;
          left: 0;
          top: 50%;
          transform: translateY(-50%);
          z-index: 50;
          pointer-events: none; /* children re-enable */
          /* Hidden on desktop — top navbar handles primary nav there */
        }
        @media (min-width: 768px) { .dialer-root { display: none; } }

        .dialer-backdrop {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.55);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          opacity: 0; pointer-events: none;
          transition: opacity 0.3s ease;
          z-index: 49;
        }
        .dialer-backdrop.open {
          opacity: 1;
          pointer-events: auto;
        }

        /* Closed capsule — slim pill hugging the left edge */
        .dialer-pill {
          pointer-events: auto;
          display: flex; flex-direction: column; align-items: center;
          padding: 8px 6px 8px 4px;
          border-radius: 0 24px 24px 0;
          background: linear-gradient(135deg, rgba(20,18,30,0.85), rgba(10,8,16,0.92));
          backdrop-filter: blur(22px) saturate(180%);
          -webkit-backdrop-filter: blur(22px) saturate(180%);
          border: 1px solid rgba(240,180,41,0.35);
          border-left: none;
          box-shadow:
            6px 8px 26px rgba(0,0,0,0.55),
            2px 4px 10px rgba(0,0,0,0.35),
            inset 0 1px 0 rgba(255,255,255,0.1);
          transition: all 0.4s cubic-bezier(.34,1.5,.64,1);
          animation: dialerPopIn 0.6s cubic-bezier(.34,1.5,.64,1) both;
          gap: 6px;
          will-change: transform, width, height;
        }
        .dialer-pill.is-open {
          padding: 14px 10px 14px 8px;
          /* width / height grow via inline style based on items rendered */
        }

        /* Closed-state active button — the only "real" button visible */
        .dialer-active-btn {
          position: relative;
          width: 52px; height: 52px;
          border-radius: 50%;
          background: linear-gradient(135deg, #f0d060 0%, #f0b429 55%, #c9911a 100%);
          color: #1a1208;
          display: flex; align-items: center; justify-content: center;
          font-size: 1.4rem; font-weight: 800;
          border: none; cursor: pointer;
          box-shadow:
            0 8px 22px rgba(0,0,0,0.45),
            inset 0 2px 0 rgba(255,255,255,0.5),
            inset 0 -2px 0 rgba(120,80,0,0.3);
          animation: dialerPulse 2.8s ease-in-out infinite;
          transition: transform 0.2s cubic-bezier(.34,1.5,.64,1);
        }
        .dialer-active-btn:active { transform: scale(0.92); }

        /* Indicator dots — show position among siblings (only visible when closed) */
        .dialer-dots {
          display: flex; flex-direction: column; gap: 4px;
          padding: 4px 0 2px;
        }
        .dialer-dot {
          width: 4px; height: 4px; border-radius: 50%;
          background: rgba(255,255,255,0.25);
          transition: all 0.3s ease;
        }
        .dialer-dot.is-active {
          background: #f0b429;
          box-shadow: 0 0 4px #f0b429;
          width: 4px; height: 4px;
        }

        /* Hint arrow — peeks from the right edge of the closed capsule */
        .dialer-hint {
          font-size: 0.65rem; color: rgba(240,180,41,0.7);
          animation: dialerHint 1.8s ease-in-out infinite;
          margin-top: 2px;
        }

        /* OPEN-state wheel */
        .dialer-wheel {
          position: relative;
          width: 92px;
          /* height set inline based on ITEM_HEIGHT * visible count */
          display: flex; flex-direction: column; align-items: center;
          touch-action: none;
        }
        .dialer-wheel-track {
          position: relative;
          width: 100%;
          height: 100%;
          /* Items absolutely positioned along this column */
        }

        .dialer-item {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 60px; height: 60px;
          margin: -30px 0 0 -30px;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02));
          border: 1px solid rgba(255,255,255,0.1);
          color: rgba(255,255,255,0.7);
          cursor: pointer;
          font-size: 1.4rem;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          will-change: transform, opacity;
          /* No CSS transition during drag — JS sets transform every frame.
             Snap-on-release uses the .snapping class for a one-shot transition. */
          transition: background 0.25s, border-color 0.25s, color 0.25s;
        }
        .dialer-item.snapping { transition: transform 0.32s cubic-bezier(.34,1.4,.64,1), opacity 0.32s, background 0.25s, border-color 0.25s, color 0.25s; }
        .dialer-item.is-centre {
          background: linear-gradient(135deg, #f0d060, #f0b429 55%, #c9911a);
          border-color: rgba(255,231,140,0.85);
          color: #1a1208;
          box-shadow:
            0 10px 26px rgba(240,180,41,0.45),
            inset 0 2px 0 rgba(255,255,255,0.55),
            inset 0 -2px 0 rgba(120,80,0,0.3);
          animation: dialerGlow 2.4s ease-in-out infinite;
        }

        .dialer-item-pulse {
          position: absolute;
          top: 8px; right: 10px;
          width: 7px; height: 7px;
          border-radius: 50%;
          background: #ff3859;
          box-shadow: 0 0 8px #ff3859;
        }

        .dialer-item-label {
          position: absolute;
          left: calc(100% + 8px);
          top: 50%;
          transform: translateY(-50%);
          padding: 4px 10px;
          background: rgba(0,0,0,0.7);
          border: 1px solid rgba(240,180,41,0.35);
          border-radius: 999px;
          font-size: 0.66rem;
          font-weight: 800;
          color: #fbd26a;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          white-space: nowrap;
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.25s ease;
        }
        .dialer-item.is-centre .dialer-item-label { opacity: 1; }

        /* Centre selection guide — chevron pointing right from outside the wheel */
        .dialer-guide {
          position: absolute;
          left: 100%;
          top: 50%;
          transform: translate(-2px, -50%);
          width: 0; height: 0;
          border-top: 8px solid transparent;
          border-bottom: 8px solid transparent;
          border-left: 10px solid rgba(240,180,41,0.7);
          filter: drop-shadow(0 0 6px rgba(240,180,41,0.5));
          pointer-events: none;
        }

        /* Close handle — small "x" button on the open wheel */
        .dialer-close {
          position: absolute;
          top: -10px;
          right: -10px;
          width: 26px; height: 26px;
          border-radius: 50%;
          background: rgba(255,255,255,0.1);
          border: 1px solid rgba(255,255,255,0.2);
          color: #fff;
          font-size: 0.75rem;
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          backdrop-filter: blur(8px);
          z-index: 2;
        }
      `}</style>

      {/* Backdrop — taps outside the wheel close it */}
      <div className={`dialer-backdrop ${open ? "open" : ""}`} onClick={() => setOpen(false)} />

      <div className="dialer-root">
        <div className={`dialer-pill ${open ? "is-open" : ""}`}>
          {open ? (
            /* ── OPEN WHEEL ── */
            <div
              ref={wheelRef}
              className="dialer-wheel"
              style={{ height: `${ITEM_HEIGHT * Math.min(5, ITEMS.length)}px` }}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove as any}
              onTouchEnd={onTouchEnd}
              onMouseDown={onTouchStart as any}
            >
              <div className="dialer-wheel-track">
                {ITEMS.map((item, i) => {
                  const distance = i - rotation;
                  const absD = Math.abs(distance);
                  // Hide items more than 2.5 slots away
                  if (absD > 2.5) return null;
                  const isCentre = Math.round(rotation) === i;
                  const scale = Math.max(0.45, 1 - absD * 0.22);
                  const opacity = Math.max(0.18, 1 - absD * 0.32);
                  // Arc bulge — items further from centre push slightly LEFT (away
                  // from the screen edge) for a 3D dial illusion.
                  const arcX = -Math.pow(absD, 2) * 3;
                  // Perspective rotation around X axis (degrees)
                  const rotX = distance * 22;
                  const isSnap = !dragRef.current; // smooth animate on release
                  return (
                    <button
                      key={item.href}
                      className={`dialer-item ${isCentre ? "is-centre" : ""} ${isSnap ? "snapping" : ""}`}
                      style={{
                        transform: `translate(${arcX}px, ${distance * ITEM_HEIGHT}px) scale(${scale}) rotateX(${rotX}deg)`,
                        opacity,
                        zIndex: 10 - Math.round(absD),
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        if (isCentre) {
                          handleCentreTap();
                        } else {
                          setRotation(i);
                        }
                      }}
                    >
                      <span>{item.icon}</span>
                      {item.pulse && !isCentre && <span className="dialer-item-pulse" />}
                      <span className="dialer-item-label">{item.label}</span>
                    </button>
                  );
                })}
              </div>
              <span className="dialer-guide" aria-hidden />
              <button className="dialer-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>
          ) : (
            /* ── CLOSED CAPSULE ── */
            <>
              <button
                className="dialer-active-btn"
                onClick={() => setOpen(true)}
                aria-label={`Open menu (${ITEMS[activeIdx].label})`}
              >
                <span>{ITEMS[activeIdx].icon}</span>
              </button>
              <div className="dialer-dots" aria-hidden>
                {ITEMS.map((_, i) => (
                  <span key={i} className={`dialer-dot ${i === activeIdx ? "is-active" : ""}`} />
                ))}
              </div>
              <span className="dialer-hint" aria-hidden>›</span>
            </>
          )}
        </div>
      </div>
    </>
  );
}
