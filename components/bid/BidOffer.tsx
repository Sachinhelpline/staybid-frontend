"use client";

/* ════════════════════════════════════════════════════════════════════
   v576 — BidOffer  ("Make your offer to the hills")

   The warm, place-first /bid Step 1. No dial, no radar, no jargon.
   The screen IS the destination (a real property photo), and floating
   over it is ONE clear thing: your price. You nudge a big rupee number,
   a plain line tells you what you save + whether hotels usually say yes,
   and the real hotels that will answer sit right there "listening".
   Press send and the same surface becomes the live auction — real hotels
   wake up and accept / counter (the existing polled live-bid data).

   Every number is REAL: the market/night from the parent signals, the
   "N hotels listening" + recent wins from /api/bids/insights?city=, the
   backdrop + hero property from /api/hotels?city=. Nothing invented.

   Same DROP-IN contract as the terminal/cockpit (cards + signals) — every
   picker's render() is byte-identical in the cream .bt-sheet overlay, the
   price writes via signals.setBidPerNight, parent state untouched, no new
   endpoint. One screen, zero scroll (reuses the sb-bt-active page lock).
   Styling under `.ofr-*`.
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

export interface BidOfferSignals {
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
  signals?: BidOfferSignals;
}

/* card indices in step1Cards: 0 city · 1 type · 2 dates · 3 guests · 4 price · 5 review/arena · 6 pay */
const CITY_IDX = 0;
const DATES_IDX = 2;
const GUESTS_IDX = 3;
const ARENA_IDX = 5;
const PAY_IDX = 6;

const inr = (n?: number | null) => "₹" + Math.max(0, Math.round(Number(n) || 0)).toLocaleString("en-IN");
const round100 = (n: number) => Math.max(0, Math.round(n / 100) * 100);
function safe<T>(fn: (() => T) | undefined, fallback: T): T {
  try { return fn ? fn() : fallback; } catch { return fallback; }
}

type Insights = {
  hotelsListening?: number;
  tonightAuctions?: number;
  avgAcceptMins?: number;
  recentWins?: { id: string; initial: string; amount: number; hotelName: string; when: string }[];
};
type HeroHotel = { id: string; name: string; image: string | null; stars: number; from: number | null };

/* warm, plain-language confidence read from the odds pct */
function confidenceOf(pct: number): { line: string; tone: "great" | "good" | "bold" | "wild" } {
  if (pct >= 68) return { line: "Hotels usually say yes at this price 👍", tone: "great" };
  if (pct >= 45) return { line: "A fair offer — good chance they accept", tone: "good" };
  if (pct >= 26) return { line: "Bold offer — expect a few to counter", tone: "bold" };
  return { line: "Very bold — some hotels may pass", tone: "wild" };
}
const TONE_COLOR: Record<string, string> = { great: "#74E0A2", good: "#B8E67C", bold: "#F2C468", wild: "#F0A15C" };

