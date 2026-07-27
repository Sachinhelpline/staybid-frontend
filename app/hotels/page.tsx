"use client";
import { useState, useEffect, useCallback, useMemo, Suspense, useRef, type Dispatch, type SetStateAction } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { getHotelArea } from "@/lib/areas";
import HotelScoreBadge, { seedScorecardCache } from "@/components/hotel/HotelScoreBadge";
import { sbImage, SB_IMG_CARD } from "@/lib/sb-image";
import { LocationGlobeModal } from "@/components/LocationGlobePicker";
import StaySearchSheet from "@/components/hotel/StaySearchSheet";
// v141 — Phase-5 explore tour. 4 steps: search → city filter →
// sort+stars → first hotel card.
import { usePageTour } from "@/lib/tutorial/usePageTour";
// v392 — canonical city pills (hill-stations + 12-month demand-cycle hubs).
import { HUB_CITIES, SATELLITE_CITIES } from "@/lib/cities";
import DemandCycleStrip from "@/components/discover/DemandCycleStrip";
// v535 — launch-phase zone/region chips (Garhwal, Himachal, Rajasthan, …). Only
// shown while launch curation is on; a thin client-side refine over the fetched
// hotels (no API change) that scopes both the rails and the grid to a zone.
import { LAUNCH_ZONES, isLaunchCurationOn } from "@/lib/launch/curation";

// v394 — new demand-cycle destinations (hubs + satellites), lowercased, for the
// "Explore India" rail. Hubs first so they lead the rail.
const NEW_DEST_ORDER: string[] = [
  ...HUB_CITIES.map((c) => c.key.toLowerCase()),
  ...SATELLITE_CITIES.map((c) => c.key.toLowerCase()),
];
const NEW_DEST_SET = new Set(NEW_DEST_ORDER);

// v160 — Sort options for the unified control-bar filter popover.
const SORT_OPTS: Array<{ v: "default" | "price-asc" | "price-desc" | "rating"; label: string }> = [
  { v: "default",    label: "Recommended" },
  { v: "price-asc",  label: "Price · low to high" },
  { v: "price-desc", label: "Price · high to low" },
  { v: "rating",     label: "Top rated" },
];

