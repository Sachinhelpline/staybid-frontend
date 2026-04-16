"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

export default function FlashDealsPage() {
  const [deals, setDeals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState("");

  useEffect(() => {
    setLoading(true);
    api.getFlashDeals(city || undefined)
      .then((d) => setDeals(d.deals || []))
      .catch(() => setDeals([]))
      .finally(() => setLoading(false));
  }, [city]);

  const cities = ["All", "Mussoorie", "Dhanaulti", "Rishikesh", "Shimla", "Manali"];

  return (
    <div className="bg-luxury-50 min-h-screen">
      {/* ── Page header ── */}
      <div
        className="py-16 md:py-20 text-white"
        style={{ background: "linear-gradient(135deg, #0a0812 0%, #130f24 50%, #0a1020 100%)" }}
      >
        <div className="max-w-7xl mx-auto px-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px w-8 bg-gradient-to-r from-transparent to-gold-500 opacity-70" />
            <span className="text-gold-400 text-[0.68rem] font-semibold tracking-[0.2em] uppercase">
              Limited Time
            </span>
            <div className="h-px w-8 bg-gradient-to-l from-transparent to-gold-500 opacity-70" />
          </div>

          <div className="flex items-center gap-3 mb-3">
            <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse flex-shrink-0" />
            <h1 className="font-display font-light text-white" style={{ fontSize: "clamp(2rem, 5vw, 3rem)" }}>
              Flash Deals
            </h1>
          </div>
          <p className="text-white/50 text-sm tracking-wide max-w-md">
            AI-powered, time-limited offers curated for your next mountain escape.
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-5 py-10">

        {/* ── City filters ── */}
        <div className="flex flex-wrap gap-2 mb-10">
          {cities.map((c) => {
            const active = (c === "All" && !city) || c === city;
            return (
              <button
                key={c}
                onClick={() => setCity(c === "All" ? "" : c)}
                className={`px-4 py-2 rounded-full text-sm font-medium tracking-wide transition-all duration-200 ${
                  active
                    ? "btn-luxury shadow-gold"
                    : "bg-white border border-luxury-200 text-luxury-500 hover:border-gold-300 hover:text-luxury-900"
                }`}
              >
                {c}
              </button>
            );
          })}
        </div>

        {/* ── Loading skeleton ── */}
        {loading && (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="rounded-3xl overflow-hidden bg-white border border-luxury-100">
                <div className="h-3 shimmer" />
                <div className="p-6 space-y-3">
                  <div className="h-4 w-1/3 shimmer rounded-full" />
                  <div className="h-5 w-3/4 shimmer rounded-full" />
                  <div className="h-4 w-1/2 shimmer rounded-full" />
                  <div className="h-8 w-1/2 shimmer rounded-full mt-4" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Deals grid ── */}
        {!loading && deals.length > 0 && (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {deals.map((d: any) => {
              const expires = new Date(d.validUntil);
              const leftHours = Math.max(0, Math.floor((expires.getTime() - Date.now()) / 3600000));
              const leftMins  = Math.max(0, Math.floor(((expires.getTime() - Date.now()) % 3600000) / 60000));
              const isUrgent  = leftHours < 3;

              return (
                <div key={d.id} className="group card-luxury overflow-hidden flex flex-col">
                  {/* Gold-to-red gradient top stripe */}
                  <div className="h-[3px] bg-gradient-to-r from-gold-500 via-red-400 to-gold-500" />

                  <div className="p-6 flex flex-col flex-1">
                    {/* Top row */}
                    <div className="flex items-center justify-between mb-4">
                      <span className="badge-gold">{d.discount}% OFF</span>
                      <span className={`text-xs font-semibold flex items-center gap-1.5 ${isUrgent ? "text-red-500" : "text-luxury-400"}`}>
                        {isUrgent && <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />}
                        {leftHours}h {leftMins}m left
                      </span>
                    </div>

                    {/* Hotel info */}
                    <h3 className="font-semibold text-luxury-900 text-[1.05rem] mb-1 group-hover:text-gold-600 transition-colors leading-snug">
                      {d.hotel?.name || "Hotel"}
                    </h3>
                    <p className="text-sm text-luxury-400 mb-1">{d.room?.type} · {d.city}</p>

                    {/* Booking progress */}
                    <div className="mb-5">
                      <div className="flex justify-between text-xs text-luxury-400 mb-1.5">
                        <span>{d.bookingCount} booked</span>
                        <span>{d.maxBookings} max</span>
                      </div>
                      <div className="h-1 bg-luxury-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-gold-500 to-gold-300 rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(100, (d.bookingCount / d.maxBookings) * 100)}%` }}
                        />
                      </div>
                    </div>

                    {/* Price & CTA */}
                    <div className="mt-auto flex items-end justify-between pt-4 border-t border-luxury-100">
                      <div>
                        <p className="text-sm text-luxury-300 line-through">₹{d.floorPrice}</p>
                        <p className="text-2xl font-bold text-luxury-900">₹{d.aiPrice}</p>
                        <p className="text-xs text-luxury-400">/night</p>
                      </div>
                      <Link
                        href={`/hotels/${d.hotelId}?dealId=${d.id}&dealPrice=${d.aiPrice}&roomId=${d.roomId}&discount=${d.discount}`}
                        className="btn-luxury px-5 py-2.5 rounded-xl text-sm"
                      >
                        Book Now
                      </Link>
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
            <div className="w-20 h-20 rounded-full bg-luxury-100 flex items-center justify-center mx-auto mb-5">
              <span className="text-3xl">⚡</span>
            </div>
            <p className="text-lg font-semibold text-luxury-800 mb-1">No flash deals right now</p>
            <p className="text-sm text-luxury-400">Check back later — AI-powered offers drop daily.</p>
          </div>
        )}
      </div>
    </div>
  );
}
