"use client";
// v140 — Tutorial Layer 3: floating "?" help button (always-on).
//
// Sits bottom-right of every customer-facing page, just above the
// BottomDock. Tap → opens a portal-mounted bottom sheet with:
//   • Replay any tour (Welcome, Home, Hotel, Bid, Flash, Earn)
//   • Master toggle: disable / enable all auto-tours
//   • Language picker (EN ⇄ Hinglish)
//
// Visibility gate:
//   • Hidden on /admin, /partner, /onboard, /auth — these have their
//     own help / support surfaces and the floating chip would collide
//     with admin tooling.
//   • Always shown otherwise (logged-in or anonymous).
//
// Mounts the same TutorialReplayList component used inside /me drawer
// so the two surfaces stay in sync.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { useTutorial, TUTORIAL_MATURE_THRESHOLD } from "@/lib/tutorial/tutorial-store";
import { TutorialReplayList } from "./TutorialReplayList";

const HIDE_PREFIXES = ["/admin", "/partner", "/onboard", "/auth", "/circle", "/host", "/worker"];

export function TutorialHelpButton() {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const { hydrated, active, disabled, seenCount } = useTutorial();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  // v143 — "is-mature" auto-decay: once the user has marked
  // TUTORIAL_MATURE_THRESHOLD tours seen (excluding welcome), the
  // floating ? shrinks + fades. It stays tappable so help is always
  // one tap away — just no longer competing for screen attention.
  const isMature = seenCount >= TUTORIAL_MATURE_THRESHOLD;

  useEffect(() => {
    setMounted(true);
  }, []);

  // v404 — the floating "?" was removed from every screen. The app tour now
  // opens from each panel's own menu via the global `sb:open-tour` event.
  useEffect(() => {
    const openIt = () => setOpen(true);
    window.addEventListener("sb:open-tour", openIt);
    return () => window.removeEventListener("sb:open-tour", openIt);
  }, []);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!mounted) return null;
  if (!hydrated) return null;
  // v404 — no more route-based hiding: the component stays mounted on EVERY
  // panel (no floating "?" anymore) so the `sb:open-tour` menu event can open
  // the tour sheet anywhere. While a tour is actively running we still don't
  // render the sheet (don't compete with driver.js popovers).
  void HIDE_PREFIXES;
  if (active) return null;

  // Map current pathname → the relevant tour key, so the button can
  // surface "Replay this page's tour" as the primary CTA.
  const currentTourKey: string | null = (() => {
    if (pathname === "/" || pathname === "/discover") return "home";
    if (pathname.startsWith("/hotels/")) return "hotel";
    if (pathname === "/hotels") return "explore"; // v141
    if (pathname === "/bid") return "bid";
    if (pathname === "/flash-deals") return "flash";
    if (pathname === "/my-bids") return "mybids"; // v141
    if (pathname === "/bookings") return "bookings"; // v141
    if (pathname === "/upgrade") return "earn";
    // v142 — Phase 6 mappings
    if (pathname === "/wallet") return "wallet";
    if (pathname === "/points" || pathname === "/points/redeem") return "points";
    if (pathname === "/saved") return "saved";
    if (pathname === "/me") return "me";
    if (pathname.startsWith("/influencer/dashboard")) return "influencer";
    if (pathname === "/verification") return "verify";
    if (pathname === "/complaints") return "complaints";
    return null;
  })();

  void isMature; // v404 — FAB removed; opened from panel menus via sb:open-tour
  const node = (
    <>
      {/* v404 — the floating "?" FAB was REMOVED from every screen. The tour
          sheet below now opens only from a panel's "App Tour" menu entry. */}

      {/* Bottom sheet (or centered modal on desktop) */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="App tour & help"
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99000,
            background: "rgba(15, 12, 8, 0.62)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            padding: "16px",
            animation: "sbHelpFadeIn 0.22s ease both",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(440px, 100%)",
              maxHeight: "calc(100dvh - 64px)",
              borderRadius: 22,
              background: "linear-gradient(160deg, #fcfcfd 0%, #f4f6f8 100%)",
              border: "1px solid rgba(201, 166, 107, 0.32)",
              boxShadow: "0 30px 60px -16px rgba(31, 26, 15, 0.45)",
              padding: "18px 18px calc(18px + env(safe-area-inset-bottom, 0px)) 18px",
              overflow: "auto",
              animation: "sbHelpSheetIn 0.28s cubic-bezier(.16,.84,.32,1) both",
              color: "var(--cozy-warm-dark, #1F1A0F)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div>
                <p
                  style={{
                    margin: 0,
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: "0.14em",
                    color: "var(--cozy-cocoa-soft, #6E5430)",
                    textTransform: "uppercase",
                  }}
                >
                  Help & Tours
                </p>
                <h2
                  style={{
                    margin: "2px 0 0",
                    fontFamily: "'Cormorant Garamond', Georgia, serif",
                    fontStyle: "italic",
                    fontSize: "1.45rem",
                    fontWeight: 600,
                    color: "var(--cozy-warm-dark, #1F1A0F)",
                  }}
                >
                  How can we help?
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                style={{
                  appearance: "none",
                  border: "none",
                  background: "rgba(201, 166, 107, 0.14)",
                  color: "var(--cozy-cocoa, #4A3820)",
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  cursor: "pointer",
                  fontSize: 18,
                  lineHeight: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                ✕
              </button>
            </div>

            <TutorialReplayList
              highlightTourKey={currentTourKey}
              onAfterReplay={() => setOpen(false)}
            />
          </div>
        </div>
      )}

      <style>{`
        /* v144 — Hover restores full opacity + subtle scale so the
           "?" pops out only when the user moves toward it. Stays a
           pure character (no background) — keeps screen clean. */
        .sb-help-fab:hover {
          opacity: 1 !important;
          transform: scale(1.4);
        }
        .sb-help-fab--mature:hover {
          /* Mature "?" hover: scale up MORE (since the base 14px is
             tiny) so the user gets a clear tap target. Still no
             background — pure character feel. */
          transform: scale(1.6);
        }
        @keyframes sbHelpFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes sbHelpSheetIn {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (min-width: 768px) {
          /* Centered modal on desktop instead of bottom sheet */
          .sb-help-fab + div[role="dialog"] {
            align-items: center !important;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .sb-help-fab, .sb-help-fab:hover {
            transition: none !important;
            transform: none !important;
          }
        }
      `}</style>
    </>
  );

  return createPortal(node, document.body);
}
