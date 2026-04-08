"use client";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { Suspense } from "react";

function HotelList() {
  const searchParams = useSearchParams();
  const [hotels, setHotels] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState(searchParams.get("city") || "");
  const [search, setSearch] = useState("");

  const fetchHotels = (params: Record<string, string>) => {
    setLoading(true);
    api.getHotels(params)
      .then((d) => { setHotels(d.hotels || []); setTotal(d.total || 0); })
      .catch(() => setHotels([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const p: Record<string, string> = {};
    if (city) p.city = city;
    if (search) p.q = search;
    fetchHotels(p);
  }, [city, search]);

  const cities = ["All", "Mussoorie", "Dhanaulti", "Rishikesh", "Shimla", "Manali", "Dehradun"];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="font-display text-3xl mb-2">Find Hotels</h1>
      <p className="text-gray-500 mb-6">{total} hotels found{city ? ` in ${city}` : ""}</p>

      {/* Search */}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by hotel name..."
        className="w-full max-w-md px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500 mb-4"
      />

      {/* City chips */}
      <div className="flex flex-wrap gap-2 mb-8">
        {cities.map((c) => (
          <button
            key={c}
            onClick={() => setCity(c === "All" ? "" : c)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition ${
              (c === "All" && !city) || c === city
                ? "bg-brand-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl bg-white border border-gray-100 overflow-hidden">
              <div className="h-48 shimmer" />
              <div className="p-4 space-y-3">
                <div className="h-5 w-3/4 shimmer rounded" />
                <div className="h-4 w-1/2 shimmer rounded" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Hotel Grid */}
      {!loading && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {hotels.map((h: any) => {
            const minPrice = h.rooms?.length ? Math.min(...h.rooms.map((r: any) => r.floorPrice)) : null;
            return (
              <Link key={h.id} href={`/hotels/${h.id}`} className="group rounded-2xl bg-white border border-gray-100 overflow-hidden hover:shadow-xl transition-all duration-300">
                {/* Image */}
                <div className="h-48 bg-gradient-to-br from-brand-100 to-brand-50 flex items-center justify-center relative overflow-hidden">
                  {h.images?.[0] ? (
                    <img src={h.images[0]} alt={h.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  ) : (
                    <span className="text-5xl opacity-30">🏨</span>
                  )}
                  {h.trustBadge && (
                    <span className="absolute top-3 left-3 px-2 py-1 bg-brand-600 text-white text-xs font-bold rounded-lg flex items-center gap-1">
                      ✓ Verified
                    </span>
                  )}
                </div>

                {/* Info */}
                <div className="p-5">
                  <div className="flex items-start justify-between mb-1">
                    <h3 className="font-bold text-lg group-hover:text-brand-700 transition">{h.name}</h3>
                    {h.avgRating > 0 && (
                      <span className="text-sm font-semibold text-accent-500 flex items-center gap-0.5">★ {h.avgRating.toFixed(1)}</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 mb-3">{h.city}, {h.state}</p>

                  <div className="flex items-center justify-between">
                    <div className="flex gap-1">
                      {h.starRating && Array.from({ length: h.starRating }).map((_, i) => (
                        <span key={i} className="text-accent-400 text-xs">★</span>
                      ))}
                    </div>
                    {minPrice && (
                      <div className="text-right">
                        <span className="text-xs text-gray-400">from</span>
                        <span className="text-lg font-bold text-brand-700 ml-1">₹{minPrice}</span>
                        <span className="text-xs text-gray-400">/night</span>
                      </div>
                    )}
                  </div>

                  {h.amenities?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-3">
                      {h.amenities.slice(0, 3).map((a: string) => (
                        <span key={a} className="text-xs px-2 py-0.5 bg-gray-100 rounded-full text-gray-500">{a}</span>
                      ))}
                      {h.amenities.length > 3 && <span className="text-xs text-gray-400">+{h.amenities.length - 3}</span>}
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {!loading && hotels.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          <span className="text-5xl mb-4 block">🏔️</span>
          <p className="text-lg font-medium">No hotels found</p>
          <p className="text-sm">Try a different city or search term</p>
        </div>
      )}
    </div>
  );
}

export default function HotelsPage() {
  return (
    <Suspense fallback={<div className="max-w-6xl mx-auto px-4 py-8"><div className="h-8 w-48 shimmer rounded mb-4" /></div>}>
      <HotelList />
    </Suspense>
  );
}
