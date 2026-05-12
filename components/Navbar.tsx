"use client";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { ModeToggle } from "@/components/ModeToggle";
import { LocationGlobeModal } from "@/components/LocationGlobePicker";

const CITIES = ["Mussoorie", "Dhanaulti", "Rishikesh", "Shimla", "Manali", "Dehradun"];

const NAV_LINKS = [
  { href: "/hotels",      label: "Hotels",      icon: "🏨" },
  { href: "/flash-deals", label: "Flash Deals", icon: "⚡", pulse: true },
  // "Reels" is just the content type — rename to "Discover" so the chip
  // describes what the user *does* with it (browse hotel reels).
  { href: "/reels",       label: "Discover",    icon: "🎬" },
  { href: "/bid",         label: "Place Bid",   icon: "🎯" },
];

const USER_LINKS = [
  { href: "/my-bids",       label: "My Bids",       icon: "📋" },
  { href: "/bookings",      label: "Bookings",      icon: "🎫" },
  { href: "/saved",         label: "Saved",         icon: "🔖" },
  { href: "/verification",  label: "Verification",  icon: "🎬" },
  { href: "/wallet",        label: "Wallet",        icon: "💰" },
  { href: "/points",        label: "Points",        icon: "⭐" },
  { href: "/influencer",    label: "Creator",       icon: "✨" },
  // Real hotel partner panel lives in a separate Vercel deployment +
  // GitHub repo (Sachinhelpline/staybid-hotel-panel). External link so the
  // user lands on the actual dashboard, not the old in-repo demo.
  { href: "https://staybid-hotel-panel.vercel.app", label: "Partner",       icon: "🏢", external: true },
];

const BOTTOM_PRIMARY = [
  { href: "/",            label: "Home",      icon: "🏠" },
  { href: "/hotels",      label: "Hotels",    icon: "🏨" },
  // Centre slot → upsized into the brand FAB. "Discover" → "Reels" for the
  // shorter label so it fits the dock without truncation.
  { href: "/discover",    label: "Reels",     icon: "🎬" },
  { href: "/flash-deals", label: "Deals",     icon: "⚡", pulse: true },
  { href: "/bid",         label: "Bid",       icon: "🎯" },
];

function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f0b429"/>
          <stop offset="100%" stopColor="#c9911a"/>
        </linearGradient>
        <linearGradient id="sG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff"/>
          <stop offset="100%" stopColor="#e2e8f0"/>
        </linearGradient>
      </defs>
      <rect width="120" height="120" rx="22" fill="#0d1b2e"/>
      <path d="M60 20 L90 46 L84 46 L84 76 L36 76 L36 46 L30 46 Z" fill="none" stroke="#c9911a" strokeWidth="3" strokeLinejoin="round"/>
      <rect x="50" y="58" width="20" height="18" rx="3" fill="#c9911a" opacity="0.75"/>
      <text x="18" y="112" fontFamily="Inter,Arial,sans-serif" fontWeight="900" fontSize="58" fill="url(#gG)" letterSpacing="-3">S</text>
      <text x="63" y="112" fontFamily="Inter,Arial,sans-serif" fontWeight="900" fontSize="58" fill="url(#sG)" letterSpacing="-3">B</text>
    </svg>
  );
}