function useRoll(target: number, ms = 340) {
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

/* ── The price track: nudge a number below the usual price ── */
function PriceTrack({ value, floor, usual, onChange, disabled }: {
  value: number; floor: number; usual: number; onChange: (v: number) => void; disabled: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const span = Math.max(1, usual - floor);
  const pct = Math.max(0, Math.min(1, (value - floor) / span));
  const drag = useRef(false);
  const setFromX = useCallback((clientX: number) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    onChange(round100(floor + p * span));
  }, [floor, span, onChange]);
  const step = (d: number) => onChange(Math.max(floor, Math.min(usual, round100(value + d))));
  return (
    <div className={`ofr-ctl${disabled ? " is-off" : ""}`}>
      <button type="button" className="ofr-step" aria-label="Lower your price" onClick={() => { if (!disabled) { playTap(); vibrate(8); step(-100); } }}>−</button>
      <div
        className="ofr-track" ref={ref}
        role="slider" aria-label="Your price per night" aria-valuemin={floor} aria-valuemax={usual} aria-valuenow={value}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={(e) => { if (disabled) return; drag.current = true; (e.target as Element).setPointerCapture?.(e.pointerId); setFromX(e.clientX); }}
        onPointerMove={(e) => { if (drag.current && !disabled) setFromX(e.clientX); }}
        onPointerUp={(e) => { drag.current = false; (e.target as Element).releasePointerCapture?.(e.pointerId); }}
        onKeyDown={(e) => {
          if (disabled) return;
          const d = e.shiftKey ? 500 : 100;
          if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); step(d); }
          else if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); step(-d); }
        }}
      >
        <div className="ofr-track-rail">
          <div className="ofr-track-fill" style={{ width: `${pct * 100}%` }} />
          <span className="ofr-track-usual" title="Usual price" />
          <span className="ofr-track-knob" style={{ left: `${pct * 100}%` }} aria-hidden />
        </div>
        <div className="ofr-track-ends">
          <span>best deal</span>
          <span>usual {inr(usual)}</span>
        </div>
      </div>
      <button type="button" className="ofr-step" aria-label="Raise your price" onClick={() => { if (!disabled) { playTap(); vibrate(8); step(100); } }}>+</button>
    </div>
  );
}

