"use client";
// ═══════════════════════════════════════════════════════════════════════
// AvailabilityCalendar — premium per-room × per-day occupancy grid for
// the partner dashboard.
//
// v132 — Three-view rewrite (Month default, Grid power-user, Room timeline)
// addressing the "outdated" feedback on the cramped 36×36 horizontal grid.
//
// What this owns:
//   • View-mode toggle (📅 Month / 🛏️ Room / 📊 Grid) at the top.
//   • Month view (DEFAULT) — full 7-column month calendar; each date shows
//     a free-rooms count + colored mini-chips (one chip per room category,
//     status-tinted). Tap a date → slide-in detail panel showing every
//     room's status for that day + walk-in / block actions inline.
//   • Room view — horizontal room-card picker on top; pick one, see THAT
//     room's full month in large easy-to-read cells with status labels.
//   • Grid view — original v113 per-room × per-day matrix preserved for
//     power users who want all-at-a-glance.
//   • All three views share the same legend, drag-tip, popover, and bulk
//     "📌 Block dates" sheet — host page contract is unchanged.
//
// Calendar data shape is the SAME one /api/partner/calendar returns —
// no new backend contract needed.
//
// Bulk block writes through /api/partner/walk-in with `source: "manual"`
// (or whatever the user picked). The existing endpoint accepts that
// extra field.
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type Room = {
  id: string;
  type?: string;
  name?: string;
  capacity?: number;
};

export type Occupancy = {
  source?: "bid" | "walk_in" | "ota_ical" | "manual" | "group";
  guestName?: string;
  amount?: number;
  provider?: string;
  note?: string;
  refId?: string;
  assignedUnitId?: string;
  assignedUnitNumber?: string;
};

export type CalendarMap = Record<string, Record<string, Occupancy>>; // roomId -> dateISO -> occ

// v132.3 — base room price set (one entry per room).
// Four prices: regular MRP, floor (bid minimum), flash floor.
// flashPrice (flash regular) lives on flash_deals rows, looked up via
// the FlashByRoomMap below.
export type RoomPriceMap = Record<string, {
  basePrice:           number | null; // rooms.floorPrice (bid floor)
  baseQty:             number | null; // rooms.quantity
  mrp:                 number | null; // rooms.mrp (regular price)
  baseFlashFloorPrice: number | null; // rooms.flashFloorPrice
}>;

// v132.3 — per-date per-room overrides indexed by `${roomId}|${date}`
export type PriceOverrideMap = Record<string, {
  id: string;
  roomId: string;
  date: string;
  floorPrice:        number | null;
  mrp:               number | null;
  flashPrice:        number | null;
  flashFloorPrice:   number | null;
  quantityOverride:  number | null;
  note: string | null;
}>;

// v132.3 — active flash deals per room
export type FlashByRoomMap = Record<string, Array<{
  id: string;
  price: number | null;
  floorPrice: number | null;
  validUntil: string;
}>>;

export type AutopilotMode = "auto" | "hybrid" | "manual";

export type PricingSavePayload = {
  items: Array<{
    roomId: string;
    date: string;
    floorPrice?: number | null;
    mrp?: number | null;
    flashPrice?: number | null;
    flashFloorPrice?: number | null;
    quantityOverride?: number | null;
    note?: string | null;
  }>;
};

// ─── ISO date helpers (UTC-stable; matches lib/availability.ts) ──────────
function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

const SOURCE_STYLE: Record<string, { bg: string; border: string; pip: string; label: string }> = {
  bid:      { bg: "linear-gradient(135deg,#f0f3f5,#dfe5eb)", border: "#90a4b8", pip: "#5c7690", label: "Bid booked"      },
  ota_ical: { bg: "linear-gradient(135deg,#dbeafe,#bfdbfe)", border: "#3b82f6", pip: "#1d4ed8", label: "OTA channel"     },
  walk_in:  { bg: "linear-gradient(135deg,#fce7f3,#fbcfe8)", border: "#db2777", pip: "#9d174d", label: "Walk-in"         },
  manual:   { bg: "repeating-linear-gradient(135deg,#e5e7eb 0 4px,#d1d5db 4px 8px)", border: "#9ca3af", pip: "#374151", label: "Blocked"  },
  group:    { bg: "linear-gradient(135deg,#ede9fe,#ddd6fe)", border: "#7c3aed", pip: "#5b21b6", label: "Group"           },
};
const FREE_BG     = "linear-gradient(135deg,#ecfccb,#d9f99d)";
const FREE_BORDER = "#a7d046";

type ViewMode = "month" | "room" | "grid";

type Props = {
  rooms: Room[];
  calendar: CalendarMap;
  month: Date;
  onMonthChange: (d: Date) => void;
  onRefresh: () => void;
  loading?: boolean;
  onPickWalkIn: (args: { roomId: string; fromDate: string; toDate: string }) => void;
  onDeleteBlock: (refId: string) => void;
  onOpenBlockSheet: () => void;
  // v132.2 — pricing
  roomPrices?: RoomPriceMap;
  priceOverrides?: PriceOverrideMap;
  onSavePricing?: (payload: PricingSavePayload) => Promise<void>;
  onClearPricing?: (args: { roomId: string; date: string }) => Promise<void>;
  // v132.3 — autopilot mode + flash deals (drives warnings in editor)
  autopilotMode?: AutopilotMode;
  flashByRoom?: FlashByRoomMap;
};

