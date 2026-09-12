"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { calculateDynamicPrice, demandTierFromScore } from "@/lib/ai-pricing";

type Mode = "checkIn" | "checkOut";

/**
 * Pricing mode — controls what each day cell displays:
 *   "hotel"  — per-day price for the supplied room(s) [default]
 *   "demand" — no price text; only the demand-tier color dot + an explanatory banner.
 *              Use when no specific hotel is selected yet (e.g. /bid request page).
 *   "none"   — no overlay at all, just the calendar.
 */
export type PricingMode = "hotel" | "demand" | "none";

interface Props {
  open: boolean;
  mode: Mode;
  checkIn: string;
  checkOut: string;
  /** v750 — rooms carry their `id` so the hotel-mode calendar can read the
   *  canonical pricing-spine livePrice per room (same authority as the room
   *  cards), instead of computing a separate per-day price. `floorPrice` is
   *  still used as the demand-mode anchor / legacy fallback shape. */
  rooms: Array<{ id?: string; floorPrice?: number | null }>;
  city: string;
  /** If set, check-in cannot be changed below this ISO date (e.g. "today" for flash deals). */
  minCheckIn?: string;
  pricingMode?: PricingMode;
  /** Optional banner rendered above the day grid (use for flash-deal context, demand explainer, etc.) */
  headerBanner?: React.ReactNode;
  onClose: () => void;
  onApply: (range: { checkIn: string; checkOut: string }) => void;
  /** v510 — render the calendar INLINE on the page (no modal backdrop / portal /
   *  scroll-lock / close button) instead of as an overlay. Used on the hotel
   *  detail page (desktop) so live per-day prices are visible without a tap. */
  inline?: boolean;
}

const WEEK = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function toIso(d: Date) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function fromIso(iso: string) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function addMonths(d: Date, n: number) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }

// v750 (PRICE-CONSISTENCY-01) — the 3-tier demand colour now comes from the ONE
// shared `demandTierFromScore` mapping in lib/ai-pricing (byte-identical to the
// former inline red≥72 / orange≥52 / green thresholds), so the calendar dots and
// the hotel room-card demand badges can never disagree about a demand score.

function formatPrice(n: number) {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000)   return `₹${Math.round(n / 100) / 10}k`;
  return `₹${n}`;
}

