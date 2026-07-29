"use client";

/* ════════════════════════════════════════════════════════════════════
   v573 — BidConsole  ("Mission Control")

   Replaces the v206–v243 boot-screen + Candy-Crush climber for /bid
   Step 1. Those two screens *explained* the product (a mock-up boot
   card, then a level-map whose "levels" were the form fields) before
   the user could type anything — two full screens of friction, and the
   real game (the reverse auction) happened AFTER all of it, on a
   surface with no game feel at all.

   This is ONE surface. No PRESS START, no tutorial. The form is just
   "loading your ammo"; the game is the auction, and the auction's data
   is live and real.

     SETUP  ─ HUD (real /api/bids/insights) · 4 loadout slots ·
              price gauge (Spine market + odds) · sticky LAUNCH
     ARENA  ─ same surface, after launch: your bid + live hotel
              responders (the existing review card render, unchanged)

   DROP-IN CONTRACT
   ────────────────
   Takes the SAME `cards: BidCard[]` the climber took (the parent's
   step1Cards). Every picker's `render()` is called byte-identical, so
   the City / Property / Dates / Guests / Price / Review / Pay bodies
   are exactly what shipped before — only the HOST changed. All parent
   state (form, submit(), liveBids, LiveBidCard) stays in app/bid/page.
   The optional `signals` prop surfaces the parent's already-computed
   market + launch state so the gauge and the launch bar are real
   without the console reaching into page state.

   Renders IN-FLOW (no body portal, not position:fixed) — so the navbar
   sits above it naturally and nothing can clip below the fold. CSS lives
   in app/globals.css under `.bgc-*` (v120 rule: no <style jsx> here).

   No 280ms poll: step1Cards is rebuilt on every parent render and the
   pickers write through setForm, so the console re-renders on every
   pick and isComplete()/summary() are always live.
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

export interface BidConsoleSignals {
  /** picked city (for the HUD headline) */
  city?: string;
  nights?: number;
  rooms?: number;
  /** per-room per-night market ADR (Spine) */
  marketAdr?: number | null;
  /** per-room per-night bid the user has set */
  bidPerNight?: number | null;
  /** the total trip budget the user typed */
  totalBudget?: number;
  /** the odds engine result (calcBidStrength) */
  strength?: {
    pct: number;
    label: string;
    color: string;
    tip?: string;
    responseTime?: string;
  } | null;
  /** success !== null || loading — flips the console into the arena */
  launched?: boolean;
  /** submit() is in flight */
  launching?: boolean;
  /** all required loadout done (city + dates + price) */
  canLaunch?: boolean;
  /** fires the parent's launcher (price card onDoneClick → submit) */
  onLaunch?: () => void;
}

interface Props {
  cards: BidCard[];
  onAllComplete: () => void;
  finalCtaLabel?: string;
  signals?: BidConsoleSignals;
}

/* Which card indices are the SETUP loadout (tap-to-fill slots) vs the
   price gauge vs the post-launch arena. Matches the 7-card order the
   parent builds: 0 City · 1 Property · 2 Dates · 3 Guests · 4 Price ·
   5 Review/Arena · 6 Pay. Bounded with optional chaining so a shorter
   card array (legacy 5-card) still renders without throwing. */
const LOADOUT_IDX = [0, 1, 2, 3];
const PRICE_IDX = 4;
const ARENA_IDX = 5;
const PAY_IDX = 6;

/* Short slot labels — card.title is the full picker question ("Where do you
   want to stay?"), too long for a compact loadout slot. Keyed by card.key so
   it degrades to the title for any unmapped card. */
const SLOT_LABEL: Record<string, string> = {
  destination: "City",
  propertyType: "Property",
  dates: "Dates",
  guests: "Guests",
};

const inr = (n?: number | null) =>
  "₹" + Math.max(0, Math.round(Number(n) || 0)).toLocaleString("en-IN");

function safe<T>(fn: (() => T) | undefined, fallback: T): T {
  try {
    return fn ? fn() : fallback;
  } catch {
    return fallback;
  }
}

