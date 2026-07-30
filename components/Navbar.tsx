"use client";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useState, useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import { ModeToggle } from "@/components/ModeToggle";
import { LocationGlobeModal } from "@/components/LocationGlobePicker";
// v109 — shared TierProvider. Was useAccountTier in v108 (per-component
// instance); now the same context drives /me drawer, DialerNav, /upgrade
// banner together, and an auto-refresh trigger flips everyone in sync.
import { useTier } from "@/lib/tier-store";
// v497 — Appearance (theme) row inside the desktop Menu dropdown.
import { useTheme } from "@/lib/theme-store";
// v125.3 — single source of truth for the customer Menu. Edit
// lib/user-links.ts; both mobile drawer and desktop dropdown update.
import { USER_LINKS_BASE, ACCOUNT_LINK } from "@/lib/user-links";
// v392 — single canonical city list (hill-stations + 12-month demand-cycle hubs).
import { CITY_DISPLAY_ORDER } from "@/lib/cities";

const CITIES = CITY_DISPLAY_ORDER;

const NAV_LINKS = [
  { href: "/hotels",      label: "Hotels",      icon: "🏨" },
  { href: "/flash-deals", label: "Flash Deals", icon: "⚡", pulse: true },
  // "Reels" is just the content type — rename to "Discover" so the chip
  // describes what the user *does* with it (browse hotel reels).
  { href: "/reels",       label: "Discover",    icon: "🎬" },
  // v234 — was "Place Bid"; renamed to "Bid" so the desktop top nav matches
  // the mobile bottom dock (BOTTOM_PRIMARY) + the mobile drawer (USER_LINKS).
  // Sachin: "mobile par yeh page bid naam se show hota hai ur desktop par
  // place bid ke naam se" — same /bid route, single canonical label so the
  // customer never wonders if it's two different pages.
  { href: "/bid",         label: "Bid",         icon: "🎯" },
  // v578 — wishlist entry: the heart on cards saves to /saved, so surface a
  // Saved chip in the top nav (was reachable nowhere before).
  { href: "/saved",       label: "Wishlist",    icon: "♡" },
];

// v108 — Creator + Partner chips filtered per-tier inside the component.
// Public users don't see them at all; they appear automatically once the
// account is upgraded to that role. Hotel Partner link now points at
// /partner inside this app (same Next.js bundle, separate sb_partner_token
// auth) rather than the abandoned external Vercel deployment.
// v125.3 — USER_LINKS_BASE, CREATOR_LINK, HOTEL_LINK now imported from
// @/lib/user-links so this file and app/me/page.tsx stay byte-identical.
// Single source of truth. To add/remove/rename a menu item, edit
// lib/user-links.ts and BOTH menus update.

const BOTTOM_PRIMARY = [
  { href: "/",            label: "Home",      icon: "🏠" },
  { href: "/hotels",      label: "Hotels",    icon: "🏨" },
  // Centre slot → upsized into the brand FAB. "Discover" → "Reels" for the
  // shorter label so it fits the dock without truncation.
  { href: "/discover",    label: "Reels",     icon: "🎬" },
  { href: "/flash-deals", label: "Deals",     icon: "⚡", pulse: true },
  { href: "/bid",         label: "Bid",       icon: "🎯" },
];

// v495 — the OFFICIAL StayBid logo: the gold reflective SB monogram
// (public/brand/staybid-mark.png, cropped from the master lockup). Framed as a
// premium gold-rimmed tile with a live shine sweep (.sb-logo-mark, globals.css).
function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <span className="sb-logo-mark" style={{ width: size, height: size }} aria-hidden>
      <img src="/brand/staybid-mark.png" alt="StayBid" width={size} height={size} decoding="async" />
    </span>
  );
}

// v495 — "StayBid" as the official gold metallic serif wordmark (.sb-wordmark).
function BrandText({ className = "", dark = false }: { className?: string; dark?: boolean }) {
  return <span className={`sb-wordmark select-none ${className}`}>StayBid</span>;
}

