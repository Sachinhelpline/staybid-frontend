"use client";

/* ════════════════════════════════════════════════════════════════════
   v575 — BidCockpit  (mission-control "cockpit")

   A sci-fi command deck for /bid Step 1. The hero is a RADAR SCOPE: a
   sweeping line paints hotel "targets" around the ring, and they ACQUIRE
   LOCK (light up green, one by one) as your bid gets stronger — signal
   strength = your real acceptance odds. You tune the bid on a HUD
   targeting slider; the launch is an ARM sequence. Dramatic, cinematic —
   "I am launching an auction."

   ONE screen, ZERO scroll on both viewports (reuses the sb-bt-active page
   lock + the .bt-sheet cream picker overlay). Same DROP-IN contract as the
   terminal (cards + signals) — every loadout picker's render() is
   byte-identical, the slider writes the bid via signals.setBidPerNight,
   all parent state untouched, no new endpoint. Styling under `.cpt-*`.
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

export interface BidCockpitSignals {
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
  signals?: BidCockpitSignals;
}

const LOADOUT_IDX = [0, 1, 2, 3];
const ARENA_IDX = 5;
const PAY_IDX = 6;
const SLOT = [
  { key: "destination", label: "Destination", icon: "◎" },
  { key: "propertyType", label: "Class", icon: "⬡" },
  { key: "dates", label: "Window", icon: "◷" },
  { key: "guests", label: "Crew", icon: "⚇" },
];
const BLIPS = 8;

const inr = (n?: number | null) => "₹" + Math.max(0, Math.round(Number(n) || 0)).toLocaleString("en-IN");
const round100 = (n: number) => Math.max(0, Math.round(n / 100) * 100);
function safe<T>(fn: (() => T) | undefined, fallback: T): T {
  try { return fn ? fn() : fallback; } catch { return fallback; }
}

/* mission-flavoured signal read-out from the odds pct */
function signalOf(o: OddsResult | null): { tag: string; color: string } {
  const p = o?.pct ?? 0;
  if (!o) return { tag: "AWAITING TARGET", color: "#8a7a54" };
  if (p >= 90) return { tag: "FULL LOCK — CLEARED", color: "#79E6A6" };
  if (p >= 70) return { tag: "STRONG LOCK", color: "#79E6A6" };
  if (p >= 55) return { tag: "SIGNAL: STRONG", color: "#C9E67A" };
  if (p >= 38) return { tag: "SIGNAL: FAIR", color: "#F2C650" };
  if (p >= 22) return { tag: "WEAK SIGNAL", color: "#E6A34A" };
  return { tag: "NO LOCK — RAISE BID", color: "#E67A6A" };
}

