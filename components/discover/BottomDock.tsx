"use client";
// ═══════════════════════════════════════════════════════════════════════════
// BottomDock — Hotstar-style bottom nav (v629 redesign, owner-picked).
//
// 5 slots (was 7): the owner locked the set + the JioHotstar anatomy —
// airy icon-only sides (label appears under the ACTIVE side item only),
// one emphasized CENTRE slot with a permanent label:
//
//   ⌂ Home    → /              (left 1)
//   ⌕ Hotels  → /hotels        (left 2)
//   ⚡ DEALS  → /flash-deals   (CENTRE — gold starburst, flash-stamp gold)
//   ₹ Bid     → /bid           (right 1)
//   ▷ Reels   → /discover      (right 2)
//
// "You" (/me) left the bar → the YouChip avatar, fixed top-right, rendered
// on the reel-app routes where the Navbar is hidden (mobile). Every other
// page keeps profile access via the Navbar (chips + More sheet). "Wishlist"
// (/saved) left the bar → the ♥ on cards + the row inside /me. BOTH routes
// stay fully live — nothing was deleted, only the bar slots.
//
// Carried over UNCHANGED from the 7-slot dock: the operator-panel hide
// list, composer/modal hide, reel-page dark skin, /bid immersive skin,
// light-theme skin, safe-area padding, overflow-x clip (Galaxy Fold), and
// the body bottom-buffer (52px → 64px for the taller centre star; the
// matching /bid `.bgz-shell` carve in globals.css:~8253 moved with it).
// ═══════════════════════════════════════════════════════════════════════════
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Home, Search, Zap, IndianRupee, Clapperboard, User } from "lucide-react";

type LucideCmp = typeof Home;

type Item = {
  href:   string;
  label:  string;
  Icon:   LucideCmp;
  center?: boolean;
};

const ITEMS: Item[] = [
  { href: "/",            label: "Home",   Icon: Home },
  { href: "/hotels",      label: "Hotels", Icon: Search },
  { href: "/flash-deals", label: "Deals",  Icon: Zap, center: true },
  { href: "/bid",         label: "Bid",    Icon: IndianRupee },
  { href: "/discover",    label: "Reels",  Icon: Clapperboard },
];

