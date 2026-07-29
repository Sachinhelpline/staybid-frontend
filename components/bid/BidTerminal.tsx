"use client";

/* ════════════════════════════════════════════════════════════════════
   v574 — BidTerminal  (high-tech "bid terminal")

   Third pass on /bid Step 1. The boot+climber (v206) explained the form;
   the console (v573) was a cleaner form. Neither felt like a GAME. This
   is a trading-terminal: a single-screen, zero-scroll surface whose HERO
   is a draggable PRICE DIAL — you grip it and turn your bid up and down,
   and a live odds arc fills and colour-shifts in real time against the
   real market rate. That drag IS the game.

   ONE screen, ZERO scroll — height:100dvh, overflow hidden, both
   viewports. Nothing hides below a fold.

   DROP-IN CONTRACT (same as the console): takes the parent's
   `cards: BidCard[]` (City/Property/Dates/Guests/Price/Review/Pay) and an
   optional `signals` object carrying the parent's already-computed market
   + launch state. Every loadout picker's render() is called byte-identical
   in an overlay; the PRICE dial replaces the price card's presets/input as
   the centrepiece and writes the bid straight to the form via
   signals.setBidPerNight. No new endpoint. All styling under `.bt-*` in
   app/globals.css (v120 rule).
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

export interface BidTerminalSignals {
  city?: string;
  nights?: number;
  rooms?: number;
  /** per-room per-night market ADR (Spine) */
  marketAdr?: number | null;
  /** per-room per-night bid currently on the form */
  bidPerNight?: number | null;
  totalBudget?: number;
  strength?: OddsResult | null;
  /** pure: odds for an arbitrary per-night bid (parent's calcBidStrength) */
  oddsFor?: (bidPerNight: number) => OddsResult | null;
  /** commit a per-night bid to the form (parent multiplies by nights×rooms) */
  setBidPerNight?: (bidPerNight: number) => void;
  launched?: boolean;
  launching?: boolean;
  canLaunch?: boolean;
  onLaunch?: () => void;
}

type OddsResult = {
  pct: number;
  label: string;
  color: string;
  tip?: string;
  responseTime?: string;
};

interface Props {
  cards: BidCard[];
  onAllComplete: () => void;
  finalCtaLabel?: string;
  signals?: BidTerminalSignals;
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

const inr = (n?: number | null) =>
  "₹" + Math.max(0, Math.round(Number(n) || 0)).toLocaleString("en-IN");
const round100 = (n: number) => Math.max(0, Math.round(n / 100) * 100);

function safe<T>(fn: (() => T) | undefined, fallback: T): T {
  try {
    return fn ? fn() : fallback;
  } catch {
    return fallback;
  }
}

/* ── COUNTER — smooth number roll (RAF, reduced-motion aware) ──────── */
function useRoll(target: number, ms = 420): number {
  const [v, setV] = useState(target);
  const from = useRef(target);
  const raf = useRef(0);
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !Number.isFinite(target)) {
      setV(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const a = from.current;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setV(Math.round(a + (target - a) * e));
      if (k < 1) raf.current = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms]);
  return v;
}

/* ═══════════════════ PRICE DIAL — the game ════════════════════════
   A 270° rotary. Grip anywhere on the ring and turn: the value arc fills
   from the floor, colour-shifts by odds, and the centre ₹ rolls. A tick
   marks the live market rate so you can see how far below (or above) you
   are. Pointer drag (touch + mouse), click-to-set, and keyboard. */
