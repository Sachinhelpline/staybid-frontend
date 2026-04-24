"use client";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { getHotelArea } from "@/lib/areas";
import { Suspense } from "react";

function FlashDealsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [deals, setDeals]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [city, setCity]       = useState(searchParams.get("city") || "");
  const [now, setNow]         = useState(Date.now());

  // Countdown tick
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Fetch deals + live slot refresh
  useEffect(() => {
    setLoading(true);
    api.getFlashDeals(city || undefined)
      .then((d) => setDeals(d.deals || []))
      .catch(() => setDeals([]))
      .finally(() => setLoading(false));
  }, [city]);

  useEffect(() => {
    const t = setInterval(() => {
      api.getFlashDeals(city || undefined)
        .then((d) => setDeals(d.deals || [])).catch(() => {});
    }, 30000);
    return () => clearInterval(t);
  }, [city]);

  const cities = ["All", "Mussoorie", "Dhanaulti", "Rishikesh", "Shimla", "Manali", "Dehradun"];

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(180deg,#0a0812 0%,#0f0d1e 60%,#13101f 100%)" }}>
      <style>{`
        @keyframes fadeUp { from{opacity:0;transform:translateY(18px)} to{opacity:1;transform:translateY(0)} }
        .deal-card { animation: fadeUp 0.4s ease-out both; }
      `}</style>

      {/* ── Header ── */}
      <div className="max-w-7xl mx-auto px-5 pt-14 pb-8">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-px w-8 bg-gradient-to-r from-transparent to-gold-500 opacity-70" />
          <span className="text-gold-400 text-[0.65rem] font-semibold tracking-[0.22em] uppercase">Same Day · AI Curated</span>
          <div className="h-px w-8 bg-gradient-to-l from-transparent to-gold-500 opacity-70" />
        </div>
        <div className="flex items-center gap-3 mb-2">
          <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse flex-shrink-0" />
          <h1 className="font-display font-light text-white" style={{ fontSize: "clamp(2rem,5vw,3rem)" }}>
            Flash Deals
          </h1>
        </div>
        <p className="text-white/40 text-sm max-w-md">
          Time-limited offers — expire at midnight. Bid or book before slots run out.
        </p>
      </div>

      {/* ── City filters ── */}
      <div className="max-w-7xl mx-auto px-5 mb-8">
        <div className="flex flex-wrap gap-2">
          {cities.map((c) => {
            const active = (c === "All" && !city) || c === city;
            return (
              <button key={c} onClick={() => setCity(c === "All" ? "" : c)}
                className={active ? "btn-3d btn-3d-gold btn-3d-sm" : "btn-3d btn-3d-dark btn-3d-sm"}>
                {c}
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-5 pb-16">

        {/* ── Loading skeleton ── */}
        {loading && (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1,2,3,4,5,6].map((i) => (
              <div key={i} className="rounded-2xl overflow-hidden border border-white/10" style={{ background:"rgba(255,255,255,0.04)" }}>
                <div className="h-44 bg-white/10 animate-pulse" />
                <div className="p-4 space-y-3">
                  <div className="h-3 w-1/3 bg-white/10 animate-pulse rounded-full" />
                  <div className="h-4 w-3/4 bg-white/10 animate-pulse rounded-full" />
                  <div className="h-3 w-1/2 bg-white/10 animate-pulse rounded-full" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Deals grid ── */}
        {!loading && deals.length > 0 && (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {deals.map((d: any, idx: number) => {
              const midnight   = new Date(); midnight.setHours(23,59,59,999);
              const diffMs     = Math.max(0, midnight.getTime() - now);
              const hrs        = Math.floor(diffMs / 3600000);
              const mins       = Math.floor((diffMs % 3600000) / 60000);
              const secs       = Math.floor((diffMs % 60000) / 1000);
              const isUrgent   = hrs < 2;
              const totalSlots  = d.maxBookings  || 10;
              const bookedSlots = d.bookingCount || 0;
              const leftSlots   = Math.max(0, totalSlots - bookedSlots);
              const fillPct     = Math.min(100, (bookedSlots / totalSlots) * 100);
              const img         = d.hotel?.images?.[0] || d.room?.images?.[0];
              const area        = getHotelArea(d.city, d.hotel?.lat, d.hotel?.lng);
              const dealUrl     = `/hotels/${d.hotelId}?dealId=${d.id}&dealPrice=${d.aiPrice}&roomId=${d.roomId}&discount=${d.discount}&directBook=true`;

              return (
                <div key={d.id}
                  className="deal-card group relative rounded-2xl overflow-hidden border border-white/10 hover:border-gold-400/50 transition-all duration-300 cursor-pointer hover:-translate-y-1"
                  style={{ background:"rgba(255,255,255,0.05)", animationDelay:`${idx*0.07}s` }}
                  onClick={() => router.push(dealUrl)}>

                  {/* Hotel image */}
                  <div className="relative h-44 overflow-hidden">
                    {img ? (
                      <img src={img} alt={d.hotel?.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"
                        style={{ background:"linear-gradient(135deg,#1a1530,#0d1a2e)" }}>
                        <span className="text-5xl opacity-20">🏨</span>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                    {/* Same-day badge */}
                    <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/70 backdrop-blur-sm border border-red-500/40 px-2 py-1 rounded-full">
                      <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse shrink-0" />
                      <span className="text-[0.6rem] font-bold text-red-400 uppercase">
                        Today · {area ? `${area}, ${d.city}` : d.city}
                      </span>
                    </div>

                    {/* Discount badge */}
                    <span className="absolute top-3 right-3 bg-gold-500 text-white text-[0.62rem] font-bold px-2 py-1 rounded-full shadow-gold">
                      {d.discount}% OFF
                    </span>

                    {/* Countdown overlay */}
                    <div className={`absolute bottom-3 left-3 flex items-center gap-1.5 ${isUrgent ? "text-red-400" : "text-white/80"}`}>
                      {isUrgent && <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />}
                      <div className="bg-black/60 backdrop-blur-sm px-2 py-1 rounded-lg flex items-center gap-1">
                        <span className="text-[0.58rem] font-semibold text-white/50 uppercase tracking-wider">Ends</span>
                        <span className="text-[0.72rem] font-mono font-bold">
                          {String(hrs).padStart(2,"0")}:{String(mins).padStart(2,"0")}:{String(secs).padStart(2,"0")}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Card body */}
                  <div className="p-4">
                    <h3 className="font-semibold text-white text-sm leading-snug mb-0.5 group-hover:text-gold-300 transition-colors line-clamp-1">
                      {d.hotel?.name || "Hotel"}
                    </h3>
                    <p className="text-white/40 text-xs mb-3">{d.room?.type || "Room"}</p>

                    {/* Slots info + progress */}
                    <div className="mb-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className={`text-[0.65rem] font-semibold ${leftSlots <= 2 ? "text-red-400" : leftSlots <= 5 ? "text-amber-400" : "text-white/50"}`}>
                          {bookedSlots}/{totalSlots} booked
                        </span>
                        <span className={`text-[0.65rem] font-bold ${leftSlots <= 2 ? "text-red-400" : "text-gold-400"}`}>
                          {leftSlots === 0 ? "SOLD OUT" : `${leftSlots} left`}
                        </span>
                      </div>
                      <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-700 ${leftSlots === 0 ? "bg-red-500" : leftSlots <= 2 ? "bg-red-500" : "bg-gradient-to-r from-gold-500 to-gold-300"}`}
                          style={{ width:`${fillPct}%` }} />
                      </div>
                    </div>

                    {/* Price + CTA */}
                    <div className="flex items-end justify-between pt-3 border-t border-white/10">
                      <div>
                        <p className="text-white/30 text-xs line-through">₹{d.floorPrice?.toLocaleString()}</p>
                        <p className="text-white font-bold text-xl leading-none">
                          ₹{d.aiPrice?.toLocaleString()}
                          <span className="text-white/30 text-xs font-normal ml-1">/night</span>
                        </p>
                      </div>
                      <div onClick={(e) => e.stopPropagation()}>
                        {leftSlots === 0 ? (
                          <span className="px-4 py-2 rounded-xl bg-white/10 text-white/30 text-xs font-semibold cursor-not-allowed">Sold Out</span>
                        ) : (
                          <button onClick={() => router.push(dealUrl)}
                            className="btn-3d btn-3d-gold btn-3d-sm">
                            ⚡ Book Now
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Empty state ── */}
        {!loading && deals.length === 0 && (
          <div className="text-center py-28">
            <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-5">
              <span className="text-3xl">⚡</span>
            </div>
            <p className="text-lg font-semibold text-white mb-2">No flash deals right now</p>
            <p className="text-sm text-white/40">AI-powered offers drop daily — check back soon.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function FlashDealsPage() {
  return (
    <Suspense>
      <FlashDealsContent />
    </Suspense>
  );
}
