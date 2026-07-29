"use client";

/* ════════════════════════════════════════════════════════════════════
   v575 — BidArcade  (the "arcade" option)

   The playful sibling of the v574 BidTerminal. Same one-screen, zero-scroll
   surface and the SAME drop-in contract (cards + signals), but the feel is a
   GAME, not a trading desk:

     • a big chunky POWER METER you fling left/right to set your bid
     • a row of hotel "bidders" that react in real time — sleepy 😴 when your
       bid is low, waking 🙂, then excited 🤩 as your odds climb (this is
       "hotels compete for your bid", made visual and fun)
     • a punchy verdict ("Hotels love it!", "Aim a bit higher…")
     • preset POWER-UPS, a confetti burst on launch, springy motion + sound

   Viewable alongside the terminal via /bid?ui=arcade (page.tsx honours the
   query). All styling under `.ba-*` in app/globals.css (v120 rule).
═══════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from "react";
import type { BidCard } from "../BidCardStack";
import type { BidGameRenderCtx } from "../BidGameZone";
import {
  playComplete,
  playError,
  playSelect,
  playTap,
  playWhoosh,
  unlockSound,
  vibrate,
} from "@/lib/bid-game/sound";

type OddsResult = { pct: number; label: string; color: string; tip?: string; responseTime?: string };

export interface BidArcadeSignals {
  city?: string;
  nights?: number;
  rooms?: number;
  marketAdr?: number | null;
  bidPerNight?: number | null;
  totalBudget?: number;
  strength?: OddsResult | null;
  oddsFor?: (bidPerNight: number) => OddsResult | null;
  setBidPerNight?: (bidPerNight: number) => void;
  launched?: boolean;
  launching?: boolean;
  canLaunch?: boolean;
  onLaunch?: () => void;
}

interface Props {
  cards: BidCard[];
  onAllComplete: () => void;
  finalCtaLabel?: string;
  signals?: BidArcadeSignals;
}

const LOADOUT_IDX = [0, 1, 2, 3];
const ARENA_IDX = 5;
const PAY_IDX = 6;
const SLOT = [
  { key: "destination", label: "City", icon: "📍" },
  { key: "propertyType", label: "Type", icon: "🏨" },
  { key: "dates", label: "Dates", icon: "📅" },
  { key: "guests", label: "Guests", icon: "👥" },
];

const inr = (n?: number | null) => "₹" + Math.max(0, Math.round(Number(n) || 0)).toLocaleString("en-IN");
const round100 = (n: number) => Math.max(0, Math.round(n / 100) * 100);
function safe<T>(fn: (() => T) | undefined, fallback: T): T {
  try { return fn ? fn() : fallback; } catch { return fallback; }
}

/* Fun verdict + hotel mood from the odds engine's pct. */
function verdict(o: OddsResult | null): { line: string; face: string } {
  const p = o?.pct ?? 0;
  if (!o) return { line: "Set a city & dates to charge up", face: "🎯" };
  if (p >= 90) return { line: "Hotels will grab this instantly!", face: "🤩" };
  if (p >= 70) return { line: "Hotels love it — they'll compete", face: "😍" };
  if (p >= 55) return { line: "Strong bid — good chance", face: "😀" };
  if (p >= 38) return { line: "Worth a shot — they may counter", face: "🙂" };
  if (p >= 22) return { line: "A bit low — nudge it up?", face: "😬" };
  return { line: "Too low — hotels are snoozing", face: "😴" };
}

/* ── COUNT-UP roll for the big number ── */
function useRoll(target: number, ms = 380) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  const raf = useRef(0);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !Number.isFinite(target)) { setV(target); from.current = target; return; }
    const start = performance.now();
    const a = from.current;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setV(Math.round(a + (target - a) * e));
      if (k < 1) raf.current = requestAnimationFrame(tick); else from.current = target;
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms]);
  return v;
}