export default function BidOffer({ cards, onAllComplete, finalCtaLabel, signals }: Props) {
  const [sheetIdx, setSheetIdx] = useState<number | null>(null);
  const soundArmed = useRef(false);
  const arm = useCallback(() => { if (soundArmed.current) return; soundArmed.current = true; unlockSound(); }, []);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("sb-bt-active");
    document.body.classList.add("sb-bt-active");
    return () => { document.documentElement.classList.remove("sb-bt-active"); document.body.classList.remove("sb-bt-active"); };
  }, []);

  /* ── real per-city warmth: insights + hero property ── */
  const city = signals?.city || "";
  const [insights, setInsights] = useState<Insights | null>(null);
  const [hero, setHero] = useState<HeroHotel | null>(null);
  useEffect(() => {
    if (!city) { setInsights(null); return; }
    let live = true;
    fetch(`/api/bids/insights?city=${encodeURIComponent(city)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (live && d) setInsights(d); })
      .catch(() => {});
    return () => { live = false; };
  }, [city]);
  useEffect(() => {
    if (!city) { setHero(null); return; }
    let live = true;
    fetch(`/api/hotels?city=${encodeURIComponent(city)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!live || !d?.hotels?.length) return;
        const h = d.hotels[0];
        const rooms = Array.isArray(h.rooms) ? h.rooms : [];
        const from = rooms.map((r: any) => Number(r.floorPrice) || 0).filter((n: number) => n > 0);
        setHero({
          id: h.id,
          name: h.name || "A lovely stay",
          image: Array.isArray(h.images) && h.images.length ? h.images[0] : null,
          stars: Number(h.starRating) || 0,
          from: from.length ? Math.min(...from) : null,
        });
      })
      .catch(() => {});
    return () => { live = false; };
  }, [city]);

  /* ── the price ── */
  const market = Math.max(0, Math.round(Number(signals?.marketAdr) || 0));
  const nights = Math.max(0, Number(signals?.nights) || 0);
  const rooms = Math.max(1, Number(signals?.rooms) || 1);
  const usual = market;                                  // the "usual price" ceiling — never bid above it here
  const floor = market > 0 ? round100(market * 0.5) : 0;
  const committed = Math.max(0, Math.round(Number(signals?.bidPerNight) || 0));
  const [val, setVal] = useState<number>(committed || (market > 0 ? round100(market * 0.72) : 0));
  useEffect(() => {
    if (market <= 0) return;
    if (val <= 0 || val < floor || val > usual) setVal(committed > 0 ? Math.min(usual, Math.max(floor, committed)) : round100(market * 0.72));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market]);
  useEffect(() => { if (committed > 0 && committed !== val) setVal(Math.min(usual || committed, committed)); /* eslint-disable-next-line */ }, [committed]);

  const ready = market > 0;
  const rolled = useRoll(val);
  const odds = ready ? signals?.oddsFor?.(val) ?? signals?.strength ?? null : null;
  const pct = Math.max(0, Math.min(100, odds?.pct || 0));
  const conf = confidenceOf(pct);
  const confColor = TONE_COLOR[conf.tone];
  const savings = ready ? Math.max(0, usual - val) : 0;
  const savingsTotal = savings * Math.max(1, nights) * rooms;

  const onSlide = useCallback((n: number) => { setVal(n); signals?.setBidPerNight?.(n); }, [signals]);

  const presets = ready
    ? [
        { k: "Bold", sub: "save most", mult: 0.6 },
        { k: "Smart", sub: "recommended", mult: 0.75 },
        { k: "Safe", sub: "most likely", mult: 0.9 },
      ].map((p) => ({ ...p, price: Math.max(floor, Math.min(usual, round100(market * p.mult))) }))
    : [];

  const hotelsCount = Math.max(0, Number(insights?.hotelsListening) || 0);
  const extraHotels = Math.max(0, hotelsCount - 1);
  const acceptMins = Math.max(0, Number(insights?.avgAcceptMins) || 0);
  const wins = Array.isArray(insights?.recentWins) ? insights!.recentWins!.slice(0, 3) : [];

  /* ── picker sheet ── */
  const openSheet = useCallback((idx: number) => { arm(); playTap(); vibrate(10); setSheetIdx(idx); }, [arm]);
  const closeSheet = useCallback(() => { setSheetIdx(null); playWhoosh(); vibrate(8); }, []);
  useEffect(() => {
    if (sheetIdx === null) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") closeSheet(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [sheetIdx, closeSheet]);
  // auto-close a sheet whose card auto-advances once it completes
  const openedSummary = useRef<{ idx: number; s: string } | null>(null);
  useEffect(() => {
    if (sheetIdx === null) { openedSummary.current = null; return; }
    const card = cards[sheetIdx]; if (!card) return;
    const now = safe(card.summary, "");
    if (!openedSummary.current || openedSummary.current.idx !== sheetIdx) { openedSummary.current = { idx: sheetIdx, s: now }; return; }
    if (openedSummary.current.s === now) return;
    if (!card.autoAdvance || !safe(card.isComplete, false)) return;
    const t = setTimeout(() => { setSheetIdx(null); playSelect(); vibrate([8, 18, 8]); }, card.autoAdvanceDelayMs ?? 420);
    return () => clearTimeout(t);
  });

  const cityLabel = safe(cards[CITY_IDX]?.summary, "") || (city || "Choose a place");
  const datesLabel = safe(cards[DATES_IDX]?.summary, "") || "Pick dates";
  const guestsLabel = safe(cards[GUESTS_IDX]?.summary, "") || "Guests";
  const datesDone = safe(cards[DATES_IDX]?.isComplete, false);

  const canLaunch = !!signals?.canLaunch && !signals?.launching;
  const launching = !!signals?.launching || sending;
  const reason = !city ? "Choose a place" : !datesDone ? "Pick your dates" : val <= 0 ? "Set your price" : "";
  const sendLabel = launching
    ? "Sending your offer…"
    : hotelsCount > 0
      ? `Send my offer to ${hotelsCount} hotel${hotelsCount === 1 ? "" : "s"} →`
      : (finalCtaLabel || "Send my offer →");

  const doSend = useCallback(() => {
    arm();
    if (!canLaunch) { playError(); vibrate([26, 18, 26]); return; }
    playComplete(); vibrate([14, 26, 14, 26, 60]);
    setSending(true);
    window.setTimeout(() => { setSending(false); signals?.onLaunch?.(); }, 560);
  }, [arm, canLaunch, signals]);

  const bgImage = hero?.image || null;

  /* ── ARENA (post-send live auction) ── */
  if (signals?.launched) {
    const arena = cards[ARENA_IDX]; const pay = cards[PAY_IDX];
    const paySummary = safe(pay?.summary, "");
    return (
      <div className="ofr ofr-arena" onPointerDown={arm}>
        {bgImage ? <div className="ofr-bg" style={{ backgroundImage: `url(${bgImage})` }} aria-hidden /> : <div className="ofr-bg ofr-bg-fallback" aria-hidden />}
        <div className="ofr-arena-in">
          <div className="ofr-arena-head">
            <span className="ofr-arena-live"><span className="ofr-live-dot" aria-hidden />Your offer is with the hotels</span>
            <span className="ofr-arena-bid">You offered <b>{inr(committed || val)}</b><em>/night</em>{city ? <i> · {city}</i> : null}</span>
          </div>
          <div className="ofr-arena-body">
            {arena ? arena.render({ onAdvance: () => {}, cardIdx: ARENA_IDX, activeIdx: ARENA_IDX, firstReach: true } as BidGameRenderCtx) : null}
          </div>
          {pay ? (
            <div className="ofr-arena-foot">
              <span className="ofr-arena-foot-txt">{paySummary && paySummary !== "—" ? `💳 ${paySummary}` : "Hotels are answering — grab the one you like."}</span>
              <button type="button" className="ofr-arena-foot-btn" onClick={() => { arm(); playTap(); pay.onDoneClick?.(); }}>{pay.doneLabel || "See my offers ›"}</button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  /* ── COMPOSE ── */
  return (
    <div className="ofr" onPointerDown={arm}>
      {bgImage ? <div className="ofr-bg" style={{ backgroundImage: `url(${bgImage})` }} aria-hidden /> : <div className="ofr-bg ofr-bg-fallback" aria-hidden />}
      <div className="ofr-scrim" aria-hidden />

      <div className="ofr-grid">
        {/* LEFT / MAIN — the offer */}
        <div className="ofr-main">
          {/* editable trip summary */}
          <div className="ofr-summary">
            <button type="button" className="ofr-chip ofr-chip-city" onClick={() => openSheet(CITY_IDX)}>
              <span className="ofr-chip-ic" aria-hidden>📍</span><span className="ofr-chip-tx">{cityLabel}</span>
            </button>
            <button type="button" className="ofr-chip" onClick={() => openSheet(DATES_IDX)}>
              <span className="ofr-chip-ic" aria-hidden>📅</span><span className="ofr-chip-tx">{datesLabel}</span>
            </button>
            <button type="button" className="ofr-chip" onClick={() => openSheet(GUESTS_IDX)}>
              <span className="ofr-chip-ic" aria-hidden>👥</span><span className="ofr-chip-tx">{guestsLabel}</span>
            </button>
          </div>

          {/* live social proof */}
          <div className="ofr-proof">
            {ready && hotelsCount > 0 ? (
              <span className="ofr-proof-live"><span className="ofr-live-dot" aria-hidden />{hotelsCount} hotel{hotelsCount === 1 ? "" : "s"} in {city} {hotelsCount === 1 ? "is" : "are"} listening{acceptMins > 0 ? ` · usually reply in ~${acceptMins} min` : ""}</span>
            ) : (
              <span className="ofr-proof-idle">Name your price — real hotels answer.</span>
            )}
          </div>

          {/* the hero number */}
          <div className="ofr-hero">
            <span className="ofr-hero-label">Your price per night</span>
            <div className={`ofr-hero-num${ready ? "" : " is-idle"}`}>
              <i>₹</i>{ready ? Math.round(rolled).toLocaleString("en-IN") : "—"}
            </div>
            {ready ? (
              <>
                <span className="ofr-hero-save" style={{ color: savings > 0 ? "#74E0A2" : "rgba(255,247,233,.8)" }}>
                  {savings > 0 ? <>You save <b>{inr(savings)}</b> a night{nights > 1 || rooms > 1 ? <> · <b>{inr(savingsTotal)}</b> total</> : null}</> : <>Full price — most likely to be accepted</>}
                </span>
                <span className="ofr-hero-conf" style={{ color: confColor }}>
                  <span className="ofr-conf-dot" style={{ background: confColor }} aria-hidden />{conf.line}
                </span>
              </>
            ) : (
              <span className="ofr-hero-save ofr-hero-hint">{!city ? "Choose your place to begin" : "Pick your dates to see prices"}</span>
            )}
          </div>

          {/* the one control */}
          <PriceTrack value={val} floor={floor} usual={usual} onChange={onSlide} disabled={!ready} />

          {/* presets */}
          {presets.length ? (
            <div className="ofr-presets">
              {presets.map((p) => {
                const active = Math.abs(val - p.price) < 60;
                return (
                  <button key={p.k} type="button" className={`ofr-pre${active ? " is-active" : ""}`}
                    onClick={() => { arm(); playSelect(); vibrate(12); onSlide(p.price); }}>
                    <span className="ofr-pre-k">{p.k}</span>
                    <span className="ofr-pre-v">{inr(p.price)}</span>
                    <span className="ofr-pre-s">{p.sub}</span>
                  </button>
                );
              })}
            </div>
          ) : <div className="ofr-presets ofr-presets-hint">Choose a place &amp; dates to see suggested prices</div>}

          {/* send */}
          <div className="ofr-send-bar">
            <button type="button" className={`ofr-send${canLaunch ? " is-ready" : ""}${launching ? " is-sending" : ""}`} onClick={doSend} aria-disabled={!canLaunch}>
              <span className="ofr-send-shine" aria-hidden />
              <span className="ofr-send-label">{sendLabel}</span>
              {reason ? <span className="ofr-send-reason">{reason}</span> : null}
            </button>
          </div>
        </div>

        {/* RIGHT — who's listening (desktop rail; folds under on mobile) */}
        <aside className="ofr-rail">
          <div className="ofr-rail-head">Who’s listening{city ? ` in ${city}` : ""}</div>
          {hero ? (
            <a className="ofr-hotel" href={`/hotels/${hero.id}`} onClick={(e) => e.stopPropagation()}>
              <span className="ofr-hotel-ph" style={hero.image ? { backgroundImage: `url(${hero.image})` } : undefined} aria-hidden>
                {!hero.image ? "🏨" : null}
                <span className="ofr-hotel-lis"><span className="ofr-live-dot" aria-hidden />listening</span>
              </span>
              <span className="ofr-hotel-tx">
                <span className="ofr-hotel-nm">{hero.name}</span>
                <span className="ofr-hotel-meta">{hero.stars > 0 ? `${"★".repeat(Math.min(5, Math.round(hero.stars)))} · ` : ""}{hero.from ? `from ${inr(hero.from)}/night` : "tap to view"}</span>
              </span>
            </a>
          ) : (
            <div className="ofr-hotel ofr-hotel-empty">{city ? "Loading the stay…" : "Pick a place to see the hotels"}</div>
          )}
          {extraHotels > 0 ? (
            <div className="ofr-rail-more">+ {extraHotels} more hotel{extraHotels === 1 ? "" : "s"} in {city} ready to answer</div>
          ) : null}

          {wins.length ? (
            <div className="ofr-wins">
              <div className="ofr-wins-h">Just won</div>
              {wins.map((w) => (
                <div key={w.id} className="ofr-win">
                  <span className="ofr-win-tx"><b>{w.initial}</b> won {w.hotelName}</span>
                  <span className="ofr-win-am">{inr(w.amount)} · {w.when}</span>
                </div>
              ))}
            </div>
          ) : null}
        </aside>
      </div>

      {/* picker sheet (reuses the cream .bt-sheet overlay) */}
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
                <button type="button" className="bt-sheet-done" onClick={() => { playSelect(); vibrate([8, 18, 8]); setSheetIdx(null); }}>✓ Done</button>
              </footer>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
