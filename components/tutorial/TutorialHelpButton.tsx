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
import { useTutorial } from "@/lib/tutorial/tutorial-store";
import { TutorialReplayList } from "./TutorialReplayList";

const HIDE_PREFIXES = ["/admin", "/partner", "/onboard", "/auth"];

export function TutorialHelpButton() {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const { hydrated, active, disabled } = useTutorial();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
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
  if (HIDE_PREFIXES.some((p) => pathname.startsWith(p))) return null;
  // Hide while ANY tour is actively running — don't compete with
  // driver.js popovers for tap targets.
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
    return null;
  })();

  const node = (
    <>
      {/* FAB — bottom-right above BottomDock */}
      <button
        type="button"
        aria-label="Open app tour & help"
        onClick={() => setOpen(true)}
        className="sb-help-fab"
        style={{
          position: "fixed",
          right: 14,
          // BottomDock height is ~64px + safe-area. We sit just above it.
          bottom: "calc(78px + env(safe-area-inset-bottom, 0px))",
          zIndex: 9500,
          width: 40,
          height: 40,
          borderRadius: "50%",
          border: "1px solid rgba(201, 166, 107, 0.55)",
          background: "linear-gradient(135deg, #FFFCF6, #F2EAD8)",
          color: "var(--cozy-warm-dark, #1F1A0F)",
          fontWeight: 800,
          fontSize: 18,
          lineHeight: 1,
          cursor: "pointer",
          boxShadow:
            "0 10px 22px -8px rgba(31, 26, 15, 0.32), inset 0 1px 0 rgba(255,255,255,0.65)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "transform 0.18s ease, box-shadow 0.18s ease",
        }}
      >
        ?
      </button>

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
              background: "linear-gradient(160deg, #FFFCF6 0%, #FAF5EB 100%)",
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
        .sb-help-fab:hover {
          transform: translateY(-2px) scale(1.05);
          box-shadow: 0 14px 28px -8px rgba(31, 26, 15, 0.42), inset 0 1px 0 rgba(255,255,255,0.75);
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