const A0 = 135; // start angle (deg)
const SWEEP = 270; // total sweep
function polar(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
function arcPath(cx: number, cy: number, r: number, from: number, to: number) {
  const s = polar(cx, cy, r, from);
  const e = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

function PriceDial({
  value,
  floor,
  ceil,
  market,
  odds,
  onChange,
  disabled,
}: {
  value: number;
  floor: number;
  ceil: number;
  market: number;
  odds: OddsResult | null;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  const ref = useRef<SVGSVGElement | null>(null);
  const rolled = useRoll(value);
  const span = Math.max(1, ceil - floor);
  const pct = Math.max(0, Math.min(1, (value - floor) / span));
  const ang = A0 + pct * SWEEP;
  const mktPct = Math.max(0, Math.min(1, (market - floor) / span));
  const mktAng = A0 + mktPct * SWEEP;
  const color = odds?.color || "#C9A66B";

  const setFromPoint = useCallback(
    (clientX: number, clientY: number) => {
      const svg = ref.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let deg = (Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI + 90;
      if (deg < 0) deg += 360;
      // Map into the [135, 405] active band; clamp the 90° dead zone at bottom.
      let rel = deg - A0;
      if (rel < 0) rel += 360;
      if (rel > SWEEP) rel = rel - 360 > -45 ? SWEEP : 0; // nearest end
      const p = Math.max(0, Math.min(1, rel / SWEEP));
      onChange(round100(floor + p * span));
    },
    [floor, span, onChange],
  );

  const dragging = useRef(false);
  const onDown = (e: React.PointerEvent) => {
    if (disabled) return;
    dragging.current = true;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setFromPoint(e.clientX, e.clientY);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragging.current || disabled) return;
    setFromPoint(e.clientX, e.clientY);
  };
  const onUp = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const step = e.shiftKey ? 500 : 100;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(Math.min(ceil, round100(value + step)));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(Math.max(floor, round100(value - step)));
    }
  };

  const thumb = polar(50, 50, 38, ang);
  const mkt = polar(50, 50, 38, mktAng);
  const mktInner = polar(50, 50, 31, mktAng);
  const below =
    market > 0 && value < market ? Math.round(((market - value) / market) * 100) : 0;
  const above =
    market > 0 && value > market ? Math.round(((value - market) / market) * 100) : 0;

  return (
    <div className={`bt-dial${disabled ? " is-locked" : ""}`}>
      <svg
        ref={ref}
        viewBox="0 0 100 100"
        className="bt-dial-svg"
        role="slider"
        aria-label="Your bid per night"
        aria-valuemin={floor}
        aria-valuemax={ceil}
        aria-valuenow={value}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKey}
      >
        <defs>
          <linearGradient id="btArc" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.55" />
            <stop offset="1" stopColor={color} stopOpacity="1" />
          </linearGradient>
        </defs>
        {/* base track */}
        <path
          d={arcPath(50, 50, 38, A0, A0 + SWEEP)}
          className="bt-dial-track"
          fill="none"
        />
        {/* value arc */}
        <path
          d={arcPath(50, 50, 38, A0, Math.max(A0 + 0.01, ang))}
          className="bt-dial-arc"
          stroke="url(#btArc)"
          fill="none"
          style={{ filter: `drop-shadow(0 0 3px ${color}aa)` }}
        />
        {/* market tick */}
        {market > 0 ? (
          <line
            x1={mkt.x}
            y1={mkt.y}
            x2={mktInner.x}
            y2={mktInner.y}
            className="bt-dial-mkt"
          />
        ) : null}
        {/* thumb */}
        <circle cx={thumb.x} cy={thumb.y} r="5.4" className="bt-dial-thumb" style={{ fill: color }} />
        <circle cx={thumb.x} cy={thumb.y} r="2.3" className="bt-dial-thumb-dot" />
      </svg>
      <div className="bt-dial-face">
        {disabled ? (
          <span className="bt-dial-lock">Pick a city<br />to bid</span>
        ) : (
          <>
            <span className="bt-dial-cur">₹</span>
            <span className="bt-dial-val">{Math.round(rolled).toLocaleString("en-IN")}</span>
            <span className="bt-dial-per">/ night</span>
            <span
              className="bt-dial-delta"
              style={{ color: below ? "#8FE3A6" : above ? "#F0C24A" : "rgba(247,240,226,.6)" }}
            >
              {below ? `▼ ${below}% below market` : above ? `▲ ${above}% above market` : "at market rate"}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════ TICKER — real per-city pulse ═════════════════ */
type Insights = {
  tonightAuctions?: number;
  acceptedToday?: number;
  hotelsListening?: number;
  avgAcceptMins?: number;
};
function Ticker({ city, market }: { city?: string; market: number }) {
  const [d, setD] = useState<Insights | null>(null);
  useEffect(() => {
    let dead = false;
    // v574 — pass the city so hotelsListening is the REAL per-city count,
    // not the platform-wide total mislabelled with a city name (the "88 in
    // Dhanaulti" bug). Refetch whenever the city changes.
    const q = city ? `?city=${encodeURIComponent(city)}` : "";
    fetch(`/api/bids/insights${q}`)
      .then((r) => (r.ok ? r.json() : null), () => null)
      .then((j) => {
        if (!dead && j) setD(j);
      });
    return () => {
      dead = true;
    };
  }, [city]);

  const listening = Number(d?.hotelsListening ?? 0);
  const reply = Number(d?.avgAcceptMins ?? 0);
  const accepted = Number(d?.acceptedToday ?? 0);

  const chips = [
    market > 0 ? { k: "MKT/night", v: inr(market) } : null,
    listening > 0
      ? { k: "listening", v: `${listening} ${listening === 1 ? "hotel" : "hotels"}` }
      : null,
    reply > 0 ? { k: "avg reply", v: `${reply}m` } : null,
    accepted > 0 ? { k: "won today", v: String(accepted) } : null,
  ].filter(Boolean) as { k: string; v: string }[];

  return (
    <div className="bt-ticker">
      <span className="bt-ticker-live">
        <span className="bt-ticker-dot" aria-hidden />
        {city ? city.toUpperCase() : "STAYBID LIVE"}
      </span>
      <div className="bt-ticker-chips">
        {chips.length ? (
          chips.map((c) => (
            <span className="bt-ticker-chip" key={c.k}>
              <b>{c.v}</b>
              <i>{c.k}</i>
            </span>
          ))
        ) : (
          <span className="bt-ticker-chip bt-ticker-quiet">Bid your price — hotels accept or counter</span>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════ MAIN ═══════════════════ */
export default function BidTerminal({
  cards,
  onAllComplete,
  finalCtaLabel = "🚀 Launch Auction",
  signals,
}: Props) {
  const [sheetIdx, setSheetIdx] = useState<number | null>(null);
  const openedSummary = useRef<{ idx: number; summary: string } | null>(null);
  const soundArmed = useRef(false);
  const arm = useCallback(() => {
    if (soundArmed.current) return;
    soundArmed.current = true;
    unlockSound();
  }, []);

  // v574 — the terminal owns the viewport (one screen, zero scroll). Lock the
  // page so nothing behind it can add a phantom scroll, and zero the /bid
  // wrapper padding so the terminal is truly edge-to-edge. Removed on unmount.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.classList.add("sb-bt-active");
    body.classList.add("sb-bt-active");
    return () => {
      html.classList.remove("sb-bt-active");
      body.classList.remove("sb-bt-active");
    };
  }, []);

  const openSlot = useCallback(
    (idx: number) => {
      arm();
      playTap();
      vibrate(12);
      setSheetIdx(idx);
    },
    [arm],
  );
  const closeSheet = useCallback(() => {
    setSheetIdx(null);
    playWhoosh();
    vibrate(10);
  }, []);

  // Auto-close autoAdvance pickers once the value changes (City, Dates).
  useEffect(() => {
    if (sheetIdx === null) {
      openedSummary.current = null;
      return;
    }
    const card = cards[sheetIdx];
    if (!card) return;
    const now = safe(card.summary, "");
    if (!openedSummary.current || openedSummary.current.idx !== sheetIdx) {
      openedSummary.current = { idx: sheetIdx, summary: now };
      return;
    }
    if (openedSummary.current.summary === now) return;
    if (!card.autoAdvance) return;
    if (!safe(card.isComplete, false)) return;
    const t = setTimeout(() => {
      setSheetIdx(null);
      playSelect();
      vibrate([10, 22, 10]);
    }, card.autoAdvanceDelayMs ?? 420);
    return () => clearTimeout(t);
  });

  useEffect(() => {
    if (sheetIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSheet();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetIdx, closeSheet]);

  const launched = !!signals?.launched;

  // ── dial range + odds ──
  const market = Math.max(0, Math.round(Number(signals?.marketAdr) || 0));
  const nights = Math.max(0, Number(signals?.nights) || 0);
  const floor = market > 0 ? round100(market * 0.55) : 0;
  const ceil = market > 0 ? round100(market * 1.6) : 0;
  const committed = Math.max(0, Math.round(Number(signals?.bidPerNight) || 0));
  // Local dial value: seed from the committed bid, else Smart (= market).
  const [dialVal, setDialVal] = useState<number>(committed || market);
  // Keep the dial in sync when the market first resolves / city changes.
  useEffect(() => {
    if (market > 0 && (dialVal <= 0 || dialVal < floor || dialVal > ceil)) {
      setDialVal(committed > 0 ? Math.min(ceil, Math.max(floor, committed)) : market);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market]);
  // If the form's committed bid changes elsewhere, follow it.
  useEffect(() => {
    if (committed > 0 && committed !== dialVal) setDialVal(committed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committed]);

  const odds = market > 0 ? signals?.oddsFor?.(dialVal) ?? signals?.strength ?? null : null;
  const dialDisabled = market <= 0;

  const onDial = useCallback(
    (v: number) => {
      setDialVal(v);
      signals?.setBidPerNight?.(v);
    },
    [signals],
  );

  // presets snap the dial (Budget 0.72× / Smart 1.0× / Premium 1.28× market)
  const presets = market > 0
    ? [
        { k: "Budget", mult: 0.72, icon: "💰" },
        { k: "Smart", mult: 1.0, icon: "⭐" },
        { k: "Premium", mult: 1.28, icon: "⚡" },
      ].map((p) => ({ ...p, price: round100(market * p.mult) }))
    : [];

  const launchLabel = signals?.launching ? "Launching…" : finalCtaLabel;
  const launchReason = !signals?.city
    ? "Pick a city"
    : nights <= 0
    ? "Pick your dates"
    : committed <= 0
    ? "Set your price"
    : "";
  const canLaunch = !!signals?.canLaunch && !signals?.launching;
  const doLaunch = useCallback(() => {
    arm();
    if (!canLaunch) {
      playError();
      vibrate([30, 20, 30]);
      return;
    }
    playComplete();
    vibrate([14, 28, 14, 28, 60]);
    signals?.onLaunch?.();
  }, [arm, canLaunch, signals]);

  /* ── ARENA (post-launch) ── */
  if (launched) {
    const arena = cards[ARENA_IDX];
    const pay = cards[PAY_IDX];
    const paySummary = safe(pay?.summary, "");
    return (
      <div className="bt bt-arena" onPointerDown={arm}>
        <div className="bt-arena-top">
          <span className="bt-arena-live">
            <span className="bt-ticker-dot" aria-hidden />
            Auction live
          </span>
          <span className="bt-arena-bid">
            Your bid <b>{inr(committed)}</b>
            <em>/night</em>
            {signals?.city ? <i> · {signals.city}</i> : null}
          </span>
        </div>
        <div className="bt-arena-body">
          {arena
            ? arena.render({
                onAdvance: () => {},
                cardIdx: ARENA_IDX,
                activeIdx: ARENA_IDX,
                firstReach: true,
              } as BidGameRenderCtx)
            : null}
        </div>
        {pay ? (
          <div className="bt-arena-foot">
            <span className="bt-arena-foot-txt">
              {paySummary && paySummary !== "—"
                ? `💳 ${paySummary}`
                : "Hotels are responding — grab the one you like."}
            </span>
            <button
              type="button"
              className="bt-arena-foot-btn"
              onClick={() => {
                arm();
                playTap();
                pay.onDoneClick?.();
              }}
            >
              {pay.doneLabel || "Open My Bids ›"}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  /* ── SETUP (the terminal) ── */
  return (
    <div className="bt" onPointerDown={arm}>
      <Ticker city={signals?.city} market={market} />

      <div className="bt-body">
        {/* LOADOUT — compact pills */}
        <div className="bt-loadout">
          {LOADOUT_IDX.map((idx) => {
            const card = cards[idx];
            if (!card) return null;
            const meta = SLOT.find((s) => s.key === card.key) || {
              label: card.title,
              icon: card.icon,
            };
            const done = safe(card.isComplete, false);
            const summary = safe(card.summary, "");
            const optional = card.key === "propertyType";
            return (
              <button
                key={card.key}
                type="button"
                className={`bt-pill${done ? " is-done" : ""}`}
                onClick={() => openSlot(idx)}
              >
                <span className="bt-pill-icon" aria-hidden>
                  {meta.icon}
                </span>
                <span className="bt-pill-text">
                  <span className="bt-pill-k">{meta.label}</span>
                  <span className="bt-pill-v">
                    {done && summary && summary !== "—"
                      ? summary
                      : optional
                      ? "Any"
                      : "Set"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* DIAL — the hero */}
        <div className="bt-stage">
          <PriceDial
            value={dialVal}
            floor={floor}
            ceil={ceil}
            market={market}
            odds={odds}
            onChange={onDial}
            disabled={dialDisabled}
          />
          <div className="bt-odds">
            <div className="bt-odds-bar">
              <div
                className="bt-odds-fill"
                style={{
                  width: `${Math.max(0, Math.min(100, odds?.pct || 0))}%`,
                  background: `linear-gradient(90deg, ${odds?.color || "#C9A66B"}99, ${odds?.color || "#C9A66B"})`,
                }}
              />
            </div>
            <div className="bt-odds-meta">
              <span className="bt-odds-label" style={{ color: odds?.color || "rgba(247,240,226,.6)" }}>
                {odds?.label || (market > 0 ? "" : "Acceptance odds")}
              </span>
              {odds?.responseTime ? <span className="bt-odds-eta">⏱ {odds.responseTime}</span> : null}
            </div>
          </div>
        </div>

        {/* right rail (desktop): live board */}
        <MarketBoard city={signals?.city} market={market} floor={floor} ceil={ceil} bid={dialVal} nights={nights} rooms={signals?.rooms} />
      </div>

      {/* presets */}
      {presets.length ? (
        <div className="bt-presets">
          {presets.map((p) => {
            const active = Math.abs(dialVal - p.price) < 50;
            return (
              <button
                key={p.k}
                type="button"
                className={`bt-preset${active ? " is-active" : ""}${p.k === "Smart" ? " is-smart" : ""}`}
                onClick={() => {
                  arm();
                  playSelect();
                  vibrate(12);
                  onDial(p.price);
                }}
              >
                <span className="bt-preset-icon" aria-hidden>{p.icon}</span>
                <span className="bt-preset-k">{p.k}</span>
                <span className="bt-preset-v">{inr(p.price)}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="bt-presets bt-presets-hint">Pick a city &amp; dates to set your price</div>
      )}

      {/* LAUNCH */}
      <div className="bt-launch-bar">
        <button
          type="button"
          className={`bt-launch${canLaunch ? " is-ready" : ""}`}
          onClick={doLaunch}
          aria-disabled={!canLaunch}
        >
          {signals?.launching ? <span className="bt-launch-spin" aria-hidden /> : null}
          <span className="bt-launch-label">{launchLabel}</span>
          {launchReason ? <span className="bt-launch-reason">{launchReason}</span> : null}
        </button>
      </div>

      {/* SHEET */}
      {sheetIdx !== null && cards[sheetIdx] ? (
        <div className="bt-sheet-scrim" onClick={closeSheet} role="presentation">
          <div
            className="bt-sheet"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={cards[sheetIdx].title}
          >
            <div className="bt-sheet-grip" aria-hidden />
            <header className="bt-sheet-head">
              <span className="bt-sheet-icon" aria-hidden>
                {cards[sheetIdx].icon}
              </span>
              <span className="bt-sheet-h-text">
                <span className="bt-sheet-title">{cards[sheetIdx].title}</span>
                {cards[sheetIdx].hint ? (
                  <span className="bt-sheet-hint">{cards[sheetIdx].hint}</span>
                ) : null}
              </span>
              <button type="button" className="bt-sheet-x" onClick={closeSheet} aria-label="Close">
                ✕
              </button>
            </header>
            <div className="bt-sheet-body">
              {cards[sheetIdx].render({
                onAdvance: () => setSheetIdx(null),
                cardIdx: sheetIdx,
                activeIdx: sheetIdx,
                firstReach: true,
              } as BidGameRenderCtx)}
            </div>
            {!cards[sheetIdx].autoAdvance ? (
              <footer className="bt-sheet-cta">
                <button
                  type="button"
                  className="bt-sheet-done"
                  onClick={() => {
                    playSelect();
                    vibrate([10, 20, 10]);
                    setSheetIdx(null);
                  }}
                >
                  ✓ Done
                </button>
              </footer>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ── MARKET BOARD (desktop right rail; hidden on mobile via CSS) ──
   Fills the desktop width so there's no dead space, and reinforces the
   terminal feel with a real market-range readout. All numbers derived
   from the same signals the dial uses — nothing fabricated. */
function MarketBoard({
  city,
  market,
  floor,
  ceil,
  bid,
  nights,
  rooms,
}: {
  city?: string;
  market: number;
  floor: number;
  ceil: number;
  bid: number;
  nights: number;
  rooms?: number;
}) {
  const span = Math.max(1, ceil - floor);
  const bidPct = Math.max(0, Math.min(100, ((bid - floor) / span) * 100));
  const mktPct = Math.max(0, Math.min(100, ((market - floor) / span) * 100));
  const total = market > 0 && nights > 0 ? bid * nights * Math.max(1, rooms || 1) : 0;
  return (
    <aside className="bt-board" aria-hidden={market <= 0 ? "true" : undefined}>
      <div className="bt-board-head">
        <span className="bt-board-title">{city ? `${city} market` : "Live market"}</span>
        <span className="bt-board-sub">real-time · below OTA</span>
      </div>
      {market > 0 ? (
        <>
          <div className="bt-board-range">
            <div className="bt-board-track">
              <span className="bt-board-mkt" style={{ left: `${mktPct}%` }} />
              <span className="bt-board-bid" style={{ left: `${bidPct}%` }} />
            </div>
            <div className="bt-board-ends">
              <span>{inr(floor)}</span>
              <span>{inr(ceil)}</span>
            </div>
          </div>
          <dl className="bt-board-rows">
            <div><dt>Market / night</dt><dd>{inr(market)}</dd></div>
            <div><dt>Your bid / night</dt><dd className="bt-board-hot">{inr(bid)}</dd></div>
            <div><dt>Nights × rooms</dt><dd>{nights > 0 ? `${nights} × ${Math.max(1, rooms || 1)}` : "—"}</dd></div>
            <div className="bt-board-total"><dt>You pay if won</dt><dd>{total > 0 ? inr(total) : "—"}</dd></div>
          </dl>
        </>
      ) : (
        <p className="bt-board-empty">Pick a city to see the live market rate, then turn the dial to set your offer.</p>
      )}
    </aside>
  );
}