export function BottomDock() {
  const pathname = usePathname() || "/";

  // "You" avatar chip: the signed-in user's initial (sb_user is
  // localStorage-only, so read it AFTER mount — SSR-safe).
  const [initial, setInitial] = useState<string | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("sb_user");
      if (raw) {
        const u = JSON.parse(raw);
        const src = (u?.name || u?.email || "").trim();
        setInitial(src ? src[0].toUpperCase() : null);
      }
    } catch { /* stay icon-only */ }
  }, [pathname]);

  // Show on EVERY customer-facing page (v80) — operator panels keep their
  // own headers + hide the public dock. (Unchanged list.)
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
    return pathname === href || pathname.startsWith(href + "/");
  };

  // The YouChip renders ONLY where the Navbar is CSS-hidden on mobile
  // (Navbar isReelRoute list), minus /me itself (it IS the destination).
  // ≥1024px the chip is display:none — the desktop Navbar shows everywhere.
  const showYouChip =
    pathname === "/" ||
    pathname.startsWith("/discover") ||
    pathname.startsWith("/reels") ||
    pathname.startsWith("/saved/posts");

  return (
    <>
      {showYouChip && (
        <Link href="/me" prefetch className="ig-you-chip" aria-label="You — profile">
          {initial
            ? <span className="ig-you-init">{initial}</span>
            : <User size={16} strokeWidth={2.2} aria-hidden />}
        </Link>
      )}

      <nav className="ig-bottom-dock" aria-label="Primary navigation">
        {ITEMS.map((it) => {
          const active = isActive(it.href);
          const I = it.Icon;
          if (it.center) {
            return (
              <Link
                key={it.href}
                href={it.href}
                prefetch
                className={`ig-dock-deal${active ? " is-active" : ""}`}
                aria-label={it.label}
                aria-current={active ? "page" : undefined}
              >
                <span className="ig-deal-star" aria-hidden>
                  <I size={20} strokeWidth={2.3} />
                </span>
                <span className="ig-deal-label">{it.label}</span>
              </Link>
            );
          }
          return (
            <Link
              key={it.href}
              href={it.href}
              prefetch
              className={`ig-dock-item${active ? " is-active" : ""}`}
              aria-label={it.label}
              aria-current={active ? "page" : undefined}
            >
              <I className="ig-dock-ic" size={21} strokeWidth={active ? 2.4 : 1.9} aria-hidden />
              {/* Hotstar anatomy: the side label appears only on the active item */}
              {active && <span className="ig-dock-label">{it.label}</span>}
            </Link>
          );
        })}
      </nav>

      <style jsx global>{`
        /* v629 — Hotstar-style dock. Same theme skins as v90 (dark cocoa /
           light frosted slate, same brand tones); the bar grew 52→~64px for
           the centre star. */
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
          /* v618 EDGE-TO-EDGE (kept): background fills the gesture-bar
             region; max(6px, safe-area) pads the icons above the pill. */
          padding: 6px 6px max(6px, env(safe-area-inset-bottom, 0px));
          background: rgba(19, 23, 28, 0.94);
          backdrop-filter: blur(18px) saturate(1.4);
          -webkit-backdrop-filter: blur(18px) saturate(1.4);
          border-top: 1px solid rgba(176, 192, 209, 0.12);
          box-shadow: 0 -6px 22px rgba(0, 0, 0, 0.45);
          /* Galaxy Fold 280px: clip transient horizontal spill (kept). */
          overflow-x: clip;
        }
        [data-theme="light"] .ig-bottom-dock {
          background: rgba(176, 192, 209, 0.94);
          border-top: 1px solid var(--border-soft);
          box-shadow: 0 -4px 18px rgba(31, 26, 15, 0.08);
        }
        /* v114 — hide while Composer/modal open (kept). */
        body.sb-composer-open .ig-bottom-dock,
        body.sb-modal-open    .ig-bottom-dock { display: none !important; }
        body.sb-composer-open .ig-you-chip,
        body.sb-modal-open    .ig-you-chip { display: none !important; }
        /* v610/v614 — /bid immersive skin (kept). */
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
          gap: 2px;
          padding: 6px 2px;
          min-height: 44px; /* full-height tap target (WCAG 2.5.8) */
          overflow: hidden;
          color: rgba(197, 212, 228, 0.78);
          text-decoration: none;
          border-radius: 12px;
          transition:
            color 0.18s cubic-bezier(.32,1.2,.36,1),
            transform 0.14s cubic-bezier(.32,1.2,.36,1),
            background 0.18s ease;
        }
        [data-theme="light"] .ig-dock-item { color: #3f5369; }
        /* v408 — reel-page always-dark skin (kept). */
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
          color: var(--cozy-champagne-light, #b4c1cf);
          background: linear-gradient(180deg, rgba(176, 192, 209,0.10), rgba(176, 192, 209,0.02));
        }
        [data-theme="light"] .ig-dock-item.is-active {
          color: var(--accent);
          background: linear-gradient(180deg, rgba(79,109,138,0.16), rgba(79,109,138,0.04));
        }
        .ig-dock-ic { flex: 0 0 auto; }
        .ig-dock-label {
          font-size: 0.55rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          white-space: nowrap;
        }

        /* ── CENTRE: ⚡ Deals — the /flash-deals GOLD stamp gradient
              (one deal, one colour — matches .fd-disc-stamp). ── */
        .ig-dock-deal {
          flex: 0 0 64px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          gap: 3px;
          padding: 0 2px;
          text-decoration: none;
          position: relative;
        }
        .ig-deal-star {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #3a2a08;
          background: radial-gradient(circle at 32% 28%, #ffe9ad, #f2c650 46%, #d69a1e);
          box-shadow: 0 0 0 1px rgba(214, 154, 30, 0.35), 0 4px 14px rgba(214, 154, 30, 0.45);
          transition: transform 0.14s cubic-bezier(.32,1.2,.36,1), box-shadow 0.18s ease;
        }
        .ig-dock-deal:active .ig-deal-star { transform: scale(0.92); }
        .ig-dock-deal.is-active .ig-deal-star {
          box-shadow: 0 0 0 2px rgba(242, 198, 80, 0.55), 0 4px 18px rgba(214, 154, 30, 0.6);
        }
        .ig-deal-label {
          font-size: 0.55rem;
          font-weight: 800;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #f2c650;
        }
        [data-theme="light"] .ig-deal-label { color: #8a6210; }
        body.is-reel-page .ig-deal-label,
        body.sb-bid-immersive .ig-deal-label { color: #f2c650; }

        /* ── "You" avatar chip — top-right on reel-app routes (mobile).
              Desktop ≥1024 shows the Navbar everywhere → chip off. ── */
        .ig-you-chip {
          position: fixed;
          top: calc(10px + env(safe-area-inset-top, 0px));
          right: 12px;
          z-index: 58;
          width: 34px;
          height: 34px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          text-decoration: none;
          color: #f2f6fa;
          background: linear-gradient(160deg, #5d7d9c, #3f5a75);
          border: 1.5px solid rgba(255, 255, 255, 0.55);
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.28);
        }
        [data-theme="dark"] .ig-you-chip,
        body.is-reel-page   .ig-you-chip {
          background: linear-gradient(160deg, #a9c3dc, #7fa0bf);
          color: #131a21;
          border-color: rgba(19, 23, 28, 0.6);
        }
        .ig-you-chip:active { transform: scale(0.92); }
        .ig-you-init {
          font-size: 0.82rem;
          font-weight: 800;
          line-height: 1;
        }
        @media (min-width: 1024px) {
          .ig-you-chip { display: none; }
        }

        /* Global bottom buffer so no content hides under the dock.
           v629: 52px → 64px (taller centre star). The /bid .bgz-shell
           carve in globals.css moved 52→64 in the same release — keep
           the two values in sync. */
        body { padding-bottom: calc(64px + env(safe-area-inset-bottom, 0px)); }
        body.is-reel-page { padding-bottom: 0; }
        /* Operator panels hide the dock — no dock-height reserve (kept). */
        body:has([data-route-admin]), body:has([data-route-partner]),
        body:has([data-route-onboard]), body.no-bottom-dock {
          padding-bottom: env(safe-area-inset-bottom, 0px) !important;
        }
      `}</style>
    </>
  );
}