/* ── POWER METER — the chunky bid control you fling ── */
function PowerMeter({
  value, floor, ceil, market, color, onChange, disabled,
}: {
  value: number; floor: number; ceil: number; market: number; color: string;
  onChange: (v: number) => void; disabled: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const span = Math.max(1, ceil - floor);
  const pct = Math.max(0, Math.min(1, (value - floor) / span));
  const mktPct = Math.max(0, Math.min(1, (market - floor) / span));
  const set = useCallback((clientX: number) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    onChange(round100(floor + p * span));
  }, [floor, span, onChange]);
  const drag = useRef(false);
  return (
    <div
      className={`ba-meter${disabled ? " is-locked" : ""}`}
      ref={ref}
      role="slider"
      aria-label="Your bid per night"
      aria-valuemin={floor} aria-valuemax={ceil} aria-valuenow={value}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={(e) => { if (disabled) return; drag.current = true; (e.target as Element).setPointerCapture?.(e.pointerId); set(e.clientX); }}
      onPointerMove={(e) => { if (drag.current && !disabled) set(e.clientX); }}
      onPointerUp={(e) => { drag.current = false; (e.target as Element).releasePointerCapture?.(e.pointerId); }}
      onKeyDown={(e) => {
        if (disabled) return;
        const step = e.shiftKey ? 500 : 100;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); onChange(Math.min(ceil, round100(value + step))); }
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); onChange(Math.max(floor, round100(value - step))); }
      }}
    >
      <div className="ba-meter-track">
        <div className="ba-meter-fill" style={{ width: `${pct * 100}%`, background: `linear-gradient(90deg, ${color}bb, ${color})` }} />
        {market > 0 ? <span className="ba-meter-mkt" style={{ left: `${mktPct * 100}%` }}><i>market</i></span> : null}
        <span className="ba-meter-knob" style={{ left: `${pct * 100}%`, borderColor: color }} aria-hidden>
          <span style={{ background: color }} />
        </span>
      </div>
      <div className="ba-meter-ends"><span>{inr(floor)}</span><span>save more ← → aim higher</span><span>{inr(ceil)}</span></div>
    </div>
  );
}

/* ── HOTEL BIDDERS — react to your odds ── */
function HotelBidders({ pct, active }: { pct: number; active: boolean }) {
  const N = 6;
  const excited = active ? Math.max(0, Math.min(N, Math.round((pct / 100) * N))) : 0;
  return (
    <div className="ba-hotels" aria-hidden>
      {Array.from({ length: N }).map((_, i) => {
        const on = i < excited;
        return (
          <span key={i} className={`ba-hotel${on ? " is-on" : ""}`} style={{ animationDelay: `${i * 60}ms` }}>
            <span className="ba-hotel-b">🏨</span>
            <span className="ba-hotel-face">{on ? "🤩" : active ? "😴" : "🏨"}</span>
          </span>
        );
      })}
    </div>
  );
}

