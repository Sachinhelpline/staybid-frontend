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
    pathname.startsWith("/agent") ||
    pathname.startsWith("/onboard") ||
    pathname.startsWith("/order") ||     // public QR food-ordering page
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
          /* v241.10 — lift dock above Android 10+ gesture region.
             Pre-v241.10 dock sat at bottom:0 with internal padding equal
             to env(safe-area-inset-bottom). The container itself still
             overlapped the swipe-up-home / corner-swipe-back zone, so
             Android sometimes captured the gesture as a dock tap.
             Now the dock is physically lifted by the inset; on devices
             without a home-bar (inset = 0) behavior is identical. */
          bottom: env(safe-area-inset-bottom, 0px);
          z-index: 60;
          display: flex;
          align-items: center;
          justify-content: space-around;
          gap: 2px;
          padding: 5px 4px 5px;
          background: rgba(31, 26, 15, 0.94);
          backdrop-filter: blur(18px) saturate(1.4);
          -webkit-backdrop-filter: blur(18px) saturate(1.4);
          border-top: 1px solid rgba(217, 190, 130, 0.12);
          box-shadow: 0 -6px 22px rgba(31, 26, 15, 0.45);
        }
        [data-theme="light"] .ig-bottom-dock {
          background: rgba(255, 252, 246, 0.94);
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
        .ig-dock-item {
          flex: 1 1 0;
          min-width: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          padding: 6px 2px;
          /* v88 — cream-tinted instead of harsh white */
          color: rgba(250, 245, 235, 0.62);
          text-decoration: none;
          border-radius: 12px;
          transition:
            color 0.18s cubic-bezier(.32,1.2,.36,1),
            transform 0.14s cubic-bezier(.32,1.2,.36,1),
            background 0.18s ease;
        }
        [data-theme="light"] .ig-dock-item { color: var(--text-muted); }
        .ig-dock-item:active { transform: scale(0.94); }
        .ig-dock-item.is-active {
          /* v88 — desaturated cozy champagne instead of saturated gold */
          color: var(--cozy-champagne-light, #D9BE82);
          background: linear-gradient(180deg, rgba(217,190,130,0.10), rgba(217,190,130,0.02));
        }
        [data-theme="light"] .ig-dock-item.is-active {
          color: var(--cozy-cocoa);
          background: linear-gradient(180deg, rgba(201,166,107,0.18), rgba(201,166,107,0.04));
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
        body { padding-bottom: calc(60px + env(safe-area-inset-bottom, 0px)); }
        body.is-reel-page { padding-bottom: 0; }
        /* Operator panels (admin, partner, onboard, auth) hide the dock —
           don't reserve the dock-height there. */
        body:has([data-route-admin]), body:has([data-route-partner]),
        body:has([data-route-onboard]), body.no-bottom-dock {
          padding-bottom: env(safe-area-inset-bottom, 0px) !important;
        }

      `}</style>
    </>
  );
}