export default function AvailabilityCalendar({
  rooms, calendar, month, onMonthChange, onRefresh, loading,
  onPickWalkIn, onDeleteBlock, onOpenBlockSheet,
  roomPrices = {}, priceOverrides = {}, onSavePricing, onClearPricing,
  autopilotMode = "auto", flashByRoom = {},
}: Props) {
  // ── View mode + active room (for Room view) ────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [activeRoomId, setActiveRoomId] = useState<string>("");

  // Auto-pick first room when entering Room view if none chosen yet.
  useEffect(() => {
    if (viewMode === "room" && !activeRoomId && rooms.length > 0) {
      setActiveRoomId(rooms[0].id);
    }
  }, [viewMode, activeRoomId, rooms]);

  // ── Today + month days ─────────────────────────────────────────────
  const todayISO = toISO(new Date());
  const days = useMemo(() => {
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => {
      const d = new Date(month.getFullYear(), month.getMonth(), i + 1);
      return { iso: toISO(d), date: d, day: d.getDate(), dow: d.getDay() };
    });
  }, [month]);

  // ── Stats (top legend chips — all rooms × all days in current month) ─
  const stats = useMemo(() => {
    let free = 0, bid = 0, ota = 0, walk = 0, manual = 0, group = 0;
    rooms.forEach(r => {
      days.forEach(d => {
        const cell = calendar[r.id]?.[d.iso];
        if (!cell) free++;
        else if (cell.source === "bid") bid++;
        else if (cell.source === "ota_ical") ota++;
        else if (cell.source === "walk_in") walk++;
        else if (cell.source === "group") group++;
        else manual++;
      });
    });
    return { free, bid, ota, walk, manual, group };
  }, [rooms, days, calendar]);

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="ac-root">
      {/* ── Header: month nav + bulk block + refresh ─────────────── */}
      <div className="ac-toolbar">
        <div className="ac-month-nav">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            className="ac-icon-btn"
          >‹</button>
          <span className="ac-month-label">
            {month.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
          </span>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            className="ac-icon-btn"
          >›</button>
          <button
            type="button"
            onClick={() => onMonthChange(new Date())}
            className="ac-today-btn"
          >Today</button>
        </div>
        <div className="ac-actions">
          <button type="button" onClick={onOpenBlockSheet} className="ac-block-btn">
            📌 Block dates
          </button>
          <button type="button" onClick={onRefresh} disabled={loading} className="ac-refresh-btn">
            {loading ? "⟳ Loading…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {/* ── View-mode toggle (Month / Room / Grid) ───────────────── */}
      <div className="ac-viewbar" role="tablist" aria-label="Calendar view">
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === "month"}
          className={`ac-view-btn ${viewMode === "month" ? "ac-view-on" : ""}`}
          onClick={() => setViewMode("month")}
        >
          <span className="ac-view-emoji">📅</span>
          <span className="ac-view-label">Month</span>
          <span className="ac-view-hint">whole month at a glance</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === "room"}
          className={`ac-view-btn ${viewMode === "room" ? "ac-view-on" : ""}`}
          onClick={() => setViewMode("room")}
        >
          <span className="ac-view-emoji">🛏️</span>
          <span className="ac-view-label">Room</span>
          <span className="ac-view-hint">one room timeline</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === "grid"}
          className={`ac-view-btn ${viewMode === "grid" ? "ac-view-on" : ""}`}
          onClick={() => setViewMode("grid")}
        >
          <span className="ac-view-emoji">📊</span>
          <span className="ac-view-label">Grid</span>
          <span className="ac-view-hint">classic matrix</span>
        </button>
      </div>

      {/* ── Legend chips ─────────────────────────────────────────── */}
      <div className="ac-legend">
        <LegendChip bg={FREE_BG} border={FREE_BORDER} label="Available" count={stats.free} />
        <LegendChip {...SOURCE_STYLE.bid}      count={stats.bid} />
        <LegendChip {...SOURCE_STYLE.ota_ical} count={stats.ota} />
        <LegendChip {...SOURCE_STYLE.walk_in}  count={stats.walk} />
        <LegendChip {...SOURCE_STYLE.manual}   count={stats.manual} />
        <LegendChip {...SOURCE_STYLE.group}    count={stats.group} />
      </div>

      {/* ── Empty state ─────────────────────────────────────────── */}
      {rooms.length === 0 ? (
        <div className="ac-empty">
          No rooms configured yet. Add rooms in the <b>Rooms</b> tab first.
        </div>
      ) : (
        <>
          {viewMode === "month" && (
            <MonthView
              rooms={rooms}
              calendar={calendar}
              month={month}
              todayISO={todayISO}
              onPickWalkIn={onPickWalkIn}
              onDeleteBlock={onDeleteBlock}
              roomPrices={roomPrices}
              priceOverrides={priceOverrides}
              onSavePricing={onSavePricing}
              onClearPricing={onClearPricing}
              autopilotMode={autopilotMode}
              flashByRoom={flashByRoom}
            />
          )}

          {viewMode === "room" && (
            <RoomTimelineView
              rooms={rooms}
              calendar={calendar}
              days={days}
              month={month}
              todayISO={todayISO}
              activeRoomId={activeRoomId}
              setActiveRoomId={setActiveRoomId}
              onPickWalkIn={onPickWalkIn}
              onDeleteBlock={onDeleteBlock}
              roomPrices={roomPrices}
              priceOverrides={priceOverrides}
            />
          )}

          {viewMode === "grid" && (
            <GridView
              rooms={rooms}
              calendar={calendar}
              days={days}
              todayISO={todayISO}
              onPickWalkIn={onPickWalkIn}
              onDeleteBlock={onDeleteBlock}
            />
          )}
        </>
      )}

      <style jsx>{`
        /* ── v132.1 — Calendar is intentionally self-themed.
           It floats as a warm cream card on the partner panel's dark
           background; mixing dark-theme tokens with hardcoded light
           status-color gradients (FREE_BG green, SOURCE_STYLE.*.bg)
           created unreadable white-on-light-green text in the
           previous build. All cell surfaces + text are now fixed
           light/dark regardless of the surrounding theme.            */
        .ac-root {
          background: #fcfcfd;
          border: 1px solid rgba(232,228,217,0.8);
          border-radius: 18px;
          padding: 16px;
          box-shadow: 0 6px 22px rgba(31,26,15,0.18);
          color: #1F1A0F;
        }

        .ac-toolbar {
          display: flex; align-items: center; justify-content: space-between;
          flex-wrap: wrap; gap: 10px;
        }
        .ac-month-nav { display: flex; align-items: center; gap: 6px; }
        .ac-month-label {
          font-family: "Cormorant Garamond", serif;
          font-size: 1.25rem; font-weight: 500;
          color: #1F1A0F;
          padding: 0 10px;
          min-width: 160px; text-align: center;
        }
        .ac-icon-btn {
          width: 34px; height: 34px; border-radius: 10px;
          background: #fcfcfd;
          border: 1px solid rgba(232,228,217,0.8);
          color: #4A3820;
          font-size: 1.2rem; font-weight: bold;
          cursor: pointer;
          transition: transform 0.12s ease, background 0.15s ease;
        }
        .ac-icon-btn:hover { background: rgba(201,166,107,0.14); }
        .ac-icon-btn:active { transform: scale(0.94); }
        .ac-today-btn {
          margin-left: 4px;
          padding: 6px 12px; border-radius: 10px;
          background: rgba(201,166,107,0.14);
          color: #8B6914;
          border: 1px solid rgba(201,166,107,0.28);
          font-size: 0.78rem; font-weight: 700;
          cursor: pointer;
        }
        .ac-today-btn:hover { background: rgba(201,166,107,0.22); }

        .ac-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .ac-block-btn, .ac-refresh-btn {
          padding: 8px 14px; border-radius: 10px;
          font-size: 0.82rem; font-weight: 700;
          cursor: pointer;
          transition: transform 0.12s ease, box-shadow 0.15s ease;
        }
        .ac-block-btn {
          background: linear-gradient(135deg, #b4c1cf, #C9A66B);
          color: #1F1A0F;
          border: 1px solid rgba(110,84,48,0.30);
          box-shadow: 0 2px 8px rgba(201,166,107,0.30);
        }
        .ac-block-btn:hover { box-shadow: 0 4px 14px rgba(201,166,107,0.45); }
        .ac-block-btn:active { transform: scale(0.97); }
        .ac-refresh-btn {
          background: #4A3820;
          color: #fcfcfd;
          border: 1px solid #4A3820;
        }
        .ac-refresh-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        .ac-viewbar {
          margin-top: 14px;
          display: flex;
          gap: 8px;
          background: #fcfcfd;
          border: 1px solid rgba(232,228,217,0.8);
          border-radius: 14px;
          padding: 6px;
        }
        .ac-view-btn {
          flex: 1 1 0;
          min-width: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1px;
          padding: 10px 6px;
          background: transparent;
          border: 1px solid transparent;
          border-radius: 10px;
          color: #4A3820;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.18s ease;
        }
        .ac-view-btn:hover { background: rgba(201,166,107,0.10); }
        .ac-view-on {
          background: linear-gradient(135deg, #fcfcfd, #e7ebef);
          border-color: rgba(201,166,107,0.45);
          box-shadow: 0 2px 8px rgba(201,166,107,0.18);
        }
        .ac-view-emoji {
          font-size: 1.15rem;
          line-height: 1;
        }
        .ac-view-label {
          font-size: 0.84rem;
          font-weight: 700;
          color: #1F1A0F;
          letter-spacing: 0.01em;
        }
        .ac-view-hint {
          font-size: 0.6rem;
          font-weight: 500;
          color: #6E5430;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          margin-top: 1px;
        }
        @media (max-width: 480px) {
          .ac-view-hint { display: none; }
          .ac-view-btn { padding: 9px 6px; }
        }

        .ac-legend {
          margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px;
        }

        .ac-empty {
          margin-top: 18px;
          text-align: center;
          padding: 36px 16px;
          color: #6E5430;
          background: #fcfcfd;
          border-radius: 14px;
          border: 1px dashed rgba(110,84,48,0.30);
        }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MonthView — 7-column whole-month calendar (new default in v132).
// Each date cell shows free-room count + status-tinted mini chips per
// room category. Tap a date → slide-in detail panel.
// ═══════════════════════════════════════════════════════════════════════
function MonthView({
  rooms, calendar, month, todayISO, onPickWalkIn, onDeleteBlock,
  roomPrices = {}, priceOverrides = {}, onSavePricing, onClearPricing,
  autopilotMode = "auto", flashByRoom = {},
}: {
  rooms: Room[];
  calendar: CalendarMap;
  month: Date;
  todayISO: string;
  onPickWalkIn: (args: { roomId: string; fromDate: string; toDate: string }) => void;
  onDeleteBlock: (refId: string) => void;
  roomPrices?: RoomPriceMap;
  priceOverrides?: PriceOverrideMap;
  onSavePricing?: (payload: PricingSavePayload) => Promise<void>;
  onClearPricing?: (args: { roomId: string; date: string }) => Promise<void>;
  autopilotMode?: AutopilotMode;
  flashByRoom?: FlashByRoomMap;
}) {
  // Build the 6-week × 7-day grid leading edge — same algorithm as iOS/
  // Google Calendar (week starts Sunday for India locale parity).
  const grid = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const startDow = first.getDay();           // 0=Sun .. 6=Sat
    const start = addDays(first, -startDow);   // back up to the Sunday
    return Array.from({ length: 42 }, (_, i) => {
      const d = addDays(start, i);
      return {
        iso: toISO(d),
        date: d,
        day: d.getDate(),
        dow: d.getDay(),
        inMonth: d.getMonth() === month.getMonth(),
      };
    });
  }, [month]);

  const [selectedISO, setSelectedISO] = useState<string | null>(null);
  const selectedDay = useMemo(() => grid.find(g => g.iso === selectedISO) || null, [grid, selectedISO]);

  // ── v132.2 — multi-select mode + bulk pricing editor ─────────────
  // When `multiMode` is on, tapping cells toggles them into selectedSet
  // instead of opening the single-day panel. After picking dates the
  // partner taps "Edit price/qty" → bulk editor opens.
  const [multiMode, setMultiMode] = useState(false);
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());
  // v132.3 — unified editor state. dates.length === 1 → single-cell edit
  // (Reset-to-base shown), dates.length > 1 → bulk edit (room picker shown).
  const [editor, setEditor] = useState<null | {
    roomId: string;
    dates: string[];
    initialTab: "regular" | "floor" | "flash" | "flashFloor" | "quantity";
  }>(null);

  function toggleDateInSet(iso: string) {
    setSelectedSet(prev => {
      const n = new Set(prev);
      if (n.has(iso)) n.delete(iso); else n.add(iso);
      return n;
    });
  }
  function clearSet() { setSelectedSet(new Set()); }
  function exitMultiMode() { setMultiMode(false); clearSet(); }

  function statusFor(roomId: string, iso: string) {
    const cell = calendar[roomId]?.[iso];
    if (!cell) return { src: null as null | string, color: "#a7d046", isFree: true, occ: undefined as Occupancy | undefined };
    return { src: cell.source || "manual", color: SOURCE_STYLE[cell.source || "manual"]?.pip || "#374151", isFree: false, occ: cell };
  }

  function summaryFor(iso: string) {
    let free = 0;
    rooms.forEach(r => { if (!calendar[r.id]?.[iso]) free++; });
    return { free, total: rooms.length };
  }

  // Resolve effective price for (room, date): override if set, else base.
  function priceFor(roomId: string, iso: string): number | null {
    const ovr = priceOverrides[`${roomId}|${iso}`];
    if (ovr && ovr.floorPrice != null) return ovr.floorPrice;
    return roomPrices[roomId]?.basePrice ?? null;
  }
  function qtyFor(roomId: string, iso: string): number | null {
    const ovr = priceOverrides[`${roomId}|${iso}`];
    if (ovr && ovr.quantityOverride != null) return ovr.quantityOverride;
    return roomPrices[roomId]?.baseQty ?? null;
  }
  // Cheapest effective price across all rooms for a given date (display in cell).
  function dayMinPrice(iso: string): number | null {
    let min: number | null = null;
    rooms.forEach(r => {
      const p = priceFor(r.id, iso);
      if (p != null && (min == null || p < min)) min = p;
    });
    return min;
  }

  const selectedCount = selectedSet.size;
  const showPricing = !!onSavePricing;

  return (
    <div className="mv-wrap">
      <div className="mv-tipbar">
        {multiMode ? (
          <p className="mv-tip mv-tip-multi">
            <b>🎯 Multi-day mode</b> — tap dates to select.
            {selectedCount > 0 && <> Selected <b>{selectedCount}</b>.</>}
          </p>
        ) : (
          <p className="mv-tip">💡 Tap any date for breakdown · prices shown at bottom of cell · <b>multi-day</b> for bulk edits.</p>
        )}
        {showPricing && (
          multiMode ? (
            <div className="mv-multi-actions">
              {selectedCount > 0 && (
                <button type="button" className="mv-mini-btn mv-mini-clear" onClick={clearSet}>Clear</button>
              )}
              <button type="button" className="mv-mini-btn mv-mini-cancel" onClick={exitMultiMode}>✕ Done</button>
            </div>
          ) : (
            <button type="button" className="mv-mini-btn mv-mini-multi" onClick={() => setMultiMode(true)}>
              📅 Multi-day
            </button>
          )
        )}
      </div>

      <div className="mv-grid-wrap">
        {/* Week-day header */}
        <div className="mv-weekhd">
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((w, i) => (
            <span key={w} className={`mv-weekhd-day ${i === 0 || i === 6 ? "mv-weekhd-we" : ""}`}>{w}</span>
          ))}
        </div>

        {/* 6×7 month grid */}
        <div className="mv-grid">
          {grid.map(d => {
            const isToday = d.iso === todayISO;
            const isWE = d.dow === 0 || d.dow === 6;
            const sum = summaryFor(d.iso);
            const pct = rooms.length ? sum.free / rooms.length : 0;
            const fillColor =
              pct >= 0.66 ? "#9DAD8F" :
              pct >= 0.33 ? "#b4c1cf" :
              pct > 0     ? "#D49583" :
                            "#9ca3af";
            const minP = d.inMonth ? dayMinPrice(d.iso) : null;
            const inSet = selectedSet.has(d.iso);

            return (
              <button
                key={d.iso}
                type="button"
                className={`mv-cell ${d.inMonth ? "" : "mv-cell-out"} ${isToday ? "mv-cell-today" : ""} ${isWE ? "mv-cell-we" : ""} ${(!multiMode && selectedISO === d.iso) ? "mv-cell-on" : ""} ${inSet ? "mv-cell-multi-on" : ""}`}
                onClick={() => {
                  if (!d.inMonth) return;
                  if (multiMode) toggleDateInSet(d.iso);
                  else setSelectedISO(d.iso);
                }}
                aria-label={`${d.iso} — ${sum.free} of ${sum.total} available${minP != null ? `, from ₹${minP}` : ""}`}
              >
                <div className="mv-cell-top">
                  <span className="mv-day-num">{d.day}</span>
                  {d.inMonth && (
                    <span className="mv-free-pill" style={{ color: fillColor, borderColor: `${fillColor}55` }}>
                      {sum.free}/{sum.total}
                    </span>
                  )}
                </div>
                {d.inMonth && (
                  <div className="mv-chips">
                    {rooms.slice(0, 6).map(r => {
                      const st = statusFor(r.id, d.iso);
                      return (
                        <span
                          key={r.id}
                          className="mv-chip"
                          style={{
                            background: st.isFree ? FREE_BG : (SOURCE_STYLE[st.src || "manual"]?.bg || FREE_BG),
                            borderColor: st.isFree ? FREE_BORDER : (SOURCE_STYLE[st.src || "manual"]?.border || FREE_BORDER),
                          }}
                          aria-hidden
                        />
                      );
                    })}
                    {rooms.length > 6 && (
                      <span className="mv-chip-more">+{rooms.length - 6}</span>
                    )}
                  </div>
                )}
                {d.inMonth && minP != null && (
                  <span className="mv-cell-price">₹{minP >= 1000 ? `${(minP / 1000).toFixed(minP % 1000 === 0 ? 0 : 1)}k` : minP}</span>
                )}
                {inSet && <span className="mv-cell-check" aria-hidden>✓</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Multi-day bottom action bar — shown when at least 1 date picked */}
      {multiMode && selectedCount > 0 && typeof document !== "undefined" && createPortal(
        <div className="mv-bulkbar">
          <div className="mv-bulkbar-inner">
            <div className="mv-bulkbar-meta">
              <b>{selectedCount}</b> date{selectedCount === 1 ? "" : "s"} selected
            </div>
            <div className="mv-bulkbar-actions">
              <button
                type="button"
                className="mv-bulk-btn"
                onClick={() => {
                  if (rooms.length === 0) return;
                  setEditor({
                    roomId: rooms[0].id,
                    dates: Array.from(selectedSet).sort(),
                    initialTab: "floor",
                  });
                }}
              >💰 Price</button>
              <button
                type="button"
                className="mv-bulk-btn"
                onClick={() => {
                  if (rooms.length === 0) return;
                  setEditor({
                    roomId: rooms[0].id,
                    dates: Array.from(selectedSet).sort(),
                    initialTab: "quantity",
                  });
                }}
              >🔢 Qty</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Day-detail panel — portaled to document.body so the modal's
          position:fixed anchors to the viewport instead of getting
          trapped inside the partner page's .fade-up transform
          containing block (which was leaving the panel below the
          viewport on mobile, requiring scroll to reveal). */}
      {selectedDay && typeof document !== "undefined" && createPortal(
        <div className="mv-panel-backdrop" onClick={() => setSelectedISO(null)}>
          <div className="mv-panel" onClick={(e) => e.stopPropagation()}>
            <div className="mv-panel-hd">
              <div>
                <p className="mv-panel-eyebrow">{selectedDay.date.toLocaleDateString("en-IN", { weekday: "long" })}</p>
                <p className="mv-panel-title">{selectedDay.date.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedISO(null)}
                className="mv-panel-close"
                aria-label="Close"
              >✕</button>
            </div>

            <div className="mv-panel-body">
              <p className="mv-panel-sub">Per-room status for this day · tap a free row for walk-in · tap ✏️ to edit price / qty.</p>
              <div className="mv-rows">
                {rooms.map(r => {
                  const st = statusFor(r.id, selectedDay.iso);
                  const label = st.isFree
                    ? "Available"
                    : (SOURCE_STYLE[st.src || "manual"]?.label || "Booked");
                  const eff = priceFor(r.id, selectedDay.iso);
                  const base = roomPrices[r.id]?.basePrice ?? null;
                  const qty = qtyFor(r.id, selectedDay.iso);
                  const baseQ = roomPrices[r.id]?.baseQty ?? null;
                  const ovr = priceOverrides[`${r.id}|${selectedDay.iso}`];
                  const hasOverride = !!ovr;
                  return (
                    <div key={r.id} className={`mv-row ${st.isFree ? "mv-row-free" : ""}`}>
                      <span
                        className="mv-row-pip"
                        style={{
                          background: st.isFree ? FREE_BG : (SOURCE_STYLE[st.src || "manual"]?.bg || FREE_BG),
                          borderColor: st.isFree ? FREE_BORDER : (SOURCE_STYLE[st.src || "manual"]?.border || FREE_BORDER),
                        }}
                      />
                      <div className="mv-row-info">
                        <p className="mv-row-name">{r.type || r.name || "Room"}</p>
                        <p className="mv-row-status">
                          {label}
                          {st.occ?.guestName && <> · <b>{st.occ.guestName}</b></>}
                          {st.occ?.assignedUnitNumber && <> · #{st.occ.assignedUnitNumber}</>}
                          {st.occ?.provider && <> · {st.occ.provider}</>}
                        </p>
                        {showPricing && (
                          <div className="mv-row-pricing">
                            <span className={`mv-row-pchip ${hasOverride && ovr.floorPrice != null ? "mv-row-pchip-ovr" : ""}`}>
                              💰 {eff != null ? `₹${eff.toLocaleString("en-IN")}` : "—"}
                              {hasOverride && ovr.floorPrice != null && base != null && eff !== base && (
                                <s>₹{base.toLocaleString("en-IN")}</s>
                              )}
                            </span>
                            <span className={`mv-row-qchip ${hasOverride && ovr.quantityOverride != null ? "mv-row-qchip-ovr" : ""}`}>
                              🛏 {qty != null ? qty : "—"} unit{qty === 1 ? "" : "s"}
                              {hasOverride && ovr.quantityOverride != null && baseQ != null && qty !== baseQ && (
                                <s>({baseQ})</s>
                              )}
                            </span>
                            <button
                              type="button"
                              className="mv-row-edit"
                              title="Edit price or quantity for this date"
                              onClick={() => {
                                setEditor({
                                  roomId: r.id,
                                  dates: [selectedDay.iso],
                                  initialTab: "floor",
                                });
                              }}
                            >✏️</button>
                          </div>
                        )}
                      </div>
                      {st.isFree ? (
                        <button
                          type="button"
                          className="mv-row-btn"
                          onClick={() => {
                            onPickWalkIn({
                              roomId: r.id,
                              fromDate: selectedDay.iso,
                              toDate: toISO(addDays(new Date(selectedDay.iso), 1)),
                            });
                            setSelectedISO(null);
                          }}
                        >+ Walk-in</button>
                      ) : st.occ?.refId && (st.occ.source === "walk_in" || st.occ.source === "manual" || st.occ.source === "group") ? (
                        <button
                          type="button"
                          className="mv-row-btn mv-row-btn-del"
                          onClick={() => {
                            if (st.occ?.refId && confirm("Remove this block? The date will become available again.")) {
                              onDeleteBlock(st.occ.refId);
                            }
                          }}
                        >🗑 Remove</button>
                      ) : (
                        <span className="mv-row-locked">🔒</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* v132.3 — unified editor: handles single + bulk + 4 prices + qty
          + autopilot-mode-aware warnings. */}
      {editor && typeof document !== "undefined" && onSavePricing && createPortal(
        <PricingEditorModal
          rooms={rooms}
          editor={editor}
          setEditorRoom={(roomId) => setEditor(s => s ? { ...s, roomId } : s)}
          roomPrices={roomPrices}
          priceOverrides={priceOverrides}
          flashByRoom={flashByRoom}
          autopilotMode={autopilotMode}
          calendar={calendar}
          onClose={() => setEditor(null)}
          onSave={async (items) => {
            await onSavePricing({ items });
            setEditor(null);
            if (editor.dates.length > 1) exitMultiMode();
          }}
          onClear={onClearPricing && editor.dates.length === 1 ? async () => {
            await onClearPricing({ roomId: editor.roomId, date: editor.dates[0] });
            setEditor(null);
          } : undefined}
        />,
        document.body
      )}

      <style jsx>{`
        /* ── v132.1 — Month view: hardcoded light surfaces + dark text.
           Was relying on theme tokens that flip dark on dark-mode
           partner panel, producing dark cells with washed-out chips and
           clipped Saturday column. Switched to fixed light bg + dark
           text + minmax(0, 1fr) grid template to kill horizontal
           overflow that was hiding the rightmost column.              */
        .mv-wrap { margin-top: 14px; }

        .mv-tipbar {
          display: flex; align-items: center; gap: 8px;
          margin-bottom: 12px; flex-wrap: wrap;
        }
        .mv-tip {
          flex: 1 1 auto;
          font-size: 0.72rem;
          color: #6E5430;
          padding: 8px 12px;
          background: rgba(201,166,107,0.14);
          border-radius: 10px;
          border: 1px solid rgba(201,166,107,0.22);
          margin: 0;
          min-width: 0;
        }
        .mv-tip b { color: #1F1A0F; }
        .mv-tip-multi {
          background: rgba(140, 160, 182,0.16);
          border-color: rgba(140, 160, 182,0.35);
        }

        .mv-mini-btn {
          flex-shrink: 0;
          padding: 8px 12px;
          font-size: 0.74rem;
          font-weight: 700;
          border-radius: 10px;
          cursor: pointer;
          font-family: inherit;
          border: 1px solid;
          transition: transform 0.12s ease, box-shadow 0.15s ease;
        }
        .mv-mini-btn:active { transform: scale(0.96); }
        .mv-mini-multi {
          background: linear-gradient(135deg, #b4c1cf, #C9A66B);
          color: #1F1A0F;
          border-color: rgba(110,84,48,0.30);
          box-shadow: 0 2px 8px rgba(201,166,107,0.30);
        }
        .mv-mini-clear {
          background: #ffffff;
          color: #4A3820;
          border-color: rgba(232,228,217,0.8);
        }
        .mv-mini-cancel {
          background: #4A3820;
          color: #fcfcfd;
          border-color: #4A3820;
        }
        .mv-multi-actions { display: inline-flex; gap: 6px; }

        /* Multi-select bulk-action sticky bottom bar (portaled) */
        .mv-bulkbar {
          position: fixed;
          left: 0; right: 0; bottom: 0;
          z-index: 100;
          background: linear-gradient(180deg, rgba(176, 192, 209,0.95), #ffffff);
          backdrop-filter: blur(8px);
          border-top: 1px solid rgba(232,228,217,0.8);
          box-shadow: 0 -8px 24px rgba(31,26,15,0.18);
          padding: 10px 14px calc(env(safe-area-inset-bottom, 0px) + 10px);
        }
        .mv-bulkbar-inner {
          max-width: 720px;
          margin: 0 auto;
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px;
        }
        .mv-bulkbar-meta {
          font-size: 0.84rem;
          color: #4A3820;
        }
        .mv-bulkbar-meta b { color: #1F1A0F; font-size: 1rem; margin-right: 4px; }
        .mv-bulkbar-actions { display: flex; gap: 8px; }
        .mv-bulk-btn {
          padding: 10px 16px;
          font-size: 0.84rem; font-weight: 800;
          border-radius: 12px;
          background: linear-gradient(135deg, #b4c1cf, #C9A66B);
          color: #1F1A0F;
          border: 1px solid rgba(110,84,48,0.30);
          box-shadow: 0 2px 8px rgba(201,166,107,0.30);
          cursor: pointer;
          font-family: inherit;
        }
        .mv-bulk-btn:active { transform: scale(0.96); }

        .mv-grid-wrap {
          background: #fcfcfd;
          border-radius: 14px;
          border: 1px solid rgba(232,228,217,0.8);
          overflow: hidden;
          width: 100%;
        }
        .mv-weekhd {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          background: #ffffff;
          border-bottom: 1px solid rgba(232,228,217,0.8);
        }
        .mv-weekhd-day {
          padding: 8px 4px;
          text-align: center;
          font-size: 0.66rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #6E5430;
          min-width: 0;
        }
        .mv-weekhd-we { color: #c2410c; }

        .mv-grid {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 1px;
          background: rgba(232,228,217,0.5);
        }
        .mv-cell {
          background: #fcfcfd;
          border: none;
          padding: 6px 4px 8px;
          min-height: 84px;
          min-width: 0;
          overflow: hidden;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-family: inherit;
          text-align: left;
          color: #1F1A0F;
          transition: background 0.15s ease, transform 0.12s ease;
        }
        .mv-cell:hover { background: rgba(201,166,107,0.10); }
        .mv-cell:active { transform: scale(0.98); }
        .mv-cell-we { background: #f4f6f8; }
        .mv-cell-out {
          background: rgba(232,228,217,0.35);
          opacity: 0.55;
          cursor: default;
          pointer-events: none;
        }
        .mv-cell-today { background: rgba(201,166,107,0.14); box-shadow: inset 0 0 0 1.5px rgba(201,166,107,0.55); }
        .mv-cell-on { background: rgba(201,166,107,0.22); box-shadow: inset 0 0 0 1.5px #C9A66B; }
        .mv-cell-top {
          display: flex; align-items: center; justify-content: space-between;
          gap: 3px;
          min-width: 0;
        }
        .mv-day-num {
          font-size: 0.84rem;
          font-weight: 700;
          color: #1F1A0F;
          line-height: 1;
          flex-shrink: 0;
        }
        .mv-cell-today .mv-day-num {
          background: linear-gradient(135deg,#b4c1cf,#C9A66B);
          color: #1F1A0F;
          border-radius: 999px;
          width: 22px; height: 22px;
          display: inline-flex; align-items: center; justify-content: center;
          line-height: 1;
        }
        .mv-free-pill {
          font-size: 0.56rem;
          font-weight: 800;
          padding: 1px 5px;
          border-radius: 999px;
          border: 1px solid;
          background: rgba(255,255,255,0.85);
          line-height: 1.5;
          white-space: nowrap;
          min-width: 0;
        }
        .mv-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 2px;
          align-items: center;
          min-width: 0;
        }
        .mv-chip {
          display: inline-block;
          width: 100%;
          max-width: 16px;
          height: 8px;
          border-radius: 3px;
          border: 1px solid;
          flex-shrink: 0;
        }
        .mv-chip-more {
          font-size: 0.55rem;
          font-weight: 700;
          color: #6E5430;
          margin-left: 2px;
        }

        /* v132.2 — price label at bottom of every in-month cell */
        .mv-cell-price {
          margin-top: auto;
          font-size: 0.62rem;
          font-weight: 800;
          color: #4A3820;
          line-height: 1;
          text-align: left;
          letter-spacing: 0.01em;
        }
        /* v132.2 — multi-select highlight + check badge */
        .mv-cell-multi-on {
          background: linear-gradient(135deg, #f0f3f5, #dfe5eb) !important;
          box-shadow: inset 0 0 0 2px #C9A66B !important;
        }
        .mv-cell-check {
          position: absolute;
          top: 4px; right: 4px;
          width: 18px; height: 18px;
          border-radius: 999px;
          background: #4A3820;
          color: #fcfcfd;
          font-size: 0.62rem;
          font-weight: 800;
          display: inline-flex; align-items: center; justify-content: center;
        }
        .mv-cell { position: relative; }

        @media (max-width: 480px) {
          .mv-cell { min-height: 68px; padding: 4px 3px 6px; gap: 4px; }
          .mv-day-num { font-size: 0.74rem; }
          .mv-cell-today .mv-day-num { width: 20px; height: 20px; font-size: 0.7rem; }
          .mv-free-pill { font-size: 0.52rem; padding: 0 4px; }
          .mv-chip { max-width: 12px; height: 6px; border-radius: 2px; }
          .mv-cell-price { font-size: 0.56rem; }
          .mv-cell-check { width: 16px; height: 16px; top: 2px; right: 2px; font-size: 0.55rem; }
        }

        /* ── Detail panel — also self-themed (v132.1) ──────────── */
        .mv-panel-backdrop {
          position: fixed; inset: 0; z-index: 95;
          background: rgba(31,26,15,0.55);
          backdrop-filter: blur(4px);
          display: flex; align-items: flex-end; justify-content: center;
        }
        .mv-panel {
          width: 100%; max-width: 540px;
          background: #ffffff;
          border-top-left-radius: 22px; border-top-right-radius: 22px;
          box-shadow: 0 -20px 60px rgba(31,26,15,0.30);
          display: flex; flex-direction: column;
          max-height: min(90dvh, 760px);
          animation: mvUp 0.28s cubic-bezier(0.3,1,0.3,1) both;
        }
        @media (min-width: 640px) {
          .mv-panel-backdrop { align-items: center; }
          .mv-panel { border-radius: 22px; max-height: 80dvh; }
        }
        @keyframes mvUp {
          from { transform: translateY(30px); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
        .mv-panel-hd {
          display: flex; align-items: center; justify-content: space-between;
          padding: 18px 22px 14px;
          border-bottom: 1px solid rgba(232,228,217,0.8);
        }
        .mv-panel-eyebrow {
          font-size: 0.62rem; font-weight: 700; letter-spacing: 0.12em;
          color: #8B6914;
          text-transform: uppercase;
        }
        .mv-panel-title {
          font-family: "Cormorant Garamond", serif;
          font-size: 1.45rem; font-weight: 400;
          color: #1F1A0F;
          line-height: 1.1; margin-top: 2px;
        }
        .mv-panel-close {
          width: 34px; height: 34px; border-radius: 999px;
          background: rgba(31,26,15,0.06);
          border: 1px solid rgba(232,228,217,0.8);
          color: #4A3820; font-size: 1.1rem;
          cursor: pointer;
        }
        .mv-panel-body {
          flex: 1 1 auto; overflow-y: auto;
          padding: 16px 22px 22px;
          -webkit-overflow-scrolling: touch;
        }
        .mv-panel-sub {
          font-size: 0.74rem;
          color: #6E5430;
          margin-bottom: 12px;
        }
        .mv-rows { display: flex; flex-direction: column; gap: 8px; }
        .mv-row {
          display: flex; align-items: center; gap: 12px;
          padding: 12px 12px;
          background: #fcfcfd;
          border: 1px solid rgba(232,228,217,0.8);
          border-radius: 12px;
        }
        .mv-row-free { border-color: rgba(167,208,70,0.45); }
        .mv-row-pip {
          flex-shrink: 0;
          width: 14px; height: 36px;
          border-radius: 4px;
          border: 1px solid;
        }
        .mv-row-info { flex: 1 1 auto; min-width: 0; }
        .mv-row-name {
          font-weight: 700; font-size: 0.92rem;
          color: #1F1A0F;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .mv-row-status {
          margin-top: 2px;
          font-size: 0.74rem;
          color: #6E5430;
        }
        .mv-row-status b { color: #4A3820; }

        /* v132.2 — per-row price + qty chips in the day-detail panel */
        .mv-row-pricing {
          display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
          margin-top: 6px;
        }
        .mv-row-pchip, .mv-row-qchip {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 3px 8px;
          font-size: 0.7rem;
          font-weight: 700;
          color: #4A3820;
          background: rgba(232,228,217,0.45);
          border: 1px solid rgba(232,228,217,0.8);
          border-radius: 999px;
        }
        .mv-row-pchip s, .mv-row-qchip s {
          font-weight: 500;
          color: #8B7340;
          opacity: 0.75;
          margin-left: 2px;
        }
        .mv-row-pchip-ovr, .mv-row-qchip-ovr {
          background: linear-gradient(135deg, #f0f3f5, #dfe5eb);
          border-color: #90a4b8;
          color: #7a4f00;
        }
        .mv-row-edit {
          padding: 4px 8px;
          font-size: 0.84rem;
          background: #fcfcfd;
          border: 1px solid rgba(232,228,217,0.8);
          border-radius: 8px;
          cursor: pointer;
          line-height: 1;
        }
        .mv-row-edit:hover {
          background: rgba(201,166,107,0.18);
        }
        .mv-row-edit:active { transform: scale(0.94); }

        .mv-row-btn {
          flex-shrink: 0;
          padding: 8px 14px;
          background: linear-gradient(135deg, #b4c1cf, #C9A66B);
          color: #1F1A0F;
          border: 1px solid rgba(110,84,48,0.30);
          border-radius: 10px;
          font-size: 0.78rem; font-weight: 700;
          cursor: pointer;
        }
        .mv-row-btn:active { transform: scale(0.96); }
        .mv-row-btn-del {
          background: #fee2e2;
          color: #b91c1c;
          border-color: #fca5a5;
        }
        .mv-row-locked {
          flex-shrink: 0;
          font-size: 1.1rem;
          opacity: 0.55;
          padding: 8px 6px;
        }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// RoomTimelineView — single-room full-month timeline. Big easy-to-read
// week-by-week cells for one selected room.
// ═══════════════════════════════════════════════════════════════════════
function RoomTimelineView({
  rooms, calendar, days, month, todayISO, activeRoomId, setActiveRoomId,
  onPickWalkIn, onDeleteBlock,
  roomPrices = {}, priceOverrides = {},
}: {
  rooms: Room[];
  calendar: CalendarMap;
  days: { iso: string; date: Date; day: number; dow: number }[];
  month: Date;
  todayISO: string;
  activeRoomId: string;
  setActiveRoomId: (id: string) => void;
  onPickWalkIn: (args: { roomId: string; fromDate: string; toDate: string }) => void;
  onDeleteBlock: (refId: string) => void;
  // v132.3 — pricing for the active room (price shown per cell)
  roomPrices?: RoomPriceMap;
  priceOverrides?: PriceOverrideMap;
}) {
  // Detail popover for occupied cells.
  const [popover, setPopover] = useState<{ iso: string; occ: Occupancy } | null>(null);

  const room = rooms.find(r => r.id === activeRoomId) || rooms[0];

  // Effective price helper (override else base)
  function priceFor(iso: string): number | null {
    const ovr = priceOverrides[`${activeRoomId}|${iso}`];
    if (ovr && ovr.floorPrice != null) return ovr.floorPrice;
    return roomPrices[activeRoomId]?.basePrice ?? null;
  }
  function fmtPrice(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : String(n);
  }

  // Pad to start of week + end of week so the grid lines up.
  const padded = useMemo(() => {
    if (days.length === 0) return [] as ({ iso: string; date: Date; day: number; dow: number; inMonth: boolean })[];
    const first = days[0];
    const last = days[days.length - 1];
    const padStart = first.dow;
    const padEnd = 6 - last.dow;
    const start = addDays(first.date, -padStart);
    const total = padStart + days.length + padEnd;
    return Array.from({ length: total }, (_, i) => {
      const d = addDays(start, i);
      return {
        iso: toISO(d),
        date: d,
        day: d.getDate(),
        dow: d.getDay(),
        inMonth: d.getMonth() === month.getMonth(),
      };
    });
  }, [days, month]);

  function cellFor(iso: string) {
    return calendar[activeRoomId]?.[iso];
  }

  // Per-room month stats
  const roomStats = useMemo(() => {
    let free = 0, booked = 0;
    days.forEach(d => {
      if (calendar[activeRoomId]?.[d.iso]) booked++; else free++;
    });
    return { free, booked, total: days.length };
  }, [days, calendar, activeRoomId]);

  return (
    <div className="rv-wrap">
      {/* Room picker — visual horizontal cards */}
      <div className="rv-picker">
        {rooms.map(r => {
          const active = r.id === activeRoomId;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setActiveRoomId(r.id)}
              className={`rv-room-card ${active ? "rv-room-card-on" : ""}`}
            >
              <span className="rv-room-emoji">🛏️</span>
              <span className="rv-room-name">{r.type || r.name || "Room"}</span>
              {r.capacity != null && (
                <span className="rv-room-cap">cap {r.capacity}</span>
              )}
            </button>
          );
        })}
      </div>

      {room && (
        <>
          {/* Stats strip for selected room */}
          <div className="rv-stats">
            <span className="rv-stat rv-stat-free">
              <b>{roomStats.free}</b> available
            </span>
            <span className="rv-stat rv-stat-booked">
              <b>{roomStats.booked}</b> booked
            </span>
            <span className="rv-stat rv-stat-total">
              of {roomStats.total} nights this month
            </span>
          </div>

          <p className="rv-tip">💡 Tap a free day to add a walk-in · tap an occupied day for details.</p>

          {/* Big month timeline */}
          <div className="rv-grid-wrap">
            <div className="rv-weekhd">
              {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((w, i) => (
                <span key={w} className={`rv-weekhd-day ${i === 0 || i === 6 ? "rv-weekhd-we" : ""}`}>{w}</span>
              ))}
            </div>
            <div className="rv-grid">
              {padded.map(d => {
                const occ = d.inMonth ? cellFor(d.iso) : undefined;
                const src = occ?.source;
                const style = src ? SOURCE_STYLE[src] : null;
                const isFree = !occ && d.inMonth;
                const isToday = d.iso === todayISO;
                return (
                  <button
                    key={d.iso}
                    type="button"
                    className={`rv-cell ${d.inMonth ? "" : "rv-cell-out"} ${isToday ? "rv-cell-today" : ""}`}
                    style={d.inMonth ? {
                      background: occ ? (style?.bg || FREE_BG) : FREE_BG,
                      borderColor: occ ? (style?.border || FREE_BORDER) : FREE_BORDER,
                    } : undefined}
                    disabled={!d.inMonth}
                    onClick={() => {
                      if (!d.inMonth) return;
                      if (occ) setPopover({ iso: d.iso, occ });
                      else onPickWalkIn({
                        roomId: activeRoomId,
                        fromDate: d.iso,
                        toDate: toISO(addDays(d.date, 1)),
                      });
                    }}
                    aria-label={
                      !d.inMonth ? `${d.iso}`
                      : (occ ? `${style?.label || "Booked"} on ${d.iso}` : `Available on ${d.iso} — tap to add walk-in`)
                    }
                  >
                    <span className="rv-day-num">{d.day}</span>
                    {d.inMonth && (
                      <span className="rv-day-label">
                        {isFree ? "Available" : (style?.label || "Booked")}
                      </span>
                    )}
                    {d.inMonth && (() => {
                      const p = priceFor(d.iso);
                      return p != null ? (
                        <span className="rv-day-price">₹{fmtPrice(p)}</span>
                      ) : null;
                    })()}
                    {occ?.assignedUnitNumber && (
                      <span className="rv-day-unit">#{occ.assignedUnitNumber}</span>
                    )}
                    {occ?.guestName && (
                      <span className="rv-day-guest">{occ.guestName}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Detail popover for occupied cell — portaled (see Month-view
              comment above for the .fade-up containing-block reasoning). */}
          {popover && typeof document !== "undefined" && createPortal(
            <div className="rv-pop-backdrop" onClick={() => setPopover(null)}>
              <div className="rv-pop" onClick={(e) => e.stopPropagation()}>
                <div className="rv-pop-hd">
                  <span
                    className="rv-pop-pip"
                    style={{ background: SOURCE_STYLE[popover.occ.source || "manual"]?.pip || "#374151" }}
                  />
                  <p className="rv-pop-title">
                    {SOURCE_STYLE[popover.occ.source || "manual"]?.label || "Booked"}
                  </p>
                  <button type="button" onClick={() => setPopover(null)} className="rv-pop-close" aria-label="Close">✕</button>
                </div>
                <div className="rv-pop-body">
                  <p className="rv-pop-row"><span>Date</span><b>{new Date(popover.iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</b></p>
                  <p className="rv-pop-row"><span>Room</span><b>{room.type || room.name || "Room"}</b></p>
                  {popover.occ.guestName && (
                    <p className="rv-pop-row"><span>Guest</span><b>{popover.occ.guestName}</b></p>
                  )}
                  {popover.occ.assignedUnitNumber && (
                    <p className="rv-pop-row"><span>Room #</span><b>{popover.occ.assignedUnitNumber}</b></p>
                  )}
                  {popover.occ.amount && (
                    <p className="rv-pop-row"><span>Amount</span><b>₹{popover.occ.amount.toLocaleString("en-IN")}</b></p>
                  )}
                  {popover.occ.provider && (
                    <p className="rv-pop-row"><span>Channel</span><b>{popover.occ.provider}</b></p>
                  )}
                  {popover.occ.note && (
                    <p className="rv-pop-note">📝 {popover.occ.note}</p>
                  )}
                  {popover.occ.refId && (popover.occ.source === "walk_in" || popover.occ.source === "manual" || popover.occ.source === "group") && (
                    <button
                      type="button"
                      onClick={() => {
                        if (popover.occ.refId && confirm("Remove this block? The date will become available again.")) {
                          onDeleteBlock(popover.occ.refId);
                          setPopover(null);
                        }
                      }}
                      className="rv-pop-del"
                    >🗑 Remove block</button>
                  )}
                  {popover.occ.source === "bid" && (
                    <p className="rv-pop-help">⚡ This is a confirmed bid. Manage it from the <b>Bookings</b> tab.</p>
                  )}
                  {popover.occ.source === "ota_ical" && (
                    <p className="rv-pop-help">🌐 Imported from {popover.occ.provider || "your OTA channel"}. Cancel directly on that platform.</p>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )}
        </>
      )}

      <style jsx>{`
        /* ── v132.1 — Room view: hardcoded light surfaces.
           Pre-fix bug: .rv-cell inherited color from theme tokens →
           on dark partner panel the text turned WHITE → invisible
           against the light green FREE_BG. Now all cell text uses
           explicit dark colors (#1F1A0F variants) against the
           hardcoded light status backgrounds.                       */
        .rv-wrap { margin-top: 14px; display: flex; flex-direction: column; gap: 12px; }

        .rv-picker {
          display: flex; flex-wrap: nowrap; gap: 8px;
          overflow-x: auto;
          padding-bottom: 4px;
          -webkit-overflow-scrolling: touch;
        }
        .rv-picker::-webkit-scrollbar { height: 4px; }
        .rv-picker::-webkit-scrollbar-thumb { background: rgba(110,84,48,0.20); border-radius: 4px; }

        .rv-room-card {
          flex-shrink: 0;
          display: inline-flex; flex-direction: column; align-items: flex-start;
          gap: 2px;
          padding: 10px 14px;
          background: #fcfcfd;
          border: 1px solid rgba(232,228,217,0.8);
          border-radius: 14px;
          font-family: inherit; cursor: pointer;
          min-width: 130px;
          color: #1F1A0F;
          transition: all 0.18s ease;
        }
        .rv-room-card:hover {
          background: rgba(201,166,107,0.14);
        }
        .rv-room-card-on {
          background: linear-gradient(135deg, #fcfcfd, #e7ebef);
          border-color: #C9A66B;
          box-shadow: 0 4px 14px rgba(201,166,107,0.25);
        }
        .rv-room-emoji { font-size: 1.05rem; line-height: 1; }
        .rv-room-name {
          font-size: 0.86rem; font-weight: 700;
          color: #1F1A0F;
          margin-top: 4px;
          white-space: nowrap;
        }
        .rv-room-cap {
          font-size: 0.62rem; font-weight: 600;
          color: #6E5430;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .rv-stats {
          display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
        }
        .rv-stat {
          font-size: 0.78rem;
          color: #4A3820;
          padding: 6px 12px;
          background: #fcfcfd;
          border-radius: 999px;
          border: 1px solid rgba(232,228,217,0.8);
        }
        .rv-stat b {
          color: #1F1A0F;
          margin-right: 4px;
          font-size: 0.92rem;
        }
        .rv-stat-free { border-color: rgba(167,208,70,0.55); background: linear-gradient(135deg,#f7fee7,#ecfccb); color: #3f5710; }
        .rv-stat-free b { color: #1f3404; }
        .rv-stat-booked { border-color: rgba(140, 160, 182,0.45); background: linear-gradient(135deg,#fafbfc,#f0f3f5); color: #7c4f0c; }
        .rv-stat-booked b { color: #4a2f00; }
        .rv-stat-total { color: #6E5430; }

        .rv-tip {
          font-size: 0.72rem;
          color: #6E5430;
          padding: 8px 12px;
          background: rgba(201,166,107,0.14);
          border-radius: 10px;
          border: 1px solid rgba(201,166,107,0.22);
        }

        .rv-grid-wrap {
          background: #fcfcfd;
          border-radius: 14px;
          border: 1px solid rgba(232,228,217,0.8);
          overflow: hidden;
          width: 100%;
        }
        .rv-weekhd {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          background: #ffffff;
          border-bottom: 1px solid rgba(232,228,217,0.8);
        }
        .rv-weekhd-day {
          padding: 8px 4px;
          text-align: center;
          font-size: 0.66rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #6E5430;
          min-width: 0;
        }
        .rv-weekhd-we { color: #c2410c; }

        .rv-grid {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 4px;
          padding: 6px;
        }
        .rv-cell {
          aspect-ratio: 1 / 1;
          border: 1.5px solid #a7d046;
          border-radius: 10px;
          padding: 6px 4px;
          font-family: inherit;
          text-align: center;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          gap: 2px;
          color: #1F1A0F;
          transition: transform 0.12s ease, box-shadow 0.15s ease;
          min-height: 60px;
          min-width: 0;
          overflow: hidden;
        }
        .rv-cell:hover:not(:disabled) {
          transform: scale(1.04);
          box-shadow: 0 4px 12px rgba(31,26,15,0.12), inset 0 0 0 1.5px rgba(31,26,15,0.20);
          z-index: 1;
        }
        .rv-cell:active:not(:disabled) { transform: scale(0.96); }
        .rv-cell-out {
          background: rgba(232,228,217,0.35) !important;
          border-color: rgba(232,228,217,0.50) !important;
          opacity: 0.55;
          cursor: default;
          color: #6E5430 !important;
        }
        .rv-cell-out .rv-day-num { color: #6E5430; }
        .rv-cell-today {
          box-shadow: 0 0 0 2px #C9A66B;
        }
        .rv-day-num {
          font-size: 1rem;
          font-weight: 800;
          line-height: 1;
          color: #1F1A0F;
        }
        .rv-day-label {
          font-size: 0.6rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          color: rgba(31,26,15,0.78);
          line-height: 1.1;
        }
        /* v132.3 — price per cell in Room view */
        .rv-day-price {
          font-size: 0.62rem;
          font-weight: 800;
          color: #6E5430;
          line-height: 1.05;
          margin-top: 1px;
          letter-spacing: 0.01em;
        }
        .rv-day-unit {
          font-size: 0.58rem;
          font-weight: 700;
          color: rgba(31,26,15,0.72);
        }
        .rv-day-guest {
          font-size: 0.56rem;
          font-weight: 600;
          color: rgba(31,26,15,0.68);
          line-height: 1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100%;
        }
        @media (max-width: 480px) {
          .rv-day-num { font-size: 0.84rem; }
          .rv-day-label { font-size: 0.52rem; }
          .rv-cell { min-height: 50px; padding: 3px 2px; border-radius: 8px; gap: 1px; }
        }

        /* Popover */
        .rv-pop-backdrop {
          position: fixed; inset: 0; z-index: 95;
          background: rgba(31,26,15,0.55);
          backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center;
        }
        .rv-pop {
          width: 320px; max-width: calc(100vw - 24px);
          background: #ffffff;
          border-radius: 18px;
          border: 1px solid rgba(232,228,217,0.8);
          box-shadow: 0 16px 40px rgba(31,26,15,0.30);
          overflow: hidden;
          animation: rvPopIn 0.20s ease both;
        }
        @keyframes rvPopIn { from { transform: scale(0.94); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .rv-pop-hd {
          display: flex; align-items: center; gap: 10px;
          padding: 14px 16px;
          background: linear-gradient(135deg, #fcfcfd, #e7ebef);
          border-bottom: 1px solid rgba(232,228,217,0.8);
        }
        .rv-pop-pip { width: 12px; height: 12px; border-radius: 999px; box-shadow: 0 0 0 2px rgba(255,255,255,0.8); }
        .rv-pop-title { flex: 1; font-weight: 700; color: #1F1A0F; font-size: 0.94rem; }
        .rv-pop-close {
          width: 30px; height: 30px; border-radius: 999px;
          background: rgba(31,26,15,0.05); color: #4A3820;
          font-weight: bold; border: none; cursor: pointer;
        }
        .rv-pop-body { padding: 14px 16px 16px; }
        .rv-pop-row {
          display: flex; justify-content: space-between; align-items: center;
          padding: 6px 0;
          font-size: 0.82rem;
          color: #1F1A0F;
          border-bottom: 1px solid rgba(232,228,217,0.4);
        }
        .rv-pop-row span { color: #6E5430; font-size: 0.72rem; }
        .rv-pop-note {
          margin-top: 10px; padding: 8px 10px;
          background: rgba(201,166,107,0.14);
          border-radius: 8px;
          font-size: 0.74rem; color: #4A3820;
        }
        .rv-pop-help {
          margin-top: 10px; padding: 8px 10px;
          background: rgba(59,130,246,0.10);
          border-radius: 8px;
          font-size: 0.74rem; color: #1d4ed8;
        }
        .rv-pop-del {
          margin-top: 12px; width: 100%;
          padding: 10px 12px;
          background: #fee2e2; border: 1px solid #fca5a5;
          color: #b91c1c;
          font-size: 0.84rem; font-weight: 700;
          border-radius: 10px; cursor: pointer;
        }
        .rv-pop-del:hover { background: #fecaca; }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// GridView — original v113 per-room × per-day matrix (preserved for
// power users who want all-rooms-at-glance over a long timeline).
// ═══════════════════════════════════════════════════════════════════════
function GridView({
  rooms, calendar, days, todayISO, onPickWalkIn, onDeleteBlock,
}: {
  rooms: Room[];
  calendar: CalendarMap;
  days: { iso: string; date: Date; day: number; dow: number }[];
  todayISO: string;
  onPickWalkIn: (args: { roomId: string; fromDate: string; toDate: string }) => void;
  onDeleteBlock: (refId: string) => void;
}) {
  const [drag, setDrag] = useState<{ roomId: string; startDate: string; endDate: string } | null>(null);
  const dragActive = useRef(false);
  const [popover, setPopover] = useState<{ roomId: string; date: string; occ: Occupancy; x: number; y: number } | null>(null);

  function startDrag(roomId: string, date: string) {
    dragActive.current = true;
    setDrag({ roomId, startDate: date, endDate: date });
  }
  function extendDrag(roomId: string, date: string) {
    if (!dragActive.current || !drag || drag.roomId !== roomId) return;
    setDrag(d => d ? { ...d, endDate: date } : null);
  }
  function endDrag() {
    if (!dragActive.current || !drag) { dragActive.current = false; return; }
    dragActive.current = false;
    const { roomId, startDate, endDate } = drag;
    const lo = startDate <= endDate ? startDate : endDate;
    const hi = startDate <= endDate ? endDate   : startDate;
    const hiPlusOne = toISO(addDays(new Date(hi), 1));
    setDrag(null);
    const cell = calendar[roomId]?.[lo];
    if (lo === hi && cell) return;
    onPickWalkIn({ roomId, fromDate: lo, toDate: hiPlusOne });
  }

  useEffect(() => {
    const up = () => endDrag();
    window.addEventListener("mouseup", up);
    window.addEventListener("touchend", up);
    return () => {
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchend", up);
    };
  }, [drag]);

  function onCellTap(roomId: string, date: string, occ: Occupancy | undefined, ev: React.MouseEvent | React.TouchEvent) {
    if (occ) {
      const target = ev.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      setPopover({
        roomId, date, occ,
        x: rect.left + rect.width / 2,
        y: rect.top + window.scrollY,
      });
      return;
    }
    onPickWalkIn({ roomId, fromDate: date, toDate: toISO(addDays(new Date(date), 1)) });
  }

  function isInDrag(roomId: string, dateISO: string): boolean {
    if (!drag || drag.roomId !== roomId) return false;
    const lo = drag.startDate <= drag.endDate ? drag.startDate : drag.endDate;
    const hi = drag.startDate <= drag.endDate ? drag.endDate   : drag.startDate;
    return dateISO >= lo && dateISO <= hi;
  }

  return (
    <div onMouseLeave={() => { if (dragActive.current) endDrag(); }}>
      <p className="gv-tip">💡 Tap empty cell to add a walk-in · drag across cells to block a range · tap occupied cell for details.</p>

      <div className="gv-grid-scroll">
        <table className="gv-grid">
          <thead>
            <tr>
              <th className="gv-room-th">Room</th>
              {days.map(d => {
                const isWE = d.dow === 0 || d.dow === 6;
                const isToday = d.iso === todayISO;
                return (
                  <th
                    key={d.iso}
                    className={`gv-day-th ${isWE ? "gv-day-th-we" : ""} ${isToday ? "gv-day-th-today" : ""}`}
                  >
                    <span className="gv-day-num">{d.day}</span>
                    <span className="gv-day-dow">{["S","M","T","W","T","F","S"][d.dow]}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rooms.map(r => (
              <tr key={r.id}>
                <td className="gv-room-td" title={r.type || r.name || "Room"}>
                  <span className="gv-room-name">{r.type || r.name || "Room"}</span>
                </td>
                {days.map(d => {
                  const cell = calendar[r.id]?.[d.iso];
                  const inDrag = isInDrag(r.id, d.iso);
                  const isToday = d.iso === todayISO;
                  const isWE = d.dow === 0 || d.dow === 6;
                  const src = cell?.source ? SOURCE_STYLE[cell.source] : null;
                  const bg = inDrag ? "linear-gradient(135deg,#dfe5eb,#b5c2d0)" : (src ? src.bg : FREE_BG);
                  const border = inDrag ? "#d97706" : (src ? src.border : FREE_BORDER);
                  return (
                    <td key={d.iso} className={`gv-cell-td ${isWE ? "gv-cell-td-we" : ""} ${isToday ? "gv-cell-td-today" : ""}`}>
                      <button
                        type="button"
                        className="gv-cell"
                        style={{ background: bg, borderColor: border }}
                        onMouseDown={(e) => { e.preventDefault(); startDrag(r.id, d.iso); }}
                        onMouseEnter={() => extendDrag(r.id, d.iso)}
                        onTouchStart={(e) => { e.preventDefault(); startDrag(r.id, d.iso); }}
                        onTouchMove={(e) => {
                          const t = e.touches[0];
                          const el = document.elementFromPoint(t.clientX, t.clientY) as HTMLElement | null;
                          const dataDate = el?.closest("[data-cell-date]")?.getAttribute("data-cell-date");
                          const dataRoom = el?.closest("[data-cell-room]")?.getAttribute("data-cell-room");
                          if (dataDate && dataRoom) extendDrag(dataRoom, dataDate);
                        }}
                        onClick={(e) => {
                          if (!dragActive.current) onCellTap(r.id, d.iso, cell, e);
                        }}
                        data-cell-date={d.iso}
                        data-cell-room={r.id}
                        aria-label={cell ? `${SOURCE_STYLE[cell.source || "manual"]?.label || "Booked"}: ${d.iso}` : `Free on ${d.iso} · tap to add`}
                      >
                        {cell?.assignedUnitNumber && (
                          <span className="gv-cell-unit">#{cell.assignedUnitNumber}</span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {popover && typeof document !== "undefined" && createPortal(
        <div className="gv-pop-backdrop" onClick={() => setPopover(null)}>
          <div
            className="gv-pop"
            onClick={(e) => e.stopPropagation()}
            style={{
              left: Math.max(12, Math.min(window.innerWidth - 288, popover.x - 144)),
              top:  Math.max(12, popover.y - 200),
            }}
          >
            <div className="gv-pop-hd">
              <span
                className="gv-pop-pip"
                style={{ background: SOURCE_STYLE[popover.occ.source || "manual"]?.pip || "#374151" }}
              />
              <p className="gv-pop-title">
                {SOURCE_STYLE[popover.occ.source || "manual"]?.label || "Booked"}
              </p>
              <button type="button" onClick={() => setPopover(null)} className="gv-pop-close" aria-label="Close">✕</button>
            </div>
            <div className="gv-pop-body">
              <p className="gv-pop-row"><span>Date</span><b>{new Date(popover.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</b></p>
              {popover.occ.guestName && (
                <p className="gv-pop-row"><span>Guest</span><b>{popover.occ.guestName}</b></p>
              )}
              {popover.occ.assignedUnitNumber && (
                <p className="gv-pop-row"><span>Room #</span><b>{popover.occ.assignedUnitNumber}</b></p>
              )}
              {popover.occ.amount && (
                <p className="gv-pop-row"><span>Amount</span><b>₹{popover.occ.amount.toLocaleString("en-IN")}</b></p>
              )}
              {popover.occ.provider && (
                <p className="gv-pop-row"><span>Channel</span><b>{popover.occ.provider}</b></p>
              )}
              {popover.occ.note && (
                <p className="gv-pop-note">📝 {popover.occ.note}</p>
              )}
              {popover.occ.refId && (popover.occ.source === "walk_in" || popover.occ.source === "manual" || popover.occ.source === "group") && (
                <button
                  type="button"
                  onClick={() => {
                    if (popover.occ.refId && confirm("Remove this block? The dates will become available again.")) {
                      onDeleteBlock(popover.occ.refId);
                      setPopover(null);
                    }
                  }}
                  className="gv-pop-del"
                >🗑 Remove block</button>
              )}
              {popover.occ.source === "bid" && (
                <p className="gv-pop-help">⚡ This is a confirmed bid. Manage it from the <b>Bookings</b> tab.</p>
              )}
              {popover.occ.source === "ota_ical" && (
                <p className="gv-pop-help">🌐 Imported from {popover.occ.provider || "your OTA channel"}. Cancel directly on that platform.</p>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      <style jsx>{`
        /* v132.1 — self-themed, same reasoning as .mv-* and .rv-* above. */
        .gv-tip {
          margin-top: 14px;
          font-size: 0.72rem;
          color: #6E5430;
          padding: 8px 12px;
          background: rgba(201,166,107,0.14);
          border-radius: 10px;
          border: 1px solid rgba(201,166,107,0.22);
        }
        .gv-tip b { color: #1F1A0F; }

        .gv-grid-scroll {
          margin-top: 12px;
          overflow-x: auto;
          background: #fcfcfd;
          border-radius: 14px;
          border: 1px solid rgba(232,228,217,0.8);
        }
        .gv-grid {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          min-width: 720px;
          font-size: 0.72rem;
        }
        .gv-grid thead tr { background: #ffffff; }
        .gv-room-th, .gv-room-td {
          position: sticky; left: 0;
          background: #ffffff;
          z-index: 2;
          padding: 10px 12px 10px 14px;
          text-align: left;
          min-width: 140px;
          max-width: 140px;
          box-shadow: 2px 0 6px rgba(31,26,15,0.05);
        }
        .gv-room-th {
          font-weight: 700;
          color: #4A3820;
          font-size: 0.7rem; letter-spacing: 0.06em; text-transform: uppercase;
        }
        .gv-room-td {
          border-top: 1px solid rgba(232,228,217,0.8);
        }
        .gv-room-name {
          font-weight: 700;
          color: #1F1A0F;
          font-size: 0.82rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          display: block;
        }
        .gv-day-th {
          font-weight: 600;
          color: #6E5430;
          padding: 8px 0 6px;
          min-width: 36px;
          width: 36px;
          text-align: center;
        }
        .gv-day-th-we { color: #c2410c; }
        .gv-day-th-today { color: #8B6914; }
        .gv-day-num {
          display: block;
          font-size: 0.82rem;
          font-weight: 700;
          line-height: 1.1;
          color: #1F1A0F;
        }
        .gv-day-th-today .gv-day-num {
          background: linear-gradient(135deg,#b4c1cf,#C9A66B);
          color: #1F1A0F;
          border-radius: 999px;
          width: 24px; height: 24px;
          margin: 0 auto;
          display: inline-flex; align-items: center; justify-content: center;
          line-height: 1;
        }
        .gv-day-dow {
          display: block;
          font-size: 0.55rem;
          font-weight: 600;
          margin-top: 1px;
          opacity: 0.7;
          letter-spacing: 0.04em;
        }

        .gv-cell-td {
          padding: 2px;
          border-top: 1px solid rgba(232,228,217,0.5);
          background: #fcfcfd;
        }
        .gv-cell-td-we { background: #f4f6f8; }
        .gv-cell-td-today { background: rgba(201,166,107,0.10); }

        .gv-cell {
          width: 100%;
          height: 36px;
          border-radius: 7px;
          border: 1px solid #a7d046;
          cursor: pointer;
          touch-action: none;
          padding: 0;
          font-size: 0.6rem;
          font-weight: 800;
          color: rgba(31,26,15,0.78);
          letter-spacing: 0.01em;
          display: inline-flex; align-items: center; justify-content: center;
          transition: transform 0.10s ease, box-shadow 0.15s ease;
        }
        .gv-cell:hover {
          transform: scale(1.06);
          box-shadow: 0 2px 8px rgba(201,166,107,0.30), inset 0 0 0 1.5px rgba(31,26,15,0.20);
          z-index: 1;
        }
        .gv-cell:active { transform: scale(0.92); }
        .gv-cell-unit {
          white-space: nowrap;
          text-shadow: 0 1px 0 rgba(255,255,255,0.55);
        }

        .gv-pop-backdrop {
          position: fixed; inset: 0; z-index: 80;
          background: rgba(31,26,15,0.18);
          backdrop-filter: blur(2px);
        }
        .gv-pop {
          position: absolute;
          width: 288px;
          background: #ffffff;
          border-radius: 14px;
          border: 1px solid rgba(232,228,217,0.8);
          box-shadow: 0 16px 40px rgba(31,26,15,0.25);
          overflow: hidden;
          z-index: 81;
        }
        .gv-pop-hd {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 14px;
          background: linear-gradient(135deg, #fcfcfd, #e7ebef);
          border-bottom: 1px solid rgba(232,228,217,0.8);
        }
        .gv-pop-pip { width: 10px; height: 10px; border-radius: 999px; box-shadow: 0 0 0 2px rgba(255,255,255,0.8); }
        .gv-pop-title { flex: 1; font-weight: 700; color: #1F1A0F; font-size: 0.92rem; }
        .gv-pop-close {
          width: 28px; height: 28px; border-radius: 999px;
          background: rgba(31,26,15,0.05); color: #4A3820;
          font-weight: bold; border: none; cursor: pointer;
        }
        .gv-pop-body { padding: 12px 14px 14px; }
        .gv-pop-row {
          display: flex; justify-content: space-between; align-items: center;
          padding: 6px 0;
          font-size: 0.82rem;
          color: #1F1A0F;
          border-bottom: 1px solid rgba(232,228,217,0.4);
        }
        .gv-pop-row span { color: #6E5430; font-size: 0.72rem; }
        .gv-pop-note {
          margin-top: 8px;
          padding: 8px 10px;
          background: rgba(201,166,107,0.14);
          border-radius: 8px;
          font-size: 0.74rem;
          color: #4A3820;
        }
        .gv-pop-help {
          margin-top: 8px;
          padding: 8px 10px;
          background: rgba(59,130,246,0.10);
          border-radius: 8px;
          font-size: 0.74rem;
          color: #1d4ed8;
        }
        .gv-pop-del {
          margin-top: 12px;
          width: 100%;
          padding: 9px 12px;
          background: #fee2e2;
          border: 1px solid #fca5a5;
          color: #b91c1c;
          font-size: 0.82rem; font-weight: 700;
          border-radius: 10px;
          cursor: pointer;
        }
        .gv-pop-del:hover { background: #fecaca; }
      `}</style>
    </div>
  );
}

function LegendChip({ bg, border, label, count, pip }: { bg: string; border: string; label: string; count?: number; pip?: string }) {
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "4px 10px",
        background: "var(--bg-pill, #fcfcfd)",
        border: "1px solid var(--border-soft, rgba(232,228,217,0.8))",
        borderRadius: 999,
        fontSize: "0.7rem",
        fontWeight: 600,
        color: "var(--text-soft, #4A3820)",
      }}
    >
      <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 4, background: bg, border: `1px solid ${border}` }} />
      <span>{label}</span>
      {typeof count === "number" && (
        <b style={{ color: "var(--text-base, #1F1A0F)", marginLeft: 2 }}>{count}</b>
      )}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// BlockDatesSheet — bulk "block these dates on these rooms" form.
// Writes to /api/partner/walk-in with `source` set to whatever the user
// picked (default `manual` = maintenance / private).
// ═══════════════════════════════════════════════════════════════════════
export function BlockDatesSheet({
  open, onClose, rooms, onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  rooms: Room[];
  onSubmit: (args: {
    roomIds: string[];
    fromDate: string;
    toDate: string;
    source: "manual" | "group";
    reason: string;
    guestName?: string;
    note?: string;
  }) => Promise<void>;
}) {
  const [pickedRooms, setPickedRooms] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("maintenance");
  const [guestName, setGuestName] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      const today = toISO(new Date());
      const tomorrow = toISO(addDays(new Date(), 1));
      setFromDate(today);
      setToDate(tomorrow);
      setPickedRooms([]);
      setReason("maintenance");
      setGuestName("");
      setNote("");
      setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  const reasons = [
    { id: "maintenance", emoji: "🛠", label: "Maintenance",   source: "manual" as const },
    { id: "private",     emoji: "🔒", label: "Private hold",  source: "manual" as const },
    { id: "owner",       emoji: "👤", label: "Owner use",     source: "manual" as const },
    { id: "vip",         emoji: "⭐", label: "VIP / comp",    source: "manual" as const },
    { id: "group",       emoji: "🎉", label: "Group booking", source: "group"  as const },
    { id: "closed",      emoji: "🚫", label: "Closed",        source: "manual" as const },
  ];

  const r = reasons.find(x => x.id === reason)!;
  const nights = fromDate && toDate
    ? Math.max(0, Math.ceil((new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86400000))
    : 0;

  const canSubmit =
    pickedRooms.length > 0 &&
    fromDate && toDate &&
    new Date(toDate) > new Date(fromDate) &&
    !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({
        roomIds: pickedRooms,
        fromDate, toDate,
        source: r.source,
        reason: r.label,
        guestName: r.id === "group" ? guestName : undefined,
        note: note || undefined,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bds-backdrop" onClick={onClose}>
      <div className="bds-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="bds-hd">
          <div>
            <p className="bds-eyebrow">📌 BLOCK DATES</p>
            <p className="bds-title">Hold rooms off the market</p>
          </div>
          <button type="button" onClick={onClose} className="bds-close" aria-label="Close">✕</button>
        </div>

        <div className="bds-body">
          {/* Reason chips */}
          <div className="bds-section">
            <p className="bds-label">Why are you blocking?</p>
            <div className="bds-chips">
              {reasons.map(x => (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => setReason(x.id)}
                  className={`bds-chip ${reason === x.id ? "bds-chip-on" : ""}`}
                >
                  <span>{x.emoji}</span>
                  <span>{x.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Date range */}
          <div className="bds-section">
            <p className="bds-label">Dates {nights > 0 && <b className="bds-nights">· {nights} night{nights !== 1 ? "s" : ""}</b>}</p>
            <div className="bds-dates">
              <label>
                <span>Start</span>
                <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} min={toISO(new Date())} />
              </label>
              <label>
                <span>End <em>(checkout)</em></span>
                <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} min={fromDate || toISO(new Date())} />
              </label>
            </div>
          </div>

          {/* Rooms */}
          <div className="bds-section">
            <p className="bds-label">
              Rooms <span className="bds-mini">({pickedRooms.length} of {rooms.length})</span>
              {rooms.length > 1 && (
                <button
                  type="button"
                  onClick={() => setPickedRooms(pickedRooms.length === rooms.length ? [] : rooms.map(x => x.id))}
                  className="bds-toggle-all"
                >
                  {pickedRooms.length === rooms.length ? "Clear all" : "Select all"}
                </button>
              )}
            </p>
            <div className="bds-rooms">
              {rooms.map(rm => {
                const on = pickedRooms.includes(rm.id);
                return (
                  <button
                    key={rm.id}
                    type="button"
                    onClick={() => setPickedRooms(p => p.includes(rm.id) ? p.filter(x => x !== rm.id) : [...p, rm.id])}
                    className={`bds-room ${on ? "bds-room-on" : ""}`}
                  >
                    <span className="bds-room-tick">{on ? "✓" : ""}</span>
                    <span>{rm.type || rm.name || "Room"}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Guest name — only for group bookings */}
          {r.id === "group" && (
            <div className="bds-section">
              <p className="bds-label">Group name</p>
              <input
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="e.g. Mehta-Sharma Wedding"
                className="bds-input"
              />
            </div>
          )}

          {/* Note */}
          <div className="bds-section">
            <p className="bds-label">Note <span className="bds-mini">(optional)</span></p>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Internal note — e.g. AC repair, painting, owner stay"
              className="bds-textarea"
            />
          </div>
        </div>

        <div className="bds-ft">
          <button type="button" onClick={onClose} className="bds-cancel">Cancel</button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="bds-submit"
          >
            {submitting ? "Blocking…" : `Block ${pickedRooms.length || ""} room${pickedRooms.length === 1 ? "" : "s"}`.trim()}
          </button>
        </div>
      </div>

      <style jsx>{`
        .bds-backdrop {
          position: fixed; inset: 0; z-index: 95;
          background: rgba(31,26,15,0.55);
          backdrop-filter: blur(4px);
          display: flex; align-items: flex-end; justify-content: center;
        }
        .bds-sheet {
          width: 100%; max-width: 540px;
          background: var(--bg-card, #ffffff);
          border-top-left-radius: 22px; border-top-right-radius: 22px;
          box-shadow: 0 -20px 60px rgba(31,26,15,0.30);
          display: flex; flex-direction: column;
          max-height: min(90dvh, 760px);
          animation: bdsUp 0.28s cubic-bezier(0.3,1,0.3,1) both;
        }
        @media (min-width: 640px) {
          .bds-backdrop { align-items: center; }
          .bds-sheet { border-radius: 22px; max-height: 90dvh; }
        }
        @keyframes bdsUp { from { transform: translateY(30px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

        .bds-hd {
          display: flex; align-items: center; justify-content: space-between;
          padding: 18px 22px 14px;
          border-bottom: 1px solid var(--border-soft, rgba(232,228,217,0.8));
        }
        .bds-eyebrow {
          font-size: 0.62rem; font-weight: 700; letter-spacing: 0.12em;
          color: var(--accent, #C9A66B);
          text-transform: uppercase;
        }
        .bds-title {
          font-family: "Cormorant Garamond", serif;
          font-size: 1.45rem; font-weight: 400;
          color: var(--text-base, #1F1A0F);
          line-height: 1.1;
          margin-top: 2px;
        }
        .bds-close {
          width: 34px; height: 34px; border-radius: 999px;
          background: rgba(31,26,15,0.06);
          border: 1px solid var(--border-soft, rgba(232,228,217,0.8));
          color: var(--text-soft, #4A3820); font-size: 1.1rem;
          cursor: pointer;
        }
        .bds-close:hover { background: rgba(31,26,15,0.12); }

        .bds-body {
          flex: 1 1 auto;
          overflow-y: auto;
          padding: 18px 22px;
          -webkit-overflow-scrolling: touch;
        }
        .bds-section + .bds-section { margin-top: 16px; }
        .bds-label {
          font-size: 0.7rem; font-weight: 700;
          color: var(--text-soft, #4A3820);
          text-transform: uppercase; letter-spacing: 0.1em;
          margin-bottom: 8px;
          display: flex; align-items: center; gap: 8px;
        }
        .bds-nights { font-weight: 700; color: var(--accent, #C9A66B); text-transform: none; letter-spacing: 0; }
        .bds-mini { font-weight: 500; color: var(--text-muted, #6E5430); text-transform: none; letter-spacing: 0; }
        .bds-toggle-all {
          margin-left: auto;
          font-size: 0.72rem; font-weight: 700;
          color: var(--accent, #C9A66B);
          background: transparent; border: none; cursor: pointer;
          text-transform: none; letter-spacing: 0;
        }

        .bds-chips, .bds-rooms { display: flex; flex-wrap: wrap; gap: 8px; }
        .bds-chip {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 8px 12px;
          background: var(--bg-pill, #fcfcfd);
          border: 1px solid var(--border-soft, rgba(232,228,217,0.8));
          border-radius: 999px;
          font-size: 0.82rem; font-weight: 600;
          color: var(--text-base, #1F1A0F);
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .bds-chip:hover { background: var(--accent-soft, rgba(201,166,107,0.14)); }
        .bds-chip-on {
          background: linear-gradient(135deg, #b4c1cf, #C9A66B);
          color: #1F1A0F;
          border-color: rgba(110,84,48,0.30);
          box-shadow: 0 2px 8px rgba(201,166,107,0.30);
        }

        .bds-room {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 8px 14px;
          background: var(--bg-pill, #fcfcfd);
          border: 1px solid var(--border-soft, rgba(232,228,217,0.8));
          border-radius: 12px;
          font-size: 0.84rem; font-weight: 600;
          color: var(--text-base, #1F1A0F);
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .bds-room:hover { background: var(--accent-soft, rgba(201,166,107,0.14)); }
        .bds-room-on {
          background: linear-gradient(135deg, rgba(176, 192, 209,0.45), rgba(201,166,107,0.55));
          border-color: var(--accent, #C9A66B);
        }
        .bds-room-tick {
          display: inline-flex; align-items: center; justify-content: center;
          width: 18px; height: 18px; border-radius: 999px;
          background: rgba(31,26,15,0.10);
          color: var(--text-base, #1F1A0F);
          font-size: 0.8rem; font-weight: 800;
        }
        .bds-room-on .bds-room-tick {
          background: var(--text-base, #1F1A0F);
          color: var(--cozy-cream-50, #fcfcfd);
        }

        .bds-dates { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .bds-dates label { display: flex; flex-direction: column; gap: 4px; }
        .bds-dates label span {
          font-size: 0.66rem; font-weight: 700;
          color: var(--text-muted, #6E5430);
          text-transform: uppercase; letter-spacing: 0.06em;
        }
        .bds-dates label em { font-style: normal; opacity: 0.7; }
        .bds-dates input,
        .bds-input,
        .bds-textarea {
          padding: 10px 12px;
          background: var(--bg-pill, #fcfcfd);
          border: 1px solid var(--border-strong, rgba(110,84,48,0.30));
          border-radius: 10px;
          font-size: 0.92rem;
          color: var(--text-base, #1F1A0F);
          width: 100%;
          outline: none;
          font-family: inherit;
        }
        .bds-textarea { resize: none; }
        .bds-dates input:focus,
        .bds-input:focus,
        .bds-textarea:focus {
          border-color: var(--accent, #C9A66B);
          box-shadow: 0 0 0 3px rgba(201,166,107,0.18);
        }

        .bds-ft {
          padding: 14px 22px calc(env(safe-area-inset-bottom, 0px) + 16px);
          display: flex; gap: 10px;
          border-top: 1px solid var(--border-soft, rgba(232,228,217,0.8));
          background: var(--bg-card, #ffffff);
        }
        .bds-cancel {
          flex: 0 0 auto;
          padding: 12px 22px; border-radius: 12px;
          background: transparent;
          color: var(--text-soft, #4A3820);
          font-size: 0.86rem; font-weight: 700;
          border: 1px solid var(--border-strong, rgba(110,84,48,0.30));
          cursor: pointer;
        }
        .bds-cancel:hover { background: var(--accent-soft, rgba(201,166,107,0.14)); }
        .bds-submit {
          flex: 1 1 auto;
          padding: 12px 22px; border-radius: 12px;
          background: linear-gradient(135deg, #b4c1cf, #C9A66B);
          color: #1F1A0F;
          font-size: 0.92rem; font-weight: 800;
          letter-spacing: 0.02em;
          border: 1px solid rgba(110,84,48,0.30);
          box-shadow: 0 4px 14px rgba(201,166,107,0.40);
          cursor: pointer;
          transition: transform 0.12s ease, box-shadow 0.15s ease;
        }
        .bds-submit:hover { box-shadow: 0 6px 18px rgba(201,166,107,0.55); }
        .bds-submit:active { transform: scale(0.98); }
        .bds-submit:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; transform: none; }
      `}</style>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════
// PricingEditorModal (v132.3) — unified editor for the four price types
// + quantity. Used for both single-cell (✏️ in day-panel) and bulk
// multi-date saves (from the multi-select bottom bar).
//
// Five tabs at top:
//   • 🏷 Regular   — rooms.mrp override (what customer sees as MRP)
//   • 💰 Floor     — rooms.floorPrice override (minimum bid accepted)
//   • ⚡ Flash     — flash_deals regular price for this date (override)
//   • 🔥 Flash Floor — rooms.flashFloorPrice override (flash minimum)
//   • 🛏 Qty       — room_date_overrides.quantityOverride
//
// v132.3 also surfaces:
//   • the active hotel autopilot mode at the top (info chip)
//   • smart warnings that fire BEFORE save when partner attempts a
//     change that breaks business rules (floor > MRP, flash floor >
//     regular floor, date has confirmed bid, date has active flash
//     deal, etc.). Warnings list the specific room + dates affected.
//     User can still "Save anyway" — these are advisory, not blocking.
// ═══════════════════════════════════════════════════════════════════════

type EditorTab = "regular" | "floor" | "flash" | "flashFloor" | "quantity";

const TAB_DEFS: Array<{ id: EditorTab; emoji: string; label: string }> = [
  { id: "regular",    emoji: "🏷", label: "Regular"    },
  { id: "floor",      emoji: "💰", label: "Floor"      },
  { id: "flash",      emoji: "⚡", label: "Flash"      },
  { id: "flashFloor", emoji: "🔥", label: "Flash Floor"},
  { id: "quantity",   emoji: "🛏", label: "Qty"        },
];

const MODE_INFO: Record<AutopilotMode, { emoji: string; label: string; tone: string }> = {
  auto:   { emoji: "🤖", label: "Full Autopilot — every tier-eligible bid auto-confirms", tone: "#0c7a4d" },
  hybrid: { emoji: "⚖️", label: "Hybrid — only premium / strong bidders auto-confirm",  tone: "#7c4f0c" },
  manual: { emoji: "👤", label: "Manual Review — every bid waits for your approval",      tone: "#1d4ed8" },
};

type Warning = {
  level: "warn" | "info";
  scope: { dates: string[]; roomName: string; flashDealIds?: string[] };
  message: string;
};

function PricingEditorModal({
  rooms,
  editor,
  setEditorRoom,
  roomPrices,
  priceOverrides,
  flashByRoom,
  autopilotMode,
  calendar,
  onClose,
  onSave,
  onClear,
}: {
  rooms: Room[];
  editor: { roomId: string; dates: string[]; initialTab: EditorTab };
  setEditorRoom: (roomId: string) => void;
  roomPrices: RoomPriceMap;
  priceOverrides: PriceOverrideMap;
  flashByRoom: FlashByRoomMap;
  autopilotMode: AutopilotMode;
  calendar: CalendarMap;
  onClose: () => void;
  onSave: (items: PricingSavePayload["items"]) => Promise<void>;
  onClear?: () => Promise<void>;
}) {
  const isSingle = editor.dates.length === 1;
  const room = rooms.find(r => r.id === editor.roomId);
  const base = roomPrices[editor.roomId] || { basePrice: null, baseQty: null, mrp: null, baseFlashFloorPrice: null };
  const ovr0 = isSingle ? priceOverrides[`${editor.roomId}|${editor.dates[0]}`] : null;
  const flashList = flashByRoom[editor.roomId] || [];
  const flashFirst = flashList[0] || null;

  const [tab, setTab] = useState<EditorTab>(editor.initialTab);
  // Live form state — initial values come from override (single) or empty (bulk).
  const initStr = (n: number | null | undefined) => n != null ? String(n) : "";
  const [regularStr,    setRegularStr]    = useState(initStr(ovr0?.mrp ?? null));
  const [floorStr,      setFloorStr]      = useState(initStr(ovr0?.floorPrice ?? null));
  const [flashStr,      setFlashStr]      = useState(initStr(ovr0?.flashPrice ?? null));
  const [flashFloorStr, setFlashFloorStr] = useState(initStr(ovr0?.flashFloorPrice ?? null));
  const [qtyStr,        setQtyStr]        = useState(initStr(ovr0?.quantityOverride ?? null));

  const [saving, setSaving] = useState(false);
  const [confirmWarnings, setConfirmWarnings] = useState(false); // shows "Save anyway" sheet

  function toNum(s: string): number | null {
    const t = s.trim();
    if (t === "") return null;
    const n = Number(t);
    return isNaN(n) ? null : n;
  }
  const newRegular    = toNum(regularStr);
  const newFloor      = toNum(floorStr);
  const newFlash      = toNum(flashStr);
  const newFlashFloor = toNum(flashFloorStr);
  const newQty        = toNum(qtyStr);

  // Effective post-save values per price field (used by warning logic).
  // Falls back to current override → base if user didn't change anything.
  function effective(field: "regular" | "floor" | "flash" | "flashFloor"): number | null {
    if (field === "regular") {
      if (regularStr.trim() !== "") return newRegular;
      if (ovr0?.mrp != null) return ovr0.mrp;
      return base.mrp;
    }
    if (field === "floor") {
      if (floorStr.trim() !== "") return newFloor;
      if (ovr0?.floorPrice != null) return ovr0.floorPrice;
      return base.basePrice;
    }
    if (field === "flash") {
      if (flashStr.trim() !== "") return newFlash;
      if (ovr0?.flashPrice != null) return ovr0.flashPrice;
      return flashFirst?.price ?? null;
    }
    if (field === "flashFloor") {
      if (flashFloorStr.trim() !== "") return newFlashFloor;
      if (ovr0?.flashFloorPrice != null) return ovr0.flashFloorPrice;
      return base.baseFlashFloorPrice;
    }
    return null;
  }

  // ── Warning engine ─────────────────────────────────────────────
  // These are advisory — surfaced before save. Partner can override.
  const roomName = room?.type || room?.name || "Room";
  const warnings: Warning[] = useMemo(() => {
    const out: Warning[] = [];
    const eR = effective("regular");
    const eF = effective("floor");
    const eFl = effective("flash");
    const eFf = effective("flashFloor");

    // Rule A — Floor > Regular (MRP)
    if (eR != null && eF != null && eF > eR) {
      out.push({
        level: "warn",
        scope: { dates: editor.dates, roomName },
        message: `Floor (₹${eF.toLocaleString("en-IN")}) is higher than the regular price (₹${eR.toLocaleString("en-IN")}). Customers won't bid below the public MRP normally — auto-accept windows may not trigger.`,
      });
    }
    // Rule B — Flash floor > Floor
    if (eF != null && eFf != null && eFf > eF) {
      out.push({
        level: "warn",
        scope: { dates: editor.dates, roomName },
        message: `Flash floor (₹${eFf.toLocaleString("en-IN")}) is higher than the regular floor (₹${eF.toLocaleString("en-IN")}). Flash deals are meant to discount further than the standard floor.`,
      });
    }
    // Rule C — Flash regular < Flash floor
    if (eFl != null && eFf != null && eFl < eFf) {
      out.push({
        level: "warn",
        scope: { dates: editor.dates, roomName },
        message: `Flash regular (₹${eFl.toLocaleString("en-IN")}) is lower than the flash floor (₹${eFf.toLocaleString("en-IN")}). The flash deal would auto-reject all eligible bids.`,
      });
    }
    // Rule D — Any date already has a CONFIRMED booking (bid)
    const datesWithBooking = editor.dates.filter(d => {
      const c = calendar[editor.roomId]?.[d];
      return c?.source === "bid";
    });
    if (datesWithBooking.length > 0) {
      out.push({
        level: "info",
        scope: { dates: datesWithBooking, roomName },
        message: `${datesWithBooking.length} of these date${datesWithBooking.length === 1 ? "" : "s"} already has a confirmed booking. Your override applies to FUTURE bids only; existing bookings are unaffected.`,
      });
    }
    // Rule E — Active flash deal exists for this room (informational on flash tabs)
    if ((tab === "flash" || tab === "flashFloor") && flashList.length > 0) {
      out.push({
        level: "info",
        scope: {
          dates: editor.dates,
          roomName,
          flashDealIds: flashList.map(f => f.id),
        },
        message: `${flashList.length} active flash deal${flashList.length === 1 ? "" : "s"} on this room. Saving here writes a per-date override; the deal itself stays live until its expiry on the deal page.`,
      });
    }
    // Rule F — Autopilot-mode-specific warnings
    if (autopilotMode === "auto") {
      // Full autopilot: floor too high could starve auto-accepts
      if (eF != null && eR != null && eF >= eR * 1.10) {
        out.push({
          level: "warn",
          scope: { dates: editor.dates, roomName },
          message: `You are in Full Autopilot mode but the floor (₹${eF.toLocaleString("en-IN")}) is ≥110% of MRP. Tier-eligible auto-confirms may never trigger because bids almost never reach this threshold.`,
        });
      }
    }
    if (autopilotMode === "hybrid") {
      // Hybrid: very low floor may surrender too many auto-accepts to LOWBALL
      if (eF != null && eR != null && eF <= eR * 0.40) {
        out.push({
          level: "warn",
          scope: { dates: editor.dates, roomName },
          message: `You are in Hybrid mode but the floor (₹${eF.toLocaleString("en-IN")}) is ≤40% of MRP. Premium / strong bidders will auto-confirm well below your target margin.`,
        });
      }
    }
    return out;
  }, [editor, regularStr, floorStr, flashStr, flashFloorStr, calendar, flashList, tab, autopilotMode, roomName]);

  const hasUserEdits =
    regularStr.trim() !== initStr(ovr0?.mrp ?? null) ||
    floorStr.trim() !== initStr(ovr0?.floorPrice ?? null) ||
    flashStr.trim() !== initStr(ovr0?.flashPrice ?? null) ||
    flashFloorStr.trim() !== initStr(ovr0?.flashFloorPrice ?? null) ||
    qtyStr.trim() !== initStr(ovr0?.quantityOverride ?? null);

  function buildItems(): PricingSavePayload["items"] {
    // Only include fields the partner touched. Empty string = clear (null).
    const patch: Partial<PricingSavePayload["items"][number]> = {};
    if (regularStr.trim()    !== "") patch.mrp = newRegular;
    if (floorStr.trim()      !== "") patch.floorPrice = newFloor;
    if (flashStr.trim()      !== "") patch.flashPrice = newFlash;
    if (flashFloorStr.trim() !== "") patch.flashFloorPrice = newFlashFloor;
    if (qtyStr.trim()        !== "") patch.quantityOverride = newQty;
    return editor.dates.map(date => ({
      roomId: editor.roomId,
      date,
      ...patch,
    }));
  }

  async function attemptSave() {
    if (saving) return;
    if (!hasUserEdits) { onClose(); return; }
    if (warnings.some(w => w.level === "warn") && !confirmWarnings) {
      setConfirmWarnings(true);
      return;
    }
    setSaving(true);
    try {
      await onSave(buildItems());
    } catch (e: any) {
      alert(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    if (!onClear) return;
    if (!confirm("Remove this override? The date will revert to the base price + quantity.")) return;
    setSaving(true);
    try { await onClear(); } finally { setSaving(false); }
  }

  const datesLabel = isSingle
    ? new Date(editor.dates[0]).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "long", year: "numeric" })
    : `${editor.dates.length} dates · ${new Date(editor.dates[0]).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${new Date(editor.dates[editor.dates.length - 1]).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;

  const mode = MODE_INFO[autopilotMode];
  const dangerWarnings = warnings.filter(w => w.level === "warn");
  const infoWarnings   = warnings.filter(w => w.level === "info");

  return (
    <div className="ped-backdrop" onClick={onClose}>
      <div className="ped-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ped-hd">
          <div>
            <p className="ped-eyebrow">{isSingle ? `Edit ${roomName}` : "Bulk edit"}</p>
            <p className="ped-title">{datesLabel}</p>
          </div>
          <button type="button" onClick={onClose} className="ped-close" aria-label="Close">✕</button>
        </div>

        <div className="ped-body">
          {/* Autopilot mode chip */}
          <div className="ped-mode" style={{ color: mode.tone, borderColor: `${mode.tone}66`, background: `${mode.tone}14` }}>
            <span className="ped-mode-emoji">{mode.emoji}</span>
            <span className="ped-mode-label">{mode.label}</span>
          </div>

          {/* Room picker (bulk only, or single with >1 room) */}
          {!isSingle && rooms.length > 1 && (
            <div className="ped-section">
              <p className="ped-label">Room</p>
              <select
                className="mv-ed-roompick"
                value={editor.roomId}
                onChange={(e) => setEditorRoom(e.target.value)}
              >
                {rooms.map(r => (
                  <option key={r.id} value={r.id}>{r.type || r.name || "Room"}</option>
                ))}
              </select>
            </div>
          )}

          {/* Tabs */}
          <div className="ped-tabs">
            {TAB_DEFS.map(t => (
              <button
                key={t.id}
                type="button"
                className={`ped-tab ${tab === t.id ? "ped-tab-on" : ""}`}
                onClick={() => setTab(t.id)}
              >
                <span aria-hidden>{t.emoji}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          {/* Active tab content */}
          {tab === "regular" && (
            <PriceField
              label="Regular price (₹ per night)"
              hint={base.mrp != null ? `Base MRP: ₹${base.mrp.toLocaleString("en-IN")}/night` : "No MRP set on this room"}
              value={regularStr}
              onChange={setRegularStr}
              placeholder={base.mrp != null ? String(base.mrp) : "0"}
            />
          )}
          {tab === "floor" && (
            <PriceField
              label="Floor price (minimum bid accepted)"
              hint={base.basePrice != null ? `Base floor: ₹${base.basePrice.toLocaleString("en-IN")}/night` : "No floor price set on this room"}
              value={floorStr}
              onChange={setFloorStr}
              placeholder={base.basePrice != null ? String(base.basePrice) : "0"}
            />
          )}
          {tab === "flash" && (
            <PriceField
              label="Flash deal regular price (₹ per night)"
              hint={
                flashFirst?.price != null
                  ? `Active flash deal sells at ₹${flashFirst.price.toLocaleString("en-IN")}`
                  : flashList.length === 0
                    ? "No active flash deal — saving here pre-sets the price for the next one"
                    : "Active flash deal has no regular price set"
              }
              value={flashStr}
              onChange={setFlashStr}
              placeholder={flashFirst?.price != null ? String(flashFirst.price) : "0"}
            />
          )}
          {tab === "flashFloor" && (
            <PriceField
              label="Flash floor (minimum acceptable inside flash)"
              hint={base.baseFlashFloorPrice != null ? `Base flash floor: ₹${base.baseFlashFloorPrice.toLocaleString("en-IN")}/night` : "No flash floor set on this room"}
              value={flashFloorStr}
              onChange={setFlashFloorStr}
              placeholder={base.baseFlashFloorPrice != null ? String(base.baseFlashFloorPrice) : "0"}
            />
          )}
          {tab === "quantity" && (
            <div className="ped-section">
              <p className="ped-label">Available quantity for this date</p>
              <input
                type="number"
                inputMode="numeric"
                className="ped-input"
                value={qtyStr}
                onChange={(e) => setQtyStr(e.target.value)}
                placeholder={base.baseQty != null ? String(base.baseQty) : "0"}
              />
              <p className="ped-hint">Total units configured: {base.baseQty ?? "—"}</p>
            </div>
          )}

          {/* Warnings */}
          {infoWarnings.length > 0 && (
            <div className="ped-warns ped-warns-info">
              {infoWarnings.map((w, i) => (
                <div key={i} className="ped-warn ped-warn-info">
                  <span className="ped-warn-icon">ℹ️</span>
                  <div>
                    <p className="ped-warn-msg">{w.message}</p>
                    {w.scope.dates.length > 0 && (
                      <p className="ped-warn-scope">📅 {w.scope.dates.length} date{w.scope.dates.length === 1 ? "" : "s"} · 🛏 {w.scope.roomName}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {dangerWarnings.length > 0 && (
            <div className="ped-warns ped-warns-danger">
              <p className="ped-warns-hd">⚠️ {dangerWarnings.length} rule {dangerWarnings.length === 1 ? "may" : "may"} break — review before save</p>
              {dangerWarnings.map((w, i) => (
                <div key={i} className="ped-warn ped-warn-danger">
                  <span className="ped-warn-icon">⚠️</span>
                  <div>
                    <p className="ped-warn-msg">{w.message}</p>
                    <p className="ped-warn-scope">
                      📅 {w.scope.dates.length} date{w.scope.dates.length === 1 ? "" : "s"} · 🛏 {w.scope.roomName}
                      {w.scope.flashDealIds && <> · ⚡ {w.scope.flashDealIds.length} flash deal{w.scope.flashDealIds.length === 1 ? "" : "s"}</>}
                    </p>
                  </div>
                </div>
              ))}
              {confirmWarnings && (
                <p className="ped-warns-confirm">
                  ✓ I've reviewed. Save anyway?
                </p>
              )}
            </div>
          )}
        </div>

        <div className="ped-ft">
          {onClear && (
            <button type="button" onClick={clear} disabled={saving} className="ped-clear">
              ↺ Reset
            </button>
          )}
          <button type="button" onClick={onClose} className="ped-cancel">Cancel</button>
          <button type="button" onClick={attemptSave} disabled={saving} className="ped-save">
            {saving ? "Saving…" : (dangerWarnings.length > 0 && confirmWarnings ? "Save anyway" : "Save")}
          </button>
        </div>
      </div>

      <style jsx>{`
        .ped-backdrop {
          position: fixed; inset: 0; z-index: 110;
          background: rgba(31,26,15,0.55);
          backdrop-filter: blur(4px);
          display: flex; align-items: flex-end; justify-content: center;
        }
        .ped-sheet {
          width: 100%; max-width: 520px;
          background: #ffffff;
          color: #1F1A0F;
          border-top-left-radius: 22px; border-top-right-radius: 22px;
          box-shadow: 0 -20px 60px rgba(31,26,15,0.30);
          display: flex; flex-direction: column;
          max-height: min(92dvh, 760px);
          animation: pedUp 0.24s cubic-bezier(0.3,1,0.3,1) both;
        }
        @media (min-width: 640px) {
          .ped-backdrop { align-items: center; }
          .ped-sheet { border-radius: 22px; max-height: 86dvh; }
        }
        @keyframes pedUp { from { transform: translateY(28px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

        .ped-hd {
          display: flex; align-items: center; justify-content: space-between;
          padding: 18px 22px 14px;
          border-bottom: 1px solid rgba(232,228,217,0.8);
        }
        .ped-eyebrow {
          font-size: 0.62rem; font-weight: 700; letter-spacing: 0.12em;
          color: #8B6914;
          text-transform: uppercase;
        }
        .ped-title {
          font-family: "Cormorant Garamond", serif;
          font-size: 1.35rem; font-weight: 400;
          color: #1F1A0F;
          line-height: 1.1; margin-top: 2px;
        }
        .ped-close {
          width: 34px; height: 34px; border-radius: 999px;
          background: rgba(31,26,15,0.06);
          border: 1px solid rgba(232,228,217,0.8);
          color: #4A3820; font-size: 1.1rem;
          cursor: pointer;
        }

        .ped-body { padding: 14px 22px; flex: 1 1 auto; overflow-y: auto; -webkit-overflow-scrolling: touch; }

        .ped-mode {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 6px 12px;
          border: 1px solid;
          border-radius: 999px;
          font-size: 0.72rem;
          font-weight: 600;
          margin-bottom: 14px;
        }
        .ped-mode-emoji { font-size: 0.92rem; line-height: 1; }
        .ped-mode-label { line-height: 1.2; }

        .ped-section + .ped-section { margin-top: 12px; }
        .ped-section, .ped-warns + .ped-tabs, .ped-tabs + .ped-section { margin-top: 12px; }
        .ped-label {
          font-size: 0.68rem; font-weight: 700;
          color: #4A3820;
          text-transform: uppercase; letter-spacing: 0.08em;
          margin-bottom: 8px;
        }

        .ped-tabs {
          display: flex; flex-wrap: wrap; gap: 4px;
          background: #fcfcfd;
          border: 1px solid rgba(232,228,217,0.8);
          border-radius: 12px;
          padding: 4px;
          margin-bottom: 14px;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }
        .ped-tabs::-webkit-scrollbar { height: 0; }
        .ped-tab {
          flex: 1 0 auto;
          padding: 8px 10px;
          font-size: 0.74rem;
          font-weight: 700;
          color: #4A3820;
          background: transparent;
          border: 1px solid transparent;
          border-radius: 8px;
          cursor: pointer;
          font-family: inherit;
          display: inline-flex; align-items: center; gap: 4px;
          white-space: nowrap;
          transition: all 0.15s ease;
        }
        .ped-tab:hover { background: rgba(201,166,107,0.10); }
        .ped-tab-on {
          background: linear-gradient(135deg, #b4c1cf, #C9A66B);
          color: #1F1A0F;
          border-color: rgba(110,84,48,0.30);
          box-shadow: 0 2px 6px rgba(201,166,107,0.30);
        }

        .ped-input-wrap {
          display: flex; align-items: center;
          background: #fcfcfd;
          border: 1px solid rgba(110,84,48,0.30);
          border-radius: 10px;
          overflow: hidden;
        }
        .ped-prefix {
          padding: 0 12px;
          font-weight: 700;
          color: #4A3820;
          background: rgba(232,228,217,0.45);
          align-self: stretch;
          display: flex; align-items: center;
        }
        .ped-input {
          flex: 1 1 auto;
          padding: 12px;
          background: transparent;
          border: none;
          color: #1F1A0F;
          font-size: 1rem;
          font-weight: 600;
          outline: none;
          font-family: inherit;
          width: 100%;
          min-width: 0;
        }
        :global(.mv-ed-roompick) {
          width: 100%;
          padding: 10px 12px;
          background: #fcfcfd;
          border: 1px solid rgba(110,84,48,0.30);
          border-radius: 10px;
          color: #1F1A0F;
          font-size: 0.92rem;
          font-family: inherit;
        }
        .ped-hint {
          margin-top: 6px;
          font-size: 0.72rem;
          color: #6E5430;
        }

        /* ── Warnings ─────────────────────────────── */
        .ped-warns { margin-top: 14px; }
        .ped-warns-hd {
          font-size: 0.74rem;
          font-weight: 700;
          color: #b45309;
          margin-bottom: 8px;
        }
        .ped-warn {
          display: flex; align-items: flex-start; gap: 8px;
          padding: 10px 12px;
          border-radius: 10px;
          margin-top: 6px;
        }
        .ped-warn-icon { font-size: 1rem; line-height: 1.2; flex-shrink: 0; }
        .ped-warn-msg {
          font-size: 0.78rem;
          color: #1F1A0F;
          line-height: 1.35;
        }
        .ped-warn-scope {
          margin-top: 4px;
          font-size: 0.68rem;
          font-weight: 600;
          color: #6E5430;
          letter-spacing: 0.01em;
        }
        .ped-warn-info {
          background: rgba(59,130,246,0.10);
          border: 1px solid rgba(59,130,246,0.22);
        }
        .ped-warn-info .ped-warn-msg { color: #1e3a8a; }
        .ped-warn-info .ped-warn-scope { color: #1d4ed8; }
        .ped-warn-danger {
          background: rgba(140, 160, 182,0.16);
          border: 1px solid rgba(140, 160, 182,0.45);
        }
        .ped-warns-confirm {
          margin-top: 10px;
          padding: 8px 10px;
          font-size: 0.78rem;
          font-weight: 700;
          color: #7c4f0c;
          background: rgba(140, 160, 182,0.10);
          border: 1px dashed rgba(140, 160, 182,0.5);
          border-radius: 8px;
        }

        .ped-ft {
          padding: 12px 22px calc(env(safe-area-inset-bottom, 0px) + 14px);
          display: flex; gap: 8px;
          border-top: 1px solid rgba(232,228,217,0.8);
          background: #ffffff;
        }
        .ped-clear {
          flex: 0 0 auto;
          padding: 10px 12px;
          background: #f0f3f5;
          color: #7c4f0c;
          border: 1px solid rgba(140, 160, 182,0.35);
          border-radius: 10px;
          font-size: 0.78rem; font-weight: 700;
          cursor: pointer;
          font-family: inherit;
        }
        .ped-cancel {
          flex: 0 0 auto;
          padding: 10px 14px;
          background: transparent;
          color: #4A3820;
          border: 1px solid rgba(110,84,48,0.30);
          border-radius: 10px;
          font-size: 0.84rem; font-weight: 700;
          cursor: pointer;
          font-family: inherit;
        }
        .ped-save {
          flex: 1 1 auto;
          padding: 12px 18px;
          background: linear-gradient(135deg, #b4c1cf, #C9A66B);
          color: #1F1A0F;
          border: 1px solid rgba(110,84,48,0.30);
          border-radius: 10px;
          font-size: 0.92rem; font-weight: 800;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(201,166,107,0.30);
          font-family: inherit;
        }
        .ped-save:disabled, .ped-clear:disabled { opacity: 0.55; cursor: not-allowed; }
      `}</style>
    </div>
  );
}

// Helper: ₹-prefixed price input (used by Regular / Floor / Flash / Flash Floor tabs).
function PriceField({
  label, hint, value, onChange, placeholder,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="pf-section">
      <p className="pf-label">{label}</p>
      <div className="pf-input-wrap">
        <span className="pf-prefix">₹</span>
        <input
          type="number"
          inputMode="numeric"
          className="pf-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus
        />
      </div>
      <p className="pf-hint">{hint}</p>
      <style jsx>{`
        .pf-section {}
        .pf-label {
          font-size: 0.68rem; font-weight: 700;
          color: #4A3820;
          text-transform: uppercase; letter-spacing: 0.08em;
          margin-bottom: 8px;
        }
        .pf-input-wrap {
          display: flex; align-items: stretch;
          background: #fcfcfd;
          border: 1px solid rgba(110,84,48,0.30);
          border-radius: 10px;
          overflow: hidden;
        }
        .pf-prefix {
          padding: 0 12px;
          font-weight: 700;
          color: #4A3820;
          background: rgba(232,228,217,0.45);
          display: flex; align-items: center;
        }
        .pf-input {
          flex: 1 1 auto;
          padding: 12px;
          background: transparent;
          border: none;
          color: #1F1A0F;
          font-size: 1rem;
          font-weight: 600;
          outline: none;
          font-family: inherit;
          width: 100%;
          min-width: 0;
        }
        .pf-hint {
          margin-top: 6px;
          font-size: 0.72rem;
          color: #6E5430;
        }
      `}</style>
    </div>
  );
}
