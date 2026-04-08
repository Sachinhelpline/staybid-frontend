"use client";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useState } from "react";

export function Navbar() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 glass">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center text-white font-bold text-sm">S</span>
          <span className="font-display text-xl text-brand-900">StayBid</span>
        </Link>

        {/* Desktop */}
        <div className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-600">
          <Link href="/hotels" className="hover:text-brand-700 transition">Hotels</Link>
          <Link href="/flash-deals" className="hover:text-brand-700 transition">
            <span className="inline-flex items-center gap-1">Flash Deals <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" /></span>
          </Link>
          <Link href="/bid" className="hover:text-brand-700 transition">Place Bid</Link>
          {user ? (
            <div className="flex items-center gap-3">
              <Link href="/bookings" className="hover:text-brand-700 transition">My Bookings</Link>
              <button onClick={logout} className="text-xs px-3 py-1.5 rounded-full border border-gray-300 hover:border-red-300 hover:text-red-600 transition">Logout</button>
            </div>
          ) : (
            <Link href="/auth" className="px-4 py-2 bg-brand-600 text-white rounded-full hover:bg-brand-700 transition text-sm">Login</Link>
          )}
        </div>

        {/* Mobile toggle */}
        <button className="md:hidden p-2" onClick={() => setOpen(!open)}>
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {open ? <path strokeLinecap="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /> : <path strokeLinecap="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t bg-white px-4 py-4 space-y-3 text-sm font-medium">
          <Link href="/hotels" onClick={() => setOpen(false)} className="block py-2">Hotels</Link>
          <Link href="/flash-deals" onClick={() => setOpen(false)} className="block py-2">Flash Deals</Link>
          <Link href="/bid" onClick={() => setOpen(false)} className="block py-2">Place Bid</Link>
          {user ? (
            <>
              <Link href="/bookings" onClick={() => setOpen(false)} className="block py-2">My Bookings</Link>
              <button onClick={() => { logout(); setOpen(false); }} className="text-red-600">Logout</button>
            </>
          ) : (
            <Link href="/auth" onClick={() => setOpen(false)} className="block py-2 text-brand-600 font-bold">Login</Link>
          )}
        </div>
      )}
    </nav>
  );
}
