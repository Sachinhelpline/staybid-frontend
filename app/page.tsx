"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function Home() {
  const router = useRouter();
  const [city, setCity] = useState("");
  const [deals, setDeals] = useState<any[]>([]);
  const [hotelCount, setHotelCount] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    api.getFlashDeals().then((d) => setDeals(d.deals?.slice(0, 4) || [])).catch(() => {});
    api.getHotels({}).then((d) => setHotelCount(d.total || null)).catch(() => {});
  }, []);

  // Live countdown tick
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const cities = ["Mussoorie", "Dhanaulti", "Rishikesh", "Shimla", "Manali", "Dehradun"];

  return (
    <div className="bg-luxury-50 overflow-x-hidden">

      {/* ═══════════════════════════════════════
          HERO
      ═══════════════════════════════════════ */}
      <section
        className="relative min-h-screen flex flex-col justify-center overflow-hidden"
        style={{ background: "linear-gradient(135deg, #0a0812 0%, #130f24 45%, #0a1020 100%)" }}
      >
        {/* Animated ambient orbs */}
        <div className="absolute -top-40 -right-40 w-[700px] h-[700px] rounded-full pointer-events-none animate-pulse"
          style={{ background: "radial-gradient(circle, rgba(240,180,41,0.07) 0%, transparent 70%)", animationDuration: "4s" }} />
        <div className="absolute -bottom-60 -left-32 w-[600px] h-[600px] rounded-full pointer-events-none animate-pulse"
          style={{ background: "radial-gradient(circle, rgba(201,145,26,0.06) 0%, transparent 70%)", animationDuration: "6s" }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.01) 0%, transparent 60%)" }} />

        {/* Floating decorative dots */}
        <div className="absolute top-24 left-[15%] w-1 h-1 bg-gold-400 rounded-full opacity-40 animate-bounce" style={{ animationDuration:"3s" }} />
        <div className="absolute top-40 right-[20%] w-1.5 h-1.5 bg-gold-300 rounded-full opacity-30 animate-bounce" style={{ animationDuration:"4.5s", animationDelay:"1s" }} />
        <div className="absolute bottom-40 left-[30%] w-1 h-1 bg-gold-500 rounded-full opacity-35 animate-bounce" style={{ animationDuration:"5s", animationDelay:"2s" }} />

        <div className="relative max-w-7xl mx-auto px-5 py-24 md:py-32 w-full">
          {/* Eyebrow */}
          <div className="flex items-center gap-3 mb-7 animate-fade-up" style={{ animationDelay:"0.1s" }}>
            <div className="h-px w-8 bg-gradient-to-r from-transparent to-gold-500 opacity-70" />
            <span className="text-gold-400 text-[0.68rem] font-semibold tracking-[0.22em] uppercase">
              India&apos;s First Reverse-Auction Hotel Platform
            </span>
            <div className="h-px w-8 bg-gradient-to-l from-transparent to-gold-500 opacity-70" />
          </div>

          {/* Headline */}
          <h1 className="font-display font-light text-white leading-[1.06] mb-7"
              style={{ fontSize: "clamp(2.8rem, 7vw, 5.5rem)" }}>
            Name Your Price.<br />
            <span className="text-gold-gradient font-semibold italic">Hotels Compete.</span>
          </h1>

          <p className="text-white/55 max-w-lg mb-10 leading-relaxed font-light"
             style={{ fontSize: "clamp(1rem, 2vw, 1.15rem)" }}>
            Bid on premium mountain stays at prices you choose.
            Off-season deals you won&apos;t find anywhere else.
          </p>

          {/* Search bar */}
          <div className="flex flex-col sm:flex-row gap-3 max-w-2xl mb-5">
            <div className="flex-1 relative">
              <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 pointer-events-none opacity-40"
                style={{ color: "#fff" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
              <input value={city} onChange={(e) => setCity(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && router.push(`/hotels${city ? `?city=${encodeURIComponent(city)}` : ""}`)}
                placeholder="Where do you want to stay?"
                className="w-full pl-12 pr-5 py-4 rounded-2xl text-white bg-white/10 placeholder:text-white/35 focus:outline-none focus:ring-1 focus:ring-gold-400/50 focus:bg-white/[0.13] transition-all backdrop-blur-sm border border-white/10 text-[15px]" />
            </div>
            <Link href={`/hotels${city ? `?city=${encodeURIComponent(city)}` : ""}`}
              className="btn-luxury px-8 py-4 rounded-2xl text-[15px] whitespace-nowrap shadow-gold-lg text-center">
              Search Hotels
            </Link>
          </div>

          {/* City chips */}
          <div className="flex flex-wrap gap-2 mb-16">
            {cities.map((c) => (
              <Link key={c} href={`/hotels?city=${c}`}
                className="px-4 py-1.5 rounded-full text-sm text-white/60 hover:text-white border border-white/10 hover:border-gold-500/50 hover:bg-white/[0.06] transition-all duration-200 tracking-wide">
                {c}
              </Link>
            ))}
          </div>

          {/* Stats */}
          <div className="flex flex-wrap gap-10 pt-8 border-t border-white/[0.09]">
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

        {/* Bottom fade into flash deals */}
        <div className="absolute bottom-0 left-0 right-0 h-24 pointer-events-none"
          style={{ background: "linear-gradient(to bottom, transparent, #0a0812)" }} />
      </section>

      {/* ═══════════════════════════════════════
          FLASH DEALS — right below hero
      ═══════════════════════════════════════ */}
      <section style={{ background: "linear-gradient(180deg, #0a0812 0%, #0f0d1e 60%, #13101f 100%)" }} className="pb-20 pt-4">
        <div className="max-w-7xl mx-auto px-5">

          {/* Section header */}
          <div className="flex items-end justify-between mb-8">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className="text-red-400 text-[0.68rem] font-bold tracking-[0.22em] uppercase">Live Now</span>
              </div>
              <h2 className="font-display font-light text-white" style={{ fontSize: "clamp(1.8rem, 3.5vw, 2.4rem)" }}>
                ⚡ Same Day Flash Deals
              </h2>
              <p className="text-white/40 text-sm mt-1">Book today · Check in today · AI-curated prices</p>
            </div>
            <Link href="/flash-deals"
              className="text-sm font-semibold text-gold-400 hover:text-gold-300 flex items-center gap-1.5 transition-colors tracking-wide group border border-gold-500/30 px-4 py-2 rounded-xl hover:border-gold-400/60">
              View All
              <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </Link>
          </div>

          {deals.length === 0 ? (
            <div className="grid md:grid-cols-4 gap-4">
              {[1,2,3,4].map(i => (
                <div key={i} className="rounded-3xl overflow-hidden bg-white/5 border border-white/10 animate-pulse">
                  <div className="h-40 bg-white/10" />
                  <div className="p-4 space-y-2">
                    <div className="h-3 bg-white/10 rounded-full w-1/3" />
                    <div className="h-4 bg-white/10 rounded-full w-2/3" />
                    <div className="h-3 bg-white/10 rounded-full w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
              {deals.map((d: any, idx: number) => {
                const expires = new Date(d.validUntil);
                const diffMs = Math.max(0, expires.getTime() - now);
                const hrs = Math.floor(diffMs / 3600000);
                const mins = Math.floor((diffMs % 3600000) / 60000);
                const secs = Math.floor((diffMs % 60000) / 1000);
                const isUrgent = hrs < 2;
                const dealUrl = `/hotels/${d.hotelId}?dealId=${d.id}&dealPrice=${d.aiPrice}&roomId=${d.roomId}&discount=${d.discount}&directBook=true`;
                const img = d.hotel?.images?.[0] || d.room?.images?.[0];

                return (
                  <div key={d.id}
                    className="group relative rounded-3xl overflow-hidden border border-white/10 hover:border-gold-400/50 transition-all duration-300 cursor-pointer hover:-translate-y-1 hover:shadow-2xl"
                    style={{ animationDelay: `${idx * 0.1}s`, background: "rgba(255,255,255,0.04)" }}
                    onClick={() => router.push(dealUrl)}
                  >
                    {/* Hotel image */}
                    <div className="relative h-44 overflow-hidden">
                      {img ? (
                        <img src={img} alt={d.hotel?.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, #1a1530, #0d1a2e)" }}>
                          <span className="text-5xl opacity-20">🏨</span>
                        </div>
                      )}
                      {/* Overlay gradient */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                      {/* Same Day badge */}
                      <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm border border-red-500/40 px-2.5 py-1 rounded-full">
                        <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse shrink-0" />
                        <span className="text-[0.6rem] font-bold text-red-400 uppercase tracking-wider">Same Day</span>
                      </div>

                      {/* Discount badge */}
                      <div className="absolute top-3 right-3 bg-gold-500 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow-gold">
                        {d.discount}% OFF
                      </div>

                      {/* Location pill at bottom of image */}
                      <div className="absolute bottom-3 left-3 flex items-center gap-1 bg-black/50 backdrop-blur-sm px-2.5 py-1 rounded-full">
                        <span className="text-[0.6rem]">📍</span>
                        <span className="text-[0.65rem] font-semibold text-white/90">{d.city}</span>
                      </div>
                    </div>

                    {/* Card body */}
                    <div className="p-4">
                      {/* Hotel name */}
                      <h3 className="font-semibold text-white text-sm leading-snug mb-0.5 group-hover:text-gold-300 transition-colors line-clamp-1">
                        {d.hotel?.name || "Hotel"}
                      </h3>
                      <p className="text-white/40 text-xs mb-3">{d.room?.type || "Room"} · {d.city}</p>

                      {/* Countdown */}
                      <div className={`flex items-center gap-1.5 mb-3 ${isUrgent ? "text-red-400" : "text-white/50"}`}>
                        {isUrgent && <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse shrink-0" />}
                        <span className="text-xs font-mono font-semibold">
                          {String(hrs).padStart(2,"0")}:{String(mins).padStart(2,"0")}:{String(secs).padStart(2,"0")} left
                        </span>
                      </div>

                      {/* Booking progress bar */}
                      <div className="mb-3">
                        <div className="flex justify-between text-[0.6rem] text-white/30 mb-1">
                          <span>{d.bookingCount} booked</span>
                          <span>{d.maxBookings} max</span>
                        </div>
                        <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-gold-500 to-gold-300 rounded-full transition-all"
                            style={{ width: `${Math.min(100, (d.bookingCount/d.maxBookings)*100)}%` }} />
                        </div>
                      </div>

                      {/* Price + CTA */}
                      <div className="flex items-end justify-between pt-3 border-t border-white/10">
                        <div>
                          <p className="text-white/30 text-xs line-through">₹{d.floorPrice}</p>
                          <p className="text-white font-bold text-xl">₹{d.aiPrice}</p>
                          <p className="text-white/40 text-[0.6rem]">/night</p>
                        </div>
                        <div onClick={e => e.stopPropagation()}>
                          <Link href={dealUrl}
                            className="btn-luxury px-3 py-2 rounded-xl text-xs font-bold shadow-gold">
                            Book Now
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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
            { num:"01", title:"Search & Browse", desc:"Discover premium hotels in your destination. Review rooms, amenities, and verified guest ratings.",
              icon:<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg> },
            { num:"02", title:"Name Your Price", desc:"Submit a bid with your budget. Hotels see your offer and compete to win your booking.",
              icon:<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg> },
            { num:"03", title:"Book & Save", desc:"Accept the best counter-offer and pay securely via Razorpay. Save up to 40% off published rates.",
              icon:<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg> },
          ].map((s) => (
            <div key={s.num}
              className="group relative p-8 rounded-3xl bg-white border border-luxury-100 hover:border-gold-200 hover:shadow-luxury-lg transition-all duration-300 cursor-default overflow-hidden hover:-translate-y-1">
              <span className="absolute top-5 right-6 font-display text-7xl font-bold text-luxury-100 group-hover:text-gold-100 transition-colors duration-300 leading-none select-none pointer-events-none">{s.num}</span>
              <div className="relative w-11 h-11 rounded-xl bg-gold-100 text-gold-500 flex items-center justify-center mb-6 group-hover:bg-gold-500 group-hover:text-white transition-all duration-300 shadow-sm">{s.icon}</div>
              <h3 className="font-semibold text-luxury-900 text-[1.05rem] mb-2.5 tracking-tight">{s.title}</h3>
              <p className="text-luxury-500 text-sm leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════════════════════════════
          TRUST STRIP
      ═══════════════════════════════════════ */}
      <section className="border-t border-luxury-100 py-12 bg-white">
        <div className="max-w-7xl mx-auto px-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { icon:"🔒", title:"Secure Payments", sub:"Razorpay encrypted" },
              { icon:"✅", title:"Verified Hotels",  sub:"Hand-picked stays" },
              { icon:"💬", title:"Live Bidding",     sub:"Real-time counters" },
              { icon:"🏔️", title:"Mountain Getaways",sub:"Curated destinations" },
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
            {[{href:"/hotels",label:"Hotels"},{href:"/flash-deals",label:"Deals"},{href:"/bid",label:"Place Bid"}].map((l) => (
              <Link key={l.href} href={l.href} className="hover:text-luxury-700 transition-colors tracking-wide">{l.label}</Link>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