/* ── Premium Location Chip — opens the shared globe modal ──────────── */
function LocationChip({ compact = false }: { compact?: boolean }) {
  const [city, setCity]     = useState("");
  const [picker, setPicker] = useState(false);

  useEffect(() => {
    try { setCity(localStorage.getItem("sb_city") || ""); } catch {}
    const apply = () => { try { setCity(localStorage.getItem("sb_city") || ""); } catch {} };
    window.addEventListener("sb:city-change", apply);
    return () => window.removeEventListener("sb:city-change", apply);
  }, []);

  return (
    <div className="relative">
      <button
        onClick={() => setPicker(true)}
        className="group relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[0.72rem] font-semibold transition-all duration-300 overflow-hidden"
        style={{
          background: "linear-gradient(135deg, rgba(240,180,41,0.18), rgba(255,255,255,0.04))",
          border: "1px solid rgba(240,180,41,0.35)",
          color: "#f0b429",
          boxShadow: "0 2px 8px rgba(201,145,26,0.15), inset 0 1px 0 rgba(255,255,255,0.2)",
        }}
      >
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        {city ? (<><span>📍</span><span className="truncate max-w-[90px]">{city}</span></>) : (<><span>🎯</span>{!compact && <span>Anywhere</span>}</>)}
      </button>

      {picker && (
        <LocationGlobeModal activeCity={city} onClose={() => setPicker(false)} />
      )}
    </div>
  );
}


