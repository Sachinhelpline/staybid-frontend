"use client";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";

const CITIES = ["Mussoorie", "Dhanaulti", "Rishikesh", "Shimla", "Manali", "Dehradun"];

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

const BOTTOM_PRIMARY = [
  { href: "/",            label: "Home",      icon: "🏠" },
  { href: "/hotels",      label: "Hotels",    icon: "🏨" },
  { href: "/flash-deals", label: "Deals",     icon: "⚡", pulse: true },
  { href: "/bid",         label: "Place Bid", icon: "🎯" },
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

/* ── Live Location Chip (in header) ──────────────────────────────── */
function LocationChip({ compact = false }: { compact?: boolean }) {
  const [city, setCity]       = useState("");
  const [loading, setLoading] = useState(false);
  const [picker, setPicker]   = useState(false);

  useEffect(() => {
    try { setCity(localStorage.getItem("sb_city") || ""); } catch {}
    const apply = () => { try { setCity(localStorage.getItem("sb_city") || ""); } catch {} };
    window.addEventListener("sb:city-change", apply);
    return () => window.removeEventListener("sb:city-change", apply);
  }, []);

  const setAndBroadcast = (c: string) => {
    try { localStorage.setItem("sb_city", c); } catch {}
    setCity(c);
    window.dispatchEvent(new Event("sb:city-change"));
  };

  const detect = () => {
    if (!navigator.geolocation) { setPicker(true); return; }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json&zoom=10`,
            { headers: { "Accept-Language": "en" } }
          );
          const data = await res.json();
          const detected =
            data.address?.city || data.address?.town || data.address?.village ||
            data.address?.county || data.address?.state_district || data.address?.state || "";
          const match = CITIES.find(c => detected.toLowerCase().includes(c.toLowerCase()));
          if (match) setAndBroadcast(match);
          else { setAndBroadcast(detected || ""); setPicker(true); }
        } catch { setPicker(true); }
        finally { setLoading(false); }
      },
      () => { setLoading(false); setPicker(true); },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  };

  return (
    <div className="relative">
      <button
        onClick={() => city ? setPicker(true) : detect()}
        disabled={loading}
        className="group relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[0.72rem] font-semibold transition-all duration-300 overflow-hidden"
        style={{
          background: "linear-gradient(135deg, rgba(240,180,41,0.18), rgba(255,255,255,0.04))",
          border: "1px solid rgba(240,180,41,0.35)",
          color: "#f0b429",
          boxShadow: "0 2px 8px rgba(201,145,26,0.15), inset 0 1px 0 rgba(255,255,255,0.2)",
        }}
      >
        <span className={`w-2 h-2 rounded-full ${loading ? "bg-gold-400 animate-ping" : "bg-emerald-400 animate-pulse"}`} />
        {loading ? "Detecting…" : city ? (<><span>📍</span><span className="truncate max-w-[90px]">{city}</span></>) : (<><span>🎯</span>{!compact && <span>Detect</span>}</>)}
      </button>

      {picker && (
        <>
          <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm" onClick={() => setPicker(false)} />
          <div className="fixed inset-x-4 top-20 md:absolute md:inset-x-auto md:top-full md:right-0 md:mt-2 md:w-72 z-[70] rounded-2xl overflow-hidden"
            style={{ background: "linear-gradient(180deg,#12101c,#0a0812)", border: "1px solid rgba(240,180,41,0.3)", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <p className="text-xs font-bold text-gold-400 tracking-widest uppercase">Choose City</p>
              <button onClick={() => setPicker(false)} className="text-white/50 hover:text-white text-sm">✕</button>
            </div>
            <button onClick={() => { setPicker(false); detect(); }}
              className="w-full px-4 py-3 flex items-center gap-2 text-sm text-white hover:bg-white/5 transition-colors border-b border-white/5">
              <span>🎯</span><span>Detect my location</span>
            </button>
            <div className="p-2 max-h-64 overflow-y-auto">
              <button onClick={() => { setAndBroadcast(""); setPicker(false); }}
                className={`w-full px-3 py-2 rounded-lg text-left text-sm transition-colors ${!city ? "bg-gold-500/20 text-gold-300" : "text-white/70 hover:bg-white/5"}`}>
                All Cities
              </button>
              {CITIES.map(c => (
                <button key={c} onClick={() => { setAndBroadcast(c); setPicker(false); }}
                  className={`w-full px-3 py-2 rounded-lg text-left text-sm transition-colors ${city === c ? "bg-gold-500/20 text-gold-300" : "text-white/70 hover:bg-white/5"}`}>
                  📍 {c}
                </button>
              ))}
            </div>
          </div>
        </>
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

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  const moreLinks = user ? [
    { href: "/my-bids",       label: "My Bids",  icon: "📋" },
    { href: "/bookings",      label: "Bookings", icon: "🎫" },
    { href: "/wallet",        label: "Wallet",   icon: "💰" },
    { href: "/hotel-partner", label: "Partner",  icon: "🏢" },
    { href: "/profile",       label: "Profile",  icon: "👤" },
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

        /* Mobile bottom nav */
        .bottom3d {
          background:
            linear-gradient(180deg, rgba(14,12,22,0.94) 0%, rgba(8,6,14,0.98) 100%);
          backdrop-filter: blur(22px) saturate(180%);
          -webkit-backdrop-filter: blur(22px) saturate(180%);
          border-top: 1px solid rgba(240,180,41,0.25);
          box-shadow: 0 -8px 30px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06);
        }
        .bottom3d::before {
          content:""; position:absolute; left:0; right:0; top:-1px; height:1px;
          background: linear-gradient(90deg, transparent, rgba(240,180,41,0.65), transparent);
        }
        .bottom3d-btn {
          position: relative;
          transition: transform .2s cubic-bezier(.3,1,.3,1);
        }
        .bottom3d-btn:active { transform: scale(0.92); }
        .bottom3d-icon {
          display:flex; align-items:center; justify-content:center;
          width: 42px; height: 30px; border-radius: 14px;
          background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01));
          border: 1px solid rgba(255,255,255,0.05);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
          transition: all .3s;
        }
        .bottom3d-btn.is-active .bottom3d-icon {
          background: linear-gradient(180deg, rgba(240,180,41,0.32), rgba(201,145,26,0.1));
          border-color: rgba(240,180,41,0.6);
          box-shadow: 0 4px 14px rgba(240,180,41,0.35), inset 0 1px 0 rgba(255,255,255,0.2);
          transform: translateY(-2px) scale(1.05);
        }
        .bottom3d-label {
          font-size: 0.6rem; font-weight: 700; letter-spacing: .04em;
          color: rgba(255,255,255,0.45);
          transition: color .2s;
        }
        .bottom3d-btn.is-active .bottom3d-label { color: #fbd26a; }

        @keyframes sheetIn { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .sheet-in { animation: sheetIn 0.28s cubic-bezier(0.34,1.2,0.64,1) both; }
        .bottom-nav { padding-bottom: env(safe-area-inset-bottom, 0px); }
        @media (max-width: 767px) { body { padding-bottom: 76px; } }
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
            <div className="ml-1">
              <LocationChip compact />
            </div>
          </div>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-1.5">
            {NAV_LINKS.map((item) => {
              const active = isActive(item.href);
              return (
                <Link key={item.href} href={item.href}
                  className={`nav3d-chip flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium tracking-wide text-white/70 ${active ? "nav3d-chip-active" : ""}`}>
                  <span className="text-base">{item.icon}</span>
                  {item.label}
                  {item.pulse && !active && <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />}
                </Link>
              );
            })}

            <div className="h-5 w-px bg-white/10 mx-1" />

            {user ? (
              <>
                {USER_LINKS.map((item) => {
                  const active = isActive(item.href);
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

      {/* ── MOBILE BOTTOM NAV (3D reflective) ───────────────────── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bottom-nav bottom3d relative">
        <div className="flex items-stretch" style={{ height: "66px" }}>
          {BOTTOM_PRIMARY.map((item) => {
            const active = isActive(item.href);
            return (
              <Link key={item.href} href={item.href}
                className={`bottom3d-btn flex-1 flex flex-col items-center justify-center gap-1 ${active ? "is-active" : ""}`}>
                <div className="bottom3d-icon relative">
                  <span className="text-[1.15rem]">{item.icon}</span>
                  {item.pulse && !active && (
                    <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                  )}
                </div>
                <span className="bottom3d-label">{item.label}</span>
              </Link>
            );
          })}
          <button onClick={() => setMoreOpen(!moreOpen)}
            className={`bottom3d-btn flex-1 flex flex-col items-center justify-center gap-1 ${moreOpen ? "is-active" : ""}`}>
            <div className="bottom3d-icon">
              <span className="text-[1.15rem]">{moreOpen ? "✕" : "☰"}</span>
            </div>
            <span className="bottom3d-label">More</span>
          </button>
        </div>
      </div>

      {/* ── MOBILE MORE SHEET ─────────────────────────────────── */}
      {moreOpen && (
        <>
          <div className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={() => setMoreOpen(false)} />
          <div className="md:hidden fixed bottom-[66px] left-0 right-0 z-50 sheet-in"
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
