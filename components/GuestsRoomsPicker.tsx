"use client";
// v243 — GuestsRoomsPicker: replaces the bulky 2×2 grid of four separate
// PremiumGuestPicker tiles (Adults / Children / Kids / Rooms) with a premium
// two-card layout per Sachin's ss1 ask ("adults children kids ek hi box main"):
//
//   ┌─────────────────────────────┐  ┌──────────────┐
//   │ 👥 GUESTS                   │  │ 🚪 ROOMS     │
//   │  Adults    [-]  2  [+]      │  │   [-] 1 [+]  │
//   │  Children  [-]  0  [+]      │  │  1 per family│
//   │  Kids      [-]  0  [+]      │  │              │
//   └─────────────────────────────┘  └──────────────┘
//
// One Guests card with three slim rows, plus a compact Rooms card. Cozy
// champagne palette, theme-aware, works mobile → desktop (the card row is
// `grid-cols-[1fr_auto]` so Rooms stays narrow on every width).
import { useEffect, useRef, useState } from "react";

type RowProps = {
  icon: string;
  label: string;
  sub?: string;
  subTone?: "default" | "amber" | "emerald";
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
};

function GuestRow({ icon, label, sub, subTone = "default", value, onChange, min, max }: RowProps) {
  const prev = useRef(value);
  const [dir, setDir] = useState<"up" | "down" | "">("");
  useEffect(() => {
    if (value > prev.current) setDir("up");
    else if (value < prev.current) setDir("down");
    prev.current = value;
  }, [value]);
  const subColor = subTone === "amber" ? "#748da6" : subTone === "emerald" ? "#4a7f4a" : "var(--text-muted)";
  return (
    <div className="grp-row">
      <span className="grp-row-icon" aria-hidden>{icon}</span>
      <div className="grp-row-label">
        <span className="grp-row-name">{label}</span>
        {sub ? <span className="grp-row-sub" style={{ color: subColor }}>{sub}</span> : null}
      </div>
      <div className="grp-ctrl">
        <button type="button" className="grp-btn" disabled={value <= min} onClick={() => value > min && onChange(value - 1)} aria-label={`Decrease ${label.toLowerCase()}`}>−</button>
        <span className="grp-val" key={value} data-dir={dir} aria-live="polite">{value}</span>
        <button type="button" className="grp-btn" disabled={value >= max} onClick={() => value < max && onChange(value + 1)} aria-label={`Increase ${label.toLowerCase()}`}>+</button>
      </div>
    </div>
  );
}