export default function LuxuryCalendar({
  open, mode, checkIn, checkOut, rooms, city, minCheckIn,
  pricingMode = "hotel", headerBanner,
  onClose, onApply, inline = false,
}: Props) {
  // Local draft so user can change both legs without committing until "Apply"
  const [draftIn,  setDraftIn]  = useState<string>(checkIn  || "");
  const [draftOut, setDraftOut] = useState<string>(checkOut || "");
  const [picking, setPicking]   = useState<Mode>(mode);
  const [cursor, setCursor]     = useState<Date>(() => {
    const base = fromIso(checkIn) || fromIso(checkOut) || new Date();
    return startOfMonth(base);
  });
  const [hoverDay, setHoverDay] = useState<string>("");
  const sheetRef = useRef<HTMLDivElement>(null);
  // v203.3 — portal-mount so calendar escapes any transform/overflow/z-index
  // trap from ancestors (BidGameZone's .bgz-shell with z:1000, /bid page's
  // animated containers, etc). SSR-safe: portalReady starts false, flips true
  // on mount. Combined with the .lux-cal-backdrop z-index bump to 1200,
  // calendar reliably appears on top of every customer surface including the
  // game zone.
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => { setPortalReady(true); }, []);

  // Reset when opened (or, inline, whenever the parent's dates change).
  useEffect(() => {
    if (!inline && !open) return;
    setDraftIn(checkIn || "");
    setDraftOut(checkOut || "");
    setPicking(mode);
    const base = fromIso(checkIn) || fromIso(checkOut) || new Date();
    setCursor(startOfMonth(base));
    // Inline: no scroll lock / no dock-hide (it lives in the page flow).
    if (inline) return;
    // body scroll lock + hide dock/dialer/back-chip while calendar is open
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("sb-modal-open");
    return () => {
      document.body.style.overflow = prev;
      document.body.classList.remove("sb-modal-open");
    };
  }, [open, mode, checkIn, checkOut, inline]);

  // Cheapest room floor price as anchor (demand-mode synthetic anchor / legacy).
  const floorAnchor = useMemo(() => {
    const prices = (rooms || [])
      .map(r => Number(r?.floorPrice) || 0)
      .filter(p => p > 0);
    if (!prices.length) return 0;
    return Math.min(...prices);
  }, [rooms]);

  // v750 (PRICE-CONSISTENCY-01) — the room ids that drive hotel-mode pricing.
  // When present (only on the hotel-detail page today), the calendar reads the
  // canonical pricing-spine livePrice per day rather than computing its own.
  const roomIds = useMemo(
    () => Array.from(new Set((rooms || []).map(r => (r?.id ? String(r.id) : "")).filter(Boolean))),
    [rooms],
  );
  // Canonical per-day price/tier resolved from the spine (hotel mode only),
  // keyed by ISO date. Accumulates across visited months.
  const [spineMap, setSpineMap] = useState<Record<string, { price: number; tier: "green" | "orange" | "red"; score: number }>>({});
  // Month+rooms fingerprints already fetched, so month navigation never restorms.
  const fetchedMonthsRef = useRef<Set<string>>(new Set());

  const todayIso = useMemo(() => toIso(new Date()), []);
  const todayDate = useMemo(() => { const t = new Date(); t.setHours(0,0,0,0); return t; }, []);

  // Build month grid (with leading blanks)
  const monthCells = useMemo(() => {
    const firstDow = startOfMonth(cursor).getDay();
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const cells: (Date | null)[] = Array(firstDow).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  // v750 (PRICE-CONSISTENCY-01) — HOTEL MODE: fetch the canonical pricing-spine
  // livePrice for the whole visible month in ONE batched request (no per-day
  // request storm). The price shown on a day cell is the LOWEST valid room
  // livePrice for that date ("starting from"), and the demand tier is derived
  // from that same room's canonical spine demandScore — the exact authority the
  // room cards read. If the spine can't resolve a date, that cell stays neutral
  // (no fabricated price, and NEVER a second pricing formula).
  useEffect(() => {
    if (pricingMode !== "hotel") return;
    if (!roomIds.length) return;
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const dates: string[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(y, m, d);
      if (dt < todayDate) continue;
      dates.push(toIso(dt));
    }
    if (!dates.length) return;
    const monthKey = `${y}-${m}|${roomIds.join(",")}`;
    if (fetchedMonthsRef.current.has(monthKey)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/pricing/spine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomIds, dates }),
        }).then((r) => r.json());
        if (cancelled) return;
        const byDate: Record<string, Record<string, any>> = res?.pricesByDate || {};
        const patch: Record<string, { price: number; tier: "green" | "orange" | "red"; score: number }> = {};
        for (const iso of dates) {
          const forDate = byDate[iso];
          if (!forDate) continue;
          let minLive = 0;
          let scoreAtMin = 0;
          for (const rid of roomIds) {
            const p = forDate[rid];
            const lp = Number(p?.livePrice) || 0;
            if (lp > 0 && (minLive === 0 || lp < minLive)) {
              minLive = lp;
              scoreAtMin = Number(p?.demandScore) || 0;
            }
          }
          if (minLive > 0) {
            patch[iso] = { price: minLive, tier: demandTierFromScore(scoreAtMin), score: scoreAtMin };
          }
        }
        // Mark fetched on any successful response (even an empty window) so
        // month nav never restorms; a network throw leaves it unmarked to retry.
        fetchedMonthsRef.current.add(monthKey);
        if (Object.keys(patch).length) setSpineMap((prev) => ({ ...prev, ...patch }));
      } catch {
        /* spine unreachable — hotel-mode cells stay neutral (never a 2nd authority) */
      }
    })();
    return () => { cancelled = true; };
  }, [pricingMode, roomIds, cursor, todayDate]);

  // Precompute prices/tiers for the month.
  //   HOTEL  mode → the canonical spine map (fetched above). No local formula.
  //   DEMAND mode → the local demand tier only (deterministic, hour-stable);
  //                 no specific hotel is selected so there is no spine to read.
  //   NONE   mode → nothing.
  const priceMap = useMemo(() => {
    if (pricingMode === "hotel") return spineMap;
    const out: Record<string, { price: number; tier: "green" | "orange" | "red"; score: number }> = {};
    if (pricingMode === "none") return out;
    // Demand mode uses a synthetic anchor (1000) since the price is never rendered.
    const anchor = floorAnchor || 1000;
    for (const d of monthCells) {
      if (!d) continue;
      if (d < todayDate) continue;
      const iso = toIso(d);
      try {
        const res = calculateDynamicPrice(anchor, iso, city || "Mussoorie");
        out[iso] = { price: res.price, tier: demandTierFromScore(res.demandScore), score: res.demandScore };
      } catch {}
    }
    return out;
  }, [monthCells, floorAnchor, city, todayDate, pricingMode, spineMap]);

  // Range helpers (using draft + hover preview)
  const inDate  = fromIso(draftIn);
  const outDate = fromIso(draftOut);
  const hoverDate = fromIso(hoverDay);

  function rangeBounds(): { start: Date | null; end: Date | null } {
    if (picking === "checkOut" && inDate && (hoverDate || outDate)) {
      const end = outDate || hoverDate!;
      if (end && end > inDate) return { start: inDate, end };
    }
    if (inDate && outDate && outDate > inDate) return { start: inDate, end: outDate };
    return { start: null, end: null };
  }
  const bounds = rangeBounds();

  function isInRange(d: Date) {
    if (!bounds.start || !bounds.end) return false;
    return d > bounds.start && d < bounds.end;
  }

  const minCheckInDate = useMemo(() => {
    if (!minCheckIn) return null;
    const d = fromIso(minCheckIn);
    if (!d) return null;
    d.setHours(0,0,0,0);
    return d;
  }, [minCheckIn]);

  function handleDayTap(iso: string, dateObj: Date) {
    if (dateObj < todayDate) return;

    if (picking === "checkIn") {
      // Lock check-in if minCheckIn is enforced and this tap would change it below the lock
      if (minCheckInDate && dateObj < minCheckInDate) return;
      setDraftIn(iso);
      // If new checkIn >= existing checkOut, clear checkOut
      if (draftOut && fromIso(draftOut)! <= dateObj) {
        setDraftOut("");
      }
      setPicking("checkOut");
    } else {
      // checkOut must be > checkIn
      if (!draftIn || dateObj <= fromIso(draftIn)!) {
        // treat tap as new checkIn instead — unless check-in is locked
        if (minCheckInDate && dateObj < minCheckInDate) return;
        setDraftIn(iso);
        setDraftOut("");
        setPicking("checkOut");
        return;
      }
      setDraftOut(iso);
    }
  }

  function clear() {
    setDraftIn(""); setDraftOut(""); setPicking("checkIn");
  }

  function apply() {
    if (draftIn && draftOut) {
      onApply({ checkIn: draftIn, checkOut: draftOut });
      onClose();
    } else if (draftIn && !draftOut) {
      // default to +1 night if user only picked checkIn
      const nextDay = fromIso(draftIn)!;
      nextDay.setDate(nextDay.getDate() + 1);
      onApply({ checkIn: draftIn, checkOut: toIso(nextDay) });
      onClose();
    }
  }

  const canPrev = startOfMonth(cursor).getTime() > startOfMonth(todayDate).getTime();
  const nights = (draftIn && draftOut)
    ? Math.max(1, Math.ceil((new Date(draftOut).getTime() - new Date(draftIn).getTime()) / 86400000))
    : 0;

  if (!inline && !open) return null;
  if (!inline && (!portalReady || typeof document === "undefined")) return null;

  const sheet = (
      <div
        ref={sheetRef}
        className={`lux-cal-sheet${inline ? " lux-cal-sheet-inline" : ""}`}
        onClick={inline ? undefined : (e => e.stopPropagation())}
      >
        {/* Top brand bar */}
        <div className="lux-cal-topbar">
          <div className="lux-cal-topbar-inner">
            <div>
              <p className="lux-cal-eyebrow">
                <span className="lux-cal-eyebrow-dot" /> AI Live Pricing · Tap any date
              </p>
              <h3 className="lux-cal-title">Select your stay</h3>
            </div>
            {!inline && <button onClick={onClose} aria-label="Close" className="lux-cal-close"><X size={16} strokeWidth={2.4} aria-hidden /></button>}
          </div>

          {/* Selected range chips */}
          <div className="lux-cal-legs">
            <button
              type="button"
              onClick={() => { if (!minCheckIn) setPicking("checkIn"); }}
              disabled={!!minCheckIn}
              className={`lux-cal-leg ${picking === "checkIn" ? "is-active" : ""} ${minCheckIn ? "is-locked" : ""}`}
              aria-disabled={!!minCheckIn}
            >
              <span className="lux-cal-leg-label">Check-in{minCheckIn ? " · Locked" : ""}</span>
              <span className="lux-cal-leg-value">
                {draftIn
                  ? new Date(draftIn).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })
                  : "Add date"}
              </span>
            </button>
            <span className="lux-cal-arrow"><ArrowRight size={14} strokeWidth={2.4} aria-hidden /></span>
            <button
              type="button"
              onClick={() => setPicking("checkOut")}
              className={`lux-cal-leg ${picking === "checkOut" ? "is-active" : ""}`}
            >
              <span className="lux-cal-leg-label">Check-out</span>
              <span className="lux-cal-leg-value">
                {draftOut
                  ? new Date(draftOut).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })
                  : "Add date"}
              </span>
            </button>
          </div>

          {/* Legend — adapts to the active pricing mode */}
          {pricingMode !== "none" && (
            <div className="lux-cal-legend">
              {pricingMode === "demand" ? (
                <>
                  <span className="lux-cal-legend-item"><i className="d-green" /> Low demand</span>
                  <span className="lux-cal-legend-item"><i className="d-orange" /> Moderate</span>
                  <span className="lux-cal-legend-item"><i className="d-red" /> Peak / Holiday</span>
                </>
              ) : (
                <>
                  <span className="lux-cal-legend-item"><i className="d-green" /> Best Deal</span>
                  <span className="lux-cal-legend-item"><i className="d-orange" /> High Demand</span>
                  <span className="lux-cal-legend-item"><i className="d-red" /> Peak / Surge</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Optional context banner (flash-deal explainer, etc.) */}
        {headerBanner && <div className="lux-cal-banner">{headerBanner}</div>}

        {/* Month nav */}
        <div className="lux-cal-monthnav">
          <button
            type="button"
            disabled={!canPrev}
            onClick={() => setCursor(addMonths(cursor, -1))}
            className="lux-cal-navbtn"
            aria-label="Previous month"
          ><ChevronLeft size={17} strokeWidth={2.4} aria-hidden /></button>
          <div className="lux-cal-monthlabel">
            {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
          </div>
          <button
            type="button"
            onClick={() => setCursor(addMonths(cursor, 1))}
            className="lux-cal-navbtn"
            aria-label="Next month"
          ><ChevronRight size={17} strokeWidth={2.4} aria-hidden /></button>
        </div>

        {/* Weekday header */}
        <div className="lux-cal-weekrow">
          {WEEK.map((w, i) => (
            <div key={i} className={`lux-cal-weekcell ${i===0 || i===6 ? "is-weekend" : ""}`}>{w}</div>
          ))}
        </div>

        {/* Day grid */}
        <div className="lux-cal-grid">
          {monthCells.map((d, idx) => {
            if (!d) return <div key={idx} className="lux-cal-day is-blank" />;
            const iso = toIso(d);
            const past = d < todayDate;
            const isToday = isSameDay(d, todayDate);
            const isIn  = !!draftIn  && isSameDay(d, fromIso(draftIn)!);
            const isOut = !!draftOut && isSameDay(d, fromIso(draftOut)!);
            const inRange = isInRange(d);
            const pData = priceMap[iso];

            const classes = [
              "lux-cal-day",
              past ? "is-past" : "",
              isToday ? "is-today" : "",
              isIn ? "is-checkin" : "",
              isOut ? "is-checkout" : "",
              inRange ? "is-inrange" : "",
              pData ? `tier-${pData.tier}` : "",
            ].filter(Boolean).join(" ");

            return (
              <button
                key={idx}
                type="button"
                disabled={past}
                onClick={() => handleDayTap(iso, d)}
                onMouseEnter={() => !past && setHoverDay(iso)}
                onMouseLeave={() => setHoverDay("")}
                className={classes}
              >
                <span className="lux-cal-daynum">{d.getDate()}</span>
                {!past && pData && pricingMode === "hotel" && (
                  <span className="lux-cal-dayprice">{formatPrice(pData.price)}</span>
                )}
                {!past && pricingMode === "demand" && pData && (
                  <span className="lux-cal-daylabel">
                    {pData.tier === "green" ? "Low" : pData.tier === "orange" ? "Med" : "High"}
                  </span>
                )}
                {/* v750 — hotel mode: when the canonical spine price is
                    unresolved for a date (outage / not yet loaded), show a
                    neutral dot instead of a fabricated price. */}
                {!past && !pData && pricingMode === "hotel" && (
                  <span className="lux-cal-daydot" />
                )}
                {/* v243.1 — the today cell is marked by the champagne ring
                    (.is-today in CSS). Suppress the "Today" text whenever the
                    cell already shows content — a price (hotel mode) OR a
                    demand label (Low/Med/High) — otherwise the bottom-anchored
                    "TODAY" overlapped it (e.g. "TODAY" on "HIGH" / "₹4.9k").
                    Today is still unmistakable from the ring + dot. */}
                {isToday && !(pData && (pricingMode === "hotel" || pricingMode === "demand")) && (
                  <span className="lux-cal-todaymark">Today</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="lux-cal-footer">
          <div className="lux-cal-footer-info">
            {nights > 0 ? (
              <>
                <span className="lux-cal-nights">{nights} night{nights > 1 ? "s" : ""}</span>
                <span className="lux-cal-footer-sub">
                  {pricingMode === "demand"
                    ? "Demand level shown · Hotels bid based on you"
                    : pricingMode === "none"
                      ? "Pick your stay"
                      : "Prices update hourly · AI Live Engine"}
                </span>
              </>
            ) : (
              <>
                <span className="lux-cal-nights">Pick your dates</span>
                <span className="lux-cal-footer-sub">
                  {picking === "checkIn" ? "Tap a date to set Check-in" : "Tap a date to set Check-out"}
                </span>
              </>
            )}
          </div>
          <div className="lux-cal-footer-actions">
            <button type="button" onClick={clear} className="lux-cal-btn-ghost">Clear</button>
            <button
              type="button"
              onClick={apply}
              disabled={!draftIn}
              className="lux-cal-btn-primary"
            >
              {draftIn && draftOut ? "Apply Dates" : draftIn ? "Apply (+1 night)" : "Apply"}
            </button>
          </div>
        </div>
      </div>
  );

  if (inline) return <div className="lux-cal-inline-wrap">{sheet}</div>;
  return createPortal(
    <div className="lux-cal-backdrop" onClick={onClose} role="dialog" aria-modal="true">{sheet}</div>,
    document.body,
  );
}