export function Navbar() {
  const { user, logout } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();
  // v109 — single global tier context. isCreator + isHotelOwner are
  // independent flags (a user can be both); the menu surfaces each
  // entry only when that role is active. Refreshes automatically on
  // partner login / creator-app submit / customer login via the
  // sb:tier-refresh event wired in lib/tier-store.tsx.
  const { isCreator, isHotelOwner } = useTier();
  const showCreator = isCreator;
  const showHotel   = isHotelOwner;
  // v494 — the Menu lists only the customer's own pages. Creator Hub / Hotel
  // Partner (like Circle / Hosts) are verticals reached via "Switch experience",
  // so they're no longer duplicated into this flat list. Account settings is
  // appended (it was previously only on the mobile drawer — the desktop dropdown
  // was missing it).
  const userLinks = useMemo(() => [...USER_LINKS_BASE, ACCOUNT_LINK], []);
  // v497 — theme state for the in-dropdown Appearance row.
  const { theme, toggle: toggleTheme } = useTheme();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => { setMoreOpen(false); }, [pathname]);

  // Operator panels keep their own headers — always hide.
  if (pathname?.startsWith("/partner")) return null;
  if (pathname?.startsWith("/worker")) return null;
  if (pathname?.startsWith("/admin")) return null;
  if (pathname?.startsWith("/agent")) return null;
  if (pathname?.startsWith("/onboard")) return null;
  if (pathname?.startsWith("/host")) return null;
  if (pathname?.startsWith("/circle")) return null; // v288 StayCircle — own chrome
  if (pathname?.startsWith("/trade")) return null;  // v361 Model 3 travel-agent auction — own chrome
  if (pathname?.startsWith("/order")) return null;
  if (pathname?.startsWith("/kiosk")) return null;

  // Reel / IG-style customer routes — on MOBILE we want the in-page chrome
  // (own top bar / dock) to own the surface. On DESKTOP (>=1024px) we
  // re-render the Navbar so the user has the standard desktop top nav.
  // The hide is now CSS-driven via `data-reel-route="true"` + the
  // @media (max-width: 1023px) rule in app/desktop.css. v122.
  const isReelRoute =
    pathname === "/" ||
    pathname?.startsWith("/discover") ||
    pathname?.startsWith("/reels") ||
    pathname?.startsWith("/me") ||
    pathname?.startsWith("/saved/posts");

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  // v108 — same tier gate as the desktop chips above. Creator + Partner
  // tiles in the mobile More sheet only appear for the matching role.
  const moreLinks = user ? [
    { href: "/my-bids",       label: "My Bids",       icon: "📋" },
    { href: "/bookings",      label: "Bookings",      icon: "🎫" },
    { href: "/verification",  label: "Verification",  icon: "🎬" },
    { href: "/wallet",        label: "Wallet",        icon: "💰" },
    ...(showHotel   ? [{ href: "/partner",    label: "Partner", icon: "🏢" }] : []),
    ...(showCreator ? [{ href: "/influencer", label: "Creator", icon: "✨" }] : []),
    { href: "/profile",       label: "Profile",       icon: "👤" },
  ] : [];

  return (
    <>
      <style>{`
        /* ═══ 3D reflective nav styles ═══ */
        @keyframes navShine { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes navPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(240,180,41,0.5), inset 0 1px 0 rgba(255,255,255,0.3); } 50% { box-shadow: 0 0 18px 2px rgba(240,180,41,0.45), inset 0 1px 0 rgba(255,255,255,0.3); } }
        /* v90 — Navbar reads theme tokens. Light mode: cream-tinted
           translucent bar with cocoa text + champagne accent. Dark mode:
           warm cocoa bar with cream text. Same champagne underline. */
        .nav3d-bar {
          background: var(--bg-elevated);
          backdrop-filter: blur(22px) saturate(180%);
          -webkit-backdrop-filter: blur(22px) saturate(180%);
          border-bottom: 1px solid var(--border-soft);
          box-shadow: var(--shadow-soft), inset 0 1px 0 rgba(255,255,255,0.04);
          color: var(--text-base);
        }
        .nav3d-bar::after {
          content:""; position:absolute; left:0; right:0; bottom:-1px; height:1px;
          background: linear-gradient(90deg, transparent, var(--accent), transparent);
          opacity: 0.55;
        }
        .nav3d-chip {
          position: relative; overflow: hidden;
          background: var(--bg-pill);
          border: 1px solid var(--border-soft);
          /* v494 — bolder, higher-contrast resting text (was --text-soft). The
             chips no longer carry an inline text-white/N, so this token is the
             single source: dark cocoa on the light bar, cream on the dark bars. */
          color: var(--text-base);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 4px rgba(31,26,15,0.06);
          transition: transform .25s cubic-bezier(.3,1,.3,1), box-shadow .25s, border-color .25s, color .2s;
        }
        .nav3d-chip:hover {
          transform: translateY(-1px);
          border-color: var(--accent);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.08), 0 6px 18px var(--accent-soft);
          color: var(--text-base);
        }
        .nav3d-chip-active {
          background: var(--bg-pill-active) !important;
          border-color: var(--border-strong) !important;
          color: var(--text-inverse) !important;
          animation: navPulse 2.6s ease-in-out infinite;
        }
        .nav3d-chip::before {
          content:""; position:absolute; inset:0;
          background: linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.12) 50%, transparent 70%);
          background-size: 200% 100%;
          opacity: 0; transition: opacity .3s;
          pointer-events: none;
        }
        .nav3d-chip:hover::before { opacity: 1; animation: navShine 1.6s linear; }

        /* ─── Mobile floating dock (v58 — modern 3D, iOS-style magnification) ─── */
        @keyframes dockPulse {
          0%, 100% { box-shadow: 0 6px 20px rgba(240,180,41,0.45), 0 0 0 0 rgba(240,180,41,0.45), inset 0 1px 0 rgba(255,255,255,0.4); }
          50%      { box-shadow: 0 8px 28px rgba(240,180,41,0.55), 0 0 0 6px rgba(240,180,41,0), inset 0 1px 0 rgba(255,255,255,0.4); }
        }
        @keyframes dockRing {
          0%   { transform: scale(0.6); opacity: 1; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        @keyframes dockPopIn {
          0%   { transform: translateY(20px) scale(0.9); opacity: 0; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes dockGlowSlide {
          0%, 100% { background-position: 0% 50%; }
          50%      { background-position: 100% 50%; }
        }

        /* Floating capsule — margin from edges, glass, depth */
        .dock {
          position: fixed;
          left: 50%;
          bottom: max(env(safe-area-inset-bottom, 0px), 12px);
          transform: translateX(-50%);
          z-index: 50;
          padding: 6px;
          border-radius: 999px;
          background:
            linear-gradient(180deg, rgba(20,18,30,0.78) 0%, rgba(10,8,16,0.85) 100%);
          backdrop-filter: blur(28px) saturate(180%);
          -webkit-backdrop-filter: blur(28px) saturate(180%);
          border: 1px solid rgba(255,255,255,0.08);
          box-shadow:
            0 18px 50px rgba(0,0,0,0.55),
            0 4px 14px rgba(0,0,0,0.4),
            inset 0 1px 0 rgba(255,255,255,0.10),
            inset 0 -1px 0 rgba(0,0,0,0.4);
          animation: dockPopIn 0.45s cubic-bezier(.34,1.4,.64,1) both;
          display: flex; align-items: center;
          /* Compact width — doesn't span full screen, less visual noise */
          max-width: calc(100vw - 24px);
        }
        .dock::before {
          /* Top-edge gold sheen */
          content: ""; position: absolute; inset: 0;
          border-radius: 999px;
          background: linear-gradient(180deg, rgba(240,180,41,0.18) 0%, transparent 30%);
          pointer-events: none;
          opacity: 0.55;
        }

        /* Each dock button — iOS-dock magnification */
        .dock-btn {
          position: relative;
          flex: 0 0 auto;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          width: 56px; height: 56px;
          border-radius: 50%;
          background: transparent;
          color: rgba(255,255,255,0.55);
          /* Spring transition for the magnify effect */
          transition:
            transform 0.35s cubic-bezier(.34,1.5,.64,1),
            color 0.25s ease,
            background 0.25s ease;
          will-change: transform;
          gap: 1px;
          isolation: isolate;
        }
        .dock-btn-icon {
          font-size: 1.25rem;
          line-height: 1;
          filter: drop-shadow(0 1px 1px rgba(0,0,0,0.4));
          transition: transform 0.35s cubic-bezier(.34,1.5,.64,1);
        }
        .dock-btn-label {
          font-size: 0.52rem;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          margin-top: 1px;
          opacity: 0.7;
          transition: opacity 0.25s, transform 0.35s cubic-bezier(.34,1.5,.64,1);
        }

        /* Hover / active grows the button, label brightens */
        .dock-btn:hover { color: rgba(255,255,255,0.92); }
        .dock-btn:hover .dock-btn-icon { transform: translateY(-2px) scale(1.12); }
        .dock-btn:hover .dock-btn-label { opacity: 1; transform: translateY(1px); }
        .dock-btn:active .dock-btn-icon { transform: scale(0.92); }

        /* Active route — permanent gold-glow capsule behind the icon */
        .dock-btn.is-active {
          color: #fff;
          background:
            radial-gradient(circle at 50% 50%, rgba(240,180,41,0.35) 0%, rgba(240,180,41,0.05) 70%);
        }
        .dock-btn.is-active .dock-btn-icon {
          transform: translateY(-3px) scale(1.18);
          filter: drop-shadow(0 4px 8px rgba(240,180,41,0.55));
        }
        .dock-btn.is-active .dock-btn-label {
          opacity: 1;
          color: #fbd26a;
          letter-spacing: 0.08em;
        }

        /* Active gold indicator dot underneath */
        .dock-btn.is-active::after {
          content: "";
          position: absolute;
          bottom: 6px;
          left: 50%;
          transform: translateX(-50%);
          width: 4px; height: 4px;
          border-radius: 50%;
          background: linear-gradient(135deg, #f0d060, #f0b429);
          box-shadow: 0 0 8px #f0b429, 0 0 14px rgba(240,180,41,0.55);
          animation: dockPulse 2.4s ease-in-out infinite;
        }

        /* iOS-dock magnification — siblings of the hovered button shrink slightly */
        .dock:hover .dock-btn:not(:hover):not(.is-active) .dock-btn-icon {
          transform: scale(0.94);
          opacity: 0.85;
        }

        /* Centered FAB — bigger, raises out of the dock for emphasis */
        .dock-fab {
          width: 64px; height: 64px;
          margin: 0 -2px;
          background: linear-gradient(135deg, #f0d060 0%, #f0b429 55%, #c9911a 100%);
          color: #1a1208;
          border-radius: 50%;
          box-shadow:
            0 10px 26px rgba(240,180,41,0.45),
            0 4px 10px rgba(0,0,0,0.4),
            inset 0 2px 0 rgba(255,255,255,0.5),
            inset 0 -2px 0 rgba(120,80,0,0.3);
          animation: dockPulse 3s ease-in-out infinite;
          position: relative;
          z-index: 2;
        }
        .dock-fab .dock-btn-icon { font-size: 1.55rem; color: #1a1208; filter: none; }
        .dock-fab .dock-btn-label {
          color: #1a1208;
          opacity: 0.85;
          font-size: 0.48rem;
        }
        .dock-fab:hover { color: #1a1208; }
        .dock-fab.is-active::after { display: none; }

        /* Pulse-red dot for new content (Flash Deals) */
        .dock-btn-pulse {
          position: absolute;
          top: 9px; right: 11px;
          width: 6px; height: 6px;
          border-radius: 50%;
          background: #ff3859;
          box-shadow: 0 0 8px #ff3859, 0 0 0 2px rgba(20,18,30,0.95);
        }
        .dock-btn-pulse::after {
          content: ""; position: absolute; inset: -3px;
          border-radius: 50%; border: 1.5px solid #ff3859;
          animation: dockRing 1.8s ease-out infinite;
        }

        /* Compact width on narrow screens */
        @media (max-width: 380px) {
          .dock-btn { width: 50px; height: 50px; }
          .dock-fab { width: 58px; height: 58px; }
          .dock-btn-icon { font-size: 1.15rem; }
          .dock-fab .dock-btn-icon { font-size: 1.4rem; }
          .dock-btn-label { font-size: 0.48rem; }
        }

        @keyframes sheetIn { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .sheet-in { animation: sheetIn 0.28s cubic-bezier(0.34,1.2,0.64,1) both; }
        .bottom-nav { padding-bottom: env(safe-area-inset-bottom, 0px); }
        /* v59 — body padding-bottom dropped because the left-edge DialerNav
           does NOT consume vertical space. Pages now flow edge-to-edge. */
      `}</style>

      {/* ── TOP NAV (3D reflective) ──────────────────────────────────
          v122 — `data-reel-route` marker. On mobile, CSS hides the bar
          on reel-style routes so the in-page top chrome owns the
          surface; on desktop the marker is ignored and the bar shows. */}
      {/* v237 — Bumped z-50 → z-[1100]. .bgz-shell (the /bid climber
          + boot screen wrapper) is z-index: 1000, and previously the
          z-50 sticky Navbar slid UNDER the shell making it invisible
          on /bid. Sachin: "ss1 aur abhi bhi full screen show ho Raha
          hai bina nav baar ke" — the bgz-shell was eating the Navbar.
          z-1100 makes the Navbar STAY VISIBLE above every page
          chrome including /bid's climber. */}
      <nav className="sticky top-0 z-1100 nav3d-bar relative" data-reel-route={isReelRoute ? "true" : undefined}>
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between gap-3" style={{ height: "64px" }}>

          {/* Logo + Location (tight gap) */}
          <div className="flex items-center gap-2">
            <Link href="/" className="flex items-center gap-2 group select-none">
              <LogoMark size={36} />
              <BrandText className="text-[1.25rem] hidden sm:inline" dark />
            </Link>
            <div className="ml-1 flex items-center gap-1.5">
              <LocationChip compact />
              <ModeToggle />
            </div>
          </div>

          {/* Desktop primary nav — visible to ALL users (logged in or not) */}
          <div className="hidden md:flex items-center gap-1.5">
            {NAV_LINKS.map((item) => {
              const active = isActive(item.href);
              const isReels = item.href === "/reels";
              return (
                <Link key={item.href} href={item.href}
                  className={`nav3d-chip relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-[0.8rem] font-semibold tracking-wide ${active ? "nav3d-chip-active" : ""}`}>
                  <span className="text-sm">{item.icon}</span>
                  {item.label}
                  {item.pulse && !active && (
                    <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                  )}
                  {isReels && !active && (
                    <span className="ml-0.5 text-[0.55rem] font-black px-1.5 py-0.5 rounded-full"
                      style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)", color: "#000" }}>
                      NEW
                    </span>
                  )}
                </Link>
              );
            })}
            {/* v542 — desktop "Create post" entry, right in the top nav (IG-style).
                Reel surfaces only (where CreateFlow listens for `sb:open-create`);
                dispatches the SAME event as the in-frame FAB → SAME tier gate.
                Fixes the desktop bug where the in-frame FAB was buried inside the
                overflow:hidden phone frame. Desktop-only (this row is `md:flex`);
                phones keep the FAB. */}
            {["/", "/discover", "/reels"].includes(pathname || "") && (
              <button
                type="button"
                aria-label="Create a post"
                onClick={() => { try { window.dispatchEvent(new CustomEvent("sb:open-create")); } catch {} }}
                className="nav3d-chip relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-[0.8rem] font-bold tracking-wide"
                style={{ background: "linear-gradient(135deg,#E7CFA0,#D9BE82 45%,#C9A66B)", color: "#1F1A0F" }}
              >
                <span className="text-sm leading-none">＋</span>
                Create
              </button>
            )}
          </div>

          {/* Desktop user nav — user-specific actions.
              v122.2 — user-links ALWAYS collapse into a "Menu ▼" dropdown
              on desktop. The earlier "inline at >=1440px" experiment
              still overflowed because the navbar container is capped at
              max-w-7xl (1280px) regardless of viewport. The dropdown is
              a clean IG.com / Twitter / LinkedIn pattern — every link is
              one tap away and the top row never overflows horizontally. */}
          <div className="hidden md:flex items-center gap-1.5">
            {user ? (
              <>
                {/* Always-collapsed "Menu ▼" — desktop only (md+). The
                    customer Navbar is hidden on mobile and on reel
                    routes anyway, so this is the desktop path. */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setMoreOpen((s) => !s)}
                    className={`nav3d-chip flex items-center gap-1.5 px-3 py-2 rounded-xl text-[0.8rem] font-semibold tracking-wide ${moreOpen ? "nav3d-chip-active" : ""}`}
                    aria-haspopup="menu"
                    aria-expanded={moreOpen}
                  >
                    <span className="text-sm">☰</span>
                    Menu
                    <span className="text-[0.5rem] opacity-60">▼</span>
                  </button>
                  {moreOpen && (
                    <>
                      {/* Click-away backdrop */}
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setMoreOpen(false)}
                        aria-hidden
                      />
                      <div
                        className="absolute right-0 top-full mt-2 z-50 w-56 rounded-2xl overflow-hidden"
                        style={{
                          background: "var(--bg-elevated, rgba(15,12,8,0.94))",
                          backdropFilter: "blur(20px) saturate(180%)",
                          WebkitBackdropFilter: "blur(20px) saturate(180%)",
                          border: "1px solid var(--border-strong, rgba(240,180,41,0.28))",
                          boxShadow: "0 18px 50px rgba(0,0,0,0.45), 0 4px 14px rgba(0,0,0,0.30)",
                        }}
                        role="menu"
                      >
                        {/* v322 — Switch experience (opens the global panel
                            switcher). Sits at the top of the menu. */}
                        <button
                          type="button"
                          onClick={() => { setMoreOpen(false); window.dispatchEvent(new Event("sb:open-switcher")); }}
                          className="flex items-center gap-3 px-3.5 py-2.5 w-full text-left text-[0.82rem] font-semibold transition-colors"
                          style={{ color: "var(--accent, #f0b429)", background: "rgba(240,180,41,0.06)", borderBottom: "1px solid rgba(240,180,41,0.14)" }}
                          role="menuitem"
                        >
                          <span className="text-base">⇅</span>
                          Switch experience
                        </button>
                        {userLinks.map((item: any) => {
                          const active = isActive(item.href);
                          return (
                            <Link
                              key={item.href}
                              href={item.href}
                              onClick={() => setMoreOpen(false)}
                              className="flex items-center gap-3 px-3.5 py-2.5 text-[0.82rem] font-semibold transition-colors"
                              style={{
                                color: active ? "var(--accent, #f0b429)" : "var(--text-soft, rgba(255,255,255,0.78))",
                                background: active ? "rgba(240,180,41,0.10)" : "transparent",
                                borderLeft: active ? "2px solid var(--accent, #f0b429)" : "2px solid transparent",
                              }}
                            >
                              <span className="text-base">{item.icon}</span>
                              {item.label}
                            </Link>
                          );
                        })}
                        {/* v497 — Appearance (theme) + App Tour + Help & Support
                            moved BELOW Account settings (they had no use at the
                            top). Appearance was previously desktop-missing. */}
                        <button
                          type="button"
                          onClick={toggleTheme}
                          className="flex items-center gap-3 px-3.5 py-2.5 w-full text-left text-[0.82rem] font-semibold transition-colors hover:bg-white/5"
                          style={{ color: "var(--text-base, #1F1A0F)", borderTop: "1px solid rgba(240,180,41,0.14)" }}
                          role="menuitem"
                        >
                          <span className="text-base">{theme === "dark" ? "🌙" : "☀️"}</span>
                          Appearance
                          <span className="ml-auto text-[0.7rem] font-medium" style={{ color: "var(--text-muted, rgba(120,110,90,0.8))" }}>
                            {theme === "dark" ? "Dark" : "Light"}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => { setMoreOpen(false); window.dispatchEvent(new Event("sb:open-tour")); }}
                          className="flex items-center gap-3 px-3.5 py-2.5 w-full text-left text-[0.82rem] font-semibold transition-colors hover:bg-white/5"
                          style={{ color: "var(--text-base, #1F1A0F)" }}
                          role="menuitem"
                        >
                          <span className="text-base">❓</span>
                          App Tour
                        </button>
                        <button
                          type="button"
                          onClick={() => { setMoreOpen(false); window.dispatchEvent(new Event("sb:open-support")); }}
                          className="flex items-center gap-3 px-3.5 py-2.5 w-full text-left text-[0.82rem] font-semibold transition-colors hover:bg-white/5"
                          style={{ color: "var(--text-base, #1F1A0F)" }}
                          role="menuitem"
                        >
                          <span className="text-base">🎧</span>
                          Help &amp; Support
                        </button>
                      </div>
                    </>
                  )}
                </div>

                <Link href="/profile"
                  className={`nav3d-chip group relative flex items-center gap-2 pl-1 pr-3 py-1 rounded-full ml-1 ${isActive("/profile") ? "nav3d-chip-active" : ""}`}>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                    style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3)" }}>
                    {(user.name || user.phone || "S").slice(0, 2).toUpperCase()}
                  </div>
                  {/* v494 — was text-white/80 → invisible on the light bar (only
                      "SA" showed). text-luxury-900 is theme/route-aware. */}
                  <span className="text-xs font-semibold text-luxury-900 leading-none">
                    {user.name ? user.name.split(" ")[0] : "Profile"}
                  </span>
                </Link>

                <button onClick={logout}
                  className="nav3d-chip ml-1 text-xs font-semibold px-3 py-2 rounded-xl hover:text-red-500">
                  Sign Out
                </button>
              </>
            ) : (
              <Link href="/auth" className="lux-btn px-5 py-2 rounded-full text-sm ml-1">
                Sign In
              </Link>
            )}
          </div>

          {/* Mobile top right */}
          <div className="md:hidden flex items-center gap-2">
            {user ? (
              <Link href="/profile"
                className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold"
                style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)", boxShadow: "0 3px 12px rgba(240,180,41,0.4), inset 0 1px 0 rgba(255,255,255,0.3)" }}>
                {(user.name || user.phone || "S").slice(0, 2).toUpperCase()}
              </Link>
            ) : (
              <Link href="/auth" className="lux-btn px-4 py-2 rounded-full text-xs">Sign In</Link>
            )}
          </div>
        </div>
      </nav>

      {/* v59 — Bottom dock removed. The new <DialerNav /> on the left edge
          (mounted globally in app/layout.tsx) handles all mobile nav now.
          See components/DialerNav.tsx for the rotating-wheel interaction. */}

      {/* ── MOBILE MORE SHEET ─────────────────────────────────── */}
      {moreOpen && (
        <>
          <div className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-xs"
            onClick={() => setMoreOpen(false)} />
          <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 sheet-in"
            style={{ background: "linear-gradient(180deg,#12101c,#0a0812)", borderRadius: "24px 24px 0 0", boxShadow: "0 -12px 50px rgba(0,0,0,0.7)", border: "1px solid rgba(240,180,41,0.25)" }}>

            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>

            <div className="flex items-center gap-2.5 px-5 py-3 border-b border-white/10">
              <LogoMark size={32} />
              <BrandText className="text-lg" dark />
              <span className="ml-auto text-[0.58rem] font-bold text-gold-400 tracking-widest uppercase border border-gold-500/40 px-2 py-0.5 rounded-full">
                LUXURY PLATFORM
              </span>
            </div>

            <div className="px-4 py-4">
              {/* v404 — App Tour + Help & Support (floating "?" + support bubble
                  removed from every screen; now in the menu). */}
              <div className="grid grid-cols-2 gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => { setMoreOpen(false); window.dispatchEvent(new Event("sb:open-tour")); }}
                  className="flex items-center gap-2 p-3 rounded-2xl text-left active:scale-[0.98] transition-transform"
                  style={{ background: "rgba(201,166,107,0.10)", border: "1px solid rgba(201,166,107,0.24)" }}
                >
                  <span className="text-lg shrink-0">❓</span>
                  <span className="text-sm font-bold text-white leading-tight">App Tour</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setMoreOpen(false); window.dispatchEvent(new Event("sb:open-support")); }}
                  className="flex items-center gap-2 p-3 rounded-2xl text-left active:scale-[0.98] transition-transform"
                  style={{ background: "rgba(201,166,107,0.10)", border: "1px solid rgba(201,166,107,0.24)" }}
                >
                  <span className="text-lg shrink-0">🎧</span>
                  <span className="text-sm font-bold text-white leading-tight">Help &amp; Support</span>
                </button>
              </div>
              {/* v322 — Switch experience (opens the global panel switcher). */}
              <button
                type="button"
                onClick={() => { setMoreOpen(false); window.dispatchEvent(new Event("sb:open-switcher")); }}
                className="w-full mb-3 flex items-center gap-3 p-3 rounded-2xl text-left active:scale-[0.98] transition-transform"
                style={{ background: "linear-gradient(135deg,rgba(201,166,107,0.16),rgba(240,180,41,0.10))", border: "1px solid rgba(240,180,41,0.3)" }}
              >
                <span className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0" style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)", color: "#1F1A0F" }}>⇅</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white leading-none mb-0.5">Switch experience</p>
                  <p className="text-xs text-white/50 truncate">Partner · Circle · Hosts · Creator</p>
                </div>
                <span className="text-xs font-bold text-gold-400 shrink-0">Open →</span>
              </button>
              {user && (
                <div className="grid grid-cols-4 gap-2 mb-3">
                  {moreLinks.map((item) => {
                    const active = isActive(item.href);
                    return (
                      <Link key={item.href} href={item.href} onClick={() => setMoreOpen(false)}
                        className={`nav3d-chip flex flex-col items-center gap-1.5 py-3 px-1 rounded-2xl text-center text-white/70 ${active ? "nav3d-chip-active" : ""}`}>
                        <span className="text-xl">{item.icon}</span>
                        <span className="text-[0.6rem] font-bold tracking-wide leading-tight">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}

              {user ? (
                <div className="space-y-2">
                  <Link href="/profile" onClick={() => setMoreOpen(false)}
                    className="lux-glass lux-border flex items-center gap-3 p-3 rounded-2xl active:scale-[0.98] transition-transform">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0"
                      style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3)" }}>
                      {(user.name || user.phone || "S").slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white leading-none mb-0.5 truncate">
                        {user.name || "StayBid Member"}
                      </p>
                      <p className="text-xs text-white/50 truncate">{user.phone}</p>
                    </div>
                    <span className="text-xs font-bold text-gold-400 shrink-0">Profile →</span>
                  </Link>

                  <button onClick={() => { logout(); setMoreOpen(false); }}
                    className="w-full py-3 rounded-xl border border-red-500/30 text-red-400 text-sm font-semibold hover:bg-red-500/10 active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                    🚪 Sign Out
                  </button>
                </div>
              ) : (
                <Link href="/auth" onClick={() => setMoreOpen(false)}
                  className="lux-btn w-full py-3.5 rounded-xl text-center text-sm block font-bold">
                  🔐 Sign In to StayBid
                </Link>
              )}
            </div>
            <div style={{ height: "env(safe-area-inset-bottom, 0px)" }} />
          </div>
        </>
      )}
    </>
  );
}
