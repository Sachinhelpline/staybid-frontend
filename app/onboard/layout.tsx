import type { ReactNode } from "react";

export const metadata = {
  title: "StayBid Partner — List Your Property",
  description: "Onboard your hotel onto StayBid in minutes. AI-assisted listing, instant live deployment.",
};

export default function OnboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-luxury-50 via-white to-gold-50">
      <header className="sticky top-0 z-30 backdrop-blur bg-white/70 border-b border-luxury-100">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/onboard" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-gold-500 to-gold-700 flex items-center justify-center text-white font-bold">S</div>
            <div>
              <div className="font-display text-xl text-luxury-900">StayBid <span className="text-gold-600">Partner</span></div>
              <div className="text-[11px] uppercase tracking-wider text-luxury-500">Property Onboarding</div>
            </div>
          </a>
          <nav className="hidden md:flex items-center gap-6 text-sm text-luxury-700">
            <a href="/onboard" className="hover:text-gold-700">Home</a>
            <a href="/onboard/signin" className="hover:text-gold-700">Sign in</a>
            <a href="/onboard/signup" className="px-4 py-2 rounded-full bg-gradient-to-r from-gold-600 to-gold-500 text-white font-medium shadow-gold hover:shadow-lg transition">List Your Hotel</a>
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <footer className="mt-20 border-t border-luxury-100 bg-white/40">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-3 text-sm text-luxury-600">
          <div>© 2026 StayBid · Luxury reverse-auction platform</div>
          <div className="flex gap-4">
            <a href="https://staybids.in" className="hover:text-gold-700">staybids.in</a>
            <a href="/onboard/signin" className="hover:text-gold-700">Partner sign in</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