function BrandText({ className = "", dark = false }: { className?: string; dark?: boolean }) {
  return (
    <span className={`font-black tracking-tight leading-none select-none ${className}`}
      style={{ fontFamily: "'Inter', sans-serif" }}>
      <span className={dark ? "text-white" : "text-luxury-900"}>stay</span>
      <span style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>bid</span>
    </span>
  );
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

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => { setMoreOpen(false); }, [pathname]);

  if (pathname?.startsWith("/partner")) return null;
  if (pathname?.startsWith("/admin")) return null;     // admin panel has its own header
  if (pathname?.startsWith("/onboard")) return null;   // onboarding panel has its own header
  if (pathname?.startsWith("/discover")) return null;  // full-display reel mode
  if (pathname?.startsWith("/reels")) return null;     // Instagram-style video feed
  if (pathname?.startsWith("/me")) return null;        // IG-style "You" profile has its own top bar
  // `/` now renders DiscoverPage directly (v57). Hide the navbar there too —
  // the reel feed has its own minimal top chrome (StayBid label + Compare),
  // and the floating dock at the bottom handles primary nav.
  if (pathname === "/") return null;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  const moreLinks = user ? [
    { href: "/my-bids",       label: "My Bids",       icon: "📋" },
    { href: "/bookings",      label: "Bookings",      icon: "🎫" },
    { href: "/verification",  label: "Verification",  icon: "🎬" },
    { href: "/wallet",        label: "Wallet",        icon: "💰" },
    // Real hotel partner panel lives in a separate Vercel deployment +
  // GitHub repo (Sachinhelpline/staybid-hotel-panel). External link so the
  // user lands on the actual dashboard, not the old in-repo demo.
  { href: "https://staybid-hotel-panel.vercel.app", label: "Partner",       icon: "🏢", external: true },
    { href: "/influencer",    label: "Creator",       icon: "✨" },
    { href: "/profile",       label: "Profile",       icon: "👤" },
  ] : [];

  return (
    <>
      <style>{`
        /* ═══ 3D reflective nav styles ═══ */
        @keyframes navShine { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes navPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(240,180,41,0.5), inset 0 1px 0 rgba(255,255,255,0.3); } 50% { box-shadow: 0 0 18px 2px rgba(240,180,41,0.45), inset 0 1px 0 rgba(255,255,255,0.3); } }
        .nav3d-bar {
          background:
            linear-gradient(180deg, rgba(12,10,22,0.85) 0%, rgba(10,8,18,0.92) 100%);
          backdrop-filter: blur(22px) saturate(180%);
          -webkit-backdrop-filter: blur(22px) saturate(180%);
          border-bottom: 1px solid rgba(240,180,41,0.22);
          box-shadow: 0 6px 30px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06);
        }
        .nav3d-bar::after {
          content:""; position:absolute; left:0; right:0; bottom:-1px; height:1px;
          background: linear-gradient(90deg, transparent, rgba(240,180,41,0.7), transparent);
        }
        .nav3d-chip {
          position: relative; overflow: hidden;
          background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02));
          border: 1px solid rgba(255,255,255,0.08);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.08), 0 2px 6px rgba(0,0,0,0.25);
          transition: transform .25s cubic-bezier(.3,1,.3,1), box-shadow .25s, border-color .25s, color .2s;
        }
        .nav3d-chip:hover {
          transform: translateY(-1px);
          border-color: rgba(240,180,41,0.35);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.12), 0 6px 18px rgba(240,180,41,0.15);
          color: #fff;
        }
        .nav3d-chip-active {
          background: linear-gradient(180deg, rgba(240,180,41,0.22), rgba(201,145,26,0.08));
          border-color: rgba(240,180,41,0.55) !important;
          color: #fbd26a !important;
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

      {/* ── TOP NAV (3D reflective) ────────────────────────────────── */}
      <nav className="sticky top-0 z-50 nav3d-bar relative">
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
                  className={`nav3d-chip relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium tracking-wide text-white/70 ${active ? "nav3d-chip-active" : ""}`}>
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
          </div>

          {/* Desktop user nav — user-specific actions */}
          <div className="hidden md:flex items-center gap-1.5">
            {user ? (
              <>
                {USER_LINKS.map((item) => {
                  const active = isActive(item.href);
                  // External entries (e.g. real hotel-panel) open in a new tab.
                  if ((item as any).external) {
                    return (
                      <a key={item.href} href={item.href} target="_blank" rel="noopener noreferrer"
                        className="nav3d-chip flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium tracking-wide text-white/70">
                        <span className="text-sm">{item.icon}</span>
                        {item.label}
                        <span className="ml-0.5 text-[0.6rem] opacity-60">↗</span>
                      </a>
                    );
                  }
                  return (
                    <Link key={item.href} href={item.href}
                      className={`nav3d-chip flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium tracking-wide text-white/70 ${active ? "nav3d-chip-active" : ""}`}>
                      <span className="text-sm">{item.icon}</span>
                      {item.label}
                    </Link>
                  );
                })}

                <Link href="/profile"
                  className={`nav3d-chip group relative flex items-center gap-2 pl-1 pr-3 py-1 rounded-full ml-1 ${isActive("/profile") ? "nav3d-chip-active" : ""}`}>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                    style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3)" }}>
                    {(user.name || user.phone || "S").slice(0, 2).toUpperCase()}
                  </div>
                  <span className="text-xs font-semibold text-white/80 leading-none">
                    {user.name ? user.name.split(" ")[0] : "Profile"}
                  </span>
                </Link>

                <button onClick={logout}
                  className="nav3d-chip ml-1 text-xs px-3 py-2 rounded-xl text-white/50 hover:text-red-400">
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
          <div className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
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
              {user && (
                <div className="grid grid-cols-4 gap-2 mb-3">
                  {moreLinks.map((item) => {
                    const active = isActive(item.href);
                    if ((item as any).external) {
                      return (
                        <a key={item.href} href={item.href} target="_blank" rel="noopener noreferrer" onClick={() => setMoreOpen(false)}
                          className="nav3d-chip flex flex-col items-center gap-1.5 py-3 px-1 rounded-2xl text-center text-white/70">
                          <span className="text-xl">{item.icon}</span>
                          <span className="text-[0.6rem] font-bold tracking-wide leading-tight">{item.label} ↗</span>
                        </a>
                      );
                    }
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
