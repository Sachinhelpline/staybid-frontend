"use client";
// ═══════════════════════════════════════════════════════════════════════
// AvailabilityCalendar — premium per-room × per-day occupancy grid for
// the partner dashboard. v113 — replaces the cramped 22×24 HTML table
// the partner panel used to ship.
//
// What this owns:
//   • One row per room category, one column per day-of-month, with
//     larger 36×44 cells, weekend shading, today indicator, sticky
//     Room column on horizontal scroll, and a colour-coded legend that
//     matches the cozy palette + the v107 channel colours.
//   • Tap empty cell → onPickWalkIn(roomId, from, to) — host opens
//     existing walk-in modal pre-filled. Drag across cells → multi-day
//     walk-in range.
//   • Tap occupied cell → details popover. If source = manual / walk_in /
//     group, "Remove block" button calls onDelete(refId).
//   • Top-bar "📌 Block dates" button → opens the dedicated
//     <BlockDatesSheet> for bulk maintenance / private / group holds.
//
// Calendar data shape is the SAME one /api/partner/calendar returns —
// no new backend contract needed. The host page already loads it.
//
// Bulk block writes through /api/partner/walk-in with `source: "manual"`
// (or whatever the user picked). The existing endpoint accepts that
// extra field (extended in this same release).
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";

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
  bid:      { bg: "linear-gradient(135deg,#fef3c7,#fde68a)", border: "#d4a015", pip: "#a17000", label: "Bid booked"      },
  ota_ical: { bg: "linear-gradient(135deg,#dbeafe,#bfdbfe)", border: "#3b82f6", pip: "#1d4ed8", label: "OTA channel"     },
  walk_in:  { bg: "linear-gradient(135deg,#fce7f3,#fbcfe8)", border: "#db2777", pip: "#9d174d", label: "Walk-in"         },
  manual:   { bg: "repeating-linear-gradient(135deg,#e5e7eb 0 4px,#d1d5db 4px 8px)", border: "#9ca3af", pip: "#374151", label: "Blocked"  },
  group:    { bg: "linear-gradient(135deg,#ede9fe,#ddd6fe)", border: "#7c3aed", pip: "#5b21b6", label: "Group"           },
};
const FREE_BG     = "linear-gradient(135deg,#ecfccb,#d9f99d)";
const FREE_BORDER = "#a7d046";

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
};

