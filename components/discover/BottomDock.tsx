"use client";
// ═══════════════════════════════════════════════════════════════════════════
// BottomDock — Instagram-style horizontal nav bar at the bottom of the
// reel feed.
//
// Replaces the left-edge DialerNav crown wheel on /, /discover and /reels
// per the v78 design ask. The crown wheel still lives on every other page
// (DialerNav.tsx hides itself on the routes this dock owns).
//
// 6 slots:
//   ⌂ Home    → /
//   ⌕ Hotels  → /hotels      (search / browse)
//   ⚡ Deals   → /flash-deals
//   ◎ Bid     → /bid
//   ▷ Reels   → /discover    (active on the reel pages)
//   ○ You     → /me
//
// The dock is fixed at the bottom (above the system gesture bar), uses a
// glassy blurred surface so the reel video still bleeds subtly through.
// ═══════════════════════════════════════════════════════════════════════════
import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = {
  href:  string;
  label: string;
  icon:  string;
  /** Solid (filled) glyph used when the route is active. */
  iconActive?: string;
};

// Slot 2 = Hotels, slot 5 = Reels (swapped per the customer ask). Order is
// the only thing that changed — isActive() keys off href, not index, so
// every route/highlight still resolves correctly.
const ITEMS: Item[] = [
  { href: "/",            label: "Home",    icon: "⌂",  iconActive: "⌂" },
  { href: "/hotels",      label: "Hotels",  icon: "⌕",  iconActive: "⌕" },
  { href: "/flash-deals", label: "Deals",   icon: "⚡", iconActive: "⚡" },
  { href: "/bid",         label: "Bid",     icon: "◎",  iconActive: "●" },
  { href: "/discover",    label: "Reels",   icon: "▷",  iconActive: "▶" },
  // v578 — wishlist entry on the mobile nav (the heart on cards saves to /saved;
  // it was only reachable from the /me drawer before).
  { href: "/saved",       label: "Wishlist", icon: "♡",  iconActive: "♥" },
  { href: "/me",          label: "You",     icon: "○",  iconActive: "●" },
];

