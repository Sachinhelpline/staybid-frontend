"use client";
/* ──────────────────────────────────────────────────────────────────────
   StaySearchSheet — the shared "Find your stay" search modal.

   Airbnb-style Where / When / Who parallel tabs + a single full-width editor
   panel (v518). Extracted from app/hotels/page.tsx so /hotels AND /flash-deals
   render the EXACT same search experience — no drift.

   Flash-deals passes `lockCheckInToday` → the calendar's check-in is locked to
   today (flash deals start same-day) while the checkout stays freely
   selectable (a flash stay can still span multiple nights).

   Styling is 100% the global `hxr-*` classes in app/globals.css, so both
   surfaces look pixel-identical for free.
   ────────────────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import LuxuryCalendar from "@/components/LuxuryCalendar";
import { getHotelArea } from "@/lib/areas";
import { sbImage, SB_IMG_CARD } from "@/lib/sb-image";
import { cityPills } from "@/lib/cities";
import { currentMonthDemand } from "@/lib/circle/demand-cycle";

const CITY_PILLS = cityPills();

function isoToday(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export default function StaySearchSheet({
  open,
  onClose,
  hotels,
  city, setCity,
  search, setSearch,
  checkIn, setCheckIn,
  checkOut, setCheckOut,
  adults, setAdults,
  childrenCount, setChildren,
  kids, setKids,
  searchUrlParams = "",
  lockCheckInToday = false,
  title = "Find your stay",
}: {
  open: boolean;
  onClose: () => void;
  hotels: any[];
  city: string; setCity: (c: string) => void;
  search: string; setSearch: (s: string) => void;
  checkIn: string; setCheckIn: (s: string) => void;
  checkOut: string; setCheckOut: (s: string) => void;
  adults: number; setAdults: (n: number) => void;
  childrenCount: number; setChildren: (n: number) => void;
  kids: number; setKids: (n: number) => void;
  searchUrlParams?: string;
  lockCheckInToday?: boolean;
  title?: string;
}) {
  const [openStep, setOpenStep] = useState<"where" | "when" | "who" | null>("where");
  const [showAllCities, setShowAllCities] = useState(false);
  const today = useMemo(() => isoToday(), []);

  // Curated "Trending this month" destinations (real demand-cycle data mapped
  // to the canonical city pills), so the default Where view is a short list.
  const trending = useMemo(() => {
    try {
      const row = currentMonthDemand();
      const keys = [...(row.primary || []), ...(row.secondary || [])];
      const seen = new Set<string>();
      const pills: typeof CITY_PILLS = [];
      keys.forEach((k) => {
        const kk = String(k).toLowerCase();
        if (seen.has(kk)) return;
        seen.add(kk);
        const pill = CITY_PILLS.find((p) => p.key.toLowerCase() === kk);
        if (pill) pills.push(pill);
      });
      return { month: row.long as string, pills: pills.slice(0, 10) };
    } catch {
      return { month: "", pills: [] as typeof CITY_PILLS };
    }
  }, []);

  // Re-open calm (Where step, collapsed list) each time. When check-in is
  // locked (flash deals) force it to today so the calendar opens on checkout.
  useEffect(() => {
    if (!open) return;
    setOpenStep("where");
    setShowAllCities(false);
    if (lockCheckInToday && checkIn !== today) setCheckIn(today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const totalGuests = adults + childrenCount + kids;

  return (
    <div
      className="hxr-sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Search filters"
      onClick={onClose}
    >
      <div className="hxr-sheet" onClick={(e) => e.stopPropagation()}>
        <header className="hxr-sheet-head">
          <h2 className="hxr-sheet-title">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="hxr-sheet-close"
            aria-label="Close search"
          >×</button>
        </header>

        <div className="hxr-sheet-body hxr-steps">
          {/* 3 parallel tabs + a single full-width editor panel below. */}
          <div className="hxr-step-tabs" role="tablist" aria-label="Search steps">
            <button
              type="button"
              role="tab"
              aria-selected={openStep === "where"}
              className={`hxr-tab${openStep === "where" ? " is-open" : ""}`}
              onClick={() => setOpenStep(openStep === "where" ? null : "where")}
            >
              <span className="hxr-tab-lbl">Where</span>
              <span className={`hxr-tab-val${(search.trim() || city) ? " is-set" : ""}`}>
                {search.trim() ? `“${search.trim()}”` : (city || "Anywhere")}
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={openStep === "when"}
              className={`hxr-tab${openStep === "when" ? " is-open" : ""}`}
              onClick={() => setOpenStep(openStep === "when" ? null : "when")}
            >
              <span className="hxr-tab-lbl">When</span>
              <span className={`hxr-tab-val${checkIn ? " is-set" : ""}`}>
                {checkIn && checkOut
                  ? `${new Date(checkIn).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${new Date(checkOut).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
                  : checkIn
                    ? new Date(checkIn).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
                    : (lockCheckInToday ? "Today" : "Any dates")}
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={openStep === "who"}
              className={`hxr-tab${openStep === "who" ? " is-open" : ""}`}
              onClick={() => setOpenStep(openStep === "who" ? null : "who")}
            >
              <span className="hxr-tab-lbl">Who</span>
              <span className={`hxr-tab-val${totalGuests > 0 ? " is-set" : ""}`}>
                {totalGuests > 0 ? `${totalGuests} guest${totalGuests === 1 ? "" : "s"}` : "Add guests"}
              </span>
            </button>
          </div>

          {openStep && (
            <div className="hxr-step-panel">
              {/* ── WHERE ── */}
              {openStep === "where" && (
              <div className="hxr-panel">
                <div className="hxr-sheet-search">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                  </svg>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search city or hotel name…"
                    type="search"
                    autoComplete="off"
                    autoFocus
                    aria-label="Search hotels"
                  />
                  {search && (
                    <button type="button" onClick={() => setSearch("")} aria-label="Clear search">✕</button>
                  )}
                </div>
                {search.trim().length >= 1 ? (
                  (() => {
                    const q = search.trim().toLowerCase();
                    const matches = (hotels || [])
                      .filter((h: any) => {
                        const name = String(h?.name || "").toLowerCase();
                        const hcity = String(h?.city || "").toLowerCase();
                        const area = getHotelArea(h?.city, h?.lat, h?.lng) || "";
                        return name.includes(q) || hcity.includes(q) || area.toLowerCase().includes(q);
                      })
                      .slice(0, 5);
                    if (!matches.length) {
                      return (
                        <p className="hxr-sheet-empty">
                          No hotels match “{search}”. Try a different name or city.
                        </p>
                      );
                    }
                    return (
                      <ul className="hxr-sheet-suggest" role="list">
                        {matches.map((h: any) => {
                          const img = h.images?.[0];
                          const area = getHotelArea(h.city, h.lat, h.lng);
                          return (
                            <li key={h.id} role="listitem">
                              <Link
                                href={`/hotels/${h.id}${searchUrlParams || ""}`}
                                onClick={onClose}
                                className="hxr-sheet-suggest-row"
                              >
                                {img ? (
                                  <img src={sbImage(img, SB_IMG_CARD)} alt="" className="hxr-sheet-suggest-img" loading="lazy" />
                                ) : (
                                  <span className="hxr-sheet-suggest-img hxr-sheet-suggest-img-fallback" aria-hidden="true">🏨</span>
                                )}
                                <span className="hxr-sheet-suggest-text">
                                  <span className="hxr-sheet-suggest-name">{h.name}</span>
                                  <span className="hxr-sheet-suggest-meta">
                                    📍 {area ? `${area}, ` : ""}{h.city}
                                  </span>
                                </span>
                                <span className="hxr-sheet-suggest-arrow" aria-hidden="true">›</span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    );
                  })()
                ) : (
                  <div className="hxr-where-picks">
                    <p className="hxr-step-hint">
                      {showAllCities
                        ? "All destinations"
                        : (trending.pills.length ? `🔥 Trending in ${trending.month}` : "Popular destinations")}
                    </p>
                    <div className="hxr-sheet-cities">
                      <button
                        type="button"
                        className={`hxr-sheet-city${city === "" ? " hxr-sheet-city-active" : ""}`}
                        aria-pressed={city === ""}
                        onClick={() => {
                          setCity("");
                          try { localStorage.setItem("sb_city", ""); } catch {}
                          setOpenStep("when");
                        }}
                      >
                        <span aria-hidden="true">🌏</span>
                        <span>Anywhere</span>
                      </button>
                      {(showAllCities ? CITY_PILLS.filter((p) => p.key) : trending.pills).map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          className={`hxr-sheet-city${c.key === city ? " hxr-sheet-city-active" : ""}`}
                          aria-pressed={c.key === city}
                          onClick={() => {
                            setCity(c.key);
                            try { localStorage.setItem("sb_city", c.key); } catch {}
                            setOpenStep("when");
                          }}
                        >
                          <span aria-hidden="true">{c.icon}</span>
                          <span>{c.label}</span>
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="hxr-step-more"
                      onClick={() => setShowAllCities((v) => !v)}
                    >
                      {showAllCities ? "↑ Show less" : "Show all cities →"}
                    </button>
                  </div>
                )}
              </div>
              )}

              {/* ── WHEN ── (inline pricing calendar; flash deals lock check-in) */}
              {openStep === "when" && (
              <div className="hxr-panel hxr-step-cal">
                <LuxuryCalendar
                  inline
                  open
                  mode={lockCheckInToday ? "checkOut" : "checkIn"}
                  minCheckIn={lockCheckInToday ? today : undefined}
                  checkIn={checkIn}
                  checkOut={checkOut}
                  rooms={[]}
                  city={city || "Mussoorie"}
                  pricingMode="demand"
                  headerBanner={lockCheckInToday ? (
                    <div className="hxr-cal-lock">
                      ⚡ Flash deals start <strong>today</strong> — check-in is locked to today. Pick your checkout date.
                    </div>
                  ) : undefined}
                  onApply={({ checkIn: ci, checkOut: co }) => {
                    setCheckIn(ci);
                    setCheckOut(co);
                    if (ci && co) setOpenStep("who");
                  }}
                  onClose={() => {}}
                />
              </div>
              )}

              {/* ── WHO ── */}
              {openStep === "who" && (
              <div className="hxr-panel">
                <div className="hxr-sheet-guests">
                  <GuestRow
                    label="Adults"
                    sub="Ages 12+"
                    value={adults}
                    min={1}
                    max={8}
                    onChange={setAdults}
                  />
                  <GuestRow
                    label="Children"
                    sub="Ages 5–12 · +₹200/night"
                    value={childrenCount}
                    min={0}
                    max={6}
                    onChange={setChildren}
                  />
                  <GuestRow
                    label="Kids"
                    sub="Under 5 · FREE"
                    value={kids}
                    min={0}
                    max={6}
                    onChange={setKids}
                  />
                </div>
              </div>
              )}
            </div>
          )}
        </div>

        <footer className="hxr-sheet-foot">
          <button
            type="button"
            className="hxr-sheet-clear"
            onClick={() => {
              setSearch("");
              setCity("");
              setCheckIn(lockCheckInToday ? today : "");
              setCheckOut("");
              setAdults(2);
              setChildren(0);
              setKids(0);
              try { localStorage.setItem("sb_city", ""); } catch {}
            }}
          >Clear all</button>
          <button
            type="button"
            className="hxr-sheet-apply"
            onClick={onClose}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            Search
          </button>
        </footer>
      </div>
    </div>
  );
}

// ───────── Guest counter row inside StaySearchSheet ─────────
function GuestRow({
  label, sub, value, min, max, onChange,
}: {
  label: string;
  sub: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="hxr-guest-row">
      <div className="hxr-guest-text">
        <p className="hxr-guest-label">{label}</p>
        <p className="hxr-guest-sub">{sub}</p>
      </div>
      <div className="hxr-guest-stepper">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={`Decrease ${label}`}
        >−</button>
        <span className="hxr-guest-value">{value}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={`Increase ${label}`}
        >+</button>
      </div>
    </div>
  );
}
