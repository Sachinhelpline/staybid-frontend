"use client";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";

/* ── Nav link definitions ──────────────────────────────────────── */
const NAV_LINKS = [
  { href: "/hotels",      label: "Hotels",      icon: "🏨" },
  { href: "/flash-deals", label: "Flash Deals", icon: "⚡", pulse: true },
  { href: "/bid",         label: "Place Bid",   icon: "🎯" },
];

const USER_LINKS = [
  { href: "/my-bids",       label: "My Bids",  icon: "📋" },
  { href: "/bookings",      label: "Bookings", icon: "🎫" },
  { href: "/wallet",        label: "Wallet",   icon: "💰" },
  { href: "/hotel-partner", label: "Partner",  icon: "🏢" },
];

// Bottom-bar primary items (always visible on mobile)
const BOTTOM_PRIMARY = [
  { href: "/",          label: "Home",       icon: "🏠" },
  { href: "/hotels",    label: "Hotels",     icon: "🏨" },
  { href: "/flash-deals", label: "Deals",   icon: "⚡", pulse: true },
  { href: "/bid",       label: "Place Bid",  icon: "🎯" },
];

/* ── StayBid Logo mark (inline SVG matching brand) ─────────────── */
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
      {/* Navy background */}
      <rect width="120" height="120" rx="22" fill="#0d1b2e"/>
      {/* Roof outline */}
      <path d="M60 20 L90 46 L84 46 L84 76 L36 76 L36 46 L30 46 Z"
        fill="none" stroke="#c9911a" strokeWidth="3" strokeLinejoin="round"/>
      {/* Door */}
      <rect x="50" y="58" width="20" height="18" rx="3" fill="#c9911a" opacity="0.75"/>
      {/* S */}
      <text x="18" y="112" fontFamily="Inter,Arial,sans-serif" fontWeight="900"
        fontSize="58" fill="url(#gG)" letterSpacing="-3">S</text>
      {/* B */}
      <text x="63" y="112" fontFamily="Inter,Arial,sans-serif" fontWeight="900"
        fontSize="58" fill="url(#sG)" letterSpacing="-3">B</text>
    </svg>
  );
}