export default function BidArcade({ cards, onAllComplete, finalCtaLabel = "🚀 Send my bid!", signals }: Props) {
  const [sheetIdx, setSheetIdx] = useState<number | null>(null);
  const openedSummary = useRef<{ idx: number; summary: string } | null>(null);
  const soundArmed = useRef(false);
  const [burst, setBurst] = useState(0); // confetti trigger
  const arm = useCallback(() => { if (soundArmed.current) return; soundArmed.current = true; unlockSound(); }, []);

  // one-screen lock (shared class with the terminal)
  useEffect(() => {
    document.documentElement.classList.add("sb-bt-active");
    document.body.classList.add("sb-bt-active");
    return () => { document.documentElement.classList.remove("sb-bt-active"); document.body.classList.remove("sb-bt-active"); };
  }, []);

  const openSlot = useCallback((idx: number) => { arm(); playTap(); vibrate(12); setSheetIdx(idx); }, [arm]);
  const closeSheet = useCallback(() => { setSheetIdx(null); playWhoosh(); vibrate(10); }, []);
  useEffect(() => {
    if (sheetIdx === null) { openedSummary.current = null; return; }
    const card = cards[sheetIdx]; if (!card) return;
    const now = safe(card.summary, "");
    if (!openedSummary.current || openedSummary.current.idx !== sheetIdx) { openedSummary.current = { idx: sheetIdx, summary: now }; return; }
    if (openedSummary.current.summary === now) return;
    if (!card.autoAdvance || !safe(card.isComplete, false)) return;
    const t = setTimeout(() => { setSheetIdx(null); playSelect(); vibrate([10, 22, 10]); }, card.autoAdvanceDelayMs ?? 420);
    return () => clearTimeout(t);
  });
  useEffect(() => {
    if (sheetIdx === null) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") closeSheet(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [sheetIdx, closeSheet]);

  const launched = !!signals?.launched;

  const market = Math.max(0, Math.round(Number(signals?.marketAdr) || 0));
  const nights = Math.max(0, Number(signals?.nights) || 0);
  const floor = market > 0 ? round100(market * 0.55) : 0;
  const ceil = market > 0 ? round100(market * 1.6) : 0;
  const committed = Math.max(0, Math.round(Number(signals?.bidPerNight) || 0));
  const [val, setVal] = useState<number>(committed || market);
  useEffect(() => { if (market > 0 && (val <= 0 || val < floor || val > ceil)) setVal(committed > 0 ? Math.min(ceil, Math.max(floor, committed)) : market); /* eslint-disable-next-line */ }, [market]);
  useEffect(() => { if (committed > 0 && committed !== val) setVal(committed); /* eslint-disable-next-line */ }, [committed]);

  const odds = market > 0 ? signals?.oddsFor?.(val) ?? signals?.strength ?? null : null;
  const locked = market <= 0;
  const rolled = useRoll(val);
  const v = verdict(odds);
  const color = odds?.color || "#C9A66B";
  const below = market > 0 && val < market ? Math.round(((market - val) / market) * 100) : 0;
  const above = market > 0 && val > market ? Math.round(((val - market) / market) * 100) : 0;

  const onMeter = useCallback((n: number) => { setVal(n); signals?.setBidPerNight?.(n); }, [signals]);

  const presets = market > 0
    ? [
        { k: "Save", mult: 0.72, icon: "💰" },
        { k: "Smart", mult: 1.0, icon: "⭐" },
        { k: "Go Big", mult: 1.28, icon: "⚡" },
      ].map((p) => ({ ...p, price: round100(market * p.mult) }))
    : [];

  const launchReason = !signals?.city ? "Pick a city" : nights <= 0 ? "Pick your dates" : committed <= 0 ? "Set your bid" : "";
  const canLaunch = !!signals?.canLaunch && !signals?.launching;
  const doLaunch = useCallback(() => {
    arm();
    if (!canLaunch) { playError(); vibrate([30, 20, 30]); return; }
    playComplete(); vibrate([14, 28, 14, 28, 60]);
    setBurst((b) => b + 1);
    signals?.onLaunch?.();
  }, [arm, canLaunch, signals]);

  /* ── ARENA ── */
  if (launched) {
    const arena = cards[ARENA_IDX]; const pay = cards[PAY_IDX];
    const paySummary = safe(pay?.summary, "");
    return (
      <div className="ba bt-arena" onPointerDown={arm}>
        <div className="bt-arena-top">
          <span className="bt-arena-live"><span className="bt-ticker-dot" aria-hidden />Auction live</span>
          <span className="bt-arena-bid">Your bid <b>{inr(committed)}</b><em>/night</em>{signals?.city ? <i> · {signals.city}</i> : null}</span>
        </div>
        <div className="bt-arena-body">
          {arena ? arena.render({ onAdvance: () => {}, cardIdx: ARENA_IDX, activeIdx: ARENA_IDX, firstReach: true } as BidGameRenderCtx) : null}
        </div>
        {pay ? (
          <div className="bt-arena-foot">
            <span className="bt-arena-foot-txt">{paySummary && paySummary !== "—" ? `💳 ${paySummary}` : "Hotels are responding — grab the one you like."}</span>
            <button type="button" className="bt-arena-foot-btn" onClick={() => { arm(); playTap(); pay.onDoneClick?.(); }}>{pay.doneLabel || "Open My Bids ›"}</button>
          </div>
        ) : null}
      </div>
    );
  }

  /* ── SETUP (the arcade) ── */
  return (
    <div className="ba" onPointerDown={arm}>
      {/* header */}
      <div className="ba-head">
        <span className="ba-head-title">🎯 Bid Arcade</span>
        <span className="ba-head-sub">{signals?.city ? `${signals.city} · your move` : "Bid your price — hotels compete"}</span>
      </div>

      {/* loadout badges */}
      <div className="ba-loadout">
        {LOADOUT_IDX.map((idx) => {
          const card = cards[idx]; if (!card) return null;
          const meta = SLOT.find((s) => s.key === card.key) || { label: card.title, icon: card.icon };
          const done = safe(card.isComplete, false);
          const summary = safe(card.summary, "");
          const optional = card.key === "propertyType";
          return (
            <button key={card.key} type="button" className={`ba-badge${done ? " is-done" : ""}`} onClick={() => openSlot(idx)}>
              <span className="ba-badge-icon" aria-hidden>{meta.icon}</span>
              <span className="ba-badge-k">{meta.label}</span>
              <span className="ba-badge-v">{done && summary && summary !== "—" ? summary : optional ? "Any" : "Set"}</span>
            </button>
          );
        })}
      </div>

      {/* the game */}
      <div className="ba-stage">
        <HotelBidders pct={odds?.pct || 0} active={!locked} />

        <div className="ba-verdict" style={{ color: locked ? "rgba(247,240,226,.6)" : color }}>
          <span className="ba-verdict-face">{v.face}</span>
          <span className="ba-verdict-line">{v.line}</span>
        </div>

        <div className="ba-bid">
          {locked ? (
            <span className="ba-bid-lock">Pick a city &amp; dates to start</span>
          ) : (
            <>
              <span className="ba-bid-cur">₹</span>
              <span className="ba-bid-val">{Math.round(rolled).toLocaleString("en-IN")}</span>
              <span className="ba-bid-per">/night</span>
              <span className="ba-bid-delta" style={{ color: below ? "#8FE3A6" : above ? "#F0C24A" : "rgba(247,240,226,.6)" }}>
                {below ? `▼ ${below}% below market` : above ? `▲ ${above}% above market` : "at market"}
              </span>
            </>
          )}
        </div>

        <PowerMeter value={val} floor={floor} ceil={ceil} market={market} color={color} onChange={onMeter} disabled={locked} />
      </div>

      {/* power-ups */}
      {presets.length ? (
        <div className="ba-presets">
          {presets.map((p) => {
            const active = Math.abs(val - p.price) < 50;
            return (
              <button key={p.k} type="button" className={`ba-pu${active ? " is-active" : ""}${p.k === "Smart" ? " is-smart" : ""}`}
                onClick={() => { arm(); playSelect(); vibrate(12); onMeter(p.price); }}>
                <span className="ba-pu-icon" aria-hidden>{p.icon}</span>
                <span className="ba-pu-k">{p.k}</span>
                <span className="ba-pu-v">{inr(p.price)}</span>
              </button>
            );
          })}
        </div>
      ) : <div className="ba-presets ba-presets-hint">Pick a city &amp; dates to unlock power-ups</div>}

      {/* launch */}
      <div className="ba-launch-bar">
        <button type="button" className={`ba-launch${canLaunch ? " is-ready" : ""}`} onClick={doLaunch} aria-disabled={!canLaunch}>
          {signals?.launching ? <span className="ba-launch-spin" aria-hidden /> : null}
          <span className="ba-launch-label">{signals?.launching ? "Sending…" : finalCtaLabel}</span>
          {launchReason ? <span className="ba-launch-reason">{launchReason}</span> : null}
        </button>
        {burst > 0 ? <Confetti key={burst} /> : null}
      </div>

      {/* picker sheet (shared cream sheet) */}
      {sheetIdx !== null && cards[sheetIdx] ? (
        <div className="bt-sheet-scrim" onClick={closeSheet} role="presentation">
          <div className="bt-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={cards[sheetIdx].title}>
            <div className="bt-sheet-grip" aria-hidden />
            <header className="bt-sheet-head">
              <span className="bt-sheet-icon" aria-hidden>{cards[sheetIdx].icon}</span>
              <span className="bt-sheet-h-text">
                <span className="bt-sheet-title">{cards[sheetIdx].title}</span>
                {cards[sheetIdx].hint ? <span className="bt-sheet-hint">{cards[sheetIdx].hint}</span> : null}
              </span>
              <button type="button" className="bt-sheet-x" onClick={closeSheet} aria-label="Close">✕</button>
            </header>
            <div className="bt-sheet-body">
              {cards[sheetIdx].render({ onAdvance: () => setSheetIdx(null), cardIdx: sheetIdx, activeIdx: sheetIdx, firstReach: true } as BidGameRenderCtx)}
            </div>
            {!cards[sheetIdx].autoAdvance ? (
              <footer className="bt-sheet-cta">
                <button type="button" className="bt-sheet-done" onClick={() => { playSelect(); vibrate([10, 20, 10]); setSheetIdx(null); }}>✓ Done</button>
              </footer>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* Lightweight confetti burst — pure CSS spans, spawned once per launch. */
function Confetti() {
  const pieces = useRef(
    Array.from({ length: 22 }).map((_, i) => ({
      x: (i / 22) * 100,
      dx: (i % 2 ? 1 : -1) * (18 + (i * 7) % 40),
      dy: -(80 + (i * 13) % 90),
      rot: (i * 47) % 360,
      c: ["#FFE9AD", "#F2C650", "#D69A1E", "#8FE3A6", "#E7CFA0"][i % 5],
      d: (i % 6) * 30,
    })),
  ).current;
  return (
    <div className="ba-confetti" aria-hidden>
      {pieces.map((p, i) => (
        <span key={i} style={{ left: `${p.x}%`, background: p.c, ["--dx" as any]: `${p.dx}px`, ["--dy" as any]: `${p.dy}px`, ["--rot" as any]: `${p.rot}deg`, animationDelay: `${p.d}ms` }} />
      ))}
    </div>
  );
}
