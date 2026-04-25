"use client";
import Link from "next/link";

export default function OnboardLanding() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-16 md:py-24">
      <div className="grid md:grid-cols-2 gap-12 items-center">
        <div>
          <div className="inline-block px-3 py-1 text-xs uppercase tracking-widest rounded-full bg-gold-100 text-gold-800 border border-gold-200 mb-5">For Hoteliers</div>
          <h1 className="font-display text-5xl md:text-6xl text-luxury-900 leading-tight">
            List your hotel on <span className="text-gold-600">StayBid</span> in <em>minutes</em>.
          </h1>
          <p className="mt-5 text-luxury-600 text-lg leading-relaxed">
            Type your hotel name and city. Our AI pulls your existing online presence, photos, amenities and rates from across the web — you just review, tweak, and go live.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/onboard/signup" className="px-7 py-3.5 rounded-full bg-gradient-to-r from-gold-600 to-gold-500 text-white font-semibold shadow-gold hover:shadow-xl transition">Start onboarding →</Link>
            <Link href="/onboard/signin" className="px-7 py-3.5 rounded-full bg-white text-luxury-800 font-semibold border border-luxury-200 hover:border-gold-400 transition">I already have an account</Link>
          </div>

          <div className="mt-10 grid grid-cols-3 gap-4 text-center">
            {[
              { n: "5 min", l: "Average onboarding" },
              { n: "₹0", l: "Listing fee" },
              { n: "Live", l: "Instantly across panels" },
            ].map((s) => (
              <div key={s.l} className="rounded-2xl bg-white border border-luxury-100 p-4 shadow-sm">
                <div className="font-display text-2xl text-gold-700">{s.n}</div>
                <div className="text-xs text-luxury-500 mt-1">{s.l}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative">
          <div className="aspect-[4/5] rounded-3xl overflow-hidden shadow-2xl border border-luxury-100 bg-cover bg-center"
               style={{ backgroundImage: "url(https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=1200)" }} />
          <div className="absolute -bottom-6 -left-6 bg-white rounded-2xl shadow-xl border border-luxury-100 p-4 max-w-[260px]">
            <div className="text-xs uppercase tracking-wider text-gold-700 font-semibold">AI Auto-fill</div>
            <div className="text-sm text-luxury-800 mt-1">Photos, amenities, room types & rates fetched from your existing online listings.</div>
          </div>
          <div className="absolute -top-6 -right-6 bg-white rounded-2xl shadow-xl border border-luxury-100 p-4 max-w-[240px]">
            <div className="text-xs uppercase tracking-wider text-gold-700 font-semibold">Owner Consent</div>
            <div className="text-sm text-luxury-800 mt-1">One-click verification. Your listing only goes live after you say yes.</div>
          </div>
        </div>
      </div>

      <div className="mt-24">
        <div className="text-center mb-12">
          <h2 className="font-display text-4xl text-luxury-900">How it works</h2>
          <p className="text-luxury-500 mt-2">Four steps. No paperwork. No demo data.</p>
        </div>
        <div className="grid md:grid-cols-4 gap-5">
          {[
            { n: "01", t: "Sign up", d: "Email or mobile + one-time OTP. Then you set your own password — no more OTPs." },
            { n: "02", t: "AI search", d: "Type your hotel name and city. We surface every existing online listing." },
            { n: "03", t: "Review & edit", d: "AI pre-fills photos, rooms, amenities, rates. You tweak anything in one screen." },
            { n: "04", t: "Go live", d: "Owner consent tick → unique Hotel ID generated → instantly visible to customers." },
          ].map((s) => (
            <div key={s.n} className="rounded-2xl bg-white border border-luxury-100 p-6 shadow-sm hover:shadow-md transition">
              <div className="text-gold-500 font-display text-3xl">{s.n}</div>
              <div className="font-semibold text-luxury-900 mt-1">{s.t}</div>
              <div className="text-sm text-luxury-600 mt-2 leading-relaxed">{s.d}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