/* ── Branded "staybid" text ─────────────────────────────────────── */
function BrandText({ className = "" }: { className?: string }) {
  return (
    <span className={`font-black tracking-tight leading-none select-none ${className}`}
      style={{ fontFamily: "'Inter', sans-serif" }}>
      <span className="text-luxury-900">stay</span>
      <span style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>bid</span>
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   NAVBAR COMPONENT
   ═══════════════════════════════════════════════════════════════════ */
export function Navbar() {
  const { user, logout } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const [scrolled, setScrolled]   = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close more-drawer on route change
  useEffect(() => { setMoreOpen(false); }, [pathname]);

  // Partner panel has its own layout — hide customer Navbar there
  if (pathname?.startsWith("/partner")) return null;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  const allMoreLinks = [
    ...(user ? [
      { href: "/my-bids",       label: "My Bids",  icon: "📋" },
      { href: "/bookings",      label: "Bookings", icon: "🎫" },
      { href: "/wallet",        label: "Wallet",   icon: "💰" },
      { href: "/hotel-partner", label: "Partner",  icon: "🏢" },
      { href: "/profile",       label: "Profile",  icon: "👤" },
    ] : []),
    { href: "/auth", label: user ? "Sign Out" : "Sign In", icon: user ? "🚪" : "🔐", isAction: !!user },
  ];

  return (
    <>
      <style>{`
        @keyframes navGlow{0%,100%{box-shadow:0 0 8px rgba(201,145,26,0.3)}50%{box-shadow:0 0 18px rgba(201,145,26,0.55)}}
        .nav-active{animation:navGlow 2.5s ease-in-out infinite}
        @keyframes slideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        .slide-up{animation:slideUp 0.2s ease-out both}
        @keyframes sheetIn{from{transform:translateY(100%)}to{transform:translateY(0)}}
        .sheet-in{animation:sheetIn 0.28s cubic-bezier(0.34,1.2,0.64,1) both}
        /* bottom nav safe area */
        .bottom-nav{padding-bottom:env(safe-area-inset-bottom,0px)}
        /* push page content above bottom nav on mobile */
        @media(max-width:767px){body{padding-bottom:72px}}
      `}</style>

      {/* ── TOP NAVBAR ──────────────────────────────────────────── */}
      <nav className={`sticky top-0 z-50 transition-all duration-500 ${scrolled ? "glass shadow-luxury" : "bg-transparent"}`}>
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between" style={{ height: "68px" }}>

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group select-none">
            <LogoMark size={40} />
            <BrandText className="text-[1.4rem]" />
          </Link>

          {/* ── Desktop nav ────────────────────────────────────── */}
          <div className="hidden md:flex items-center gap-1.5">
            {NAV_LINKS.map((item) => {
              const active = isActive(item.href);
              return (
                <Link key={item.href} href={item.href}
                  className={`relative flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium tracking-wide transition-all duration-200 group
                    ${active
                      ? "bg-gold-500/10 text-gold-600 border border-gold-400/30 nav-active"
                      : "text-luxury-500 hover:text-luxury-900 hover:bg-luxury-50 border border-transparent hover:border-luxury-100"
                    }`}>
                  <span className={`text-base transition-transform duration-200 ${active ? "" : "group-hover:scale-110"}`}>{item.icon}</span>
                  {item.label}
                  {item.pulse && !active && <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />}
                  {active && <span className="absolute -bottom-px left-3 right-3 h-px bg-gradient-to-r from-transparent via-gold-500 to-transparent" />}
                </Link>
              );
            })}

            <div className="h-5 w-px bg-luxury-200 mx-1" />

            {user ? (
              <>
                {USER_LINKS.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <Link key={item.href} href={item.href}
                      className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium tracking-wide transition-all duration-200 group border
                        ${active
                          ? "bg-gold-500/10 text-gold-600 border-gold-400/30 nav-active"
                          : "text-luxury-500 hover:text-luxury-900 hover:bg-luxury-50 border-transparent hover:border-luxury-100"
                        }`}>
                      <span className="text-base group-hover:scale-110 transition-transform duration-200">{item.icon}</span>
                      {item.label}
                    </Link>
                  );
                })}

                {/* Profile avatar */}
                <Link href="/profile"
                  className={`group relative flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border transition-all duration-200 ml-1
                    ${isActive("/profile") ? "border-gold-400/50 bg-gold-500/10 nav-active" : "border-luxury-200 hover:border-gold-300 hover:bg-gold-50"}`}>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                    style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)" }}>
                    {(user.name || user.phone || "S").slice(0, 2).toUpperCase()}
                  </div>
                  <span className="text-xs font-semibold text-luxury-600 group-hover:text-luxury-900 transition-colors leading-none">
                    {user.name ? user.name.split(" ")[0] : "Profile"}
                  </span>
                </Link>

                <button onClick={logout}
                  className="ml-1 text-xs px-3.5 py-2 rounded-xl border border-luxury-200 text-luxury-400 hover:border-red-200 hover:text-red-500 hover:bg-red-50 transition-all duration-200">
                  Sign Out
                </button>
              </>
            ) : (
              <Link href="/auth" className="btn-luxury px-5 py-2.5 rounded-full text-sm ml-1 shadow-gold hover:scale-105 transition-transform">
                Sign In
              </Link>
            )}
          </div>

          {/* Mobile: user avatar / sign in (top right) */}
          <div className="md:hidden flex items-center gap-2">
            {user ? (
              <Link href="/profile"
                className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-gold"
                style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)" }}>
                {(user.name || user.phone || "S").slice(0, 2).toUpperCase()}
              </Link>
            ) : (
              <Link href="/auth" className="btn-luxury px-4 py-2 rounded-full text-xs shadow-gold">Sign In</Link>
            )}
          </div>
        </div>

        {/* Gold accent line */}
        <div className="gold-line" />
      </nav>

      {/* ── MOBILE BOTTOM NAVIGATION BAR ──────────────────────── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bottom-nav"
        style={{ background: "rgba(255,255,255,0.97)", backdropFilter: "blur(20px)", borderTop: "1px solid rgba(201,145,26,0.2)", boxShadow: "0 -4px 24px rgba(0,0,0,0.1)" }}>

        <div className="flex items-stretch" style={{ height: "64px" }}>

          {/* Primary nav buttons */}
          {BOTTOM_PRIMARY.map((item) => {
            const active = isActive(item.href);
            return (
              <Link key={item.href} href={item.href}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-all duration-200 relative
                  ${active ? "text-gold-600" : "text-luxury-400 active:scale-95"}`}>
                {/* Active indicator pill */}
                {active && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full"
                    style={{ background: "linear-gradient(90deg,#c9911a,#f0b429)" }} />
                )}
                <span className={`text-[1.3rem] transition-transform duration-200 ${active ? "scale-110" : ""}`}>
                  {item.icon}
                </span>
                <span className={`text-[0.6rem] font-bold tracking-wide leading-none ${active ? "text-gold-600" : "text-luxury-400"}`}>
                  {item.label}
                </span>
                {item.pulse && !active && (
                  <span className="absolute top-2 right-[calc(50%-10px)] w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                )}
              </Link>
            );
          })}

          {/* More button */}
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-all duration-200 relative
              ${moreOpen ? "text-gold-600" : "text-luxury-400 active:scale-95"}`}>
            {moreOpen && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full"
                style={{ background: "linear-gradient(90deg,#c9911a,#f0b429)" }} />
            )}
            <span className="text-[1.3rem]">
              {moreOpen ? "✕" : "☰"}
            </span>
            <span className={`text-[0.6rem] font-bold tracking-wide leading-none ${moreOpen ? "text-gold-600" : "text-luxury-400"}`}>
              More
            </span>
          </button>
        </div>
      </div>

      {/* ── MOBILE MORE SHEET (slide up) ──────────────────────── */}
      {moreOpen && (
        <>
          {/* Backdrop */}
          <div className="md:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={() => setMoreOpen(false)} />

          {/* Sheet */}
          <div className="md:hidden fixed bottom-16 left-0 right-0 z-50 sheet-in"
            style={{ background: "rgba(255,255,255,0.98)", borderRadius: "24px 24px 0 0", boxShadow: "0 -8px 40px rgba(0,0,0,0.15)", border: "1px solid rgba(201,145,26,0.15)" }}>

            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-luxury-200" />
            </div>

            {/* Brand row */}
            <div className="flex items-center gap-2.5 px-5 py-3 border-b border-luxury-100">
              <LogoMark size={32} />
              <BrandText className="text-lg" />
              <span className="ml-auto text-[0.58rem] font-bold text-gold-500 tracking-widest uppercase bg-gold-50 border border-gold-200 px-2 py-0.5 rounded-full">
                LUXURY PLATFORM
              </span>
            </div>

            {/* Links grid */}
            <div className="px-4 py-4">
              {user && (
                <div className="grid grid-cols-4 gap-2 mb-3">
                  {allMoreLinks.filter(l => !l.isAction && l.href !== "/auth").map((item) => {
                    const active = isActive(item.href);
                    return (
                      <Link key={item.href} href={item.href} onClick={() => setMoreOpen(false)}
                        className={`flex flex-col items-center gap-1.5 py-3 px-1 rounded-2xl border transition-all text-center
                          ${active
                            ? "bg-gold-500/10 border-gold-400/40 text-gold-600 shadow-gold"
                            : "bg-luxury-50 border-luxury-100 text-luxury-600 hover:border-gold-200 active:scale-95"
                          }`}>
                        <span className="text-xl">{item.icon}</span>
                        <span className="text-[0.6rem] font-bold tracking-wide leading-tight">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}

              {/* User profile row or sign in */}
              {user ? (
                <div className="space-y-2">
                  <Link href="/profile" onClick={() => setMoreOpen(false)}
                    className="flex items-center gap-3 p-3 rounded-2xl border border-gold-200 bg-gradient-to-r from-gold-50 to-amber-50 active:scale-[0.98] transition-transform">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0"
                      style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)" }}>
                      {(user.name || user.phone || "S").slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-luxury-900 leading-none mb-0.5 truncate">
                        {user.name || "StayBid Member"}
                      </p>
                      <p className="text-xs text-luxury-400 truncate">{user.phone}</p>
                    </div>
                    <span className="text-xs font-bold text-gold-600 shrink-0">Profile →</span>
                  </Link>

                  <button onClick={() => { logout(); setMoreOpen(false); }}
                    className="w-full py-3 rounded-xl border border-red-200 text-red-500 text-sm font-semibold hover:bg-red-50 active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                    🚪 Sign Out
                  </button>
                </div>
              ) : (
                <Link href="/auth" onClick={() => setMoreOpen(false)}
                  className="btn-luxury w-full py-3.5 rounded-xl text-center text-sm block shadow-gold font-bold">
                  🔐 Sign In to StayBid
                </Link>
              )}
            </div>

            {/* Safe area spacer */}
            <div style={{ height: "env(safe-area-inset-bottom, 0px)" }} />
          </div>
        </>
      )}
    </>
  );
}
