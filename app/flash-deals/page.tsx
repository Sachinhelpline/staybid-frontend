"use client";
import { useState, useEffect, useMemo, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { getHotelArea } from "@/lib/areas";
import ModalCloseButton from "@/components/ModalCloseButton";
import HotelScoreBadge from "@/components/hotel/HotelScoreBadge";
// v129 — every flash-deal price is a ₹100 multiple. Same rule as the
// Negotiate slider, /bid presets, and partner counter slider.
import { snap100 } from "@/lib/price-snap";
// v139 — Phase-3 flash deals spotlight tour (3 steps: ticker → card → CTA).
import { usePageTour } from "@/lib/tutorial/usePageTour";
// v143 — flash-drawer modal tour triggered on card tap.
import { useTutorial } from "@/lib/tutorial/tutorial-store";

/* ─────────────────────────────────────────────────────────────────
   Flash Deals · v52 — Live · Ultra-premium
   One deal per hotel · upgrade-room picker · live availability
   ───────────────────────────────────────────────────────────────── */

type Upgrade = {
  roomId: string;
  type: string;
  capacity: number;
  floorPrice: number;
  dealPrice: number;
  extraPerNight: number;
  unitsFree: number;
  available: boolean;
  amenities?: string[];
  images?: string[];
};

type Deal = {
  id: string;
  hotelId: string;
  roomId: string;
  city: string;
  aiPrice: number;
  floorPrice: number;
  discount: number;
  validUntil?: string;
  maxBookings: number;
  bookingCount: number;
  hotel?: any;
  room?: any;
  unitsFree: number;
  unitsTotal: number;
  upgrades: Upgrade[];
  roomTypesAvailable: number;
  _synthetic?: boolean;
};

/* Format helpers ----------------------------------------------------------- */
// v129 — every rendered price snaps to a ₹100 multiple at the formatter so
// extra-per-night chips, headline rates, and the modal's room ladder all read
// from one source of truth. The underlying deal record is left untouched —
// only the display + click-through URLs use the snapped value.
const fmtINR = (n: number) =>
  "₹" + snap100(n).toLocaleString("en-IN");
const pad2 = (n: number) => String(n).padStart(2, "0");

/* Animated number that counts up smoothly ----------------------------------- */
function CountUp({ value, duration = 900 }: { value: number; duration?: number }) {
  const [v, setV] = useState(0);
  const startRef = useRef<number>(0);
  const fromRef = useRef<number>(0);
  useEffect(() => {
    fromRef.current = v;
    startRef.current = performance.now();
    let raf: number;
    const tick = (t: number) => {
      const p = Math.min(1, (t - startRef.current) / duration);
      const ease = 1 - Math.pow(1 - p, 3);
      setV(Math.round(fromRef.current + (value - fromRef.current) * ease));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);
  return <>{v.toLocaleString("en-IN")}</>;
}

/* Circular countdown ring — v159.9: 52 → 38 px, slimmer 2.4 stroke. */
function CountdownRing({ pctRemaining, urgent }: { pctRemaining: number; urgent: boolean }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  const dash = (pctRemaining / 100) * c;
  return (
    <svg width="38" height="38" viewBox="0 0 38 38" style={{ flexShrink: 0 }}>
      <circle cx="19" cy="19" r={r} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="2.4" />
      <circle
        cx="19" cy="19" r={r} fill="none"
        stroke={urgent ? "#ff3859" : "#f0b429"}
        strokeWidth="2.4" strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        transform="rotate(-90 19 19)"
        style={{ transition: "stroke-dasharray 700ms cubic-bezier(.4,.0,.2,1)", filter: urgent ? "drop-shadow(0 0 5px #ff3859)" : "drop-shadow(0 0 5px #f0b429)" }}
      />
    </svg>
  );
}

/* v159.7 — Real-timer digit cell. v159.9 — Simplified to key-based
   animation: when value prop changes, React unmounts the old span and
   mounts a fresh .td-anim element with the new value. The new element
   rolls UP from below into place. No dual-render stack, no risk of
   "double separator" artifacts on rapid ticks, no stale state. */
function TimerDigit({ value }: { value: number | string }) {
  const v = String(value);
  return (
    <span className="td-cell">
      <span className="td-anim" key={v}>{v}</span>
    </span>
  );
}

/* Convenience — render "HH:MM:SS" with each digit animated. */
function TimerDigits({ hrs, mins, secs }: { hrs: number; mins: number; secs: number }) {
  const hh = pad2(hrs);
  const mm = pad2(mins);
  const ss = pad2(secs);
  return (
    <>
      <TimerDigit value={hh[0]} />
      <TimerDigit value={hh[1]} />
      <span className="td-sep">:</span>
      <TimerDigit value={mm[0]} />
      <TimerDigit value={mm[1]} />
      <span className="td-sep">:</span>
      <TimerDigit value={ss[0]} />
      <TimerDigit value={ss[1]} />
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function FlashDealsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [deals, setDeals]     = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  // v139 — Tutorial Layer 2 — flash deals tour. Delay 1100ms so the
  // ticker animates in + at least one .fd-card renders before fire.
  usePageTour("flash", "flash", { delayMs: 1100 });
  // v143 — fires when a deal card opens its drawer (see onOpen below).
  const { triggerTour } = useTutorial();
  const [city, setCity]       = useState(searchParams.get("city") || "");
  const [now, setNow]         = useState(Date.now());
  const [openId, setOpenId]   = useState<string | null>(null);
  const [pickedUpgrade, setPickedUpgrade] = useState<Record<string, string>>({}); // dealId → roomId
  const [hydrated, setHydrated] = useState(false);

  // 1-second tick (countdown)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Sync with global LocationChip — picker writes `sb_city` and fires
  // `sb:city-change`. Hydrate BEFORE the first fetch to avoid a race.
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

  // Fetch + 30s live refresh
  useEffect(() => {
    if (!hydrated) return;
    setLoading(true);
    api.getFlashDeals(city || undefined)
      .then((d) => setDeals(d.deals || []))
      .catch(() => setDeals([]))
      .finally(() => setLoading(false));
  }, [city, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const t = setInterval(() => {
      api.getFlashDeals(city || undefined)
        .then((d) => setDeals(d.deals || [])).catch(() => {});
    }, 30000);
    return () => clearInterval(t);
  }, [city, hydrated]);

  // v159.3 — icon + label pairs matching /hotels CITY_PILLS.
  const cities: Array<{ key: string; label: string; icon: string }> = [
    { key: "",          label: "All",       icon: "🏔" },
    { key: "Mussoorie", label: "Mussoorie", icon: "⛰️" },
    { key: "Dhanaulti", label: "Dhanaulti", icon: "🌲" },
    { key: "Rishikesh", label: "Rishikesh", icon: "🕉" },
    { key: "Shimla",    label: "Shimla",    icon: "🌨" },
    { key: "Manali",    label: "Manali",    icon: "🏂" },
    { key: "Dehradun",  label: "Dehradun",  icon: "🌳" },
  ];

  /* Live stats strip ------------------------------------------------------- */
  const stats = useMemo(() => {
    const dealsLive = deals.length;
    const avgDisc = deals.length
      ? Math.round(deals.reduce((s, d) => s + d.discount, 0) / deals.length)
      : 0;
    const totalSaving = deals.reduce(
      (s, d) => s + Math.max(0, (d.floorPrice || 0) - d.aiPrice),
      0
    );
    const hotelsHot = new Set(deals.map(d => d.hotelId)).size;
    return { dealsLive, avgDisc, totalSaving, hotelsHot };
  }, [deals]);

  const open = deals.find(d => d.id === openId) || null;

  // v159.3 — Sort dimension. Default "discount" matches Sachin's "biggest
  // savings first" intent. Other modes keep the same rail-less grid but
  // re-rank the dense card list so user can scan by price / time.
  const [sortBy, setSortBy] = useState<"discount" | "price-asc" | "ending">("discount");
  const sortedDeals = useMemo(() => {
    const cloned = [...deals];
    if (sortBy === "discount") {
      cloned.sort((a, b) => (b.discount || 0) - (a.discount || 0));
    } else if (sortBy === "price-asc") {
      cloned.sort((a, b) => (a.aiPrice || 0) - (b.aiPrice || 0));
    } else if (sortBy === "ending") {
      cloned.sort((a, b) => {
        const ta = a.validUntil ? new Date(a.validUntil).getTime() : Infinity;
        const tb = b.validUntil ? new Date(b.validUntil).getTime() : Infinity;
        return ta - tb;
      });
    }
    return cloned;
  }, [deals, sortBy]);

  return (
    <div className="fd-root">
      <FdStyles />

      {/* Animated mesh background */}
      <div className="fd-bg-mesh" aria-hidden />

      {/* v159.5 — Hero ABOVE sticky. Single-line: eyebrow · italic title ·
          count. Scrolls away cleanly on first scroll. Half the height of
          the v159.3 stacked block (~22px vs ~50px on mobile). */}
      <header className="fd-hero-slim sb-fade-in">
        <p className="fd-hero-line">
          <span className="fd-dot-live" aria-hidden="true" />
          <span className="fd-hero-eyebrow">Live · Same-Day · AI</span>
          <span className="fd-hero-dot" aria-hidden="true">·</span>
          <span className="fd-hero-title">
            Flash <span className="fd-title-gold">Deals</span>
          </span>
          <span className="fd-hero-dot" aria-hidden="true">·</span>
          <span className="fd-hero-count">
            {loading
              ? "loading…"
              : `${stats.dealsLive} deal${stats.dealsLive !== 1 ? "s" : ""}${city ? ` in ${city}` : ""}`}
          </span>
        </p>
        {/* Mini stat strip — keeps the headline numbers above-fold but as
            a tiny secondary row, not a full hero block. */}
        <div className="fd-hero-stats">
          <span className="fd-stat-dot" />
          <span className="fd-stat"><CountUp value={stats.dealsLive} /> live</span>
          <span className="fd-stat-sep">·</span>
          <span className="fd-stat"><CountUp value={stats.hotelsHot} /> hotels</span>
          <span className="fd-stat-sep">·</span>
          <span className="fd-stat"><CountUp value={stats.avgDisc} />% off</span>
          <span className="fd-stat-sep">·</span>
          <span className="fd-stat fd-stat-gold">
            ₹<CountUp value={stats.totalSaving} /> saved
          </span>
        </div>
      </header>

      {/* v159.5 — Slim sticky chrome: city pills + refine. Solid background
          (no backdrop-blur leak). Hero above scrolls away first. */}
      <div className="fd-sticky">
        <div className="fd-sticky-inner">
          <div className="fd-cities" data-autonext-self="fd-results">
            {cities.map((c) => {
              const active = (c.key === "" && !city) || c.key === city;
              return (
                <button
                  key={c.key || "all"}
                  type="button"
                  onClick={() => {
                    setCity(c.key);
                    try { localStorage.setItem("sb_city", c.key); } catch {}
                  }}
                  className={`fd-cat ${active ? "fd-cat-active" : ""}`}
                  aria-pressed={active}
                >
                  <span className="fd-cat-icon" aria-hidden="true">{c.icon}</span>
                  <span className="fd-cat-label">{c.label}</span>
                </button>
              );
            })}
          </div>
          <div className="fd-refine">
            <label className="fd-refine-chip">
              <span className="fd-refine-eyebrow">Sort</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="fd-refine-select"
                aria-label="Sort flash deals"
              >
                <option value="discount">Biggest discount</option>
                <option value="price-asc">Price · low → high</option>
                <option value="ending">Ending soonest</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      {/* ── Deals grid — v122.3 auto-scroll target ──────────────────── */}
      <div className="fd-grid-wrap" data-autonext="fd-results">
        {loading && <SkeletonGrid />}

        {!loading && deals.length === 0 && (
          <div className="fd-empty">
            <div className="fd-empty-icon">⚡</div>
            <p className="fd-empty-title">All deals sold out for tonight</p>
            <p className="fd-empty-sub">AI curates fresh deals daily. Check back near midnight.</p>
          </div>
        )}

        {!loading && sortedDeals.length > 0 && (
          <div className="fd-grid">
            {sortedDeals.map((d, idx) => (
              <DealCard
                key={d.id}
                deal={d}
                idx={idx}
                now={now}
                onOpen={() => { setOpenId(d.id); triggerTour("flashDrawer", { delayMs: 450 }); }}
                pickedRoomId={pickedUpgrade[d.id] || d.roomId}
                onPickUpgrade={(rid) => setPickedUpgrade(p => ({ ...p, [d.id]: rid }))}
                router={router}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Premium drawer with full upgrade picker ─────────────────────── */}
      {open && (
        <DealDrawer
          deal={open}
          now={now}
          pickedRoomId={pickedUpgrade[open.id] || open.roomId}
          onPickUpgrade={(rid) => setPickedUpgrade(p => ({ ...p, [open.id]: rid }))}
          onClose={() => setOpenId(null)}
          onBook={(rid) => {
            const finalRoom =
              rid === open.roomId
                ? open
                : { ...open, roomId: rid, aiPrice: open.upgrades.find(u => u.roomId === rid)?.dealPrice ?? open.aiPrice };
            // v129 — URL carries the snapped ₹100-multiple so the receiving
            // hotel page paints a price that already obeys the platform rule.
            const url = `/hotels/${open.hotelId}?dealId=${open.id}&dealPrice=${snap100(finalRoom.aiPrice)}&roomId=${finalRoom.roomId}&discount=${open.discount}&directBook=true`;
            router.push(url);
          }}
        />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* DEAL CARD                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

function DealCard({ deal, idx, now, onOpen, pickedRoomId, onPickUpgrade, router }: {
  deal: Deal; idx: number; now: number; onOpen: () => void;
  pickedRoomId: string; onPickUpgrade: (rid: string) => void; router: any;
}) {
  const midnight = new Date(); midnight.setHours(23, 59, 59, 999);
  const totalWindowMs = 14 * 3600000; // last 14h shown on ring
  const diffMs = Math.max(0, midnight.getTime() - now);
  const hrs = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  const secs = Math.floor((diffMs % 60000) / 1000);
  const urgent = hrs < 2;
  const pctRemaining = Math.min(100, (diffMs / totalWindowMs) * 100);

  const totalSlots  = deal.maxBookings  || 5;
  const bookedSlots = deal.bookingCount || 0;
  const leftSlots   = Math.max(0, totalSlots - bookedSlots);
  const fillPct     = Math.min(100, (bookedSlots / totalSlots) * 100);

  const area = getHotelArea(deal.city, deal.hotel?.lat, deal.hotel?.lng);

  // Active room selected (base or upgrade)
  const pickedUp = deal.upgrades.find(u => u.roomId === pickedRoomId);
  const showAiPrice = pickedUp ? pickedUp.dealPrice : deal.aiPrice;
  const showFloor   = pickedUp ? pickedUp.floorPrice : deal.floorPrice;
  const showType    = pickedUp ? pickedUp.type       : (deal.room?.type || "Room");

  const img = deal.hotel?.images?.[0] || deal.room?.images?.[0];

  const sold = leftSlots === 0;

  return (
    <div
      className="fd-card"
      style={{ animationDelay: `${idx * 0.06}s` }}
      onClick={onOpen}
    >
      {/* Image with cinematic ken-burns + gradient overlay */}
      <div className="fd-img-wrap">
        {img ? (
          <img src={img} alt={deal.hotel?.name} className="fd-img" />
        ) : (
          <div className="fd-img-fallback">
            <span style={{ fontSize: "3rem", opacity: 0.18 }}>🏨</span>
          </div>
        )}
        <div className="fd-img-shade" />
        <div className="fd-img-shimmer" />

        {/* LIVE badge */}
        <div className="fd-live-pill">
          <span className="fd-dot-live" />
          <span>LIVE</span>
        </div>

        {/* Discount stamp (animated) */}
        <div className={`fd-disc-stamp ${deal.discount >= 25 ? "fire" : ""}`}>
          <span className="fd-disc-num">{deal.discount}%</span>
          <span className="fd-disc-off">OFF</span>
        </div>

        {/* Bottom-left location */}
        <div className="fd-img-bottom">
          <div className="fd-loc">
            <span className="fd-loc-dot" />
            {area ? `${area}, ${deal.city}` : deal.city || "—"}
          </div>
        </div>

        {/* Countdown ring (bottom-right) — v159.7 real-timer digit rolls */}
        <div className="fd-ring-wrap">
          <CountdownRing pctRemaining={pctRemaining} urgent={urgent} />
          <div className="fd-ring-time">
            <span className={`fd-ring-digits ${urgent ? "urgent" : ""}`} aria-label={`Ends in ${pad2(hrs)}:${pad2(mins)}:${pad2(secs)}`}>
              <TimerDigits hrs={hrs} mins={mins} secs={secs} />
            </span>
            <span className="fd-ring-lbl">ends</span>
          </div>
        </div>
      </div>

      {/* Body — v159.4 Airbnb-compact: tight name+score row, single meta
          line, slim upgrade chips, horizontal price+CTA row. No dead
          vertical gaps from a tall medal column. */}
      <div className="fd-body">
        {/* Row 1 — Hotel name (truncates) + compact score pill (inline) */}
        <div className="fd-name-row">
          <h3 className="fd-hotel-name">{deal.hotel?.name || "Hotel"}</h3>
          {deal.hotelId ? (
            <div className="fd-score-inline" onClick={(e) => e.stopPropagation()}>
              <HotelScoreBadge
                hotelId={deal.hotelId}
                hotelName={deal.hotel?.name}
                variant="compact"
              />
            </div>
          ) : null}
        </div>

        {/* Row 2 — stars + room type + capacity + units left, all inline */}
        <div className="fd-meta-line">
          {deal.hotel?.starRating ? (
            <span className="fd-stars">{"★".repeat(deal.hotel.starRating)}</span>
          ) : null}
          <span className="fd-meta-sep">·</span>
          <span className="fd-room-type">{showType}</span>
          <span className="fd-meta-sep">·</span>
          <span className="fd-room-cap">sleeps {pickedUp?.capacity || deal.room?.capacity || 2}</span>
          <span className="fd-meta-sep">·</span>
          <span className={`fd-slots-pill ${leftSlots <= 2 ? "urgent" : ""} ${sold ? "soldout" : ""}`}>
            {sold ? "Sold out" : `${leftSlots} of ${totalSlots} left`}
          </span>
        </div>

        {/* Upgrade chips — slim horizontal row, no big wrapper box */}
        {deal.upgrades.length > 0 && (
          <div className="fd-up-row" onClick={(e) => e.stopPropagation()}>
            <button
              className={`fd-up-chip ${pickedRoomId === deal.roomId ? "active" : ""}`}
              onClick={() => onPickUpgrade(deal.roomId)}
            >
              <span className="fd-up-chip-type">{deal.room?.type || "Base"}</span>
              <span className="fd-up-chip-delta">{fmtINR(deal.aiPrice)}</span>
            </button>
            {deal.upgrades.slice(0, 3).map(u => (
              <button
                key={u.roomId}
                className={`fd-up-chip ${pickedRoomId === u.roomId ? "active" : ""} ${!u.available ? "soldout" : ""}`}
                disabled={!u.available}
                onClick={() => u.available && onPickUpgrade(u.roomId)}
              >
                <span className="fd-up-chip-type">{u.type}</span>
                <span className="fd-up-chip-delta">
                  {u.available
                    ? (u.extraPerNight > 0 ? `+${fmtINR(u.extraPerNight)}` : fmtINR(u.dealPrice))
                    : "Sold"}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Price + CTA — horizontal row, no dividers */}
        <div className="fd-price-row">
          <div className="fd-price-block">
            <div className="fd-price-line">
              {showFloor > showAiPrice && (
                <span className="fd-price-strike">{fmtINR(showFloor)}</span>
              )}
              <span className="fd-price-now">{fmtINR(showAiPrice)}</span>
              <span className="fd-price-unit">/night</span>
            </div>
            {showFloor > showAiPrice && (
              <p className="fd-price-save">
                Save {fmtINR(Math.max(0, showFloor - showAiPrice))}
              </p>
            )}
          </div>
          <button
            className={`fd-cta ${sold ? "sold" : ""}`}
            disabled={sold}
            onClick={(e) => {
              e.stopPropagation();
              if (sold) return;
              const url = `/hotels/${deal.hotelId}?dealId=${deal.id}&dealPrice=${snap100(showAiPrice)}&roomId=${pickedRoomId}&discount=${deal.discount}&directBook=true`;
              router.push(url);
            }}
          >
            {sold ? "Sold Out" : "⚡ Grab Now"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* DRAWER                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

function DealDrawer({ deal, now, pickedRoomId, onPickUpgrade, onClose, onBook }: {
  deal: Deal; now: number; pickedRoomId: string;
  onPickUpgrade: (rid: string) => void;
  onClose: () => void;
  onBook: (rid: string) => void;
}) {
  const midnight = new Date(); midnight.setHours(23, 59, 59, 999);
  const diffMs = Math.max(0, midnight.getTime() - now);
  const hrs = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  const secs = Math.floor((diffMs % 60000) / 1000);

  const pickedUp = deal.upgrades.find(u => u.roomId === pickedRoomId);
  const showAiPrice = pickedUp ? pickedUp.dealPrice : deal.aiPrice;
  const showFloor   = pickedUp ? pickedUp.floorPrice : deal.floorPrice;

  // Lock body scroll
  useEffect(() => {
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = old; };
  }, []);

  const img = deal.hotel?.images?.[0] || deal.room?.images?.[0];

  return (
    <div className="fd-drawer-bg" onClick={onClose}>
      <div className="fd-drawer" onClick={(e) => e.stopPropagation()}>
        <ModalCloseButton onClose={onClose} tone="light" className="fd-drawer-x" />

        {/* Hero image */}
        <div className="fd-drawer-img">
          {img ? <img src={img} alt={deal.hotel?.name} /> : <div className="fd-drawer-img-fallback">🏨</div>}
          <div className="fd-drawer-img-shade" />
          <div className="fd-drawer-img-head">
            <div className="fd-drawer-eyebrow">
              <span className="fd-dot-live" />
              <span>LIVE FLASH DEAL</span>
              <span className="fd-drawer-timer">
                · ends&nbsp;<TimerDigits hrs={hrs} mins={mins} secs={secs} />
              </span>
            </div>
            <h2>{deal.hotel?.name || "Hotel"}</h2>
            <p>{deal.city} · {deal.hotel?.starRating ? "★".repeat(deal.hotel.starRating) : ""}</p>
          </div>
        </div>

        {/* Body */}
        <div className="fd-drawer-body">
          <div className="fd-drawer-section-title">Choose your room</div>
          <div className="fd-drawer-rooms">
            {/* Base */}
            <button
              className={`fd-drawer-room ${pickedRoomId === deal.roomId ? "active" : ""}`}
              onClick={() => onPickUpgrade(deal.roomId)}
            >
              <div className="fd-drawer-room-left">
                <div className="fd-drawer-room-type">
                  {deal.room?.type || "Base Room"}
                  <span className="fd-pill">Headline price</span>
                </div>
                <div className="fd-drawer-room-meta">
                  Sleeps {deal.room?.capacity || 2} · {deal.unitsFree} unit{deal.unitsFree !== 1 ? "s" : ""} free
                </div>
              </div>
              <div className="fd-drawer-room-right">
                <div className="fd-drawer-room-price">{fmtINR(deal.aiPrice)}</div>
                <div className="fd-drawer-room-strike">{fmtINR(deal.floorPrice)}</div>
              </div>
            </button>

            {/* Upgrades */}
            {deal.upgrades.length === 0 && (
              <div className="fd-drawer-empty">Only one room type at this hotel tonight.</div>
            )}
            {deal.upgrades.map(u => (
              <button
                key={u.roomId}
                className={`fd-drawer-room ${pickedRoomId === u.roomId ? "active" : ""} ${!u.available ? "soldout" : ""}`}
                disabled={!u.available}
                onClick={() => u.available && onPickUpgrade(u.roomId)}
              >
                <div className="fd-drawer-room-left">
                  <div className="fd-drawer-room-type">
                    {u.type}
                    {u.extraPerNight > 0 && u.available && (
                      <span className="fd-pill gold">+{fmtINR(u.extraPerNight)}</span>
                    )}
                    {!u.available && <span className="fd-pill red">Sold tonight</span>}
                  </div>
                  <div className="fd-drawer-room-meta">
                    Sleeps {u.capacity} · {u.available ? `${u.unitsFree} unit${u.unitsFree !== 1 ? "s" : ""} free` : "fully booked"}
                  </div>
                </div>
                <div className="fd-drawer-room-right">
                  <div className="fd-drawer-room-price" style={{ opacity: u.available ? 1 : 0.4 }}>
                    {fmtINR(u.dealPrice)}
                  </div>
                  <div className="fd-drawer-room-strike">{fmtINR(u.floorPrice)}</div>
                </div>
              </button>
            ))}
          </div>

          {/* Rules */}
          <div className="fd-drawer-rules">
            <div className="fd-drawer-section-title">How this deal works</div>
            <ul>
              <li><span>🕒</span><span>Expires at midnight tonight · auto-refreshes next day.</span></li>
              <li><span>🛏️</span><span>One headline price per hotel — pick from available rooms above.</span></li>
              <li><span>🚫</span><span>Sold rooms are hidden in real time. No double-booking.</span></li>
              <li><span>💳</span><span>Instant confirmation · pay only the headline / upgrade price.</span></li>
              <li><span>↩️</span><span>Free cancellation up to 4 hours before check-in.</span></li>
            </ul>
          </div>
        </div>

        {/* Sticky CTA */}
        <div className="fd-drawer-cta-wrap">
          <div className="fd-drawer-cta-info">
            <div className="fd-drawer-cta-strike">{fmtINR(showFloor)}</div>
            <div className="fd-drawer-cta-price">{fmtINR(showAiPrice)}<span>/night</span></div>
          </div>
          <button className="fd-drawer-cta" onClick={() => onBook(pickedRoomId)}>
            ⚡ Grab this stay
          </button>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function SkeletonGrid() {
  return (
    <div className="fd-grid">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="fd-card fd-card-skel">
          <div className="fd-skel-img" />
          <div className="fd-body">
            <div className="fd-skel-line w60" />
            <div className="fd-skel-line w40" />
            <div className="fd-skel-line w80" />
            <div className="fd-skel-line w50" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* STYLES — inline so the dark luxury surface stays isolated                  */
/* ────────────────────────────────────────────────────────────────────────── */

function FdStyles() {
  return (
    <style jsx global>{`
      /* v89 — Cozy cream surface instead of dark navy. Same warm mesh
         overlay but on a parchment base. */
      .fd-root {
        position: relative;
        min-height: 100vh;
        background: radial-gradient(1200px 600px at 20% 0%, rgba(201, 166, 107, 0.10), transparent 60%),
                    radial-gradient(900px 500px at 90% 30%, rgba(217, 190, 130, 0.08), transparent 55%),
                    linear-gradient(180deg, #FAF5EB 0%, #F5EFE0 50%, #FAF5EB 100%);
        color: var(--cozy-warm-dark, #1F1A0F);
        overflow-x: hidden;
      }
      .fd-bg-mesh {
        position: fixed; inset: 0;
        background-image:
          radial-gradient(circle at 25% 70%, rgba(240, 180, 41, 0.08) 0, transparent 35%),
          radial-gradient(circle at 80% 20%, rgba(255, 56, 89, 0.05) 0, transparent 30%);
        pointer-events: none;
        animation: fdMesh 14s ease-in-out infinite alternate;
      }
      @keyframes fdMesh {
        0%   { transform: translate3d(0, 0, 0) scale(1); }
        100% { transform: translate3d(-2%, 1%, 0) scale(1.05); }
      }

      /* v159.6 — Sticky reads as distinct floating layer: cream-50
         (slight elevation vs cream-100 hero bg) + champagne-tinted edge
         + stronger drop-shadow. Solid bg, no backdrop-blur. */
      .fd-sticky {
        position: sticky; top: 0; z-index: 30;
        background: var(--cozy-cream-50, #FFFCF6);
        border-bottom: 1px solid color-mix(in srgb, var(--cozy-champagne, #C9A66B) 28%, var(--cozy-taupe, #E8DCC8));
        box-shadow: 0 8px 18px -8px rgba(31, 26, 15, 0.20);
      }
      .fd-sticky-inner {
        max-width: 1480px; margin: 0 auto;
        padding: 6px 14px 4px;
      }
      @media (min-width: 640px)  { .fd-sticky-inner { padding: 8px 22px 6px; } }
      @media (min-width: 1024px) { .fd-sticky-inner { padding: 10px 32px 8px; } }

      .fd-dot-live {
        width: 7px; height: 7px; border-radius: 50%;
        background: #ff3859; box-shadow: 0 0 0 0 rgba(255, 56, 89, 0.6);
        animation: fdPulse 1.6s infinite;
      }
      @keyframes fdPulse {
        0%   { box-shadow: 0 0 0 0 rgba(255, 56, 89, 0.55); }
        70%  { box-shadow: 0 0 0 12px rgba(255, 56, 89, 0); }
        100% { box-shadow: 0 0 0 0 rgba(255, 56, 89, 0); }
      }

      /* v159.5 — Single-line hero ABOVE the sticky. Scrolls away first.
         Total height ~22px on mobile (vs ~140px stacked block in v159.3).
         Tiny stat strip lives just under the title as a secondary row. */
      .fd-hero-slim {
        position: relative; z-index: 1;
        max-width: 1480px; margin: 0 auto;
        padding: 8px 16px 6px;
      }
      @media (min-width: 640px)  { .fd-hero-slim { padding: 12px 22px 8px; } }
      @media (min-width: 1024px) { .fd-hero-slim { padding: 16px 32px 10px; } }
      .fd-hero-line {
        display: flex; align-items: baseline; flex-wrap: wrap;
        gap: 6px; margin: 0;
        line-height: 1.25;
      }
      .fd-hero-eyebrow {
        font-size: 0.5rem; font-weight: 700;
        letter-spacing: 0.22em; text-transform: uppercase;
        background: linear-gradient(90deg, #D9BE82, #C9A66B);
        -webkit-background-clip: text; background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      .fd-hero-title {
        font-family: 'Cormorant Garamond', 'Syne', serif;
        font-weight: 500;
        font-style: italic;
        font-size: 0.95rem;
        line-height: 1.15;
        color: var(--cozy-warm-dark, #1F1A0F);
        letter-spacing: -0.005em;
      }
      .fd-hero-count {
        font-family: var(--font-body, "DM Sans"), system-ui, sans-serif;
        font-size: 0.7rem; font-weight: 500;
        color: var(--cozy-cocoa-soft, #6E5430);
        letter-spacing: 0.005em;
      }
      .fd-hero-dot { color: var(--cozy-cocoa-soft, #6E5430); opacity: 0.5; }
      .fd-title-gold {
        background: linear-gradient(90deg, #D9BE82, #C9A66B, #9C7E48, #C9A66B, #D9BE82);
        background-size: 200% 100%;
        -webkit-background-clip: text; background-clip: text;
        -webkit-text-fill-color: transparent;
        animation: fdShine 4s linear infinite;
      }
      @keyframes fdShine {
        0%   { background-position: 0% 50%; }
        100% { background-position: 200% 50%; }
      }
      @media (min-width: 1024px) {
        .fd-hero-eyebrow { font-size: 0.6rem; }
        .fd-hero-title   { font-size: 1.2rem; }
        .fd-hero-count   { font-size: 0.82rem; }
      }
      @media (min-width: 1280px) {
        .fd-hero-title { font-size: 1.4rem; }
      }
      /* Stat strip — secondary tiny row under the title line. */
      .fd-hero-stats {
        display: inline-flex; flex-wrap: wrap; align-items: center;
        gap: 5px; margin-top: 4px;
        font-size: 0.66rem; color: var(--cozy-cocoa-soft, #6E5430);
      }
      .fd-stat { color: var(--cozy-warm-dark, #1F1A0F); font-weight: 600; }
      .fd-stat-gold {
        color: var(--cozy-cocoa, #4A3820);
        background: linear-gradient(135deg, rgba(201,166,107,0.18), rgba(201,166,107,0.06));
        padding: 1px 7px; border-radius: 999px;
        border: 1px solid rgba(201,166,107,0.30);
      }
      .fd-stat-sep { color: var(--cozy-taupe, #C8B891); opacity: 0.7; }
      .fd-stat-dot {
        width: 6px; height: 6px; border-radius: 50%;
        background: var(--cozy-sage, #9DAD8F);
        box-shadow: 0 0 6px rgba(157, 173, 143, 0.6);
        animation: fdPulse 1.8s infinite;
      }
      @media (min-width: 1024px) { .fd-hero-stats { font-size: 0.74rem; } }

      /* v159.3 — Category pills Airbnb-true. No boxed bg on inactive,
         active gets a thin champagne underline. Mirrors /hotels v159.2. */
      .fd-cities {
        display: flex; gap: 2px;
        overflow-x: auto; scrollbar-width: none; -ms-overflow-style: none;
        padding: 2px 0 4px; margin: 0;
        scroll-snap-type: x proximity;
      }
      .fd-cities::-webkit-scrollbar { display: none; }
      .fd-cat {
        flex: 0 0 auto;
        display: inline-flex; flex-direction: column;
        align-items: center; justify-content: flex-end;
        gap: 1px;
        min-width: 54px;
        padding: 4px 8px 6px;
        background: transparent; border: 0; border-radius: 0;
        cursor: pointer;
        /* v159.6 — color-based dimming, NOT opacity. Matches /hotels
           .hxr-cat treatment so inactive cats read as solid muted text
           on the solid sticky bg, not as washed-out semi-transparent. */
        color: var(--cozy-cocoa-soft, #6E5430);
        transition: color 0.18s ease;
        scroll-snap-align: start;
        -webkit-tap-highlight-color: transparent;
        position: relative;
      }
      .fd-cat-icon {
        font-size: 1.05rem; line-height: 1;
        filter: saturate(0.35) brightness(0.92);
        transition: filter 0.18s ease, transform 0.18s ease;
      }
      .fd-cat-label {
        font-size: 0.58rem; font-weight: 600; letter-spacing: 0.01em;
        white-space: nowrap; color: inherit;
      }
      .fd-cat:hover { color: var(--cozy-cocoa, #4A3820); }
      .fd-cat:hover .fd-cat-icon { filter: saturate(0.75); }
      .fd-cat-active { color: var(--cozy-warm-dark, #1F1A0F); }
      .fd-cat-active .fd-cat-icon { filter: none; transform: scale(1.04); }
      .fd-cat-active::after {
        content: "";
        position: absolute; left: 18%; right: 18%; bottom: -1px;
        height: 2px; border-radius: 2px;
        background: var(--cozy-warm-dark, #1F1A0F);
        box-shadow: 0 0 0 0.5px var(--cozy-warm-dark, #1F1A0F);
      }
      @media (min-width: 768px) {
        .fd-cat { min-width: 64px; padding: 6px 12px 8px; }
        .fd-cat-icon { font-size: 1.2rem; }
        .fd-cat-label { font-size: 0.66rem; }
      }

      /* Refine row — slim sort chip. Mirrors /hotels v159.2. */
      .fd-refine {
        display: flex; flex-wrap: wrap; align-items: center;
        gap: 5px; padding-top: 4px;
      }
      .fd-refine-chip {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 3px 9px; height: 25px;
        background: var(--cozy-cream-50, #FFFCF6);
        border: 1px solid var(--cozy-taupe, #E8DCC8);
        border-radius: 999px;
        color: var(--cozy-cocoa, #4A3820);
        font-size: 0.66rem; font-weight: 500;
      }
      .fd-refine-eyebrow { opacity: 0.7; font-size: 0.64rem; }
      .fd-refine-select {
        background: transparent; border: 0; outline: none;
        font-size: 0.66rem; font-weight: 600;
        color: var(--cozy-warm-dark, #1F1A0F);
        font-family: inherit; cursor: pointer; padding-right: 2px;
      }
      @media (min-width: 1024px) {
        .fd-refine { gap: 6px; }
        .fd-refine-chip { height: 28px; font-size: 0.72rem; padding-left: 11px; padding-right: 11px; }
        .fd-refine-select { font-size: 0.72rem; }
        .fd-refine-eyebrow { font-size: 0.7rem; }
      }

      /* Grid — v159.3 responsive: 1 / 2 / 3 / 4 / 5 cols across breakpoints.
         Mobile keeps 1 col so the dense card chrome (countdown ring + LIVE
         pill + room picker + meter) stays legible. */
      .fd-grid-wrap {
        position: relative; z-index: 1;
        max-width: 1480px; margin: 0 auto;
        padding: 0 16px 80px;
      }
      @media (min-width: 640px)  { .fd-grid-wrap { padding: 0 22px 88px; } }
      @media (min-width: 1024px) { .fd-grid-wrap { padding: 0 32px 96px; } }
      .fd-grid {
        display: grid; gap: 14px;
        grid-template-columns: 1fr;
      }
      @media (min-width: 640px)  { .fd-grid { grid-template-columns: repeat(2, 1fr); gap: 16px; } }
      @media (min-width: 1024px) { .fd-grid { grid-template-columns: repeat(3, 1fr); gap: 18px; } }
      @media (min-width: 1280px) { .fd-grid { grid-template-columns: repeat(4, 1fr); gap: 20px; } }
      @media (min-width: 1536px) { .fd-grid { grid-template-columns: repeat(5, 1fr); gap: 22px; } }

      /* v91 — Card uses theme tokens: cream surface in light mode, warm
         cocoa in dark. Champagne accent on hover stays brand-consistent. */
      .fd-card {
        position: relative;
        background: var(--bg-card);
        border: 1px solid var(--border-soft);
        border-radius: 20px;
        overflow: hidden;
        cursor: pointer;
        color: var(--text-base);
        transition: transform 0.4s cubic-bezier(.4,.0,.2,1), border-color 0.3s, box-shadow 0.3s;
        animation: fdFadeUp 0.55s cubic-bezier(.2,.7,.2,1) both;
        box-shadow: var(--shadow-soft);
      }
      .fd-card:hover {
        transform: translateY(-4px);
        border-color: var(--accent);
        box-shadow: var(--shadow-card), 0 0 0 1px var(--accent-soft);
      }
      @keyframes fdFadeUp {
        from { opacity: 0; transform: translateY(22px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      /* v159.3 — Image height responsive. Mobile is wider in 1-col grid so
         keep aspect-ratio shorter; tablet+ stays similar. */
      .fd-img-wrap {
        position: relative; height: 168px; overflow: hidden; background: #0d0d1a;
      }
      @media (min-width: 640px)  { .fd-img-wrap { height: 180px; } }
      @media (min-width: 1024px) { .fd-img-wrap { height: 192px; } }
      @media (min-width: 1280px) { .fd-img-wrap { height: 200px; } }
      .fd-img {
        width: 100%; height: 100%; object-fit: cover;
        transform: scale(1.05);
        transition: transform 7s ease;
        animation: fdKenBurns 18s ease-in-out infinite alternate;
      }
      .fd-card:hover .fd-img { transform: scale(1.1); }
      @keyframes fdKenBurns {
        0%   { transform: scale(1.05) translate(0, 0); }
        100% { transform: scale(1.12) translate(-1%, -1%); }
      }
      .fd-img-fallback {
        width: 100%; height: 100%;
        display: flex; align-items: center; justify-content: center;
        background: linear-gradient(135deg, #1a1530 0%, #0d1a2e 100%);
      }
      .fd-img-shade {
        position: absolute; inset: 0;
        background: linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.55) 75%, rgba(0,0,0,0.85) 100%);
      }
      .fd-img-shimmer {
        position: absolute; inset: 0;
        background: linear-gradient(120deg, transparent 30%, rgba(255,255,255,0.10) 45%, transparent 60%);
        background-size: 250% 100%;
        animation: fdShimmer 5s linear infinite;
        pointer-events: none;
      }
      @keyframes fdShimmer {
        0%   { background-position: 250% 0; }
        100% { background-position: -250% 0; }
      }

      .fd-live-pill {
        position: absolute; top: 12px; left: 12px; z-index: 2;
        display: inline-flex; align-items: center; gap: 6px;
        padding: 5px 10px;
        background: rgba(0,0,0,0.65); backdrop-filter: blur(6px);
        border: 1px solid rgba(255, 56, 89, 0.45);
        border-radius: 999px;
        font-size: 0.6rem; font-weight: 700;
        letter-spacing: 0.18em; color: #ff7088;
      }

      .fd-disc-stamp {
        position: absolute; top: 12px; right: 12px; z-index: 2;
        background: linear-gradient(135deg, #f0d060, #f0b429 60%, #d4a017);
        border-radius: 14px;
        padding: 8px 12px;
        display: flex; flex-direction: column; align-items: center;
        line-height: 1;
        box-shadow: 0 8px 22px rgba(240,180,41,0.35), inset 0 0 0 1px rgba(255,255,255,0.25);
        animation: fdStamp 2.4s ease-in-out infinite;
      }
      .fd-disc-stamp.fire {
        background: linear-gradient(135deg, #ff7088, #ff3859 60%, #d12d4a);
        box-shadow: 0 8px 22px rgba(255,56,89,0.45), inset 0 0 0 1px rgba(255,255,255,0.25);
      }
      @keyframes fdStamp {
        0%, 100% { transform: rotate(-3deg) scale(1); }
        50%      { transform: rotate(-3deg) scale(1.05); }
      }
      .fd-disc-num { color: #0a0814; font-weight: 900; font-size: 1.1rem; letter-spacing: -0.02em; }
      .fd-disc-stamp.fire .fd-disc-num { color: var(--text-base); }
      .fd-disc-off { color: #0a0814; font-weight: 800; font-size: 0.55rem; letter-spacing: 0.18em; }
      .fd-disc-stamp.fire .fd-disc-off { color: var(--text-base); opacity: 0.9; }

      .fd-img-bottom {
        position: absolute; bottom: 12px; left: 12px; z-index: 2;
      }
      /* v92 — fd-loc + fd-ring-wrap sit OVER the image (always dark bg
         visually), so their text needs a FIXED bright color, NOT the
         theme-token walnut. In light mode they were rendering walnut-on-
         dark = invisible (user SS2 — "ENDS 22:18:33" hidden). */
      .fd-loc {
        display: inline-flex; align-items: center; gap: 6px;
        background: rgba(15, 12, 8, 0.62); backdrop-filter: blur(6px);
        padding: 5px 10px; border-radius: 999px;
        font-size: 0.65rem; font-weight: 600;
        color: #F5EFE0;
        border: 1px solid rgba(217, 190, 130, 0.20);
      }
      .fd-loc-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--cozy-champagne, #C9A66B); }

      /* v159.9 — Shrunk + premium glass timer chip. Was 52px ring + chunky
         8/12 padding on a dark glass pill. Now: 38px ring, tighter 3/10
         padding, softer warm-cocoa gradient bg with subtle champagne
         outline so it reads as a luxe accent on the photo instead of a
         heavy badge. */
      .fd-ring-wrap {
        position: absolute; bottom: 8px; right: 8px; z-index: 2;
        display: flex; align-items: center; gap: 6px;
        background:
          linear-gradient(135deg, rgba(31, 26, 15, 0.78), rgba(20, 16, 10, 0.92));
        backdrop-filter: blur(10px) saturate(140%);
        -webkit-backdrop-filter: blur(10px) saturate(140%);
        border-radius: 999px;
        padding: 3px 11px 3px 3px;
        border: 1px solid rgba(217, 190, 130, 0.28);
        box-shadow:
          0 6px 18px -8px rgba(0, 0, 0, 0.4),
          inset 0 1px 0 rgba(255, 246, 226, 0.10);
      }
      .fd-ring-wrap > svg { width: 38px !important; height: 38px !important; }
      .fd-ring-time {
        display: flex; flex-direction: column; line-height: 1;
        font-family: 'Menlo', 'Consolas', monospace;
        color: #F5EFE0;
      }
      .fd-ring-digits {
        font-size: 0.78rem; font-weight: 700; letter-spacing: 0.02em;
        display: inline-flex; align-items: center;
        font-variant-numeric: tabular-nums;
        color: #F5EFE0;
        text-shadow: 0 1px 2px rgba(0,0,0,0.4);
      }
      .fd-ring-digits.urgent { color: #ff9aaa; }
      .fd-ring-lbl {
        font-size: 0.46rem; font-weight: 700; letter-spacing: 0.22em;
        color: rgba(217, 190, 130, 0.78); text-transform: uppercase;
        margin-top: 1px;
      }
      /* Drawer header timer — same digit-cell rules apply via .td-cell. */
      .fd-drawer-timer {
        display: inline-flex; align-items: center;
        font-variant-numeric: tabular-nums;
      }
      @keyframes fdBlink {
        0%, 49% { opacity: 1; } 50%, 100% { opacity: 0.4; }
      }

      /* v159.9 — Real-timer digit roll, simplified. Each digit lives in
         a fixed-width overflow:hidden cell. When value changes the
         <span> remounts (via React key) and its tdRollIn animation
         plays once: starts shifted DOWN + faded, settles at center.
         Premium scoreboard pop. No stacked dual-render → no risk of
         old+new digit ghosting visible side-by-side. */
      .td-cell {
        display: inline-block;
        overflow: hidden;
        width: 0.58em;
        height: 1em;
        line-height: 1;
        vertical-align: baseline;
        font-feature-settings: "tnum" 1;
      }
      .td-anim {
        display: block;
        text-align: center;
        animation: tdRollIn 0.32s cubic-bezier(.32,.7,.3,1) both;
        will-change: transform, opacity;
      }
      @keyframes tdRollIn {
        from { transform: translateY(55%); opacity: 0; }
        45%  { opacity: 0.85; }
        to   { transform: translateY(0);   opacity: 1; }
      }
      .td-sep {
        display: inline-block;
        width: 0.22em;
        text-align: center;
        opacity: 0.7;
        animation: fdBlink 1.05s ease-in-out infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        .td-anim { animation: none; }
        .td-sep  { animation: none; opacity: 1; }
      }

      /* Body — v159.3 tighter on mobile. */
      .fd-body { padding: 11px 13px 12px; }
      @media (min-width: 640px)  { .fd-body { padding: 13px 14px 14px; } }
      @media (min-width: 1024px) { .fd-body { padding: 14px 16px 16px; } }
      .fd-hotel-row {
        display: flex; align-items: flex-start; justify-content: space-between;
        gap: 8px; margin-bottom: 6px;
      }
      @media (min-width: 1024px) { .fd-hotel-row { gap: 10px; margin-bottom: 8px; } }
      .fd-hotel-row-left {
        flex: 1 1 auto; min-width: 0;
        display: flex; flex-direction: column; gap: 2px;
      }
      .fd-hotel-name {
        font-size: 0.86rem; font-weight: 600; color: var(--text-base);
        margin: 0;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        letter-spacing: -0.005em;
      }
      @media (min-width: 1024px) { .fd-hotel-name { font-size: 0.95rem; } }
      /* v128.4 — Flash deal scorecard badge slot. v159.3 — scaled down on
         small cards so the medal reads as a corner accent. */
      .fd-score-slot { flex-shrink: 0; align-self: flex-start; transform: scale(0.78); transform-origin: top right; }
      @media (min-width: 1024px) { .fd-score-slot { transform: scale(0.92); } }
      @media (min-width: 1280px) { .fd-score-slot { transform: scale(1); } }
      @media (max-width: 480px) { .fd-hotel-row { gap: 6px; } }
      /* v92 — Star + room type + slots use theme accent (champagne) so
         they read on both cream + cocoa surfaces. The bright #f0b429
         original gold disappeared on cream. */
      .fd-stars { color: var(--accent, #C9A66B); font-size: 0.65rem; letter-spacing: 0.05em; }
      .fd-rt-row { display: flex; align-items: baseline; gap: 6px; margin-bottom: 12px; }
      .fd-room-type { color: var(--accent, #C9A66B); font-size: 0.7rem; font-weight: 700; }
      .fd-room-cap { color: var(--text-muted); font-size: 0.65rem; }

      .fd-slots { margin-bottom: 12px; }
      .fd-slots-text {
        display: flex; justify-content: space-between; align-items: center;
        margin-bottom: 6px; font-size: 0.65rem; font-weight: 600;
      }
      .fd-slots-left { color: var(--accent, #C9A66B); }
      .fd-slots-left.urgent { color: #c87878; }
      .fd-slots-of { color: var(--text-muted); }
      /* v92 — Slots bar theme-aware (was nearly invisible white-alpha on cream) */
      .fd-slots-bar {
        position: relative; height: 5px;
        background: var(--border-soft); border-radius: 999px; overflow: hidden;
      }
      .fd-slots-fill {
        height: 100%; border-radius: 999px;
        background: linear-gradient(90deg, var(--cozy-champagne, #C9A66B), var(--cozy-champagne-light, #D9BE82));
        transition: width 0.8s ease;
      }
      .fd-slots-fill.urgent {
        background: linear-gradient(90deg, #c87878, #d49583);
      }
      .fd-slots-shimmer {
        position: absolute; inset: 0;
        background: linear-gradient(90deg, transparent, rgba(255, 246, 226, 0.35), transparent);
        background-size: 200% 100%;
        animation: fdShimmerBar 2.4s linear infinite;
      }
      @keyframes fdShimmerBar {
        0%   { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }

      /* Upgrade chips wrapper — v92 theme-aware */
      .fd-up-wrap {
        background: var(--accent-soft);
        border: 1px solid var(--border-soft);
        border-radius: 12px;
        padding: 10px 12px;
        margin-bottom: 14px;
      }
      .fd-up-label {
        display: flex; justify-content: space-between; align-items: center;
        font-size: 0.66rem; font-weight: 600;
        color: var(--accent);
        margin-bottom: 8px;
      }
      .fd-up-count { color: var(--text-muted); font-size: 0.6rem; font-weight: 500; }
      .fd-up-chips {
        display: flex; gap: 6px; overflow-x: auto;
        scrollbar-width: none;
      }
      .fd-up-chips::-webkit-scrollbar { display: none; }
      /* v92 — Upgrade chips theme-aware. Was rgba(0,0,0,0.25) bg which
         became a dark blob on the cream card surface (user SS2). Now
         uses --bg-pill (cream in light, warm cocoa in dark) + theme
         border + theme text. Active state stays champagne in both. */
      .fd-up-chip {
        flex-shrink: 0;
        display: flex; flex-direction: column; align-items: flex-start;
        padding: 4px 9px 5px;
        background: var(--bg-pill);
        border: 1px solid var(--border-soft);
        border-radius: 10px;
        cursor: pointer;
        transition: all 0.2s ease;
        text-align: left;
      }
      .fd-up-chip:hover { border-color: var(--accent); transform: translateY(-1px); }
      .fd-up-chip.active {
        background: var(--accent-soft);
        border-color: var(--accent);
        box-shadow: inset 0 0 0 1px var(--accent-soft);
      }
      .fd-up-chip.soldout { opacity: 0.45; cursor: not-allowed; }
      .fd-up-chip-type { font-size: 0.66rem; font-weight: 600; color: var(--text-base); line-height: 1.1; }
      .fd-up-chip-delta {
        font-size: 0.6rem; font-weight: 700;
        color: var(--accent); margin-top: 2px;
      }
      .fd-up-chip.soldout .fd-up-chip-delta { color: #c87878; }

      /* v159.4 — Airbnb-compact card body. Replaces .fd-hotel-row,
         .fd-rt-row, .fd-slots, .fd-up-wrap with denser single-row rows.
         Old classes still exist in CSS but are no longer rendered. */
      .fd-name-row {
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px; margin-bottom: 4px;
      }
      .fd-hotel-name {
        flex: 1 1 auto; min-width: 0;
        font-size: 0.92rem; font-weight: 600; color: var(--text-base);
        margin: 0;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        letter-spacing: -0.005em;
      }
      @media (min-width: 1024px) { .fd-hotel-name { font-size: 1rem; } }
      /* Inline score chip — uses HotelScoreBadge variant="compact" which
         renders as a ~30px horizontal pill. Scaled down slightly so it
         reads as a corner accent next to the title. */
      .fd-score-inline {
        flex: 0 0 auto;
        transform: scale(0.78);
        transform-origin: right center;
      }
      @media (min-width: 1024px) { .fd-score-inline { transform: scale(0.86); } }
      @media (min-width: 1280px) { .fd-score-inline { transform: scale(0.92); } }

      /* Meta line — stars · room · capacity · units left, all inline */
      .fd-meta-line {
        display: flex; align-items: center; flex-wrap: wrap;
        gap: 5px; margin: 0 0 10px;
        font-size: 0.74rem; line-height: 1.2;
      }
      .fd-meta-line .fd-stars {
        color: var(--accent, #C9A66B); font-size: 0.7rem; letter-spacing: 0.04em;
      }
      .fd-meta-sep { color: var(--text-muted); opacity: 0.6; }
      .fd-meta-line .fd-room-type {
        color: var(--accent, #C9A66B); font-weight: 700; font-size: 0.72rem;
      }
      .fd-meta-line .fd-room-cap {
        color: var(--text-muted); font-size: 0.72rem;
      }
      /* Units-left as a tiny pill — green when plenty, amber when ≤2 */
      .fd-slots-pill {
        display: inline-flex; align-items: center;
        padding: 2px 8px; border-radius: 999px;
        font-size: 0.66rem; font-weight: 600;
        background: color-mix(in srgb, var(--cozy-sage, #9DAD8F) 22%, var(--bg-card));
        color: var(--cozy-warm-dark, #1F1A0F);
        border: 1px solid color-mix(in srgb, var(--cozy-sage, #9DAD8F) 40%, transparent);
      }
      .fd-slots-pill.urgent {
        background: color-mix(in srgb, #d49583 22%, var(--bg-card));
        border-color: color-mix(in srgb, #d49583 50%, transparent);
        color: #8d4f3f;
      }
      .fd-slots-pill.soldout {
        background: var(--accent-soft); color: var(--text-muted);
        border-color: var(--border-soft);
      }

      /* Upgrade row — slim chips, no boxed wrapper. */
      .fd-up-row {
        display: flex; gap: 6px; overflow-x: auto;
        scrollbar-width: none; margin: 0 0 10px;
        padding: 2px 0;
      }
      .fd-up-row::-webkit-scrollbar { display: none; }

      /* Price + CTA — v159.4 horizontal, no divider, super tight. */
      .fd-price-row {
        display: flex; align-items: flex-end; justify-content: space-between;
        gap: 10px;
      }
      .fd-price-block {
        flex: 1 1 auto; min-width: 0;
        display: flex; flex-direction: column;
      }
      .fd-price-line {
        display: flex; align-items: baseline; gap: 4px;
        flex-wrap: wrap;
      }
      .fd-price-strike {
        color: var(--text-muted); font-size: 0.7rem;
        text-decoration: line-through;
      }
      .fd-price-now {
        color: var(--text-base); font-size: 1.15rem; font-weight: 800; line-height: 1;
        letter-spacing: -0.01em;
      }
      @media (min-width: 1024px) { .fd-price-now { font-size: 1.3rem; } }
      .fd-price-unit { color: var(--text-muted); font-size: 0.65rem; font-weight: 500; }
      .fd-price-save {
        margin: 2px 0 0; color: var(--cozy-sage, #5d7a52);
        font-size: 0.6rem; font-weight: 700;
      }
      .fd-cta {
        flex: 0 0 auto;
        padding: 9px 16px;
        background: linear-gradient(135deg, #f0d060, #f0b429 60%, #d4a017);
        color: #0a0814; font-size: 0.74rem; font-weight: 800;
        border: none; border-radius: 11px;
        cursor: pointer;
        box-shadow: 0 6px 16px rgba(240,180,41,0.35), inset 0 1px 0 rgba(255,255,255,0.5);
        transition: all 0.2s ease;
        letter-spacing: 0.02em;
        white-space: nowrap;
      }
      @media (min-width: 1024px) { .fd-cta { padding: 10px 18px; font-size: 0.78rem; } }
      .fd-cta:hover { transform: translateY(-2px); box-shadow: 0 14px 30px rgba(240,180,41,0.5), inset 0 1px 0 rgba(255,255,255,0.5); }
      .fd-cta.sold {
        background: var(--accent-soft); color: var(--text-muted);
        cursor: not-allowed; box-shadow: none;
      }

      /* v92 — Skeleton uses taupe shimmer so it's visible on cream cards too */
      .fd-card-skel { cursor: default; pointer-events: none; }
      .fd-card-skel:hover { transform: none; }
      .fd-skel-img {
        height: 200px;
        background: linear-gradient(90deg, var(--border-soft), var(--accent-soft), var(--border-soft));
        background-size: 200% 100%;
        animation: fdSkel 1.6s linear infinite;
      }
      .fd-skel-line {
        height: 10px; border-radius: 4px; margin: 8px 0;
        background: linear-gradient(90deg, var(--border-soft), var(--accent-soft), var(--border-soft));
        background-size: 200% 100%;
        animation: fdSkel 1.6s linear infinite;
      }
      .w40 { width: 40%; } .w50 { width: 50%; } .w60 { width: 60%; } .w80 { width: 80%; }
      @keyframes fdSkel {
        0%   { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }

      /* Empty */
      .fd-empty { text-align: center; padding: 80px 20px; }
      .fd-empty-icon {
        width: 72px; height: 72px; border-radius: 50%;
        background: var(--accent-soft);
        border: 1px solid var(--border-soft);
        display: flex; align-items: center; justify-content: center;
        margin: 0 auto 18px;
        font-size: 1.6rem;
      }
      .fd-empty-title { color: var(--text-base); font-size: 1.05rem; font-weight: 600; margin: 0 0 6px; }
      .fd-empty-sub { color: var(--text-muted); font-size: 0.82rem; margin: 0; }

      /* Drawer */
      .fd-drawer-bg {
        position: fixed; inset: 0; z-index: 100;
        background: rgba(0,0,0,0.7); backdrop-filter: blur(8px);
        display: flex; align-items: stretch; justify-content: center;
        padding: 0;
        animation: fdFadeIn 0.25s ease both;
      }
      @keyframes fdFadeIn {
        from { opacity: 0; } to { opacity: 1; }
      }
      /* v91 — Drawer reads theme tokens. */
      .fd-drawer {
        position: relative;
        margin: auto;
        width: 100%; max-width: 540px;
        max-height: 92vh;
        background: var(--bg-card);
        border: 1px solid var(--border-soft);
        border-radius: 24px;
        overflow: hidden;
        display: flex; flex-direction: column;
        color: var(--text-base);
        animation: fdDrawer 0.4s cubic-bezier(.2,.7,.2,1) both;
        box-shadow: var(--shadow-card);
      }
      @media (max-width: 540px) {
        .fd-drawer-bg { align-items: flex-end; }
        .fd-drawer {
          max-width: none; max-height: 94vh;
          border-radius: 24px 24px 0 0;
          animation: fdDrawerMobile 0.45s cubic-bezier(.2,.7,.2,1) both;
        }
      }
      @keyframes fdDrawer {
        from { opacity: 0; transform: translateY(20px) scale(0.97); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes fdDrawerMobile {
        from { transform: translateY(100%); }
        to   { transform: translateY(0); }
      }
      /* v92 — Drawer close sits over the dark image, so cream text + dark bg */
      .fd-drawer-x {
        position: absolute; top: 14px; right: 14px; z-index: 3;
        width: 36px; height: 36px; border-radius: 50%;
        background: rgba(15, 12, 8, 0.62); backdrop-filter: blur(6px);
        border: 1px solid rgba(217, 190, 130, 0.22);
        color: #F5EFE0; font-size: 1rem; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: all 0.2s ease;
      }
      .fd-drawer-x:hover { background: rgba(15, 12, 8, 0.85); transform: rotate(90deg); }
      .fd-drawer-img {
        position: relative; height: 220px;
      }
      .fd-drawer-img img { width: 100%; height: 100%; object-fit: cover; }
      .fd-drawer-img-fallback {
        width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
        background: linear-gradient(135deg, #1a1530, #0d1a2e); font-size: 3rem; opacity: 0.2;
      }
      .fd-drawer-img-shade {
        position: absolute; inset: 0;
        background: linear-gradient(180deg, transparent 30%, rgba(0,0,0,0.7) 75%, rgba(0,0,0,0.92) 100%);
      }
      .fd-drawer-img-head {
        position: absolute; bottom: 0; left: 0; right: 0; padding: 18px 22px;
      }
      .fd-drawer-eyebrow {
        display: inline-flex; align-items: center; gap: 6px;
        color: #ff7088; font-size: 0.6rem; font-weight: 700;
        letter-spacing: 0.18em; margin-bottom: 6px;
      }
      /* v92 — Drawer header lies on top of the dark image — fix cream */
      .fd-drawer-img-head h2 {
        font-family: 'Cormorant Garamond', 'Syne', serif;
        font-weight: 400; font-size: 1.6rem; margin: 0;
        color: #F5EFE0;
      }
      .fd-drawer-img-head p {
        color: rgba(245, 239, 224, 0.78); font-size: 0.78rem;
        margin: 4px 0 0;
      }

      .fd-drawer-body {
        flex: 1; overflow-y: auto;
        padding: 22px 22px 100px;
      }
      /* v92 — Drawer body theme-aware (lives in card bg, not over image) */
      .fd-drawer-section-title {
        font-size: 0.65rem; font-weight: 700;
        color: var(--accent);
        letter-spacing: 0.18em; text-transform: uppercase;
        margin-bottom: 12px;
      }
      .fd-drawer-rooms { display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px; }
      .fd-drawer-room {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 16px;
        background: var(--bg-pill);
        border: 1px solid var(--border-soft);
        border-radius: 14px;
        cursor: pointer; text-align: left;
        transition: all 0.22s ease;
      }
      .fd-drawer-room:hover { border-color: var(--accent); transform: translateY(-1px); }
      .fd-drawer-room.active {
        background: var(--accent-soft);
        border-color: var(--accent);
        box-shadow: 0 0 0 1px var(--accent-soft), 0 8px 20px rgba(201, 166, 107, 0.18);
      }
      .fd-drawer-room.soldout { opacity: 0.5; cursor: not-allowed; }
      .fd-drawer-room-left { flex: 1; min-width: 0; }
      .fd-drawer-room-type {
        display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        color: var(--text-base); font-size: 0.86rem; font-weight: 600;
        margin-bottom: 4px;
      }
      .fd-drawer-room-meta { color: var(--text-muted); font-size: 0.7rem; }
      .fd-drawer-room-right { text-align: right; flex-shrink: 0; padding-left: 12px; }
      .fd-drawer-room-price { color: var(--text-base); font-size: 1rem; font-weight: 800; }
      .fd-drawer-room-strike {
        color: var(--text-muted); font-size: 0.68rem;
        text-decoration: line-through;
      }
      .fd-pill {
        font-size: 0.55rem; font-weight: 700;
        padding: 2px 8px; border-radius: 999px;
        background: var(--accent-soft); color: var(--text-soft);
        letter-spacing: 0.06em;
      }
      .fd-pill.gold {
        background: linear-gradient(135deg, var(--cozy-champagne-light, #D9BE82), var(--cozy-champagne, #C9A66B));
        color: var(--text-inverse);
      }
      .fd-pill.red {
        background: rgba(212, 149, 131, 0.18); color: #c87878;
      }
      .fd-drawer-empty {
        padding: 14px; text-align: center;
        color: var(--text-muted); font-size: 0.78rem;
        background: var(--bg-pill);
        border: 1px dashed var(--border-soft);
        border-radius: 14px;
      }

      .fd-drawer-rules ul {
        list-style: none; padding: 0; margin: 0;
        display: flex; flex-direction: column; gap: 8px;
      }
      .fd-drawer-rules li {
        display: flex; align-items: flex-start; gap: 12px;
        padding: 10px 14px;
        background: var(--bg-pill);
        border: 1px solid var(--border-soft);
        border-radius: 12px;
        color: var(--text-soft); font-size: 0.78rem; line-height: 1.4;
      }
      .fd-drawer-rules li > span:first-child {
        font-size: 1rem; line-height: 1.1; flex-shrink: 0;
      }

      /* v92 — CTA wrapper sits at bottom of the drawer card. Use theme
         gradient that fades from transparent card bg into solid card bg
         so it reads on cream AND cocoa. */
      .fd-drawer-cta-wrap {
        position: absolute; left: 0; right: 0; bottom: 0;
        padding: 14px 22px;
        background: linear-gradient(180deg, transparent 0%, var(--bg-card) 35%, var(--bg-card) 100%);
        border-top: 1px solid var(--border-soft);
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
      }
      .fd-drawer-cta-info { flex-shrink: 0; }
      .fd-drawer-cta-strike {
        color: var(--text-muted); font-size: 0.7rem;
        text-decoration: line-through; line-height: 1;
      }
      .fd-drawer-cta-price {
        color: var(--text-base); font-size: 1.3rem; font-weight: 800; line-height: 1.1;
      }
      .fd-drawer-cta-price span { color: var(--text-muted); font-size: 0.68rem; font-weight: 500; margin-left: 4px; }
      .fd-drawer-cta {
        flex: 1;
        padding: 14px 20px;
        background: linear-gradient(135deg, #f0d060, #f0b429 60%, #d4a017);
        color: #0a0814; font-size: 0.92rem; font-weight: 800;
        border: none; border-radius: 14px;
        cursor: pointer;
        box-shadow: 0 10px 26px rgba(240,180,41,0.4), inset 0 1px 0 rgba(255,255,255,0.5);
        transition: all 0.2s ease;
        letter-spacing: 0.02em;
      }
      .fd-drawer-cta:hover { transform: translateY(-2px); box-shadow: 0 16px 36px rgba(240,180,41,0.5); }
    `}</style>
  );
}

/* ─────────────────────────────────────────────────────────────── */

export default function FlashDealsPage() {
  return (
    <Suspense>
      <FlashDealsContent />
    </Suspense>
  );
}
