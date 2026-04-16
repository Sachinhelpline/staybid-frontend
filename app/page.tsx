"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

export default function Home() {
  const [city, setCity] = useState("");
  const [deals, setDeals] = useState<any[]>([]);
  const [hotelCount, setHotelCount] = useState<number | null>(null);

  useEffect(() => {
    // Live: fetch flash deals preview
    api.getFlashDeals().then((d) => setDeals(d.deals?.slice(0, 3) || [])).catch(() => {});
    // Live: fetch real hotel count for stats row
    api.getHotels({}).then((d) => setHotelCount(d.total || null)).catch(() => {});
  }, []);

  const cities = ["Mussoorie", "Dhanaulti", "Rishikesh", "Shimla", "Manali", "Dehradun"];

  return (
    <div className="bg-luxury-50">

      {/* ═══════════════════════════════════════
          HERO — Cinematic dark luxury
      ═══════════════════════════════════════ */}
      <section
        className="relative min-h-[92vh] flex items-center overflow-hidden"
        style={{ background: "linear-gradient(135deg, #0a0812 0%, #130f24 45%, #0a1020 100%)" }}
      >
        {/* Ambient glow spots */}
        <div className="absolute inset-0 pointer-events-none hero-mesh" />

        {/* Animated gold orb — top right */}
        <div
          className="absolute -top-32 -right-32 w-[600px] h-[600px] rounded-full opacity-[0.06] pointer-events-none"
          style={{ background: "radial-gradient(circle, #f0b429 0%, transparent 70%)" }}
        />
        {/* Animated gold orb — bottom left */}
        <div
          className="absolute -bottom-48 -left-24 w-[500px] h-[500px] rounded-full opacity-[0.05] pointer-events-none"
          style={{ background: "radial-gradient(circle, #c9911a 0%, transparent 70%)" }}
        />

        <div className="relative max-w-7xl mx-auto px-5 py-28 md:py-40 w-full">

          {/* Eyebrow */}
          <div className="flex items-center gap-3 mb-8">
            <div className="h-px w-8 bg-gradient-to-r from-transparent to-gold-500 opacity-70" />
            <span className="text-gold-400 text-[0.68rem] font-semibold tracking-[0.22em] uppercase select-none">
              India&apos;s First Reverse-Auction Hotel Platform
            </span>
            <div className="h-px w-8 bg-gradient-to-l from-transparent to-gold-500 opacity-70" />
          </div>

          {/* Headline */}
          <h1 className="font-display font-light text-white leading-[1.06] mb-8"
              style={{ fontSize: "clamp(2.8rem, 7vw, 5.5rem)" }}>
            Name Your Price.<br />
            <span className="text-gold-gradient font-semibold italic">Hotels Compete.</span>
          </h1>

          {/* Subtext */}
          <p className="text-white/55 max-w-lg mb-12 leading-relaxed font-light"
             style={{ fontSize: "clamp(1rem, 2vw, 1.15rem)" }}>
            Bid on premium mountain stays at prices you choose.
            Off-season deals you won&apos;t find anywhere else.
          </p>

          {/* Search bar */}
          <div className="flex flex-col sm:flex-row gap-3 max-w-2xl">
            <div className="flex-1 relative">
              <svg
                className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 pointer-events-none"
                style={{ color: "rgba(255,255,255,0.3)" }}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Where do you want to stay?"
                className="w-full pl-12 pr-5 py-4 rounded-2xl text-white bg-white/10 placeholder:text-white/35 focus:outline-none focus:ring-1 focus:ring-gold-400/50 focus:bg-white/[0.13] transition-all backdrop-blur-sm border border-white/10 text-[15px]"
              />
            </div>
            <Link
              href={`/hotels${city ? `?city=${encodeURIComponent(city)}` : ""}`}
              className="btn-luxury px-8 py-4 rounded-2xl text-[15px] whitespace-nowrap shadow-gold-lg"
            >
              Search Hotels
            </Link>
          </div>

          {/* City chips */}
          <div className="flex flex-wrap gap-2 mt-6">
            {cities.map((c) => (
              <Link
                key={c}
                href={`/hotels?city=${c}`}
                className="px-4 py-2 rounded-full text-sm text-white/65 hover:text-white border border-white/10 hover:border-gold-500/45 hover:bg-white/[0.06] transition-all duration-200 tracking-wide"
              >
                {c}
              </Link>
            ))}
          </div>

          {/* Stats — live data */}
          <div className="flex flex-wrap gap-10 mt-16 pt-8 border-t border-white/[0.09]">
            {[
              { value: hotelCount ? `${hotelCount}+` : "200+", label: "Hotels Listed" },
              { value: "15+", label: "Cities Covered" },
              { value: "35%", label: "Avg. Savings" },
            ].map((s) => (
              <div key={s.label}>
                <p className="font-display text-white font-semibold" style={{ fontSize: "1.7rem" }}>{s.value}</p>
                <p className="text-white/38 text-[0.65rem] tracking-[0.18em] uppercase mt-1 font-medium">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════
          HOW IT WORKS
      ═══════════════════════════════════════ */}
      <section className="max-w-7xl mx-auto px-5 py-24 md:py-32">
        <div className="text-center mb-16">
          <p className="text-gold-500 text-[0.68rem] font-semibold tracking-[0.22em] uppercase mb-4">Simple Process</p>
          <h2 className="font-display font-light text-luxury-900" style={{ fontSize: "clamp(2rem, 4vw, 2.8rem)" }}>
            How StayBid Works
          </h2>
          <div className="gold-line w-20 mx-auto mt-5" />
        </div>

        <div className="grid md:grid-cols-3 gap-7">
          {[
            {
              num: "01",
              title: "Search & Browse",
              desc: "Discover premium hotels in your destination. Review rooms, amenities, and verified guest ratings.",
              icon: (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                </svg>
              ),
            },
            {
              num: "02",
              title: "Name Your Price",
              desc: "Submit a bid with your budget. Hotels see your offer and compete to win your booking.",
              icon: (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
              ),
            },
            {
              num: "03",
              title: "Book & Save",
              desc: "Accept the best counter-offer and pay securely via Razorpay. Save up to 40% off published rates.",
              icon: (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
              ),
            },
          ].map((s) => (
            <div
              key={s.num}
              className="group relative p-8 rounded-3xl bg-white border border-luxury-100 hover:border-gold-200 hover:shadow-luxury-lg transition-all duration-400 cursor-default overflow-hidden"
            >
              {/* Background number */}
              <span className="absolute top-5 right-6 font-display text-7xl font-bold text-luxury-100 group-hover:text-gold-100 transition-colors duration-300 leading-none select-none pointer-events-none">
                {s.num}
              </span>

              {/* Icon */}
              <div className="relative w-11 h-11 rounded-xl bg-gold-100 text-gold-500 flex items-center justify-center mb-6 group-hover:bg-gold-500 group-hover:text-white transition-all duration-300 shadow-sm">
                {s.icon}
              </div>

              <h3 className="font-semibold text-luxury-900 text-[1.05rem] mb-2.5 tracking-tight">{s.title}</h3>
              <p className="text-luxury-500 text-sm leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════════════════════════════
          FLASH DEALS PREVIEW
      ═══════════════════════════════════════ */}
      {deals.length > 0 && (
        <section className="py-20" style={{ background: "linear-gradient(180deg, #f4f2ec 0%, #faf9f6 100%)" }}>
          <div className="max-w-7xl mx-auto px-5">

            <div className="flex items-end justify-between mb-12">
              <div>
                <p className="text-[0.68rem] font-semibold tracking-[0.22em] uppercase mb-3 flex items-center gap-2 text-gold-500">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse inline-block" />
                  Limited Time Offers
                </p>
                <h2 className="font-display font-light text-luxury-900" style={{ fontSize: "clamp(1.8rem, 3.5vw, 2.5rem)" }}>
                  Flash Deals
                </h2>
              </div>
              <Link
                href="/flash-deals"
                className="text-sm font-medium text-gold-500 hover:text-gold-600 flex items-center gap-1.5 transition-colors tracking-wide group"
              >
                View All
                <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </Link>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              {deals.map((d: any) => (
                <Link key={d.id} href={`/hotels/${d.hotelId}`} className="group card-luxury overflow-hidden block">
                  {/* Gold top stripe */}
                  <div className="h-[3px] bg-gradient-to-r from-gold-500 via-gold-300 to-gold-500" />
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <span className="badge-gold">{d.discount}% OFF</span>
                      <span className="text-xs text-luxury-400 tracking-wide">{d.city}</span>
                    </div>
                    <h3 className="font-semibold text-luxury-900 text-[1.05rem] mb-1 group-hover:text-gold-600 transition-colors leading-snug">
                      {d.hotel?.name || "Hotel"}
                    </h3>
                    <p className="text-sm text-luxury-400 mb-4">{d.room?.type} Room</p>
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-bold text-luxury-900">₹{d.aiPrice}</span>
                      <span className="text-sm text-luxury-300 line-through">₹{d.floorPrice}</span>
                      <span className="text-xs text-luxury-400">/night</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ═══════════════════════════════════════
          TRUST STRIP
      ═══════════════════════════════════════ */}
      <section className="border-t border-luxury-100 py-12">
        <div className="max-w-7xl mx-auto px-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { icon: "🔒", title: "Secure Payments", sub: "Razorpay encrypted" },
              { icon: "✅", title: "Verified Hotels", sub: "Hand-picked stays" },
              { icon: "💬", title: "Live Bidding", sub: "Real-time counters" },
              { icon: "🏔️", title: "Mountain Getaways", sub: "Curated destinations" },
            ].map((t) => (
              <div key={t.title} className="flex flex-col items-center gap-2">
                <span className="text-2xl">{t.icon}</span>
                <p className="text-sm font-semibold text-luxury-800 tracking-tight">{t.title}</p>
                <p className="text-xs text-luxury-400">{t.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════
          FOOTER
      ═══════════════════════════════════════ */}
      <footer className="border-t border-luxury-200 py-12 bg-white">
        <div className="max-w-7xl mx-auto px-5 flex flex-col md:flex-row items-center justify-between gap-5">
          <Link href="/" className="flex items-center gap-2.5 select-none">
            <div className="w-8 h-8 rounded-lg btn-luxury flex items-center justify-center text-white font-bold text-xs">S</div>
            <span className="font-display text-xl text-luxury-800 tracking-wide">StayBid</span>
          </Link>

          <p className="text-sm text-luxury-400 tracking-wide">© 2026 StayBid. Crafted with care in India.</p>

          <div className="flex items-center gap-6 text-sm text-luxury-400">
            {[
              { href: "/hotels",      label: "Hotels" },
              { href: "/flash-deals", label: "Deals" },
              { href: "/bid",         label: "Place Bid" },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="hover:text-luxury-700 transition-colors tracking-wide">
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
