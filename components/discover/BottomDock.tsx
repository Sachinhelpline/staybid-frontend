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
  { href: "/bid",         label: "Bid",     icon: "◎",  iconActive: "●" },
  { href: "/hotels",      label: "Hotels",  icon: "⌕",  iconActive: "⌕" },
  { href: "/me",          label: "You",     icon: "○",  iconActive: "●" },
];

export function BottomDock() {
  const pathname = usePathname() || "/";

  // Only show on the reel-feed surfaces + the "You" IG-style profile page.
  // Outside of these, DialerNav owns navigation. Keeps the two systems
  // mutually exclusive.
  const visible =
    pathname === "/" ||
    pathname.startsWith("/discover") ||
    pathname.startsWith("/reels") ||
    pathname.startsWith("/me");
  if (!visible) return null;

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    // /discover and /reels both light up the Reels slot
    if (href === "/discover") {
      return pathname.startsWith("/discover") || pathname.startsWith("/reels");
    }
    // /me — the "You" tab — lights up across the whole profile surface
    if (href === "/me") {
      return pathname.startsWith("/me");
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
          gap: 4px;
          padding: 6px 8px calc(env(safe-area-inset-bottom, 0px) + 6px);
          background: rgba(7, 6, 14, 0.88);
          backdrop-filter: blur(18px) saturate(1.4);
          -webkit-backdrop-filter: blur(18px) saturate(1.4);
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 -6px 22px rgba(0, 0, 0, 0.45);
        }
        .ig-dock-item {
          flex: 1 1 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          padding: 6px 4px;
          color: rgba(255, 255, 255, 0.62);
          text-decoration: none;
          border-radius: 12px;
          transition:
            color 0.18s cubic-bezier(.32,1.2,.36,1),
            transform 0.14s cubic-bezier(.32,1.2,.36,1),
            background 0.18s ease;
        }
        .ig-dock-item:active { transform: scale(0.94); }
        .ig-dock-item.is-active {
          color: #ffd76b;
          background: linear-gradient(180deg, rgba(255,215,107,0.08), rgba(255,215,107,0.02));
        }
        .ig-dock-glyph {
          font-size: 1.35rem;
          line-height: 1;
          font-weight: 600;
        }
        .ig-dock-label {
          font-size: 0.56rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

      `}</style>
    </>
  );
}
