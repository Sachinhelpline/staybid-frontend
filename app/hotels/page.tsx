"use client";
import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { getHotelArea } from "@/lib/areas";

function HotelList() {
  const searchParams = useSearchParams();
  const [hotels, setHotels] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState(searchParams.get("city") || "");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [apiError, setApiError] = useState("");

  // Debounce search — wait 350ms after user stops typing before firing API
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchHotels = useCallback((params: Record<string, string>) => {
    setLoading(true);
    setApiError("");
    api.getHotels(params)
      .then((d) => { setHotels(d.hotels || []); setTotal(d.total || 0); })
      .catch((e) => {
        setHotels([]);
        setApiError(e.message || "Server se data nahi aa raha. Thodi der baad try karein.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const p: Record<string, string> = {};
    if (city)           p.city = city;
    if (debouncedSearch) p.q = debouncedSearch;
    fetchHotels(p);
  }, [city, debouncedSearch, fetchHotels]);

  const cities = ["All", "Mussoorie", "Dhanaulti", "Rishikesh", "Shimla", "Manali", "Dehradun"];

  return (
    <div className="min-h-screen lux-bg">
    <div className="max-w-7xl mx-auto px-5 py-12">

      {/* ── Page header ── */}
      <div className="mb-10">
        <p className="text-gold-500 text-[0.68rem] font-semibold tracking-[0.2em] uppercase mb-3">Explore</p>
        <h1 className="font-display font-light text-white mb-1" style={{ fontSize: "clamp(1.9rem, 4vw, 2.8rem)" }}>
          Find Your Perfect Stay
        </h1>
        <p className="text-white/50 text-sm">
          {loading ? "Searching…" : `${total} hotel${total !== 1 ? "s" : ""}${city ? ` in ${city}` : ""} found`}
        </p>
      </div>

      {/* ── Search ── */}
      <div className="relative max-w-md mb-6">
        <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by hotel name…"
          className="w-full pl-11 pr-4 py-3 rounded-2xl border border-white/15 bg-white/5 text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-gold-400/50 focus:border-gold-300 transition text-sm"
        />
      </div>

      {/* ── City filter chips ── */}
      <div className="flex flex-wrap gap-2 mb-10">
        {cities.map((c) => {
          const active = (c === "All" && !city) || c === city;
          return (
            <button
              key={c}
              onClick={() => setCity(c === "All" ? "" : c)}
              className={`px-4 py-2 rounded-full text-sm font-medium tracking-wide transition-all duration-200 ${
                active
                  ? "lux-btn shadow-gold"
                  : "bg-white/5 border border-white/15 text-white/60 hover:border-gold-300 hover:text-white"
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
            <div key={i} className="rounded-3xl bg-white border border-white/10 overflow-hidden">
              <div className="h-52 shimmer" />
              <div className="p-5 space-y-3">
                <div className="h-5 w-3/4 shimmer rounded-full" />
                <div className="h-4 w-1/2 shimmer rounded-full" />
                <div className="h-4 w-1/3 shimmer rounded-full" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Hotel grid ── */}
      {!loading && hotels.length > 0 && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {hotels.map((h: any) => {
            const minPrice = h.rooms?.length
              ? Math.min(...h.rooms.map((r: any) => r.floorPrice))
              : null;

            return (
              <Link
                key={h.id}
                href={`/hotels/${h.id}`}
                className="group lux-glass lux-border rounded-3xl overflow-hidden flex flex-col"
              >
                {/* Image */}
                <div className="h-52 bg-white/10 relative overflow-hidden flex-shrink-0">
                  {h.images?.[0] ? (
                    <img
                      src={h.images[0]}
                      alt={h.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="text-5xl opacity-20">🏨</span>
                    </div>
                  )}

                  {/* Gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                  {h.trustBadge && (
                    <span className="absolute top-3 left-3 badge-gold flex items-center gap-1">
                      ✓ Verified
                    </span>
                  )}

                  {h.starRating && (
                    <span className="absolute top-3 right-3 px-2 py-1 bg-black/50 backdrop-blur-sm text-white text-xs font-semibold rounded-lg">
                      {"★".repeat(h.starRating)}
                    </span>
                  )}
                </div>

                {/* Info */}
                <div className="p-5 flex flex-col flex-1">
                  <div className="flex items-start justify-between mb-1 gap-2">
                    <h3 className="font-semibold text-white text-[1rem] leading-snug group-hover:text-gold-600 transition-colors">
                      {h.name}
                    </h3>
                    {h.avgRating > 0 && (
                      <span className="text-sm font-semibold text-gold-500 flex items-center gap-0.5 shrink-0">
                        ★ {h.avgRating.toFixed(1)}
                      </span>
                    )}
                  </div>

                  {(() => {
                    const area = getHotelArea(h.city, h.lat, h.lng);
                    return (
                      <p className="text-sm text-white/50 mb-4 tracking-wide flex items-center gap-1">
                        <span>📍</span>
                        <span>{area ? `${area}, ` : ""}{h.city}</span>
                      </p>
                    );
                  })()}

                  {h.amenities?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {h.amenities.slice(0, 3).map((a: string) => (
                        <span key={a} className="text-xs px-2.5 py-0.5 bg-white/5 border border-white/10 rounded-full text-white/60">
                          {a}
                        </span>
                      ))}
                      {h.amenities.length > 3 && (
                        <span className="text-xs text-white/50">+{h.amenities.length - 3}</span>
                      )}
                    </div>
                  )}

                  {/* Price — pushed to bottom */}
                  {minPrice && (
                    <div className="mt-auto pt-4 border-t border-white/10 flex items-center justify-between">
                      <span className="text-xs text-white/50 tracking-wide">Starting from</span>
                      <div>
                        <span className="text-xl font-bold text-white">₹{minPrice}</span>
                        <span className="text-xs text-white/50 ml-1">/night</span>
                      </div>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* ── API / Server error banner ── */}
      {!loading && apiError && (
        <div className="mb-6 p-5 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-4">
          <span className="text-2xl shrink-0">⚠️</span>
          <div>
            <p className="font-semibold text-red-700 text-sm mb-1">Server se connect nahi ho pa raha</p>
            <p className="text-red-500 text-xs leading-relaxed">{apiError}</p>
            <button
              onClick={() => fetchHotels(city ? { city } : {})}
              className="mt-3 px-4 py-1.5 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700 transition"
            >
              Dobara try karein
            </button>
          </div>
        </div>
      )}

      {/* ── Empty state (only shown when no error) ── */}
      {!loading && hotels.length === 0 && !apiError && (
        <div className="text-center py-28">
          <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-5">
            <span className="text-3xl">🏔️</span>
          </div>
          <p className="text-lg font-semibold text-white/90 mb-1">No hotels found</p>
          <p className="text-sm text-white/50">Try a different city or search term</p>
        </div>
      )}
    </div>
    </div>
  );
}

export default function HotelsPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-7xl mx-auto px-5 py-12">
          <div className="h-8 w-64 shimmer rounded-full mb-4" />
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-64 shimmer rounded-3xl" />
            ))}
          </div>
        </div>
      }
    >
      <HotelList />
    </Suspense>
  );
}