function useRoll(target: number, ms = 360) {
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

/* ── RADAR SCOPE — hotels lock on as the bid strengthens ── */
function Radar({ pct, active, color }: { pct: number; active: boolean; color: string }) {
  const locked = active ? Math.max(0, Math.min(BLIPS, Math.round((pct / 100) * BLIPS))) : 0;
  // deterministic blip layout (no random → SSR-safe, stable)
  const blips = Array.from({ length: BLIPS }).map((_, i) => {
    const ang = (i * (360 / BLIPS) + 18) * (Math.PI / 180);
    const r = 22 + ((i * 7) % 3) * 8;
    return { x: 50 + r * Math.cos(ang), y: 50 + r * Math.sin(ang), on: i < locked };
  });
  return (
    <div className={`cpt-radar${active ? "" : " is-idle"}`}>
      <svg viewBox="0 0 100 100" className="cpt-radar-svg" aria-hidden>
        <defs>
          <radialGradient id="cptGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor={color} stopOpacity="0.18" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </radialGradient>
          <linearGradient id="cptSweepG" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={color} stopOpacity="0" />
            <stop offset="1" stopColor={color} stopOpacity="0.42" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="46" fill="url(#cptGlow)" />
        {/* range rings */}
        {[46, 34, 22, 10].map((r) => (
          <circle key={r} cx="50" cy="50" r={r} className="cpt-ring" fill="none" />
        ))}
        {/* cross-hairs */}
        <line x1="4" y1="50" x2="96" y2="50" className="cpt-cross" />
        <line x1="50" y1="4" x2="50" y2="96" className="cpt-cross" />
        {/* rotating sweep */}
        {active ? (
          <g className="cpt-sweep">
            <path d="M50 50 L50 4 A46 46 0 0 1 82 15 Z" fill="url(#cptSweepG)" />
            <line x1="50" y1="50" x2="50" y2="4" className="cpt-sweep-line" style={{ stroke: color }} />
          </g>
        ) : null}
        {/* target blips */}
        {blips.map((b, i) => (
          <g key={i}>
            {b.on ? <circle cx={b.x} cy={b.y} r="3.4" className="cpt-blip-halo" style={{ fill: color }} /> : null}
            <circle cx={b.x} cy={b.y} r="1.7" className={`cpt-blip${b.on ? " is-on" : ""}`} style={b.on ? { fill: color } : undefined} />
          </g>
        ))}
        {/* centre reticle */}
        <circle cx="50" cy="50" r="3" className="cpt-reticle" style={{ stroke: color }} />
        <circle cx="50" cy="50" r="0.9" className="cpt-reticle-dot" style={{ fill: color }} />
      </svg>
    </div>
  );
}

/* ── HUD targeting slider ── */
function TargetSlider({ value, floor, ceil, market, color, onChange, disabled }: {
  value: number; floor: number; ceil: number; market: number; color: string;
  onChange: (v: number) => void; disabled: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const span = Math.max(1, ceil - floor);
  const pct = Math.max(0, Math.min(1, (value - floor) / span));
  const mktPct = Math.max(0, Math.min(1, (market - floor) / span));
  const drag = useRef(false);
  const set = useCallback((clientX: number) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    onChange(round100(floor + p * span));
  }, [floor, span, onChange]);
  return (
    <div
      className={`cpt-slider${disabled ? " is-locked" : ""}`} ref={ref}
      role="slider" aria-label="Target price per night" aria-valuemin={floor} aria-valuemax={ceil} aria-valuenow={value}
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
      <div className="cpt-slider-track">
        <div className="cpt-slider-fill" style={{ width: `${pct * 100}%`, background: `linear-gradient(90deg, ${color}66, ${color})` }} />
        {market > 0 ? <span className="cpt-slider-mkt" style={{ left: `${mktPct * 100}%` }} /> : null}
        <span className="cpt-slider-knob" style={{ left: `${pct * 100}%`, borderColor: color }} aria-hidden><i style={{ background: color }} /></span>
      </div>
      <div className="cpt-slider-ends"><span>◄ {inr(floor)}</span><span>{inr(ceil)} ►</span></div>
    </div>
  );
}

export default function BidCockpit({ cards, onAllComplete, finalCtaLabel = "◈ ARM & LAUNCH", signals }: Props) {
  const [sheetIdx, setSheetIdx] = useState<number | null>(null);
  const openedSummary = useRef<{ idx: number; summary: string } | null>(null);
  const soundArmed = useRef(false);
  const [arming, setArming] = useState(false);
  const arm = useCallback(() => { if (soundArmed.current) return; soundArmed.current = true; unlockSound(); }, []);

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
  const sig = signalOf(odds);
  const color = sig.color;
  const below = market > 0 && val < market ? Math.round(((market - val) / market) * 100) : 0;
  const above = market > 0 && val > market ? Math.round(((val - market) / market) * 100) : 0;
  const lockedCount = locked ? 0 : Math.max(0, Math.min(BLIPS, Math.round(((odds?.pct ?? 0) / 100) * BLIPS)));

  const onSlide = useCallback((n: number) => { setVal(n); signals?.setBidPerNight?.(n); }, [signals]);

  const presets = market > 0
    ? [
        { k: "Save", mult: 0.72 },
        { k: "Smart", mult: 1.0 },
        { k: "Strike", mult: 1.28 },
      ].map((p) => ({ ...p, price: round100(market * p.mult) }))
    : [];

  const launchReason = !signals?.city ? "Set destination" : nights <= 0 ? "Set window" : committed <= 0 ? "Set target price" : "";
  const canLaunch = !!signals?.canLaunch && !signals?.launching;
  const doLaunch = useCallback(() => {
    arm();
    if (!canLaunch) { playError(); vibrate([30, 20, 30]); return; }
    playComplete(); vibrate([16, 30, 16, 30, 70]);
    setArming(true);
    window.setTimeout(() => { setArming(false); signals?.onLaunch?.(); }, 620);
  }, [arm, canLaunch, signals]);

  /* ── ARENA ── */
  if (launched) {
    const arena = cards[ARENA_IDX]; const pay = cards[PAY_IDX];
    const paySummary = safe(pay?.summary, "");
    return (
      <div className="cpt bt-arena" onPointerDown={arm}>
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

  /* ── COCKPIT ── */
  return (
    <div className={`cpt${arming ? " is-arming" : ""}`} onPointerDown={arm}>
      <span className="cpt-corner cpt-corner-tl" aria-hidden /><span className="cpt-corner cpt-corner-tr" aria-hidden />
      <span className="cpt-corner cpt-corner-bl" aria-hidden /><span className="cpt-corner cpt-corner-br" aria-hidden />

      {/* HUD top bar */}
      <div className="cpt-hud">
        <span className="cpt-hud-cell">
          <i>MISSION</i><b>{signals?.city ? signals.city.toUpperCase() : "STANDBY"}</b>
        </span>
        <span className="cpt-hud-cell cpt-hud-sig" style={{ color }}>
          <span className="cpt-hud-dot" style={{ background: color }} aria-hidden />
          {sig.tag}
        </span>
        <span className="cpt-hud-cell cpt-hud-tgt">
          <i>TARGETS</i><b>{locked ? "—" : `${lockedCount}/${BLIPS}`}</b>
        </span>
      </div>

      {/* system slots */}
      <div className="cpt-slots">
        {LOADOUT_IDX.map((idx) => {
          const card = cards[idx]; if (!card) return null;
          const meta = SLOT.find((s) => s.key === card.key) || { label: card.title, icon: card.icon };
          const done = safe(card.isComplete, false);
          const summary = safe(card.summary, "");
          const optional = card.key === "propertyType";
          return (
            <button key={card.key} type="button" className={`cpt-slot${done ? " is-done" : ""}`} onClick={() => openSlot(idx)}>
              <span className="cpt-slot-ico" aria-hidden>{meta.icon}</span>
              <span className="cpt-slot-k">{meta.label}</span>
              <span className="cpt-slot-v">{done && summary && summary !== "—" ? summary : optional ? "ANY" : "— SET —"}</span>
            </button>
          );
        })}
      </div>

      {/* radar + readout */}
      <div className="cpt-stage">
        <div className="cpt-scope">
          <Radar pct={odds?.pct || 0} active={!locked} color={color} />
          <div className="cpt-readout">
            {locked ? (
              <span className="cpt-readout-lock">SET DESTINATION<br />&amp; WINDOW</span>
            ) : (
              <>
                <span className="cpt-readout-label">TARGET PRICE</span>
                <span className="cpt-readout-val"><i>₹</i>{Math.round(rolled).toLocaleString("en-IN")}</span>
                <span className="cpt-readout-per">PER NIGHT</span>
                <span className="cpt-readout-delta" style={{ color: below ? "#79E6A6" : above ? "#F2C650" : "rgba(230,236,240,.55)" }}>
                  {below ? `${below}% UNDER MARKET` : above ? `${above}% OVER MARKET` : "AT MARKET"}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="cpt-signal">
          <div className="cpt-signal-head">
            <span>SIGNAL STRENGTH</span>
            <span style={{ color }}>{sig.tag}</span>
          </div>
          <div className="cpt-signal-bar">
            <div className="cpt-signal-fill" style={{ width: `${Math.max(0, Math.min(100, odds?.pct || 0))}%`, background: `linear-gradient(90deg, ${color}88, ${color})` }} />
          </div>
          {odds?.responseTime ? <span className="cpt-signal-eta">◷ EST. RESPONSE — {odds.responseTime}</span> : null}
        </div>

        <TargetSlider value={val} floor={floor} ceil={ceil} market={market} color={color} onChange={onSlide} disabled={locked} />
      </div>

      {/* presets */}
      {presets.length ? (
        <div className="cpt-presets">
          {presets.map((p) => {
            const active = Math.abs(val - p.price) < 50;
            return (
              <button key={p.k} type="button" className={`cpt-pre${active ? " is-active" : ""}`}
                onClick={() => { arm(); playSelect(); vibrate(12); onSlide(p.price); }}>
                <span className="cpt-pre-k">{p.k.toUpperCase()}</span>
                <span className="cpt-pre-v">{inr(p.price)}</span>
              </button>
            );
          })}
        </div>
      ) : <div className="cpt-presets cpt-presets-hint">SET DESTINATION &amp; WINDOW TO ARM PRESETS</div>}

      {/* launch */}
      <div className="cpt-launch-bar">
        <button type="button" className={`cpt-launch${canLaunch ? " is-ready" : ""}${arming ? " is-arming" : ""}`} onClick={doLaunch} aria-disabled={!canLaunch}>
          <span className="cpt-launch-scan" aria-hidden />
          <span className="cpt-launch-label">
            {arming ? "LAUNCHING…" : signals?.launching ? "LAUNCHING…" : finalCtaLabel}
          </span>
          {launchReason ? <span className="cpt-launch-reason">{launchReason}</span> : null}
        </button>
      </div>

      {/* picker sheet */}
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