export function BottomDock() {
  const pathname = usePathname() || "/";

  // Show on EVERY customer-facing page (v80) — was previously only the
  // reel surfaces; user reported it disappearing when they tapped into
  // /bid, /hotels, or any hamburger destination. Only the operator
  // panels keep their own headers + hide the public dock.
  const hidden =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/partner") ||
    pathname.startsWith("/worker") ||    // worker panel — own chrome
    pathname.startsWith("/agent") ||
    pathname.startsWith("/onboard") ||
    pathname.startsWith("/host") ||      // Hospitality Business OS — own chrome
    pathname.startsWith("/circle") ||    // v288 StayCircle — own chrome
    pathname.startsWith("/trade") ||     // v361 Model 3 travel-agent auction — own chrome
    pathname.startsWith("/order") ||     // public QR food-ordering page
    pathname.startsWith("/kiosk") ||     // offline kiosk = its own fullscreen surface
    pathname.startsWith("/auth");        // auth screens should be chrome-free
  if (hidden) return null;

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    // /discover and /reels both light up the Reels slot
    if (href === "/discover") {
      return pathname.startsWith("/discover") || pathname.startsWith("/reels");
    }
    // /me — the "You" tab — lights up across the whole profile surface,
    // also when the user is on /profile (account settings linked from the
    // hamburger drawer) since that's logically still "You".
    if (href === "/me") {
      return pathname.startsWith("/me") || pathname.startsWith("/profile");
    }
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <>
      <nav className="ig-bottom-dock" aria-label="Primary navigation">
        {ITEMS.map((it) => {
          const active = isActive(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              prefetch
              className={`ig-dock-item${active ? " is-active" : ""}`}
              aria-label={it.label}
              aria-current={active ? "page" : undefined}
            >
              <span className="ig-dock-glyph">{active ? (it.iconActive || it.icon) : it.icon}</span>
              <span className="ig-dock-label">{it.label}</span>
            </Link>
          );
        })}
      </nav>

      <style jsx global>{`
        /* v90 — Theme-aware dock. In dark mode, warm cocoa bar (the v88
           look). In light mode, frosted cream over whatever's beneath
           with cocoa text + champagne active accent. Same brand colour
           on both. */
        .ig-bottom-dock {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 60;
          display: flex;
          align-items: center;
          justify-content: space-around;
          gap: 2px;
          /* v607 — shrink the dock height (top/bottom padding 5→3).
             v618 — EDGE-TO-EDGE experiment. The dock is at bottom:0, so its
             background already reaches the true bottom edge. max(5px, safe-area)
             pads the ICONS up above the gesture pill while the dock's OWN
             background continuously fills the gesture-bar region — so on a
             device that draws content edge-to-edge (viewport-fit=cover), the
             pill floats over the nav instead of over a separate OS-coloured
             strip. On devices that don't (safe-area=0) it collapses to 5px =
             unchanged. This is the standard iOS/Android pattern (IG's bar
             extends under the home indicator). */
          padding: 3px 4px max(5px, env(safe-area-inset-bottom, 0px));
          background: rgba(19, 23, 28, 0.94);
          backdrop-filter: blur(18px) saturate(1.4);
          -webkit-backdrop-filter: blur(18px) saturate(1.4);
          border-top: 1px solid rgba(176, 192, 209, 0.12);
          box-shadow: 0 -6px 22px rgba(0, 0, 0, 0.45);
          /* The dock is exactly viewport-width (left:0;right:0). On the
             280px Galaxy Fold cover screen the 6 emoji glyphs' intrinsic
             width is the shrink floor, so the rightmost item can spill a
             few px past the edge → a transient document-level horizontal
             scrollbar. Clip it here (can't hide anything real since the
             dock already spans the full viewport). */
          overflow-x: clip;
        }
        [data-theme="light"] .ig-bottom-dock {
          background: rgba(176, 192, 209, 0.94);
          border-top: 1px solid var(--border-soft);
          box-shadow: 0 -4px 18px rgba(31, 26, 15, 0.08);
        }
        /* v114 — hide the dock while the Composer is open so it can't
           bleed through ANY stacking context (real iOS Safari + Android
           Chrome both have edge cases where high-z fixed panels still
           let a sibling fixed nav peek through). The Composer sets
           body.sb-composer-open on mount + clears on unmount. */
        body.sb-composer-open .ig-bottom-dock,
        body.sb-modal-open    .ig-bottom-dock { display: none !important; }
        /* v610/v614 — owner: the /bid page USED to hide the dock (v407
           immersive game zone). On gesture-nav phones with no OS nav bar that
           trapped the user — no way to leave /bid. The dock now STAYS visible
           on /bid (v614 also carves the dock height out of the fixed z-1000
           .bgz-shell overlay so it can't bury the dock). (Composer/modal
           still hide it.)
           /bid is an always-dark game surface even in light theme, so match
           the dock to the dark game zone here — otherwise a bright slate bar
           flashes at the bottom of the dark climber. Reuses the inert
           body.sb-bid-immersive class the page already sets. */
        body.sb-bid-immersive .ig-bottom-dock {
          background: rgba(13, 10, 5, 0.92);
          border-top: 1px solid rgba(176, 192, 209, 0.14);
          box-shadow: 0 -6px 22px rgba(0, 0, 0, 0.55);
        }
        body.sb-bid-immersive .ig-dock-item { color: rgba(197, 212, 228, 0.82); }
        body.sb-bid-immersive .ig-dock-item.is-active {
          color: var(--cozy-champagne-light, #b4c1cf);
          background: linear-gradient(180deg, rgba(176, 192, 209,0.10), rgba(176, 192, 209,0.02));
        }
        .ig-dock-item {
          flex: 1 1 0;
          min-width: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1px;
          padding: 4px 2px;
          overflow: hidden;
          /* v88 — cream-tinted instead of harsh white; v609 lifted for legibility */
          color: rgba(197, 212, 228, 0.86);
          text-decoration: none;
          border-radius: 12px;
          transition:
            color 0.18s cubic-bezier(.32,1.2,.36,1),
            transform 0.14s cubic-bezier(.32,1.2,.36,1),
            background 0.18s ease;
        }
        /* v609 — owner: the v608 slate read dull. Deep, saturated slate so the
           nav (the app's main control) reads premium + clearly legible. */
        [data-theme="light"] .ig-dock-item { color: #3f5369; font-weight: 650; }
        /* v408 — On the immersive reel (always dark, even in light theme) the
           cream dock read as a bright block stacked on the phone's system nav
           bar ("double layer"). Force the dark walnut dock + light glyphs there
           so the bottom blends into the reel like TikTok/IG. Scoped to
           .is-reel-page (0,2,1 specificity) so it beats the light-theme rules
           without touching any other surface. */
        body.is-reel-page .ig-bottom-dock {
          background: rgba(10, 8, 5, 0.92);
          border-top: 1px solid rgba(176, 192, 209, 0.14);
          box-shadow: 0 -6px 22px rgba(0, 0, 0, 0.55);
        }
        body.is-reel-page .ig-dock-item { color: rgba(176, 192, 209, 0.62); }
        body.is-reel-page .ig-dock-item.is-active {
          color: var(--cozy-champagne-light, #b4c1cf);
          background: linear-gradient(180deg, rgba(176, 192, 209,0.10), rgba(176, 192, 209,0.02));
        }
        .ig-dock-item:active { transform: scale(0.94); }
        .ig-dock-item.is-active {
          /* v88 — desaturated cozy champagne instead of saturated gold */
          color: var(--cozy-champagne-light, #b4c1cf);
          background: linear-gradient(180deg, rgba(176, 192, 209,0.10), rgba(176, 192, 209,0.02));
        }
        [data-theme="light"] .ig-dock-item.is-active {
          color: var(--accent);
          background: linear-gradient(180deg, rgba(79,109,138,0.16), rgba(79,109,138,0.04));
        }
        .ig-dock-glyph {
          font-size: 1.25rem;
          line-height: 1;
          font-weight: 600;
        }
        .ig-dock-label {
          font-size: 0.52rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        /* Global padding so no page content gets stuck under the dock.
           Reel-app routes (/, /discover, /reels) opt out via their own
           layout but everything else gets a safe ~70px bottom buffer.
           v124.2: bumped from safe-area-only to dock-height + safe-area
           so the LAST in-page CTA (Book Now, Submit Bid, etc.) is always
           clear of the dock on mobile + tablet. Real-device feedback —
           several pages had the last CTA row half-covered. */
        body { padding-bottom: calc(52px + env(safe-area-inset-bottom, 0px)); }
        body.is-reel-page { padding-bottom: 0; }
        /* Operator panels (admin, partner, onboard, auth) hide the dock —
           don't reserve the dock-height there. */
        body:has([data-route-admin]), body:has([data-route-partner]),
        body:has([data-route-onboard]), body.no-bottom-dock {
          padding-bottom: env(safe-area-inset-bottom, 0px) !important;
        }
        /* v610 — the /bid dock is visible again, so /bid keeps the normal
           dock-height reserve (from the body rule above) so PRESS START sits
           above the dock instead of under it. (Old v413 buffer-drop removed.) */

      `}</style>
    </>
  );
}
