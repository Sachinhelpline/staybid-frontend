"use client";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/hotels",      label: "Hotels",      icon: "🏨" },
  { href: "/flash-deals", label: "Flash Deals", icon: "⚡", pulse: true },
  { href: "/bid",         label: "Place Bid",   icon: "🎯" },
];

const USER_LINKS = [
  { href: "/my-bids",       label: "My Bids",    icon: "📋" },
  { href: "/bookings",      label: "Bookings",   icon: "🎫" },
  { href: "/wallet",        label: "Wallet",     icon: "💰" },
  { href: "/hotel-partner", label: "Partner",    icon: "🏢" },
];

export function Navbar() {
  const { user, logout } = useAuth();
  const [open, setOpen]       = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <>
      <style>{`
        @keyframes navGlow { 0%,100%{box-shadow:0 0 8px rgba(201,145,26,0.3)} 50%{box-shadow:0 0 18px rgba(201,145,26,0.55)} }
        .nav-btn-active { animation: navGlow 2.5s ease-in-out infinite; }
        @keyframes slideDown { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }
        .drawer-animate { animation: slideDown 0.22s ease-out both; }
      `}</style>

      <nav className={`sticky top-0 z-50 transition-all duration-500 ${scrolled ? "glass shadow-luxury" : "bg-transparent"}`}>
        <div className="max-w-7xl mx-auto px-5 flex items-center justify-between" style={{ height: "68px" }}>

          {/* ── Logo ── */}
          <Link href="/" className="flex items-center gap-2.5 group select-none">
            <div className="w-9 h-9 rounded-xl btn-luxury flex items-center justify-center text-white font-bold text-sm shadow-gold shrink-0 group-hover:scale-105 transition-transform">
              S
            </div>
            <span className="font-display text-[1.35rem] tracking-wide text-luxury-900 leading-none">
              StayBid
            </span>
          </Link>

          {/* ── Desktop nav ── */}
          <div className="hidden md:flex items-center gap-1.5">
            {NAV_LINKS.map((item) => {
              const active = isActive(item.href);
              return (
                <Link key={item.href} href={item.href}
                  className={`relative flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium tracking-wide transition-all duration-200 group
                    ${active
                      ? "bg-gold-500/10 text-gold-600 border border-gold-400/30 nav-btn-active"
                      : "text-luxury-500 hover:text-luxury-900 hover:bg-luxury-50 border border-transparent hover:border-luxury-100"
                    }`}>
                  <span className={`text-base transition-transform duration-200 ${active ? "" : "group-hover:scale-110"}`}>{item.icon}</span>
                  {item.label}
                  {item.pulse && !active && (
                    <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                  )}
                  {active && (
                    <span className="absolute -bottom-px left-3 right-3 h-px bg-gradient-to-r from-transparent via-gold-500 to-transparent" />
                  )}
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
                          ? "bg-gold-500/10 text-gold-600 border-gold-400/30 nav-btn-active"
                          : "text-luxury-500 hover:text-luxury-900 hover:bg-luxury-50 border-transparent hover:border-luxury-100"
                        }`}>
                      <span className="text-base group-hover:scale-110 transition-transform duration-200">{item.icon}</span>
                      {item.label}
                    </Link>
                  );
                })}

                {/* Profile avatar chip */}
                <Link href="/profile"
                  className={`group relative flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border transition-all duration-200 ml-1
                    ${isActive("/profile")
                      ? "border-gold-400/50 bg-gold-500/10 nav-btn-active"
                      : "border-luxury-200 hover:border-gold-300 hover:bg-gold-50"
                    }`}>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                    style={{ background: "linear-gradient(135deg,#c9911a,#f0b429,#c9911a)" }}>
                    {(user.name || user.phone || "S").slice(0, 2).toUpperCase()}
                  </div>
                  <span className="text-xs font-semibold text-luxury-600 group-hover:text-luxury-900 transition-colors leading-none">
                    {user.name ? user.name.split(" ")[0] : "Profile"}
                  </span>
                </Link>

                <button onClick={logout}
                  className="ml-1 text-xs px-3.5 py-2 rounded-xl border border-luxury-200 text-luxury-400 hover:border-red-200 hover:text-red-500 hover:bg-red-50 transition-all duration-200 tracking-wide">
                  Sign Out
                </button>
              </>
            ) : (
              <Link href="/auth" className="btn-luxury px-5 py-2.5 rounded-full text-sm ml-1 shadow-gold hover:scale-105 transition-transform">
                Sign In
              </Link>
            )}
          </div>

          {/* ── Mobile toggle ── */}
          <button className="md:hidden p-2 text-luxury-600 hover:text-luxury-900 transition-colors"
            onClick={() => setOpen(!open)} aria-label="Toggle menu">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              {open
                ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              }
            </svg>
          </button>
        </div>

        {/* Gold accent line */}
        <div className="gold-line" />

        {/* ── Mobile drawer ── */}
        {open && (
          <div className="md:hidden drawer-animate glass-light border-t border-luxury-100 px-4 py-4">

            {/* Brand row in drawer */}
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-luxury-100">
              <div className="w-7 h-7 rounded-lg btn-luxury flex items-center justify-center text-white font-bold text-xs shadow-gold">S</div>
              <span className="font-display text-base tracking-wide text-luxury-900">StayBid</span>
              <span className="ml-auto text-[0.6rem] font-bold text-gold-500 tracking-widest uppercase bg-gold-50 border border-gold-200 px-2 py-0.5 rounded-full">Luxury Platform</span>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-4">
              {NAV_LINKS.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
                    className={`flex flex-col items-center gap-1 py-3 px-2 rounded-2xl border transition-all text-center
                      ${active
                        ? "bg-gold-500/10 border-gold-400/40 text-gold-600 shadow-gold"
                        : "bg-white border-luxury-100 text-luxury-600 hover:border-gold-200"
                      }`}>
                    <span className="text-xl">{item.icon}</span>
                    <span className="text-[0.65rem] font-semibold tracking-wide leading-tight">{item.label}</span>
                    {item.pulse && <span className="w-1 h-1 bg-red-500 rounded-full animate-pulse" />}
                  </Link>
                );
              })}
            </div>

            {user ? (
              <>
                {/* Mobile profile card */}
                <Link href="/profile" onClick={() => setOpen(false)}
                  className="flex items-center gap-3 mb-3 p-3 rounded-2xl border border-gold-200 bg-gradient-to-r from-gold-50 to-amber-50 hover:border-gold-300 transition-all">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0"
                    style={{ background: "linear-gradient(135deg,#c9911a,#f0b429,#c9911a)" }}>
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

                <div className="grid grid-cols-3 gap-2 mb-3">
                  {USER_LINKS.map((item) => {
                    const active = isActive(item.href);
                    return (
                      <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
                        className={`flex flex-col items-center gap-1 py-3 px-2 rounded-2xl border transition-all text-center
                          ${active
                            ? "bg-gold-500/10 border-gold-400/40 text-gold-600 shadow-gold"
                            : "bg-white border-luxury-100 text-luxury-600 hover:border-gold-200"
                          }`}>
                        <span className="text-xl">{item.icon}</span>
                        <span className="text-[0.65rem] font-semibold tracking-wide leading-tight">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
                <button onClick={() => { logout(); setOpen(false); }}
                  className="w-full py-2.5 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-all">
                  Sign Out
                </button>
              </>
            ) : (
              <Link href="/auth" onClick={() => setOpen(false)}
                className="btn-luxury w-full py-3 rounded-xl text-center text-sm block shadow-gold">
                Sign In to StayBid
              </Link>
            )}
          </div>
        )}
      </nav>
    </>
  );
}
