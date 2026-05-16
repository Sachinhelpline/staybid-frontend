"use client";
import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { getHotelArea } from "@/lib/areas";
import HotelScoreBadge from "@/components/hotel/HotelScoreBadge";

function HotelList() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [hotels, setHotels] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState(searchParams.get("city") || "");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [apiError, setApiError] = useState("");
  const [hydrated, setHydrated] = useState(false);

  // Warm up /discover so the ✨ Explore chip swap is instant.
  useEffect(() => {
    try { router.prefetch("/discover"); } catch {}
  }, [router]);

  // Debounce search — wait 350ms after user stops typing before firing API
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchHotels = useCallback((params: Record<string, string>) => {
    setLoading(true);
    setApiError("");
    // BUG-FIX 2: fetch active flash deals in parallel and merge them onto
    // each hotel so the listing card prefers the deal price over floor.
    Promise.all([
      api.getHotels(params).catch((e: any) => { throw e; }),
      api.getFlashDeals?.(params.city)?.catch?.(() => ({ deals: [] })) || Promise.resolve({ deals: [] }),
    ])
      .then(async ([hotelsRes, dealsRes]: any[]) => {
        const dealsByHotel: Record<string, any[]> = {};
        for (const d of (dealsRes?.deals || [])) {
          (dealsByHotel[d.hotelId] ||= []).push(d);
        }
        // Fetch competitor min per hotel in parallel (small list — first page)
        const hotels = hotelsRes.hotels || [];
        const compMins = await Promise.all(
          hotels.map((h: any) =>
            fetch(`/api/pricing/competitor/${h.id}`)
              .then((r) => r.json())
              .then((j) => j?.competitor_min ?? null)
              .catch(() => null)
          )
        );
        const enriched = hotels.map((h: any, i: number) => ({
          ...h,
          flashDeals: dealsByHotel[h.id] || [],
          competitor_min: compMins[i],
        }));
        setHotels(enriched);
        setTotal(hotelsRes.total || 0);
      })
      .catch((e) => {
        setHotels([]);
        setApiError(e.message || "Server se data nahi aa raha. Thodi der baad try karein.");
      })
      .finally(() => setLoading(false));
  }, []);

  // Hydrate city from `sb_city` (premium globe picker in Navbar) BEFORE the
  // first fetch. Without this, two requests race (no-city + sb_city) and the
  // slower one overwrites the correct response.
  useEffect(() => {
    if (!searchParams.get("city")) {
      try {
        const sb = localStorage.getItem("sb_city");
        if (sb) setCity(sb);
      } catch {}
    }
    setHydrated(true);
    const apply = () => {
      try { setCity(localStorage.getItem("sb_city") || ""); } catch {}
    };
    window.addEventListener("sb:city-change", apply);
    return () => window.removeEventListener("sb:city-change", apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return; // skip until sb_city is read
    const p: Record<string, string> = {};
    if (city)           p.city = city;
    if (debouncedSearch) p.q = debouncedSearch;
    fetchHotels(p);
  }, [city, debouncedSearch, fetchHotels, hydrated]);

  const cities = ["All", "Mussoorie", "Dhanaulti", "Rishikesh", "Shimla", "Manali", "Dehradun"];

  return (
    <div className="min-h-screen lux-bg">
    {/* v90 — `.lux-bg` is now theme-aware (reads var(--bg-page)), so the
        page surface flips with the dark/light toggle. The cozy compact
        hero from v89 stays — eyebrow + heading + count + search + chips
        fit in a tight band so the first hotel row is above the fold. */}
    <div className="max-w-7xl mx-auto px-4 py-4">

      {/* ── Compact page header ── */}
      <div className="mb-3">
        <p className="text-[0.6rem] font-semibold tracking-[0.18em] uppercase mb-1" style={{ color: "var(--accent)" }}>Explore</p>
        <h1 className="font-display font-light mb-0.5" style={{ fontSize: "clamp(1.4rem, 4vw, 2.0rem)", color: "var(--text-base)" }}>
          Find Your Perfect Stay
        </h1>
        <p className="text-[0.78rem]" style={{ color: "var(--text-muted)" }}>
          {loading ? "Searching…" : `${total} hotel${total !== 1 ? "s" : ""}${city ? ` in ${city}` : ""} found`}
        </p>
      </div>

      {/* ── Search (slimmer) ── */}
      <div className="relative max-w-md mb-3">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: "var(--text-muted)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by hotel name…"
          className="w-full pl-10 pr-3 py-2 rounded-xl text-[0.86rem] focus:outline-none transition"
          style={{
            border: "1px solid var(--border-soft)",
            background: "var(--bg-input)",
            color: "var(--text-base)",
          }}
        />
      </div>

      {/* ── City filter chips — v122.3: tap auto-scrolls to results ── */}
      <div className="flex flex-wrap gap-1.5 mb-4" data-autonext-self="hotels-results">
        {cities.map((c) => {
          const active = (c === "All" && !city) || c === city;
          return (
            <button
              key={c}
              onClick={() => setCity(c === "All" ? "" : c)}
              className="px-3 py-1.5 rounded-full text-[0.74rem] font-semibold transition-all"
              style={{
                background: active ? "var(--bg-pill-active)" : "var(--bg-pill)",
                color: active ? "var(--text-inverse)" : "var(--text-soft)",
                border: active ? "1px solid var(--border-strong)" : "1px solid var(--border-soft)",
                boxShadow: active ? "var(--shadow-soft)" : "none",
              }}
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

      {/* ── Hotel grid ── v122.3: data-autonext target for filter chip scroll */}
      {!loading && hotels.length > 0 && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6" data-autonext="hotels-results">
          {hotels.map((h: any, idx: number) => {
            // BUG-FIX 2: prefer ACTIVE flash deal price over room.floorPrice
            // for the "Starting from" badge. Hotels were showing ₹3899
            // (floor) even though a ₹999 deal was live.
            const flashMin = (h.flashDeals || []).length
              ? Math.min(...h.flashDeals.map((d: any) => d.aiPrice ?? d.dealPrice ?? Infinity))
              : Infinity;
            const roomMin = h.rooms?.length
              ? Math.min(...h.rooms.map((r: any) => r.floorPrice))
              : Infinity;
            const minPrice = Math.min(flashMin, roomMin);
            const showFlash = flashMin < roomMin;

            return (
              <Link
                key={h.id}
                href={`/hotels/${h.id}`}
                className="group lux-glass lux-border rounded-3xl overflow-hidden flex flex-col transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_20px_50px_-10px_rgba(240,180,41,0.35)] active:scale-[0.985]"
                style={{ animation: `lux-fadeUp 0.5s ease ${idx * 0.06}s both` }}
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

                  {/* v128 — compact live scorecard badge (bottom-right of image) */}
                  <div
                    className="absolute bottom-3 right-3 z-10"
                    style={{ pointerEvents: "auto" }}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  >
                    <HotelScoreBadge hotelId={h.id} hotelName={h.name} variant="card" />
                  </div>
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

                  {/* Price — pushed to bottom. Shows competitor min strikethrough
                      + "Best price guaranteed" copy when our price beats market. */}
                  {minPrice && minPrice !== Infinity && (() => {
                    const competitorMin = h.competitor_min || h.competitorMin;
                    const beatsMarket = competitorMin && competitorMin > minPrice;
                    return (
                      <div className="mt-auto pt-4 border-t border-white/10">
                        {beatsMarket && (
                          <div className="text-[10px] text-emerald-300 font-semibold tracking-wide mb-1">
                            ✅ Best price guaranteed
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-white/50 tracking-wide">
                            {showFlash ? "⚡ Flash deal from" : "Starting from"}
                          </span>
                          <div>
                            <span className={`text-xl font-bold ${showFlash ? "text-gold-300" : "text-white"}`}>₹{minPrice}</span>
                            {beatsMarket && (
                              <span className="text-xs text-white/40 line-through ml-1.5">₹{competitorMin}</span>
                            )}
                            <span className="text-xs text-white/50 ml-1">/night</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
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