// v159 — Airbnb-style explore. Multiple horizontally-scrolling rails grouped
// by theme + city; a search/filter switches to the legacy responsive grid.
// All rails read the same single `hotels` fetch — no extra round-trips.
// v159.8 — Multi-level search sheet (Where + When + Who) reusing the
// LuxuryCalendar from /hotels/[id]. State persists to localStorage as
// `sb_search_state` and propagates to /hotels/[id] via URL params on
// card tap so the detail picker arrives pre-filled.


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

  // v159.8 — Multi-level search sheet state
  const [searchOpen, setSearchOpen] = useState(false);
  // v160 — Unified control bar: location globe + filter popover.
  const [locOpen, setLocOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchCheckIn, setSearchCheckIn] = useState("");
  const [searchCheckOut, setSearchCheckOut] = useState("");
  const [searchAdults, setSearchAdults] = useState(2);
  const [searchChildren, setSearchChildren] = useState(0);
  const [searchKids, setSearchKids] = useState(0);

  // Pending bookings — surfaces "Continue your booking" card at top of body
  const [pendingBids, setPendingBids] = useState<any[]>([]);

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
  // v433 — smart filters (session-only; not URL-mirrored to keep the shallow
  // sort/stars mirror untouched). priceMax=null → no price cap; minScore=0 → any.
  const [priceMax, setPriceMax] = useState<number | null>(null);
  const [minScore, setMinScore] = useState<number>(0);
  const [propTypes, setPropTypes] = useState<Set<string>>(new Set());
  const [amenitySel, setAmenitySel] = useState<Set<string>>(new Set());
  // v535 — active launch zone ("" = all zones). Client-side refine over the
  // fetched hotels; scopes rails + grid to the zone's cities. Only meaningful
  // while launch curation is on.
  const [zone, setZone] = useState("");
  const zonesOn = isLaunchCurationOn() && LAUNCH_ZONES.length > 0;

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
        const ids = list.map((h: any) => h.id).filter(Boolean);
        // Fetch competitor mins + ALL hotel scorecards in parallel (one batch
        // call for scores instead of one-per-badge). Seeding the badge cache
        // before setHotels means the badges read from cache and never self-fetch.
        const [compMins] = await Promise.all([
          Promise.all(
            list.map((h: any) =>
              fetch(`/api/pricing/competitor/${h.id}`)
                .then((r) => r.json())
                .then((j) => j?.competitor_min ?? null)
                .catch(() => null)
            )
          ),
          ids.length
            ? fetch(`/api/hotels/scorecards?ids=${ids.map(encodeURIComponent).join(",")}`)
                .then((r) => r.json())
                .then((j) => seedScorecardCache(j?.scorecards))
                .catch(() => {})
            : Promise.resolve(),
        ]);
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
        setApiError(e.message || "We couldn't load hotels right now. Please try again in a moment.");
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
    // v159.8 — Hydrate search state from localStorage so the search pill
    // remembers the user's last "when + who" between sessions.
    try {
      const raw = localStorage.getItem("sb_search_state");
      if (raw) {
        const s = JSON.parse(raw);
        if (s?.checkIn) setSearchCheckIn(String(s.checkIn));
        if (s?.checkOut) setSearchCheckOut(String(s.checkOut));
        if (typeof s?.adults === "number")   setSearchAdults(Math.max(1, Math.min(8, s.adults)));
        if (typeof s?.children === "number") setSearchChildren(Math.max(0, Math.min(6, s.children)));
        if (typeof s?.kids === "number")     setSearchKids(Math.max(0, Math.min(6, s.kids)));
      }
    } catch {}
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

  // v159.8 — Persist search state. Only after hydration so we don't
  // clobber stored values on initial paint.
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem("sb_search_state", JSON.stringify({
        checkIn: searchCheckIn, checkOut: searchCheckOut,
        adults: searchAdults, children: searchChildren, kids: searchKids,
      }));
    } catch {}
  }, [hydrated, searchCheckIn, searchCheckOut, searchAdults, searchChildren, searchKids]);

  // v159.8 — Fetch pending bookings ("Continue your booking" card).
  // Bids with status PENDING / ACCEPTED / COUNTER haven't been completed
  // — most recent one surfaces as a single card at top of body.
  useEffect(() => {
    if (!hydrated) return;
    if (typeof window === "undefined") return;
    const tok = localStorage.getItem("sb_token");
    if (!tok) return;
    api.getMyBids?.()
      .then((d: any) => {
        const bids = (d?.bids || []).filter((b: any) =>
          b?.status === "PENDING" || b?.status === "ACCEPTED" || b?.status === "COUNTER"
        );
        // Sort newest first + cap to 3 — most recent surface as a rail
        bids.sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
        setPendingBids(bids.slice(0, 3));
      })
      .catch(() => setPendingBids([]));
  }, [hydrated]);

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

  // v433 — filter option sets derived from the fetched hotels.
  const priceBounds = useMemo(() => {
    const ps = enrichedHotels
      .map((h: any) => h._minPrice)
      .filter((n: any) => Number.isFinite(n)) as number[];
    if (!ps.length) return null;
    const lo = Math.floor(Math.min(...ps) / 100) * 100;
    const hi = Math.ceil(Math.max(...ps) / 100) * 100;
    return hi > lo ? { lo, hi } : null;
  }, [enrichedHotels]);
  const propTypeOpts = useMemo(() => {
    const s = new Set<string>();
    hotels.forEach((h: any) => { if (h.property_type) s.add(String(h.property_type)); });
    return Array.from(s).slice(0, 8);
  }, [hotels]);
  const amenityOpts = useMemo(() => {
    const freq = new Map<string, number>();
    hotels.forEach((h: any) => {
      (Array.isArray(h.amenities) ? h.amenities : []).forEach((a: string) => {
        if (a) freq.set(a, (freq.get(a) || 0) + 1);
      });
    });
    return Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map((e) => e[0]);
  }, [hotels]);

  const filteredHotels = useMemo(() => {
    let list = enrichedHotels;
    // v535 — launch zone refine: keep only hotels whose city is in the picked
    // zone. "" = all zones (no-op). Case-insensitive city match.
    if (zone) {
      const z = LAUNCH_ZONES.find((zz) => zz.id === zone);
      if (z) {
        const cityset = new Set(z.cities);
        list = list.filter((h: any) => cityset.has(String(h.city || "").trim().toLowerCase()));
      }
    }
    if (selectedStars.size > 0) {
      list = list.filter((h: any) => selectedStars.has(Number(h.starRating) || 0));
    }
    if (priceMax != null) {
      list = list.filter((h: any) => h._minPrice != null && h._minPrice <= priceMax);
    }
    if (minScore > 0) {
      list = list.filter((h: any) => (Number(h.avgRating) || 0) >= minScore);
    }
    if (propTypes.size > 0) {
      list = list.filter((h: any) => h.property_type && propTypes.has(String(h.property_type)));
    }
    if (amenitySel.size > 0) {
      list = list.filter((h: any) => {
        const set = new Set(Array.isArray(h.amenities) ? h.amenities : []);
        let ok = true;
        amenitySel.forEach((a) => { if (!set.has(a)) ok = false; });
        return ok;
      });
    }
    return list;
  }, [enrichedHotels, zone, selectedStars, priceMax, minScore, propTypes, amenitySel]);

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

  const filtersActive = sortBy !== "default" || selectedStars.size > 0
    || priceMax != null || minScore > 0 || propTypes.size > 0 || amenitySel.size > 0;
  const inSearchMode = !!debouncedSearch.trim() || filtersActive;

  // v159.8 — Search summary shown inside the trigger button.
  const totalGuests = searchAdults + searchChildren + searchKids;
  const fmtShort = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    } catch { return iso; }
  };
  const searchSummary = (() => {
    const parts: string[] = [];
    if (city) parts.push(city);
    if (searchCheckIn && searchCheckOut) {
      parts.push(`${fmtShort(searchCheckIn)} – ${fmtShort(searchCheckOut)}`);
    }
    if (totalGuests !== 2) parts.push(`${totalGuests} guest${totalGuests !== 1 ? "s" : ""}`);
    return parts.length ? parts.join(" · ") : "Where to next? Search city or hotel…";
  })();

  // Build search URL params so card taps carry dates+guests to /hotels/[id].
  const searchUrlParams = (() => {
    const p = new URLSearchParams();
    if (searchCheckIn)  p.set("checkIn",  searchCheckIn);
    if (searchCheckOut) p.set("checkOut", searchCheckOut);
    if (searchAdults !== 2)   p.set("adults",   String(searchAdults));
    if (searchChildren !== 0) p.set("children", String(searchChildren));
    if (searchKids !== 0)     p.set("kids",     String(searchKids));
    const s = p.toString();
    return s ? `?${s}` : "";
  })();
  const toggleStar = (s: number) => {
    setSelectedStars((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };
  const resetFilters = () => {
    setSortBy("default"); setSelectedStars(new Set());
    setPriceMax(null); setMinScore(0); setPropTypes(new Set()); setAmenitySel(new Set());
  };
  const toggleInSet = (setter: Dispatch<SetStateAction<Set<string>>>, v: string) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v); else next.add(v);
      return next;
    });
  };

  // ───────────────────────── Rails ─────────────────────────
  // We always build from `filteredHotels` so star-filter is honoured.
  // (sort doesn't change rail composition — each rail has its own sort.)
  type Rail = { key: string; title: string; icon?: string; eyebrow?: string; items: any[]; compact?: boolean };

  const rails: Rail[] = useMemo(() => {
    if (!filteredHotels.length) return [];
    const out: Rail[] = [];

    // 1. Recently viewed — by stored ID order. v159.8: fallback to a
    //    deterministic "Trending nearby" rail (top-rated hotels) when
    //    there's no stored history yet so this rail always shows
    //    SOMETHING instead of disappearing.
    if (recentIds.length) {
      const map = new Map(filteredHotels.map((h: any) => [String(h.id), h]));
      const items = recentIds.map((id) => map.get(String(id))).filter(Boolean);
      // v159.9 — compact half-height tiles (Airbnb "Recently viewed" pattern)
      if (items.length) out.push({ key: "recent", title: "Recently viewed", icon: "🕘", items, compact: true });
    } else {
      const seeded = [...filteredHotels]
        .sort((a: any, b: any) => (Number(b.avgRating) || 0) - (Number(a.avgRating) || 0))
        .slice(0, 8);
      if (seeded.length >= 3) {
        out.push({
          key: "trending-nearby",
          title: "Trending nearby",
          icon: "✨",
          eyebrow: "Picks the community is loving right now",
          items: seeded,
          compact: true,
        });
      }
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

    // 4b. Explore India — new demand-cycle destinations (Goa, Kerala, Udaipur,
    //     Leh, … + satellites). Every new city has one flagship hotel, so a
    //     per-city rail (≥2) would never form; this compact rail surfaces one
    //     card per new city (hubs first) so the national inventory is
    //     discoverable. Only on the "All" view.
    if (!city) {
      const seenCity = new Set<string>();
      const byCity: Record<string, any> = {};
      filteredHotels.forEach((h: any) => {
        const k = String(h.city || "").toLowerCase();
        if (NEW_DEST_SET.has(k) && !byCity[k]) byCity[k] = h;
      });
      const exploreItems = NEW_DEST_ORDER
        .map((k) => byCity[k])
        .filter((h) => {
          if (!h) return false;
          const k = String(h.city || "").toLowerCase();
          if (seenCity.has(k)) return false;
          seenCity.add(k);
          return true;
        });
      if (exploreItems.length >= 3) {
        out.push({
          key: "explore-india",
          title: "Explore India · New destinations",
          icon: "🧭",
          eyebrow: "Beaches, deserts, backwaters & high Himalaya — bookable all year",
          items: exploreItems,
        });
      }
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
      // v397 — threshold lowered 2→1 so EVERY city with inventory gets its own
      // "Stay in {city}" rail (the new demand-cycle hubs + satellites each have
      // one flagship hotel, so ≥2 hid them entirely from the city rails).
      const ordered = Object.entries(cityBuckets)
        .sort(([, a], [, b]) => b.length - a.length)
        .filter(([k, v]) => k !== "Other" && v.length >= 1);
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

      {/* v160 — Unified premium control bar. Centered (not full-bleed):
          [📍 Location ▾] · [ 🔍 Search ] · [⚙ Filter ▾]. Location opens the
          globe picker; Filter opens a sort + star-rating popover. */}
      <div className="hxr-sticky">
        <div className="hxr-sticky-inner">
          <div className="sb-cbar-wrap">
            <div className="sb-cbar">
              {/* Location — 3D button, opens globe picker */}
              <button
                type="button"
                className="sb-cbar-loc"
                data-autonext-self="hotels-results"
                onClick={() => setLocOpen(true)}
                aria-label="Change location"
              >
                <span className="sb-cbar-loc-pin" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2c-3.87 0-7 3.13-7 7 0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
                  </svg>
                </span>
                <span className="sb-cbar-loc-txt">{city || "All"}</span>
                <span className="sb-cbar-loc-caret" aria-hidden="true">▾</span>
              </button>

              {/* Search — center, taps open the zoom-in search sheet */}
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="sb-cbar-search"
                aria-label="Open search"
              >
                <svg className="sb-cbar-search-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                </svg>
                <span className={`sb-cbar-search-txt ${(city || searchCheckIn || totalGuests !== 2) ? "is-set" : ""}`}>
                  {searchSummary}
                </span>
                <span className="sb-cbar-search-kbd" aria-hidden="true">⌕</span>
              </button>

              {/* Filter — 3D button, opens sort + star popover */}
              <button
                type="button"
                className={`sb-cbar-filter ${filtersActive ? "is-active" : ""}`}
                onClick={() => setFilterOpen((o) => !o)}
                aria-label="Sort and filter"
                aria-expanded={filterOpen}
              >
                <svg className="sb-cbar-filter-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" d="M4 6h16M7 12h10M10 18h4" />
                </svg>
                <span className="sb-cbar-filter-lbl">Filter</span>
                {((sortBy !== "default" ? 1 : 0) + selectedStars.size) > 0 && (
                  <span className="sb-cbar-filter-badge">
                    {(sortBy !== "default" ? 1 : 0) + selectedStars.size}
                  </span>
                )}
              </button>
            </div>

            {/* Filter popover — sort options + star toggles */}
            {filterOpen && (
              <>
                <div className="sb-cbar-scrim" onClick={() => setFilterOpen(false)} />
                <div className="sb-cbar-pop" role="dialog" aria-label="Sort and filter">
                  <div className="sb-cbar-pop-grp">
                    <p className="sb-cbar-pop-h">Sort by</p>
                    <div className="sb-cbar-pop-opts">
                      {SORT_OPTS.map((o) => (
                        <button
                          key={o.v}
                          type="button"
                          className={`sb-cbar-pop-opt ${sortBy === o.v ? "is-on" : ""}`}
                          onClick={() => setSortBy(o.v)}
                        >
                          <span>{o.label}</span>
                          {sortBy === o.v && <span aria-hidden="true">✓</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="sb-cbar-pop-grp">
                    <p className="sb-cbar-pop-h">Star rating</p>
                    <div className="sb-cbar-pop-stars">
                      {[5, 4, 3].map((s) => (
                        <button
                          key={s}
                          type="button"
                          className={`sb-cbar-pop-star ${selectedStars.has(s) ? "is-on" : ""}`}
                          onClick={() => toggleStar(s)}
                          aria-pressed={selectedStars.has(s)}
                        >
                          {s} ★
                        </button>
                      ))}
                    </div>
                  </div>
                  {priceBounds && (
                    <div className="sb-cbar-pop-grp">
                      <p className="sb-cbar-pop-h">
                        Price / night
                        <span className="sb-cbar-pop-hval">
                          {priceMax == null ? "Any" : `up to ₹${priceMax.toLocaleString("en-IN")}`}
                        </span>
                      </p>
                      <input
                        type="range"
                        className="sb-cbar-pop-range"
                        min={priceBounds.lo}
                        max={priceBounds.hi}
                        step={100}
                        value={priceMax ?? priceBounds.hi}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setPriceMax(v >= priceBounds.hi ? null : v);
                        }}
                        aria-label="Maximum price per night"
                      />
                      <div className="sb-cbar-pop-rangeends">
                        <span>₹{priceBounds.lo.toLocaleString("en-IN")}</span>
                        <span>₹{priceBounds.hi.toLocaleString("en-IN")}+</span>
                      </div>
                    </div>
                  )}
                  <div className="sb-cbar-pop-grp">
                    <p className="sb-cbar-pop-h">Guest rating</p>
                    <div className="sb-cbar-pop-stars">
                      {[{ v: 0, l: "Any" }, { v: 4, l: "4.0+" }, { v: 4.5, l: "4.5+" }].map((o) => (
                        <button
                          key={o.v}
                          type="button"
                          className={`sb-cbar-pop-star ${minScore === o.v ? "is-on" : ""}`}
                          onClick={() => setMinScore(o.v)}
                          aria-pressed={minScore === o.v}
                        >
                          {o.l}
                        </button>
                      ))}
                    </div>
                  </div>
                  {propTypeOpts.length > 0 && (
                    <div className="sb-cbar-pop-grp">
                      <p className="sb-cbar-pop-h">Property type</p>
                      <div className="sb-cbar-pop-chips">
                        {propTypeOpts.map((t) => (
                          <button
                            key={t}
                            type="button"
                            className={`sb-cbar-pop-chip ${propTypes.has(t) ? "is-on" : ""}`}
                            onClick={() => toggleInSet(setPropTypes, t)}
                            aria-pressed={propTypes.has(t)}
                          >
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {amenityOpts.length > 0 && (
                    <div className="sb-cbar-pop-grp">
                      <p className="sb-cbar-pop-h">Amenities</p>
                      <div className="sb-cbar-pop-chips">
                        {amenityOpts.map((a) => (
                          <button
                            key={a}
                            type="button"
                            className={`sb-cbar-pop-chip ${amenitySel.has(a) ? "is-on" : ""}`}
                            onClick={() => toggleInSet(setAmenitySel, a)}
                            aria-pressed={amenitySel.has(a)}
                          >
                            {a}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {filtersActive && (
                    <button type="button" className="sb-cbar-pop-reset" onClick={resetFilters}>
                      ✕ Reset all
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* v392/v513 — 12-month demand cycle: this month's peak destinations.
          Slim single-line trending row BELOW the search bar (Airbnb-style) so
          it never pushes the content down. Every city is bookable all year;
          this only highlights where demand peaks. */}
      <DemandCycleStrip
        activeCity={city}
        onPick={(c) => {
          setZone("");
          setCity(c);
          try { localStorage.setItem("sb_city", c); } catch {}
        }}
      />

      {/* v535 — launch zone/region chips. A curated set of regions (Garhwal,
          Himachal, Rajasthan, Kumaon, South & Coastal, Leh–Ladakh). "All zones"
          shows everything; a zone scopes both the rails and the grid to that
          region's cities. Client-side refine only — no API change. Picking a
          zone clears any single-city filter so the whole region shows. */}
      {zonesOn && !debouncedSearch && (
        <div className="hxr-zonebar" role="tablist" aria-label="Explore by region">
          <div className="hxr-zonebar-scroll">
            <button
              type="button"
              role="tab"
              aria-selected={!zone}
              className={`hxr-zone-chip ${!zone ? "is-on" : ""}`}
              onClick={() => setZone("")}
            >
              🗺️ All zones
            </button>
            {LAUNCH_ZONES.map((z) => (
              <button
                key={z.id}
                type="button"
                role="tab"
                aria-selected={zone === z.id}
                className={`hxr-zone-chip ${zone === z.id ? "is-on" : ""}`}
                onClick={() => {
                  setZone(z.id);
                  // A zone spans multiple cities → drop the single-city fetch
                  // filter so the whole region is available to refine client-side.
                  if (city) {
                    setCity("");
                    try { localStorage.removeItem("sb_city"); } catch {}
                  }
                }}
              >
                {z.label}
              </button>
            ))}
          </div>
        </div>
      )}

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
              <p className="hxr-error-title">Couldn't reach the server</p>
              <p className="hxr-error-body">{apiError}</p>
              <button onClick={() => fetchHotels(city ? { city } : {})} className="hxr-error-btn">
                Try again
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

        {/* v159.10 — Pending bookings, Airbnb-style. Single big card per
            row, text on left + thumbnail with slight peek-overflow on
            right. Multi-card variant becomes a horizontal scroller. */}
        {!loading && !apiError && pendingBids.length > 0 && (
          <div className="hxr-pending">
            <div className="hxr-pending-scroller">
              {pendingBids.map((bid: any) => {
                const hotelName = bid?.hotel?.name || "Your hotel";
                const hotelCity = bid?.hotel?.city || "";
                const hotelImg  = bid?.hotel?.images?.[0] || "";
                const statusLine = bid.status === "ACCEPTED"
                  ? "Complete your payment"
                  : bid.status === "COUNTER"
                    ? "Hotel countered · review offer"
                    : "Continue your booking";
                const subtitle = (bid?.request?.checkIn && bid?.request?.checkOut)
                  ? `${fmtShort(bid.request.checkIn)} – ${fmtShort(bid.request.checkOut)}${bid?.request?.guests ? ` · ${bid.request.guests} guest${bid.request.guests !== 1 ? "s" : ""}` : ""}`
                  : (hotelCity ? `Stay in ${hotelCity}` : "");
                return (
                  <Link
                    key={bid.id}
                    href={`/my-bids#${bid.id}`}
                    className="hxr-pending-card"
                  >
                    <div className="hxr-pending-text">
                      <h3 className="hxr-pending-title">{statusLine} for {hotelName}</h3>
                      {subtitle && (
                        <p className="hxr-pending-meta">
                          {subtitle}
                          <span className="hxr-pending-arrow" aria-hidden="true"> ›</span>
                        </p>
                      )}
                    </div>
                    <div className="hxr-pending-imgwrap" aria-hidden="true">
                      {hotelImg ? (
                        <img src={sbImage(hotelImg, SB_IMG_CARD)} alt="" className="hxr-pending-img" loading="lazy" />
                      ) : (
                        <div className="hxr-pending-img hxr-pending-img-fallback">🏨</div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
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
                searchUrlParams={searchUrlParams}
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
                <CardLink key={h.id} h={h} variant="grid" onHeart={handleHeartTap} savedSet={savedSet} searchUrlParams={searchUrlParams} />
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
                <CardLink key={h.id} h={h} variant="grid" onHeart={handleHeartTap} savedSet={savedSet} searchUrlParams={searchUrlParams} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* v520 — shared StaySearchSheet (Airbnb-style Where/When/Who). Same
          component powers /flash-deals (with check-in locked to today). */}
      <StaySearchSheet
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        hotels={hotels}
        city={city}
        setCity={setCity}
        search={search}
        setSearch={setSearch}
        checkIn={searchCheckIn}
        setCheckIn={setSearchCheckIn}
        checkOut={searchCheckOut}
        setCheckOut={setSearchCheckOut}
        adults={searchAdults}
        setAdults={setSearchAdults}
        childrenCount={searchChildren}
        setChildren={setSearchChildren}
        kids={searchKids}
        setKids={setSearchKids}
        searchUrlParams={searchUrlParams}
      />


      {/* v160 — Location globe picker, opened by the control-bar location
          button. Writes sb_city + fires sb:city-change, which the
          applyCity listener above reflects into `city` state. */}
      {locOpen && (
        <LocationGlobeModal activeCity={city} onClose={() => setLocOpen(false)} />
      )}
    </div>
  );
}

// ───────── Rail wrapper with title + horizontal-scroll list ─────────
function RailSection({
  rail,
  onHeart,
  savedSet,
  searchUrlParams,
}: {
  rail: { key: string; title: string; icon?: string; eyebrow?: string; items: any[]; compact?: boolean };
  onHeart: (e: React.MouseEvent, h: any) => void;
  savedSet: Set<string>;
  searchUrlParams?: string;
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
    <section className={`hxr-rail-section ${rail.compact ? "hxr-rail-compact" : ""}`}>
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
          <CardLink
            key={`${rail.key}-${h.id}`}
            h={h}
            variant="rail"
            onHeart={onHeart}
            savedSet={savedSet}
            searchUrlParams={searchUrlParams}
            compact={rail.compact}
          />
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
  searchUrlParams,
  compact,
}: {
  h: any;
  variant: "rail" | "grid";
  onHeart: (e: React.MouseEvent, h: any) => void;
  savedSet: Set<string>;
  searchUrlParams?: string;
  compact?: boolean;
}) {
  const { minPrice, showFlash } = h._minPrice !== undefined
    ? { minPrice: h._minPrice, showFlash: h._showFlash }
    : minPriceFor(h);
  const area = getHotelArea(h.city, h.lat, h.lng);
  const isSaved = savedSet.has(String(h.id));
  const competitorMin = h.competitor_min || h.competitorMin;
  const beatsMarket = competitorMin && minPrice && competitorMin > minPrice;
  const belowPct = beatsMarket ? Math.round((1 - minPrice / competitorMin) * 100) : 0;
  const reviewsCount = Number(h.totalReviews || 0);
  const guestFavorite = (Number(h.avgRating) || 0) >= 4.6 && (Number(h.totalReviews) || 0) >= 10;

  return (
    <Link
      role="listitem"
      href={`/hotels/${h.id}${searchUrlParams || ""}`}
      className={`hxr-card ${variant === "rail" ? "hxr-card-rail" : "hxr-card-grid"} ${compact ? "hxr-card-compact" : ""}`}
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
            <span className="hxr-card-rating">
              <span className="hxr-card-rating-star">★</span>{Number(h.avgRating).toFixed(1)}
              {reviewsCount > 0 && <span className="hxr-card-rating-count">({reviewsCount})</span>}
            </span>
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
        {!compact && beatsMarket && belowPct >= 5 && (
          <span className="hxr-card-below">▼ {belowPct}% below market</span>
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
              <div className="sb-cbar-wrap">
                <div className="sb-cbar">
                  <span className="sb-cbar-loc">
                    <span className="sb-cbar-loc-pin" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2c-3.87 0-7 3.13-7 7 0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
                      </svg>
                    </span>
                    <span className="sb-cbar-loc-txt">All</span>
                  </span>
                  <span className="sb-cbar-search">
                    <svg className="sb-cbar-search-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                    </svg>
                    <span className="sb-cbar-search-txt">Where to next? Search city or hotel…</span>
                  </span>
                  <span className="sb-cbar-filter">
                    <svg className="sb-cbar-filter-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" d="M4 6h16M7 12h10M10 18h4" />
                    </svg>
                    <span className="sb-cbar-filter-lbl">Filter</span>
                  </span>
                </div>
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
