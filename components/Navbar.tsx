"use client";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useState, useEffect } from "react";

export function Navbar() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const navLinks = [
    { href: "/hotels",      label: "Hotels" },
    { href: "/flash-deals", label: "Flash Deals", pulse: true },
    { href: "/bid",         label: "Place Bid" },
  ];

  return (
    <nav
      className={`sticky top-0 z-50 transition-all duration-500 ${
        scrolled ? "glass shadow-luxury" : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-5 flex items-center justify-between" style={{ height: "68px" }}>

        {/* ── Logo ── */}
        <Link href="/" className="flex items-center gap-2.5 group select-none">
          <div className="w-9 h-9 rounded-xl btn-luxury flex items-center justify-center text-white font-bold text-sm shadow-gold shrink-0">
            S
          </div>
          <span className="font-display text-[1.35rem] tracking-wide text-luxury-900 leading-none">
            StayBid
          </span>
        </Link>

        {/* ── Desktop nav ── */}
        <div className="hidden md:flex items-center gap-7">
          {navLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm font-medium text-luxury-500 hover:text-luxury-900 transition-colors duration-200 tracking-wide flex items-center gap-1.5"
            >
              {item.label}
              {item.pulse && (
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
              )}
            </Link>
          ))}

          <div className="h-4 w-px bg-luxury-200 mx-1" />

          {user ? (
            <div className="flex items-center gap-4">
              <Link href="/my-bids"  className="text-sm font-medium text-luxury-500 hover:text-luxury-900 transition-colors tracking-wide">My Bids</Link>
              <Link href="/bookings" className="text-sm font-medium text-luxury-500 hover:text-luxury-900 transition-colors tracking-wide">Bookings</Link>
              <Link href="/wallet"   className="text-sm font-medium text-luxury-500 hover:text-luxury-900 transition-colors tracking-wide flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1-6 0H5.25A2.25 2.25 0 0 0 3 12m18 0v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 9m18 0V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v3" />
                </svg>
                Wallet
              </Link>
              <button
                onClick={logout}
                className="text-xs px-4 py-2 rounded-full border border-luxury-200 text-luxury-400 hover:border-red-200 hover:text-red-500 transition-all duration-200 tracking-wide"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <Link
              href="/auth"
              className="btn-luxury px-5 py-2.5 rounded-full text-sm"
            >
              Sign In
            </Link>
          )}
        </div>

        {/* ── Mobile toggle ── */}
        <button
          className="md:hidden p-2 text-luxury-600 hover:text-luxury-900 transition-colors"
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            {open
              ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              : <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            }
          </svg>
        </button>
      </div>

      {/* Gold accent line below nav */}
      <div className="gold-line" />

      {/* ── Mobile drawer ── */}
      {open && (
        <div className="md:hidden glass-light border-t border-luxury-100 px-5 py-4 space-y-1">
          {navLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="flex items-center justify-between py-3 text-sm font-medium text-luxury-700 hover:text-luxury-900 border-b border-luxury-100 last:border-0 tracking-wide transition-colors"
            >
              {item.label}
              {item.pulse && <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />}
            </Link>
          ))}

          {user ? (
            <>
              {[
                { href: "/my-bids",  label: "My Bids"     },
                { href: "/bookings", label: "My Bookings"  },
                { href: "/wallet",   label: "Wallet"       },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="flex py-3 text-sm font-medium text-luxury-700 hover:text-luxury-900 border-b border-luxury-100 tracking-wide transition-colors"
                >
                  {item.label}
                </Link>
              ))}
              <button
                onClick={() => { logout(); setOpen(false); }}
                className="flex py-3 text-sm font-medium text-red-500 tracking-wide"
              >
                Sign Out
              </button>
            </>
          ) : (
            <div className="pt-2">
              <Link
                href="/auth"
                onClick={() => setOpen(false)}
                className="btn-luxury w-full py-3 rounded-xl text-center text-sm block"
              >
                Sign In
              </Link>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