export default function GuestsRoomsPicker({
  adults, children, kids, rooms,
  onAdults, onChildren, onKids, onRooms,
  suggested,
}: {
  adults: number; children: number; kids: number; rooms: number;
  onAdults: (n: number) => void; onChildren: (n: number) => void; onKids: (n: number) => void; onRooms: (n: number) => void;
  // v247 — auto room-upgrade hint. Parent derives a suggested room count
  // from the guest mix (≈2 adults/room, the "1 per family" rule). When it
  // differs from the current manual value we surface a one-tap "Suggested: N"
  // chip; tapping it adopts the suggestion. Purely additive — omit to keep
  // the static "1 per family" caption (every existing caller).
  suggested?: number;
}) {
  const roomsPrev = useRef(rooms);
  const [roomsDir, setRoomsDir] = useState<"up" | "down" | "">("");
  useEffect(() => {
    if (rooms > roomsPrev.current) setRoomsDir("up");
    else if (rooms < roomsPrev.current) setRoomsDir("down");
    roomsPrev.current = rooms;
  }, [rooms]);

  return (
    <div className="grp-wrap mb-4 relative z-2">
      {/* Guests card */}
      <div className="grp-card grp-guests">
        <div className="grp-head">
          <span className="grp-head-icon">👥</span>
          <span className="grp-head-title">Guests</span>
          <span className="grp-head-count">{adults + children + kids}</span>
        </div>
        <GuestRow icon="🧑" label="Adults" sub="12+ yrs" value={adults} onChange={onAdults} min={1} max={8} />
        <GuestRow icon="🧒" label="Children" sub="5-12 · +₹200" subTone="amber" value={children} onChange={onChildren} min={0} max={6} />
        <GuestRow icon="👶" label="Kids" sub="<5 · free" subTone="emerald" value={kids} onChange={onKids} min={0} max={6} />
      </div>

      {/* Rooms card */}
      <div className="grp-card grp-rooms">
        <div className="grp-head grp-head--center">
          <span className="grp-head-icon">🚪</span>
          <span className="grp-head-title">Rooms</span>
        </div>
        <div className="grp-rooms-ctrl">
          <button type="button" className="grp-btn grp-btn--lg" disabled={rooms <= 1} onClick={() => rooms > 1 && onRooms(rooms - 1)} aria-label="Decrease rooms">−</button>
          <span className="grp-rooms-val" key={rooms} data-dir={roomsDir} aria-live="polite">{rooms}</span>
          <button type="button" className="grp-btn grp-btn--lg" disabled={rooms >= 10} onClick={() => rooms < 10 && onRooms(rooms + 1)} aria-label="Increase rooms">+</button>
        </div>
        {suggested && suggested > 0 && suggested !== rooms ? (
          <button
            type="button"
            className="grp-rooms-suggest"
            onClick={() => onRooms(Math.max(1, Math.min(10, suggested)))}
            aria-label={`Use suggested ${suggested} rooms`}
          >
            ✨ Suggested: {suggested}
          </button>
        ) : (
          <span className="grp-rooms-sub">1 per family</span>
        )}
      </div>

      <style jsx global>{`
        .grp-wrap {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 10px;
          align-items: stretch;
        }
        /* v708 (owner ss9 — Samsung Fold) — the Guests(1fr) + Rooms(auto,
           min 116px) row has a ~334px min-content, so on a Fold-cover width
           (280–376px) AND a 360px phone it overflowed the availability card and
           the Rooms stepper was cut off (measured: clipped at ≤360; clean at
           ≥390). Stack the two cards at ≤389px so the picker fits every narrow
           phone + all folded covers; 390px+ keeps the side-by-side layout. */
        @media (max-width: 389px) {
          .grp-wrap { grid-template-columns: 1fr; }
          .grp-rooms { min-width: 0; }
        }
        .grp-card {
          background: var(--bg-card, #fff);
          border: 1px solid var(--border-soft, rgba(106,133,160,0.22));
          border-radius: 16px;
          box-shadow: 0 1px 3px rgba(31,26,15,0.05), 0 6px 18px -10px rgba(160,130,80,0.18);
          padding: 11px 12px;
        }
        .grp-head {
          display: flex; align-items: center; gap: 7px;
          margin-bottom: 8px;
          padding-bottom: 7px;
          border-bottom: 1px solid var(--border-soft, rgba(106,133,160,0.16));
        }
        .grp-head--center { justify-content: center; border-bottom: none; padding-bottom: 0; margin-bottom: 6px; }
        .grp-head-icon { font-size: 0.95rem; line-height: 1; }
        .grp-head-title {
          font-size: 0.6rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;
          color: var(--text-soft, #6e5430);
        }
        .grp-head-count {
          margin-left: auto;
          font-size: 0.7rem; font-weight: 800;
          color: #1a1205;
          background: rgba(106,133,160,0.18);
          border-radius: 999px;
          min-width: 20px; height: 20px;
          display: inline-flex; align-items: center; justify-content: center;
          padding: 0 6px;
        }
        .grp-row {
          display: flex; align-items: center; gap: 8px;
          padding: 5px 0;
        }
        .grp-row + .grp-row { border-top: 1px solid rgba(106,133,160,0.10); }
        .grp-row-icon { font-size: 1rem; line-height: 1; width: 18px; text-align: center; }
        .grp-row-label { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
        .grp-row-name { font-size: 0.82rem; font-weight: 700; color: var(--text-base, #1f1a0f); line-height: 1.1; }
        .grp-row-sub { font-size: 0.58rem; font-weight: 600; line-height: 1; }
        .grp-ctrl { display: inline-flex; align-items: center; gap: 8px; }
        .grp-btn {
          width: 26px; height: 26px; border-radius: 999px;
          font-size: 1rem; font-weight: 700; line-height: 1;
          display: inline-flex; align-items: center; justify-content: center;
          background: rgba(106,133,160,0.12);
          color: var(--text-base, #1f1a0f);
          border: 1px solid var(--border-soft, rgba(106,133,160,0.22));
          cursor: pointer; user-select: none; -webkit-tap-highlight-color: transparent;
          transition: transform 0.12s ease, background 0.18s ease, box-shadow 0.18s ease;
          padding: 0;
        }
        .grp-btn:hover:not(:disabled) { background: rgba(106,133,160,0.26); transform: scale(1.08); box-shadow: 0 0 0 3px rgba(106,133,160,0.14); }
        .grp-btn:active:not(:disabled) { transform: scale(0.9); }
        .grp-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .grp-btn--lg { width: 30px; height: 30px; font-size: 1.1rem; }
        .grp-val {
          font-size: 0.95rem; font-weight: 900; font-variant-numeric: tabular-nums;
          color: var(--text-base, #1f1a0f); min-width: 18px; text-align: center; display: inline-block;
        }
        .grp-rooms { display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 116px; }
        .grp-rooms-ctrl { display: flex; align-items: center; gap: 10px; }
        .grp-rooms-val {
          font-size: 1.3rem; font-weight: 900; font-variant-numeric: tabular-nums;
          color: var(--text-base, #1f1a0f); min-width: 22px; text-align: center; display: inline-block;
        }
        .grp-rooms-sub { font-size: 0.56rem; font-weight: 600; color: var(--text-muted); margin-top: 6px; letter-spacing: 0.02em; }
        .grp-rooms-suggest {
          font-size: 0.56rem; font-weight: 800; letter-spacing: 0.02em;
          margin-top: 6px; padding: 3px 9px; border-radius: 999px;
          color: #7a5a12;
          background: rgba(106,133,160,0.16);
          border: 1px solid rgba(106,133,160,0.36);
          cursor: pointer; line-height: 1.1;
          transition: transform 0.12s ease, background 0.18s ease, box-shadow 0.18s ease;
          -webkit-tap-highlight-color: transparent;
        }
        .grp-rooms-suggest:hover { background: rgba(106,133,160,0.28); box-shadow: 0 0 0 3px rgba(106,133,160,0.12); }
        .grp-rooms-suggest:active { transform: scale(0.94); }
        .grp-val[data-dir="up"], .grp-rooms-val[data-dir="up"] { animation: grpUp 0.26s ease both; }
        .grp-val[data-dir="down"], .grp-rooms-val[data-dir="down"] { animation: grpDown 0.26s ease both; }
        @keyframes grpUp { from { transform: translateY(6px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes grpDown { from { transform: translateY(-6px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .grp-val, .grp-rooms-val, .grp-btn { animation: none !important; transition: none !important; }
        }
        @media (min-width: 480px) {
          .grp-rooms { min-width: 140px; }
          .grp-row-name { font-size: 0.86rem; }
        }
        /* v504 — wide desktop: spread Adults/Children/Kids into 3 columns so each
           +/- stepper sits beside its own label (no marooned gap across a wide
           card) and the guests card fills its width richly instead of stretching. */
        @media (min-width: 1280px) {
          .grp-guests {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            column-gap: 12px;
            row-gap: 2px;
            align-items: center;
          }
          .grp-guests .grp-head { grid-column: 1 / -1; }
          .grp-guests .grp-row {
            padding: 7px 11px;
            border-radius: 12px;
            background: rgba(106, 133, 160, 0.06);
            border: 1px solid rgba(106, 133, 160, 0.12);
          }
          .grp-guests .grp-row + .grp-row { border-top: 1px solid rgba(106, 133, 160, 0.12); }
        }
      `}</style>
    </div>
  );
}