export default function BidConsole({
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

  /* Auto-close the sheet for autoAdvance pickers (City, Dates) — but
     only once the picked value actually CHANGES, so re-opening a done
     slot to edit it doesn't snap shut before the user picks. Same rule
     the climber used, minus its polling. */
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

  /* Scroll-lock the page body only while a sheet is open. Restores the
     previous value rather than clearing it. */
  useEffect(() => {
    if (sheetIdx === null) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sheetIdx]);

  /* Esc closes the sheet. */
  useEffect(() => {
    if (sheetIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSheet();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetIdx, closeSheet]);

  const launched = !!signals?.launched;

  /* ── derived gauge numbers (all from the parent's real signals) ──── */
  const market = Math.max(0, Math.round(Number(signals?.marketAdr) || 0));
  const bid = Math.max(0, Math.round(Number(signals?.bidPerNight) || 0));
  const belowPct =
    market > 0 && bid > 0 && bid < market
      ? Math.round(((market - bid) / market) * 100)
      : 0;
  const overPct =
    market > 0 && bid > market ? Math.round(((bid - market) / market) * 100) : 0;
  const oddsPct = Math.max(0, Math.min(100, Number(signals?.strength?.pct) || 0));
  const oddsLabel = signals?.strength?.label || "";
  const oddsColor = signals?.strength?.color || "#C9A66B";
  const hasPrice = bid > 0;

  const launchLabel = signals?.launching ? "Launching…" : finalCtaLabel;
  const launchReason = !signals?.city
    ? "Pick a city to launch"
    : !(signals?.nights && signals.nights > 0)
    ? "Pick your dates"
    : !hasPrice
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

  /* ═══════════════════ ARENA (post-launch) ═══════════════════ */
  if (launched) {
    const arena = cards[ARENA_IDX];
    const pay = cards[PAY_IDX];
    const paySummary = safe(pay?.summary, "");
    return (
      <div className="bgc bgc-arena" onPointerDown={arm}>
        <div className="bgc-arena-top">
          <span className="bgc-arena-live">
            <span className="bgc-arena-dot" aria-hidden />
            Auction live
          </span>
          <span className="bgc-arena-bid">
            Your bid <b>{inr(bid)}</b>
            <em>/night</em>
            {signals?.city ? <span className="bgc-arena-city"> · {signals.city}</span> : null}
          </span>
        </div>
        <div className="bgc-arena-body">
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
          <div className="bgc-arena-foot">
            <span className="bgc-arena-foot-txt">
              {paySummary && paySummary !== "—"
                ? `💳 ${paySummary}`
                : "Hotels are responding — grab the one you like."}
            </span>
            <button
              type="button"
              className="bgc-arena-foot-btn"
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

  /* ═══════════════════ SETUP ═══════════════════ */
  const priceCard = cards[PRICE_IDX];

  return (
    <div className="bgc" onPointerDown={arm}>
      {/* HUD — real, live platform pulse */}
      <ConsoleHud city={signals?.city} />

      {/* LOADOUT — 4 tap-to-fill slots, no locking */}
      <div className="bgc-loadout">
        <div className="bgc-section-label">
          <span className="bgc-section-kicker">Loadout</span>
          <span className="bgc-section-rule" />
        </div>
        <div className="bgc-slots">
          {LOADOUT_IDX.map((idx) => {
            const card = cards[idx];
            if (!card) return null;
            const done = safe(card.isComplete, false);
            const summary = safe(card.summary, "");
            const isOptional = card.key === "propertyType";
            return (
              <button
                key={card.key}
                type="button"
                className={`bgc-slot${done ? " is-done" : ""}`}
                onClick={() => openSlot(idx)}
              >
                <span className="bgc-slot-icon" aria-hidden>
                  {card.icon}
                </span>
                <span className="bgc-slot-text">
                  <span className="bgc-slot-title">{SLOT_LABEL[card.key] || card.title}</span>
                  <span className="bgc-slot-value">
                    {done && summary && summary !== "—"
                      ? summary
                      : isOptional
                      ? "Any type"
                      : "Tap to set"}
                  </span>
                </span>
                <span className={`bgc-slot-state${done ? " is-done" : ""}`} aria-hidden>
                  {done ? "✓" : "›"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* PRICE — the game moment: gauge + odds, driven by real Spine */}
      <div className="bgc-price">
        <div className="bgc-section-label">
          <span className="bgc-section-kicker">Your price</span>
          <span className="bgc-section-rule" />
        </div>

        {hasPrice && market > 0 ? (
          <div className="bgc-gauge">
            <div className="bgc-gauge-row">
              <span className="bgc-gauge-cell">
                <span className="bgc-gauge-k">Market / night</span>
                <span className="bgc-gauge-v">{inr(market)}</span>
              </span>
              <span className="bgc-gauge-cell">
                <span className="bgc-gauge-k">Your bid / night</span>
                <span className="bgc-gauge-v bgc-gauge-v-hot">{inr(bid)}</span>
              </span>
              <span className="bgc-gauge-cell">
                <span className="bgc-gauge-k">
                  {overPct > 0 ? "Above market" : "Below market"}
                </span>
                <span
                  className={`bgc-gauge-v ${overPct > 0 ? "bgc-gauge-v-over" : "bgc-gauge-v-under"}`}
                >
                  {overPct > 0 ? `▲ ${overPct}%` : belowPct > 0 ? `▼ ${belowPct}%` : "at market"}
                </span>
              </span>
            </div>
            {oddsLabel ? (
              <div className="bgc-odds">
                <div className="bgc-odds-head">
                  <span className="bgc-odds-k">Acceptance odds</span>
                  <span className="bgc-odds-label" style={{ color: oddsColor }}>
                    {oddsLabel}
                  </span>
                </div>
                <div className="bgc-odds-track">
                  <div
                    className="bgc-odds-fill"
                    style={{
                      width: `${oddsPct}%`,
                      background: `linear-gradient(90deg, ${oddsColor}aa, ${oddsColor})`,
                    }}
                  />
                </div>
                {signals?.strength?.responseTime ? (
                  <p className="bgc-odds-note">⏱ {signals.strength.responseTime}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="bgc-price-hint">
            Pick a preset or type your total trip budget — you&rsquo;ll see live odds
            against the real market rate the moment you do.
          </p>
        )}

        {/* The existing price picker body (presets + budget input),
            rendered byte-identical. */}
        <div className="bgc-price-body">
          {priceCard
            ? priceCard.render({
                onAdvance: () => {},
                cardIdx: PRICE_IDX,
                activeIdx: PRICE_IDX,
                firstReach: true,
              } as BidGameRenderCtx)
            : null}
        </div>
      </div>

      {/* LAUNCH — sticky, always reachable, honest disabled reason */}
      <div className="bgc-launch-bar">
        <button
          type="button"
          className={`bgc-launch${canLaunch ? " is-ready" : ""}`}
          onClick={doLaunch}
          aria-disabled={!canLaunch}
        >
          {signals?.launching ? <span className="bgc-launch-spin" aria-hidden /> : null}
          <span className="bgc-launch-label">{launchLabel}</span>
        </button>
        {launchReason ? <p className="bgc-launch-reason">{launchReason}</p> : null}
      </div>

      {/* SHEET — the picker body for the tapped loadout slot */}
      {sheetIdx !== null && cards[sheetIdx] ? (
        <div className="bgc-sheet-scrim" onClick={closeSheet} role="presentation">
          <div
            className="bgc-sheet"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={cards[sheetIdx].title}
          >
            <div className="bgc-sheet-grip" aria-hidden />
            <header className="bgc-sheet-head">
              <span className="bgc-sheet-icon" aria-hidden>
                {cards[sheetIdx].icon}
              </span>
              <span className="bgc-sheet-h-text">
                <span className="bgc-sheet-title">{cards[sheetIdx].title}</span>
                {cards[sheetIdx].hint ? (
                  <span className="bgc-sheet-hint">{cards[sheetIdx].hint}</span>
                ) : null}
              </span>
              <button
                type="button"
                className="bgc-sheet-x"
                onClick={closeSheet}
                aria-label="Close"
              >
                ✕
              </button>
            </header>
            <div className="bgc-sheet-body">
              {cards[sheetIdx].render({
                onAdvance: () => setSheetIdx(null),
                cardIdx: sheetIdx,
                activeIdx: sheetIdx,
                firstReach: true,
              } as BidGameRenderCtx)}
            </div>
            {!cards[sheetIdx].autoAdvance ? (
              <footer className="bgc-sheet-cta">
                <button
                  type="button"
                  className="bgc-sheet-done"
                  onClick={() => {
                    playSelect();
                    vibrate([10, 20, 10]);
                    setSheetIdx(null);
                  }}
                >
                  {safe(cards[sheetIdx].isComplete, false)
                    ? cards[sheetIdx].doneLabel && cards[sheetIdx].key !== "price"
                      ? cards[sheetIdx].doneLabel
                      : "✓ Done"
                    : "Done"}
                </button>
              </footer>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ── HUD ─────────────────────────────────────────────────────────────
   Reads the SAME public /api/bids/insights the home Live Bidding band
   uses. Prints only the counters that are non-zero (never a wall of
   zeros under a "live right now" claim). When a city is picked the
   headline scopes to it. */
type Insights = {
  tonightAuctions?: number;
  acceptedToday?: number;
  hotelsListening?: number;
  avgAcceptMins?: number;
};

function ConsoleHud({ city }: { city?: string }) {
  const [d, setD] = useState<Insights | null>(null);
  useEffect(() => {
    let dead = false;
    fetch("/api/bids/insights")
      .then((r) => (r.ok ? r.json() : null), () => null)
      .then((j) => {
        if (!dead && j) setD(j);
      });
    return () => {
      dead = true;
    };
  }, []);

  const listening = Number(d?.hotelsListening ?? d?.tonightAuctions ?? 0);
  const reply = Number(d?.avgAcceptMins ?? 0);
  const accepted = Number(d?.acceptedToday ?? 0);

  const stats = [
    reply > 0 ? { k: "Avg reply", v: `${reply} min` } : null,
    accepted > 0 ? { k: "Accepted today", v: String(accepted) } : null,
  ].filter(Boolean) as { k: string; v: string }[];

  const headline =
    listening > 0
      ? `${listening} ${listening === 1 ? "hotel is" : "hotels are"} taking offers${
          city ? ` in ${city}` : " tonight"
        }`
      : city
      ? `Set your offer for ${city}`
      : "Bid your own price — hotels accept or counter";

  return (
    <div className="bgc-hud">
      <div className="bgc-hud-lead">
        <span className="bgc-hud-dot" aria-hidden />
        <span className="bgc-hud-headline">{headline}</span>
      </div>
      {stats.length ? (
        <div className="bgc-hud-stats">
          {stats.map((s) => (
            <span className="bgc-hud-stat" key={s.k}>
              <b>{s.v}</b>
              <span>{s.k}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
