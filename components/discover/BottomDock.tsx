"use client";
// ═══════════════════════════════════════════════════════════════════════════
// BottomDock — Instagram-style horizontal nav bar at the bottom of the
// reel feed.
//
// Replaces the left-edge DialerNav crown wheel on /, /discover and /reels
// per the v78 design ask. The crown wheel still lives on every other page
// (DialerNav.tsx hides itself on the routes this dock owns).
//
// 5 slots — mirrors Instagram's bottom row:
//   🏠 Home    → /
//   🎬 Reels   → /discover    (active on the reel pages)
//   🎯 Bid     → /bid         (the "compose" / primary action slot)
//   🏨 Hotels  → /hotels      (search / browse equivalent)
//   👤 Profile → /profile
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

const ITEMS: Item[] = [
  { href: "/",            label: "Home",    icon: "⌂",  iconActive: "⌂" },
  { href: "/discover",    label: "Reels",   icon: "▷",  iconActive: "▶" },
  { href: "/flash-deals", label: "Deals",   icon: "⚡", iconActive: "⚡" },
  { href: "/bid",         label: "Bid",     icon: "◎",  iconActive: "●" },
  { href: "/hotels",      label: "Hotels",  icon: "⌕",  iconActive: "⌕" },
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
    pathname.startsWith("/onboard") ||
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
          padding: 5px 4px calc(env(safe-area-inset-bottom, 0px) + 5px);
          /* v88 — warm dark (cocoa) instead of cool near-black. Matches
             the premium cozy system. Inactive items now use cream-tinted
             white instead of harsh stark white. */
          background: rgba(31, 26, 15, 0.94);
          backdrop-filter: blur(18px) saturate(1.4);
          -webkit-backdrop-filter: blur(18px) saturate(1.4);
          border-top: 1px solid rgba(217, 190, 130, 0.12);
          box-shadow: 0 -6px 22px rgba(31, 26, 15, 0.45);
        }
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
        .ig-dock-item:active { transform: scale(0.94); }
        .ig-dock-item.is-active {
          /* v88 — desaturated cozy champagne instead of saturated gold */
          color: var(--cozy-champagne-light, #D9BE82);
          background: linear-gradient(180deg, rgba(217,190,130,0.10), rgba(217,190,130,0.02));
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
           layout but everything else gets a safe ~70px bottom buffer. */
        body { padding-bottom: env(safe-area-inset-bottom, 0px); }
        body.is-reel-page { padding-bottom: 0; }

      `}</style>
    </>
  );
}
