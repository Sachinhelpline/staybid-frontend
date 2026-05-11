"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { calculateDynamicPrice } from "@/lib/ai-pricing";

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
  rooms: Array<{ floorPrice?: number | null }>;
  city: string;
  /** If set, check-in cannot be changed below this ISO date (e.g. "today" for flash deals). */
  minCheckIn?: string;
  pricingMode?: PricingMode;
  /** Optional banner rendered above the day grid (use for flash-deal context, demand explainer, etc.) */
  headerBanner?: React.ReactNode;
  onClose: () => void;
  onApply: (range: { checkIn: string; checkOut: string }) => void;
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

// 3-tier demand color: green / orange / red
function demandTier(score: number): "green" | "orange" | "red" {
  if (score >= 72) return "red";       // Very High + Surge
  if (score >= 52) return "orange";    // High
  return "green";                       // Low + Moderate
}

function formatPrice(n: number) {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000)   return `₹${Math.round(n / 100) / 10}k`;
  return `₹${n}`;
}

export default function LuxuryCalendar({
  open, mode, checkIn, checkOut, rooms, city, minCheckIn,
  pricingMode = "hotel", headerBanner,
  onClose, onApply,
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

  // Reset when opened
  useEffect(() => {
    if (!open) return;
    setDraftIn(checkIn || "");
    setDraftOut(checkOut || "");
    setPicking(mode);
    const base = fromIso(checkIn) || fromIso(checkOut) || new Date();
    setCursor(startOfMonth(base));
    // body scroll lock
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open, mode, checkIn, checkOut]);

  // Cheapest room floor price as anchor
  const floorAnchor = useMemo(() => {
    const prices = (rooms || [])
      .map(r => Number(r?.floorPrice) || 0)
      .filter(p => p > 0);
    if (!prices.length) return 0;
    return Math.min(...prices);
  }, [rooms]);

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

  // Precompute prices/tiers for the month (deterministic — calculateDynamicPrice is hour-stable)
  // For "demand" mode we still compute the tier (so color dots render) but never expose price.
  // For "none" mode we skip the computation entirely.
  const priceMap = useMemo(() => {
    const out: Record<string, { price: number; tier: "green" | "orange" | "red"; score: number }> = {};
    if (pricingMode === "none") return out;
    // Demand mode falls back to a synthetic anchor (1000) since we never render the price anyway.
    const anchor = floorAnchor || (pricingMode === "demand" ? 1000 : 0);
    if (!anchor) return out;
    for (const d of monthCells) {
      if (!d) continue;
      if (d < todayDate) continue;
      const iso = toIso(d);
      try {
        const res = calculateDynamicPrice(anchor, iso, city || "Mussoorie");
        out[iso] = { price: res.price, tier: demandTier(res.demandScore), score: res.demandScore };
      } catch {}
    }
    return out;
  }, [monthCells, floorAnchor, city, todayDate, pricingMode]);

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

  if (!open) return null;

  return (
    <div
      className="lux-cal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={sheetRef}
        className="lux-cal-sheet"
        onClick={e => e.stopPropagation()}
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
            <button onClick={onClose} aria-label="Close" className="lux-cal-close">✕</button>
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
            <span className="lux-cal-arrow">→</span>
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
          >‹</button>
          <div className="lux-cal-monthlabel">
            {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
          </div>
          <button
            type="button"
            onClick={() => setCursor(addMonths(cursor, 1))}
            className="lux-cal-navbtn"
            aria-label="Next month"
          >›</button>
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
                {!past && !pData && floorAnchor === 0 && pricingMode === "hotel" && (
                  <span className="lux-cal-daydot" />
                )}
                {isToday && <span className="lux-cal-todaymark">Today</span>}
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
    </div>
  );
}