export default function AvailabilityCalendar({
  rooms, calendar, month, onMonthChange, onRefresh, loading,
  onPickWalkIn, onDeleteBlock, onOpenBlockSheet,
}: Props) {
  // ── Drag-to-select state (one row at a time) ───────────────────────
  const [drag, setDrag] = useState<{ roomId: string; startDate: string; endDate: string } | null>(null);
  const dragActive = useRef(false);

  // ── Details popover ─────────────────────────────────────────────────
  const [popover, setPopover] = useState<{ roomId: string; date: string; occ: Occupancy; x: number; y: number } | null>(null);

  // ── Today + month days ─────────────────────────────────────────────
  const todayISO = toISO(new Date());
  const days = useMemo(() => {
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => {
      const d = new Date(month.getFullYear(), month.getMonth(), i + 1);
      return { iso: toISO(d), date: d, day: d.getDate(), dow: d.getDay() };
    });
  }, [month]);

  // ── Stats (top legend chips) ────────────────────────────────────────
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

  // ── Drag handlers ───────────────────────────────────────────────────
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
    // Make it a half-open range (toDate exclusive — checkout day).
    const hiPlusOne = toISO(addDays(new Date(hi), 1));
    setDrag(null);
    // If the range is just one day AND that cell is occupied, treat as a
    // tap on the occupied cell instead of a drag.
    const cell = calendar[roomId]?.[lo];
    if (lo === hi && cell) {
      return; // handled by onCellTap
    }
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
      // Show details popover.
      const target = ev.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      setPopover({
        roomId, date, occ,
        x: rect.left + rect.width / 2,
        y: rect.top + window.scrollY,
      });
      return;
    }
    // Empty cell → tomorrow as checkout default → walk-in modal.
    onPickWalkIn({ roomId, fromDate: date, toDate: toISO(addDays(new Date(date), 1)) });
  }

  function isInDrag(roomId: string, dateISO: string): boolean {
    if (!drag || drag.roomId !== roomId) return false;
    const lo = drag.startDate <= drag.endDate ? drag.startDate : drag.endDate;
    const hi = drag.startDate <= drag.endDate ? drag.endDate   : drag.startDate;
    return dateISO >= lo && dateISO <= hi;
  }

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="ac-root" onMouseLeave={() => { if (dragActive.current) endDrag(); }}>
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

      {/* ── Legend chips ─────────────────────────────────────────── */}
      <div className="ac-legend">
        <LegendChip bg={FREE_BG} border={FREE_BORDER} label="Free" count={stats.free} />
        <LegendChip {...SOURCE_STYLE.bid}      count={stats.bid} />
        <LegendChip {...SOURCE_STYLE.ota_ical} count={stats.ota} />
        <LegendChip {...SOURCE_STYLE.walk_in}  count={stats.walk} />
        <LegendChip {...SOURCE_STYLE.manual}   count={stats.manual} />
        <LegendChip {...SOURCE_STYLE.group}    count={stats.group} />
      </div>

      {/* ── Drag tip ─────────────────────────────────────────────── */}
      <p className="ac-tip">💡 Tap empty cell to add a walk-in · drag across cells to block a range · tap occupied cell for details · or use <b>📌 Block dates</b> for bulk holds.</p>

      {/* ── Grid ─────────────────────────────────────────────────── */}
      {rooms.length === 0 ? (
        <div className="ac-empty">
          No rooms configured yet. Add rooms in the <b>Rooms</b> tab first.
        </div>
      ) : (
        <div className="ac-grid-scroll">
          <table className="ac-grid">
            <thead>
              <tr>
                <th className="ac-room-th">Room</th>
                {days.map(d => {
                  const isWE = d.dow === 0 || d.dow === 6;
                  const isToday = d.iso === todayISO;
                  return (
                    <th
                      key={d.iso}
                      className={`ac-day-th ${isWE ? "ac-day-th-we" : ""} ${isToday ? "ac-day-th-today" : ""}`}
                    >
                      <span className="ac-day-num">{d.day}</span>
                      <span className="ac-day-dow">{["S","M","T","W","T","F","S"][d.dow]}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rooms.map(r => (
                <tr key={r.id}>
                  <td className="ac-room-td" title={r.type || r.name || "Room"}>
                    <span className="ac-room-name">{r.type || r.name || "Room"}</span>
                  </td>
                  {days.map(d => {
                    const cell = calendar[r.id]?.[d.iso];
                    const inDrag = isInDrag(r.id, d.iso);
                    const isToday = d.iso === todayISO;
                    const isWE = d.dow === 0 || d.dow === 6;
                    const src = cell?.source ? SOURCE_STYLE[cell.source] : null;
                    const bg = inDrag ? "linear-gradient(135deg,#fde68a,#fbbf24)" : (src ? src.bg : FREE_BG);
                    const border = inDrag ? "#d97706" : (src ? src.border : FREE_BORDER);
                    return (
                      <td key={d.iso} className={`ac-cell-td ${isWE ? "ac-cell-td-we" : ""} ${isToday ? "ac-cell-td-today" : ""}`}>
                        <button
                          type="button"
                          className="ac-cell"
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
                            // Only treat as a tap if not a drag.
                            if (!dragActive.current) onCellTap(r.id, d.iso, cell, e);
                          }}
                          data-cell-date={d.iso}
                          data-cell-room={r.id}
                          aria-label={cell ? `${SOURCE_STYLE[cell.source || "manual"]?.label || "Booked"}: ${d.iso}` : `Free on ${d.iso} · tap to add`}
                        >
                          {cell?.assignedUnitNumber && (
                            <span className="ac-cell-unit">#{cell.assignedUnitNumber}</span>
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
      )}

      {/* ── Details popover ──────────────────────────────────────── */}
      {popover && (
        <div className="ac-popover-backdrop" onClick={() => setPopover(null)}>
          <div
            className="ac-popover"
            onClick={(e) => e.stopPropagation()}
            style={{
              left: Math.max(12, Math.min(window.innerWidth - 288, popover.x - 144)),
              top:  Math.max(12, popover.y - 200),
            }}
          >
            <div className="ac-popover-hd">
              <span
                className="ac-popover-pip"
                style={{ background: SOURCE_STYLE[popover.occ.source || "manual"]?.pip || "#374151" }}
              />
              <p className="ac-popover-title">
                {SOURCE_STYLE[popover.occ.source || "manual"]?.label || "Booked"}
              </p>
              <button
                type="button"
                onClick={() => setPopover(null)}
                className="ac-popover-close"
                aria-label="Close"
              >✕</button>
            </div>
            <div className="ac-popover-body">
              <p className="ac-popover-row"><span>Date</span><b>{new Date(popover.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</b></p>
              {popover.occ.guestName && (
                <p className="ac-popover-row"><span>Guest</span><b>{popover.occ.guestName}</b></p>
              )}
              {popover.occ.assignedUnitNumber && (
                <p className="ac-popover-row"><span>Room #</span><b>{popover.occ.assignedUnitNumber}</b></p>
              )}
              {popover.occ.amount && (
                <p className="ac-popover-row"><span>Amount</span><b>₹{popover.occ.amount.toLocaleString("en-IN")}</b></p>
              )}
              {popover.occ.provider && (
                <p className="ac-popover-row"><span>Channel</span><b>{popover.occ.provider}</b></p>
              )}
              {popover.occ.note && (
                <p className="ac-popover-note">📝 {popover.occ.note}</p>
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
                  className="ac-popover-delete"
                >
                  🗑 Remove block
                </button>
              )}
              {popover.occ.source === "bid" && (
                <p className="ac-popover-help">⚡ This is a confirmed bid. Manage it from the <b>Bookings</b> tab.</p>
              )}
              {popover.occ.source === "ota_ical" && (
                <p className="ac-popover-help">🌐 Imported from {popover.occ.provider || "your OTA channel"}. Cancel directly on that platform.</p>
              )}
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .ac-root {
          background: var(--bg-card, #ffffff);
          border: 1px solid var(--border-soft, rgba(232,228,217,0.8));
          border-radius: 18px;
          padding: 16px;
          box-shadow: var(--shadow-card, 0 6px 22px rgba(31,26,15,0.10));
        }

        .ac-toolbar {
          display: flex; align-items: center; justify-content: space-between;
          flex-wrap: wrap; gap: 10px;
        }
        .ac-month-nav { display: flex; align-items: center; gap: 6px; }
        .ac-month-label {
          font-family: "Cormorant Garamond", serif;
          font-size: 1.25rem; font-weight: 500;
          color: var(--text-base, #1F1A0F);
          padding: 0 10px;
          min-width: 160px; text-align: center;
        }
        .ac-icon-btn {
          width: 34px; height: 34px; border-radius: 10px;
          background: var(--bg-pill, #FFFCF6);
          border: 1px solid var(--border-soft, rgba(232,228,217,0.8));
          color: var(--text-soft, #4A3820);
          font-size: 1.2rem; font-weight: bold;
          cursor: pointer;
          transition: transform 0.12s ease, background 0.15s ease;
        }
        .ac-icon-btn:hover { background: var(--accent-soft, rgba(201,166,107,0.14)); }
        .ac-icon-btn:active { transform: scale(0.94); }
        .ac-today-btn {
          margin-left: 4px;
          padding: 6px 12px; border-radius: 10px;
          background: var(--accent-soft, rgba(201,166,107,0.14));
          color: var(--accent, #C9A66B);
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
          background: linear-gradient(135deg, #D9BE82, #C9A66B);
          color: #1F1A0F;
          border: 1px solid rgba(110,84,48,0.30);
          box-shadow: 0 2px 8px rgba(201,166,107,0.30);
        }
        .ac-block-btn:hover { box-shadow: 0 4px 14px rgba(201,166,107,0.45); }
        .ac-block-btn:active { transform: scale(0.97); }
        .ac-refresh-btn {
          background: var(--text-soft, #4A3820);
          color: #FFFCF6;
          border: 1px solid var(--text-soft, #4A3820);
        }
        .ac-refresh-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        .ac-legend {
          margin-top: 14px; display: flex; flex-wrap: wrap; gap: 6px;
        }
        .ac-tip {
          margin-top: 10px;
          font-size: 0.72rem;
          color: var(--text-muted, #6E5430);
          padding: 8px 12px;
          background: var(--accent-soft, rgba(201,166,107,0.14));
          border-radius: 10px;
          border: 1px solid rgba(201,166,107,0.22);
        }
        .ac-tip b { color: var(--text-base, #1F1A0F); }

        .ac-empty {
          margin-top: 18px;
          text-align: center;
          padding: 36px 16px;
          color: var(--text-muted, #6E5430);
          background: var(--bg-pill, #FFFCF6);
          border-radius: 14px;
          border: 1px dashed var(--border-strong, rgba(110,84,48,0.30));
        }

        .ac-grid-scroll {
          margin-top: 14px;
          overflow-x: auto;
          background: var(--bg-pill, #FFFCF6);
          border-radius: 14px;
          border: 1px solid var(--border-soft, rgba(232,228,217,0.8));
        }
        .ac-grid {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          min-width: 720px;
          font-size: 0.72rem;
        }
        .ac-grid thead tr { background: var(--bg-card, #ffffff); }
        .ac-room-th, .ac-room-td {
          position: sticky; left: 0;
          background: var(--bg-card, #ffffff);
          z-index: 2;
          padding: 10px 12px 10px 14px;
          text-align: left;
          min-width: 140px;
          max-width: 140px;
          box-shadow: 2px 0 6px rgba(31,26,15,0.05);
        }
        .ac-room-th {
          font-weight: 700;
          color: var(--text-soft, #4A3820);
          font-size: 0.7rem; letter-spacing: 0.06em; text-transform: uppercase;
        }
        .ac-room-td {
          border-top: 1px solid var(--border-soft, rgba(232,228,217,0.8));
        }
        .ac-room-name {
          font-weight: 700;
          color: var(--text-base, #1F1A0F);
          font-size: 0.82rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          display: block;
        }
        .ac-day-th {
          font-weight: 600;
          color: var(--text-muted, #6E5430);
          padding: 8px 0 6px;
          min-width: 36px;
          width: 36px;
          text-align: center;
        }
        .ac-day-th-we { color: #c2410c; }
        .ac-day-th-today { color: var(--accent, #C9A66B); }
        .ac-day-num {
          display: block;
          font-size: 0.82rem;
          font-weight: 700;
          line-height: 1.1;
        }
        .ac-day-th-today .ac-day-num {
          background: linear-gradient(135deg,#D9BE82,#C9A66B);
          color: #1F1A0F;
          border-radius: 999px;
          width: 24px; height: 24px;
          margin: 0 auto;
          display: inline-flex; align-items: center; justify-content: center;
          line-height: 1;
        }
        .ac-day-dow {
          display: block;
          font-size: 0.55rem;
          font-weight: 600;
          margin-top: 1px;
          opacity: 0.7;
          letter-spacing: 0.04em;
        }

        .ac-cell-td {
          padding: 2px;
          border-top: 1px solid rgba(232,228,217,0.5);
          background: var(--bg-pill, #FFFCF6);
        }
        .ac-cell-td-we { background: rgba(232,228,217,0.30); }
        .ac-cell-td-today { background: rgba(201,166,107,0.10); }

        .ac-cell {
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
        .ac-cell:hover {
          transform: scale(1.06);
          box-shadow: 0 2px 8px rgba(201,166,107,0.30), inset 0 0 0 1.5px rgba(31,26,15,0.20);
          z-index: 1;
        }
        .ac-cell:active { transform: scale(0.92); }
        .ac-cell-unit {
          white-space: nowrap;
          text-shadow: 0 1px 0 rgba(255,255,255,0.55);
        }

        .ac-popover-backdrop {
          position: fixed; inset: 0; z-index: 80;
          background: rgba(31,26,15,0.18);
          backdrop-filter: blur(2px);
        }
        .ac-popover {
          position: absolute;
          width: 288px;
          background: var(--bg-card, #ffffff);
          border-radius: 14px;
          border: 1px solid var(--border-soft, rgba(232,228,217,0.8));
          box-shadow: 0 16px 40px rgba(31,26,15,0.25);
          overflow: hidden;
          z-index: 81;
        }
        .ac-popover-hd {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 14px;
          background: linear-gradient(135deg, var(--cozy-cream-50, #FFFCF6), var(--cozy-cream-200, #F2EAD8));
          border-bottom: 1px solid var(--border-soft, rgba(232,228,217,0.8));
        }
        .ac-popover-pip { width: 10px; height: 10px; border-radius: 999px; box-shadow: 0 0 0 2px rgba(255,255,255,0.8); }
        .ac-popover-title { flex: 1; font-weight: 700; color: var(--text-base, #1F1A0F); font-size: 0.92rem; }
        .ac-popover-close {
          width: 28px; height: 28px; border-radius: 999px;
          background: rgba(31,26,15,0.05); color: var(--text-soft, #4A3820);
          font-weight: bold; border: none; cursor: pointer;
        }
        .ac-popover-body { padding: 12px 14px 14px; }
        .ac-popover-row {
          display: flex; justify-content: space-between; align-items: center;
          padding: 6px 0;
          font-size: 0.82rem;
          color: var(--text-base, #1F1A0F);
          border-bottom: 1px solid rgba(232,228,217,0.4);
        }
        .ac-popover-row span { color: var(--text-muted, #6E5430); font-size: 0.72rem; }
        .ac-popover-note {
          margin-top: 8px;
          padding: 8px 10px;
          background: var(--accent-soft, rgba(201,166,107,0.14));
          border-radius: 8px;
          font-size: 0.74rem;
          color: var(--text-soft, #4A3820);
        }
        .ac-popover-help {
          margin-top: 8px;
          padding: 8px 10px;
          background: rgba(59,130,246,0.10);
          border-radius: 8px;
          font-size: 0.74rem;
          color: #1d4ed8;
        }
        .ac-popover-delete {
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
        .ac-popover-delete:hover { background: #fecaca; }
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
        background: "var(--bg-pill, #FFFCF6)",
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
// This is what was actually missing from v112 → "room blocker shyad kaam
// nahi kar raha hai". It writes to /api/partner/walk-in with `source` set
// to whatever the user picked (default `manual` = maintenance / private).
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
          background: var(--bg-pill, #FFFCF6);
          border: 1px solid var(--border-soft, rgba(232,228,217,0.8));
          border-radius: 999px;
          font-size: 0.82rem; font-weight: 600;
          color: var(--text-base, #1F1A0F);
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .bds-chip:hover { background: var(--accent-soft, rgba(201,166,107,0.14)); }
        .bds-chip-on {
          background: linear-gradient(135deg, #D9BE82, #C9A66B);
          color: #1F1A0F;
          border-color: rgba(110,84,48,0.30);
          box-shadow: 0 2px 8px rgba(201,166,107,0.30);
        }

        .bds-room {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 8px 14px;
          background: var(--bg-pill, #FFFCF6);
          border: 1px solid var(--border-soft, rgba(232,228,217,0.8));
          border-radius: 12px;
          font-size: 0.84rem; font-weight: 600;
          color: var(--text-base, #1F1A0F);
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .bds-room:hover { background: var(--accent-soft, rgba(201,166,107,0.14)); }
        .bds-room-on {
          background: linear-gradient(135deg, rgba(217,190,130,0.45), rgba(201,166,107,0.55));
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
          color: var(--cozy-cream-50, #FFFCF6);
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
          background: var(--bg-pill, #FFFCF6);
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
          background: linear-gradient(135deg, #D9BE82, #C9A66B);
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
