"use client";
import { useState, useEffect, useCallback, useMemo, Suspense, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { getHotelArea } from "@/lib/areas";
import HotelScoreBadge from "@/components/hotel/HotelScoreBadge";
import { sbImage, SB_IMG_CARD } from "@/lib/sb-image";
// v141 — Phase-5 explore tour. 4 steps: search → city filter →
// sort+stars → first hotel card.
import { usePageTour } from "@/lib/tutorial/usePageTour";

// v159 — Airbnb-style explore. Multiple horizontally-scrolling rails grouped
// by theme + city; a search/filter switches to the legacy responsive grid.
// All rails read the same single `hotels` fetch — no extra round-trips.

const CITY_PILLS: Array<{ key: string; label: string; icon: string }> = [
  { key: "",          label: "All",       icon: "🏔" },
  { key: "Mussoorie", label: "Mussoorie", icon: "⛰️" },
  { key: "Dhanaulti", label: "Dhanaulti", icon: "🌲" },
  { key: "Rishikesh", label: "Rishikesh", icon: "🕉" },
  { key: "Shimla",    label: "Shimla",    icon: "🌨" },
  { key: "Manali",    label: "Manali",    icon: "🏂" },
  { key: "Dehradun",  label: "Dehradun",  icon: "🌳" },
];

// Per-card min price (best of active flash + lowest room floor).
function minPriceFor(h: any) {
  const flashMin = (h.flashDeals || []).length
    ? Math.min(...h.flashDeals.map((d: any) => d.aiPrice ?? d.dealPrice ?? Infinity))
    : Infinity;
  const roomMin = h.rooms?.length
    ? Math.min(...h.rooms.map((r: any) => r.floorPrice))
    : Infinity;
  const m = Math.min(flashMin, roomMin);
  return {
    minPrice: Number.isFinite(m) ? m : null,
    showFlash: flashMin < roomMin,
  };
}

function hashId(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Save (heart) — toggles `sb_local_saves` to match the schema used by
// /saved (`{ target_type, target_id, hotel_name, hotel_image }`).
function readSavedHotelIds(): Set<string> {
  try {
    const raw = localStorage.getItem("sb_local_saves");
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as any[];
    return new Set(arr.filter((s) => s?.target_type === "hotel").map((s) => String(s.target_id)));
  } catch {
    return new Set();
  }
}

function toggleSavedHotel(h: any): boolean {
  try {
    const raw = localStorage.getItem("sb_local_saves");
    const arr: any[] = raw ? JSON.parse(raw) : [];
    const key = `hotel:${h.id}`;
    const exists = arr.some((s) => `${s.target_type}:${s.target_id}` === key);
    let next: any[];
    if (exists) {
      next = arr.filter((s) => `${s.target_type}:${s.target_id}` !== key);
    } else {
      next = [
        {
          id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          target_type: "hotel",
          target_id: h.id,
          hotel_name: h.name,
          hotel_image: h.images?.[0] || "",
          city: h.city,
          starRating: h.starRating,
          avgRating: h.avgRating,
          createdAt: new Date().toISOString(),
        },
        ...arr,
      ];
    }
    localStorage.setItem("sb_local_saves", JSON.stringify(next));
    // Fire-and-forget remote sync (auth optional)
    try {
      const token = localStorage.getItem("sb_token");
      if (token) {
        fetch("/api/discover/save", {
          method: exists ? "DELETE" : "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ targetType: "hotel", targetId: h.id }),
        }).catch(() => {});
      }
    } catch {}
    return !exists;
  } catch {
    return false;
  }
}

function readRecentHotelIds(): string[] {
  try {
    const raw = localStorage.getItem("sb_recent_viewed_hotels");
    if (!raw) return [];
    const arr = JSON.parse(raw) as string[];
    return Array.isArray(arr) ? arr.slice(0, 12) : [];
  } catch {
    return [];
  }
}

function HotelList() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [hotels, setHotels] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState(searchParams.get("city") || "");
  const [search, setSearch] = useState("");
  // v141 — Phase 5 — explore tour.
  usePageTour("explore", "explore", { delayMs: 1200 });
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [apiError, setApiError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [savedSet, setSavedSet] = useState<Set<string>>(new Set());
  const [recentIds, setRecentIds] = useState<string[]>([]);

  const initialSort = (() => {
    const s = searchParams.get("sort");
    return s === "price-asc" || s === "price-desc" || s === "rating" ? s : "default";
  })() as "default" | "price-asc" | "price-desc" | "rating";
  const initialStars = (() => {
    const raw = searchParams.get("stars");
    if (!raw) return new Set<number>();
    const set = new Set<number>();
    raw.split(",").forEach((p) => {
      const n = Number(p.trim());
      if (n === 3 || n === 4 || n === 5) set.add(n);
    });
    return set;
  })();
  const [sortBy, setSortBy] = useState<"default" | "price-asc" | "price-desc" | "rating">(initialSort);
  const [selectedStars, setSelectedStars] = useState<Set<number>>(initialStars);

  // Mirror sort + stars into URL (replace, no history pollution).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (sortBy === "default") sp.delete("sort"); else sp.set("sort", sortBy);
    if (selectedStars.size === 0) sp.delete("stars");
    else {
      const arr: number[] = [];
      selectedStars.forEach((s) => arr.push(s));
      sp.set("stars", arr.sort((a, b) => b - a).join(","));
    }
    const qs = sp.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    router.replace(url, { scroll: false });
  }, [sortBy, selectedStars, router]);

  // Prefetch /discover so ✨ Explore swap is instant.
  useEffect(() => {
    try { router.prefetch("/discover"); } catch {}
  }, [router]);

  // Debounce search.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchHotels = useCallback((params: Record<string, string>) => {
    setLoading(true);
    setApiError("");
    Promise.all([
      api.getHotels(params).catch((e: any) => { throw e; }),
      api.getFlashDeals?.(params.city)?.catch?.(() => ({ deals: [] })) || Promise.resolve({ deals: [] }),
    ])
      .then(async ([hotelsRes, dealsRes]: any[]) => {
        const dealsByHotel: Record<string, any[]> = {};
        for (const d of (dealsRes?.deals || [])) {
          (dealsByHotel[d.hotelId] ||= []).push(d);
        }
        const list = hotelsRes.hotels || [];
        const compMins = await Promise.all(
          list.map((h: any) =>
            fetch(`/api/pricing/competitor/${h.id}`)
              .then((r) => r.json())
              .then((j) => j?.competitor_min ?? null)
              .catch(() => null)
          )
        );
        const enriched = list.map((h: any, i: number) => ({
          ...h,
          flashDeals: dealsByHotel[h.id] || [],
          competitor_min: compMins[i],
        }));
        setHotels(enriched);
        setTotal(hotelsRes.total || enriched.length);
      })
      .catch((e) => {
        setHotels([]);
        setApiError(e.message || "Server se data nahi aa raha. Thodi der baad try karein.");
      })
      .finally(() => setLoading(false));
  }, []);

  // Hydrate city from sb_city + listen for globe-picker changes.
  useEffect(() => {
    if (!searchParams.get("city")) {
      try {
        const sb = localStorage.getItem("sb_city");
        if (sb) setCity(sb);
      } catch {}
    }
    try { setSavedSet(readSavedHotelIds()); } catch {}
    try { setRecentIds(readRecentHotelIds()); } catch {}
    setHydrated(true);
    const applyCity = () => {
      try { setCity(localStorage.getItem("sb_city") || ""); } catch {}
    };
    const applyStorage = (e: StorageEvent) => {
      if (e.key === "sb_local_saves") setSavedSet(readSavedHotelIds());
      if (e.key === "sb_recent_viewed_hotels") setRecentIds(readRecentHotelIds());
    };
    window.addEventListener("sb:city-change", applyCity);
    window.addEventListener("storage", applyStorage);
    return () => {
      window.removeEventListener("sb:city-change", applyCity);
      window.removeEventListener("storage", applyStorage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const p: Record<string, string> = {};
    if (city)            p.city = city;
    if (debouncedSearch) p.q = debouncedSearch;
    fetchHotels(p);
  }, [city, debouncedSearch, fetchHotels, hydrated]);

  const handleHeartTap = (e: React.MouseEvent, h: any) => {
    e.preventDefault();
    e.stopPropagation();
    const now = toggleSavedHotel(h);
    setSavedSet((prev) => {
      const next = new Set(prev);
      if (now) next.add(String(h.id)); else next.delete(String(h.id));
      return next;
    });
  };

  // Star + sort + price annotation. Applied to BOTH grid + rails.
  const enrichedHotels = useMemo(() => {
    return hotels.map((h: any) => {
      const { minPrice, showFlash } = minPriceFor(h);
      return { ...h, _minPrice: minPrice, _showFlash: showFlash };
    });
  }, [hotels]);

  const filteredHotels = useMemo(() => {
    let list = enrichedHotels;
    if (selectedStars.size > 0) {
      list = list.filter((h: any) => selectedStars.has(Number(h.starRating) || 0));
    }
    return list;
  }, [enrichedHotels, selectedStars]);

  const displayHotels = useMemo(() => {
    if (sortBy === "default") return filteredHotels;
    const cloned = [...filteredHotels];
    if (sortBy === "price-asc") {
      cloned.sort((a: any, b: any) => (a._minPrice ?? Infinity) - (b._minPrice ?? Infinity));
    } else if (sortBy === "price-desc") {
      cloned.sort((a: any, b: any) => (b._minPrice ?? -Infinity) - (a._minPrice ?? -Infinity));
    } else if (sortBy === "rating") {
      cloned.sort((a: any, b: any) => (Number(b.avgRating) || 0) - (Number(a.avgRating) || 0));
    }
    return cloned;
  }, [filteredHotels, sortBy]);

  const filtersActive = sortBy !== "default" || selectedStars.size > 0;
  const inSearchMode = !!debouncedSearch.trim() || filtersActive;
  const toggleStar = (s: number) => {
    setSelectedStars((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };
  const resetFilters = () => { setSortBy("default"); setSelectedStars(new Set()); };

  // ───────────────────────── Rails ─────────────────────────
  // We always build from `filteredHotels` so star-filter is honoured.
  // (sort doesn't change rail composition — each rail has its own sort.)
  type Rail = { key: string; title: string; icon?: string; eyebrow?: string; items: any[] };

  const rails: Rail[] = useMemo(() => {
    if (!filteredHotels.length) return [];
    const out: Rail[] = [];

    // 1. Recently viewed — by stored ID order
    if (recentIds.length) {
      const map = new Map(filteredHotels.map((h: any) => [String(h.id), h]));
      const items = recentIds.map((id) => map.get(String(id))).filter(Boolean);
      if (items.length) out.push({ key: "recent", title: "Recently viewed", icon: "🕘", items });
    }

    // 2. Flash deals tonight
    const flash = filteredHotels.filter((h: any) => (h.flashDeals?.length || 0) > 0);
    if (flash.length) {
      out.push({
        key: "flash",
        title: "Flash deals tonight",
        icon: "⚡",
        eyebrow: "Limited time · prices drop after midnight",
        items: flash.sort((a: any, b: any) => (a._minPrice ?? Infinity) - (b._minPrice ?? Infinity)),
      });
    }

    // 3. Top rated by avgRating
    const topRated = [...filteredHotels]
      .filter((h: any) => (Number(h.avgRating) || 0) >= 4.2)
      .sort((a: any, b: any) => (Number(b.avgRating) || 0) - (Number(a.avgRating) || 0))
      .slice(0, 12);
    if (topRated.length >= 3) {
      out.push({
        key: "top-rated",
        title: "Most loved by guests",
        icon: "★",
        eyebrow: "Highest-rated stays this month",
        items: topRated,
      });
    }

    // 4. Premium verified (trustBadge or starRating >= 4)
    const verified = filteredHotels.filter(
      (h: any) => h.trustBadge === true || Number(h.starRating) >= 4
    ).slice(0, 12);
    if (verified.length >= 3) {
      out.push({
        key: "verified",
        title: "Premium verified stays",
        icon: "✓",
        eyebrow: "Personally inspected · trust-verified",
        items: verified,
      });
    }

    // 5. Per-city rails — only when "All" is selected so we don't show
    //    the same rail twice. When a specific city is active the existing
    //    rails above cover it.
    if (!city) {
      const cityBuckets: Record<string, any[]> = {};
      filteredHotels.forEach((h: any) => {
        const key = String(h.city || "Other");
        (cityBuckets[key] ||= []).push(h);
      });
      // Order by hotel count desc — busier cities float up.
      const ordered = Object.entries(cityBuckets)
        .sort(([, a], [, b]) => b.length - a.length)
        .filter(([k, v]) => k !== "Other" && v.length >= 2);
      for (const [cityName, items] of ordered) {
        out.push({
          key: `city-${cityName}`,
          title: `Stay in ${cityName}`,
          icon: "📍",
          items,
        });
      }
    } else {
      // Specific city active — single "All stays in {city}" rail at the end.
      out.push({
        key: `city-all-${city}`,
        title: `All stays in ${city}`,
        icon: "🏨",
        items: filteredHotels,
      });
    }

    return out;
  }, [filteredHotels, city, recentIds]);

  // ───────────────────────── Render ─────────────────────────
  return (
    <div className="hxr-page lux-bg">
      {/* v159.5 — Hero ABOVE sticky. Scrolls away cleanly on first scroll
          so it doesn't bleed through the sticky chrome on scroll-up.
          Single-line layout (eyebrow · italic title · count) is half the
          height of the v159.2 stacked block. */}
      <header className="hxr-hero-slim sb-fade-in">
        <p className="hxr-hero-line">
          <span className="hxr-hero-eyebrow">Explore</span>
          <span className="hxr-hero-dot" aria-hidden="true">·</span>
          <span className="hxr-hero-title">Find Your Perfect Stay</span>
          <span className="hxr-hero-dot" aria-hidden="true">·</span>
          <span className="hxr-hero-count">
            {loading
              ? "loading…"
              : inSearchMode
                ? `${displayHotels.length} match`
                : `${total} stay${total !== 1 ? "s" : ""}${city ? ` in ${city}` : ""}`}
          </span>
        </p>
      </header>

      {/* Sticky header — slim: search + categories + refine only. v159.5:
          background is solid (no backdrop-blur leak) and sits below the
          hero so the scroll story is hero-away → sticky-stuck. */}
      <div className="hxr-sticky">
        <div className="hxr-sticky-inner">
          {/* Search pill */}
          <div className="hxr-search">
            <svg className="hxr-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Where to next? Search city or hotel…"
              className="hxr-search-input"
              type="search"
              autoComplete="off"
              aria-label="Search hotels"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="hxr-search-clear"
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          {/* Category pills — icon + label, Airbnb-true: no boxed bg on
              inactive, active gets a thin champagne underline. */}
          <div className="hxr-cats" data-autonext-self="hotels-results">
            {CITY_PILLS.map((c) => {
              const active = c.key === city;
              return (
                <button
                  key={c.key || "all"}
                  type="button"
                  onClick={() => {
                    setCity(c.key);
                    try { localStorage.setItem("sb_city", c.key); } catch {}
                  }}
                  className={`hxr-cat ${active ? "hxr-cat-active" : ""}`}
                  aria-pressed={active}
                >
                  <span className="hxr-cat-icon" aria-hidden="true">{c.icon}</span>
                  <span className="hxr-cat-label">{c.label}</span>
                </button>
              );
            })}
          </div>

          {/* Refine row */}
          <div className="hxr-refine">
            <label className="hxr-refine-chip">
              <span className="hxr-refine-eyebrow">Sort</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="hxr-refine-select"
                aria-label="Sort hotels"
              >
                <option value="default">Recommended</option>
                <option value="price-asc">Price · low → high</option>
                <option value="price-desc">Price · high → low</option>
                <option value="rating">Top rated</option>
              </select>
            </label>
            {[5, 4, 3].map((s) => {
              const active = selectedStars.has(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleStar(s)}
                  className={`hxr-star-chip ${active ? "hxr-star-active" : ""}`}
                  aria-pressed={active}
                  aria-label={`Filter ${s} star hotels`}
                >
                  {s}★
                </button>
              );
            })}
            {filtersActive && (
              <button type="button" onClick={resetFilters} className="hxr-reset">
                ✕ Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="hxr-body" data-autonext="hotels-results">
        {/* Loading skeleton */}
        {loading && (
          <div className="hxr-skel-rail" aria-hidden="true">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="hxr-skel-card">
                <div className="hxr-skel-img shimmer" />
                <div className="hxr-skel-line shimmer" />
                <div className="hxr-skel-line-sm shimmer" />
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {!loading && apiError && (
          <div className="hxr-error">
            <span aria-hidden="true" style={{ fontSize: 22 }}>⚠️</span>
            <div>
              <p className="hxr-error-title">Server se connect nahi ho pa raha</p>
              <p className="hxr-error-body">{apiError}</p>
              <button onClick={() => fetchHotels(city ? { city } : {})} className="hxr-error-btn">
                Dobara try karein
              </button>
            </div>
          </div>
        )}

        {/* Empty */}
        {!loading && !apiError && displayHotels.length === 0 && (
          <div className="hxr-empty">
            <div className="hxr-empty-glyph">{filtersActive || debouncedSearch ? "🎯" : "🏔"}</div>
            <p className="hxr-empty-title">
              {filtersActive || debouncedSearch ? "No hotels match" : "No hotels found"}
            </p>
            <p className="hxr-empty-sub">
              {filtersActive || debouncedSearch ? "Loosen the filters or change your search" : "Try a different city"}
            </p>
            {(filtersActive || debouncedSearch) && (
              <button
                onClick={() => { resetFilters(); setSearch(""); }}
                className="hxr-empty-btn"
              >
                Clear all
              </button>
            )}
          </div>
        )}

        {/* Default view: rails. Triggered when no search + no filter. */}
        {!loading && !apiError && displayHotels.length > 0 && !inSearchMode && rails.length > 0 && (
          <div className="hxr-rails">
            {rails.map((rail) => (
              <RailSection
                key={rail.key}
                rail={rail}
                onHeart={handleHeartTap}
                savedSet={savedSet}
              />
            ))}
          </div>
        )}

        {/* Search/filter mode: responsive grid. */}
        {!loading && !apiError && displayHotels.length > 0 && inSearchMode && (
          <div className="hxr-grid-wrap">
            <h2 className="hxr-grid-title">
              {debouncedSearch
                ? `Matches for "${debouncedSearch}"`
                : `${displayHotels.length} stay${displayHotels.length !== 1 ? "s" : ""} match your filters`}
            </h2>
            <div className="hxr-grid">
              {displayHotels.map((h: any) => (
                <CardLink key={h.id} h={h} variant="grid" onHeart={handleHeartTap} savedSet={savedSet} />
              ))}
            </div>
          </div>
        )}

        {/* Fallback: rails empty (e.g. very few hotels) — show grid */}
        {!loading && !apiError && displayHotels.length > 0 && !inSearchMode && rails.length === 0 && (
          <div className="hxr-grid-wrap">
            <h2 className="hxr-grid-title">All stays</h2>
            <div className="hxr-grid">
              {displayHotels.map((h: any) => (
                <CardLink key={h.id} h={h} variant="grid" onHeart={handleHeartTap} savedSet={savedSet} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ───────── Rail wrapper with title + horizontal-scroll list ─────────
function RailSection({
  rail,
  onHeart,
  savedSet,
}: {
  rail: { key: string; title: string; icon?: string; eyebrow?: string; items: any[] };
  onHeart: (e: React.MouseEvent, h: any) => void;
  savedSet: Set<string>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(true);

  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth - 4;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft < max);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateArrows();
    el.addEventListener("scroll", updateArrows, { passive: true });
    window.addEventListener("resize", updateArrows);
    return () => {
      el.removeEventListener("scroll", updateArrows);
      window.removeEventListener("resize", updateArrows);
    };
  }, [updateArrows, rail.items.length]);

  const scrollBy = (dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    const card = el.querySelector(".hxr-card") as HTMLElement | null;
    const step = card ? card.offsetWidth + 16 : el.clientWidth * 0.85;
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  };

  return (
    <section className="hxr-rail-section">
      <header className="hxr-rail-head">
        <div className="hxr-rail-head-text">
          <h2 className="hxr-rail-title">
            {rail.icon && <span className="hxr-rail-icon" aria-hidden="true">{rail.icon}</span>}
            {rail.title}
          </h2>
          {rail.eyebrow && <p className="hxr-rail-eyebrow">{rail.eyebrow}</p>}
        </div>
        <div className="hxr-rail-arrows" aria-hidden="true">
          <button
            type="button"
            className="hxr-arrow"
            onClick={() => scrollBy(-1)}
            disabled={!canLeft}
            aria-label={`Scroll ${rail.title} left`}
          >
            ‹
          </button>
          <button
            type="button"
            className="hxr-arrow"
            onClick={() => scrollBy(1)}
            disabled={!canRight}
            aria-label={`Scroll ${rail.title} right`}
          >
            ›
          </button>
        </div>
      </header>
      <div className="hxr-rail" ref={scrollRef} role="list">
        {rail.items.map((h: any) => (
          <CardLink key={`${rail.key}-${h.id}`} h={h} variant="rail" onHeart={onHeart} savedSet={savedSet} />
        ))}
        {/* Bleed pad so the last card snaps cleanly to the right edge */}
        <div className="hxr-rail-end" aria-hidden="true" />
      </div>
    </section>
  );
}

// ───────── Hotel card (rail + grid share same component) ─────────
function CardLink({
  h,
  variant,
  onHeart,
  savedSet,
}: {
  h: any;
  variant: "rail" | "grid";
  onHeart: (e: React.MouseEvent, h: any) => void;
  savedSet: Set<string>;
}) {
  const { minPrice, showFlash } = h._minPrice !== undefined
    ? { minPrice: h._minPrice, showFlash: h._showFlash }
    : minPriceFor(h);
  const area = getHotelArea(h.city, h.lat, h.lng);
  const isSaved = savedSet.has(String(h.id));
  const competitorMin = h.competitor_min || h.competitorMin;
  const beatsMarket = competitorMin && minPrice && competitorMin > minPrice;
  const guestFavorite = (Number(h.avgRating) || 0) >= 4.6 && (h.reviewsCount || 0) >= 10;

  return (
    <Link
      role="listitem"
      href={`/hotels/${h.id}`}
      className={`hxr-card ${variant === "rail" ? "hxr-card-rail" : "hxr-card-grid"}`}
    >
      <div className="hxr-card-imgwrap">
        {h.images?.[0] ? (
          <img
            src={sbImage(h.images[0], SB_IMG_CARD)}
            alt={h.name}
            loading="lazy"
            decoding="async"
            onError={(e: any) => {
              if (!e.target.dataset.fallbackTried) {
                e.target.dataset.fallbackTried = "1";
                e.target.src = `https://picsum.photos/seed/sb-fallback-${hashId(String(h.id))}/800/1000`;
              }
            }}
            className="hxr-card-img"
          />
        ) : (
          <div className="hxr-card-placeholder">🏨</div>
        )}

        {/* Badge top-left */}
        {showFlash && (
          <span className="hxr-badge hxr-badge-flash">⚡ Flash deal</span>
        )}
        {!showFlash && guestFavorite && (
          <span className="hxr-badge hxr-badge-fav">Guest favourite</span>
        )}
        {!showFlash && !guestFavorite && h.trustBadge && (
          <span className="hxr-badge hxr-badge-verified">✓ Verified</span>
        )}

        {/* Heart top-right */}
        <button
          type="button"
          onClick={(e) => onHeart(e, h)}
          className={`hxr-heart ${isSaved ? "hxr-heart-on" : ""}`}
          aria-label={isSaved ? "Remove from saved" : "Save hotel"}
          aria-pressed={isSaved}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill={isSaved ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12.001 4.529c2.349-2.532 6.151-2.595 8.6-.184 2.45 2.41 2.605 6.37.4 8.978l-7.21 7.21a1.06 1.06 0 0 1-1.5 0l-7.21-7.21c-2.205-2.609-2.05-6.568.4-8.978 2.45-2.41 6.252-2.348 8.601.184Z" />
          </svg>
        </button>

        {/* Score chip bottom-right of image — uses existing 3D medal component */}
        <div
          className="hxr-score-chip"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <HotelScoreBadge hotelId={h.id} hotelName={h.name} variant="compact" />
        </div>
      </div>

      <div className="hxr-card-info">
        <div className="hxr-card-row1">
          <h3 className="hxr-card-name">{h.name}</h3>
          {(Number(h.avgRating) || 0) > 0 && (
            <span className="hxr-card-rating">★ {Number(h.avgRating).toFixed(1)}</span>
          )}
        </div>
        <p className="hxr-card-loc">
          {area ? `${area}, ` : ""}{h.city}
        </p>
        {minPrice && (
          <p className="hxr-card-price">
            {beatsMarket && (
              <span className="hxr-card-strike">₹{competitorMin}</span>
            )}
            <span className={`hxr-card-amount ${showFlash ? "hxr-card-amount-flash" : ""}`}>
              ₹{minPrice.toLocaleString("en-IN")}
            </span>
            <span className="hxr-card-per">/night</span>
          </p>
        )}
      </div>
    </Link>
  );
}

export default function HotelsPage() {
  return (
    <Suspense
      fallback={
        <div className="hxr-page lux-bg">
          <header className="hxr-hero-slim">
            <p className="hxr-hero-line">
              <span className="hxr-hero-eyebrow">Explore</span>
              <span className="hxr-hero-dot" aria-hidden="true">·</span>
              <span className="hxr-hero-title">Find Your Perfect Stay</span>
              <span className="hxr-hero-dot" aria-hidden="true">·</span>
              <span className="hxr-hero-count">loading…</span>
            </p>
          </header>
          <div className="hxr-sticky">
            <div className="hxr-sticky-inner">
              <div className="hxr-search">
                <svg className="hxr-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                </svg>
                <input className="hxr-search-input" placeholder="Where to next? Search city or hotel…" disabled aria-label="Search hotels" />
              </div>
            </div>
          </div>
          <div className="hxr-body">
            <div className="hxr-skel-rail" aria-hidden="true">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="hxr-skel-card">
                  <div className="hxr-skel-img shimmer" />
                  <div className="hxr-skel-line shimmer" />
                  <div className="hxr-skel-line-sm shimmer" />
                </div>
              ))}
            </div>
          </div>
        </div>
      }
    >
      <HotelList />
    </Suspense>
  );
}
