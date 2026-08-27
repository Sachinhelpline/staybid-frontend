// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-01 — per-session state + turn foundation.
//
//   • Hotel-id ALLOWLIST — the set of ids surfaced to the caller this session
//     via search / current-page context. getHotelDetails / OPEN_HOTEL are gated
//     against it, so the model can never pull an arbitrary hotel id.
//   • TRUSTED hotel map (REREV-02) — the normalized, VALIDATED hotel records that
//     approved read adapters actually returned. compareHotels resolves its rows
//     ONLY from here, so a caller can never inject fabricated catalogue values.
//   • Turn foundation — monotonically increasing turn ids + AbortController so a
//     newer turn (or reset/cancel) supersedes an in-flight one and its result is
//     rejected. reset() immediately invalidates the active turn (REREV-01).
//
// PRIVACY: nothing here is persisted. No transcripts, no audio, no history — the
// allowlist + trusted map live only in memory for the life of the session object.
//
// Pure module: no I/O, no React, no next/*, no @/lib type-value imports.
// AbortController is a platform global (Node 18+ / browsers).
// ─────────────────────────────────────────────────────────────────────────
import { type NormalizedHotel, isValidHotelId } from "./contracts";

/** Max trusted hotel records retained (bounded — oldest evicted past the cap). */
const MAX_TRUSTED_HOTELS = 200;
/** Sentinel active-turn id meaning "no valid active turn" (no real turn uses it). */
const NO_ACTIVE_TURN = -1;

export interface VoiceTurn {
  turnId: number;
  signal: AbortSignal;
  /** True once this turn is superseded / reset / no longer the active turn. */
  isStale: () => boolean;
  /** Abort THIS turn explicitly (aborts its signal). */
  cancel: () => void;
}

export interface VoiceSession {
  /** Register ids the caller is now allowed to inspect (search / page context). */
  allowHotelIds: (ids: unknown[]) => void;
  /** Is this id allowlisted for detail/open? */
  hasHotelId: (id: unknown) => boolean;
  /** Snapshot of the current allowlist (for bounds, tests). */
  allowedHotelIds: () => string[];
  /** REREV-02: store a VALIDATED normalized hotel record for trusted comparison. */
  trustHotel: (record: NormalizedHotel) => void;
  /** REREV-02: resolve the trusted normalized record for an id, or null. */
  getTrustedHotel: (id: unknown) => NormalizedHotel | null;
  /** Begin a new turn; aborts + supersedes any previous in-flight turn. */
  beginTurn: () => VoiceTurn;
  /** Clear all per-session state + immediately invalidate the active turn. */
  reset: () => void;
}

export function createVoiceSession(): VoiceSession {
  const allowlist = new Set<string>();
  const trusted = new Map<string, NormalizedHotel>();
  // Monotonic counter — the id most recently ISSUED. Never reset/reused.
  let issuedTurnId = 0;
  // The id of the currently-valid turn. reset() sets it to NO_ACTIVE_TURN so the
  // in-flight turn becomes stale immediately, before any new turn begins.
  let activeTurnId = NO_ACTIVE_TURN;
  let currentController: AbortController | null = null;

  function abortCurrent() {
    if (currentController) {
      try {
        currentController.abort();
      } catch {
        /* no-op */
      }
    }
  }

  return {
    allowHotelIds(ids) {
      if (!Array.isArray(ids)) return;
      for (const id of ids) {
        if (isValidHotelId(id)) allowlist.add(id);
      }
    },
    hasHotelId(id) {
      return typeof id === "string" && allowlist.has(id);
    },
    allowedHotelIds() {
      return Array.from(allowlist);
    },
    trustHotel(record) {
      // Only accept a well-formed, id-valid normalized record; store an EXACT
      // projection of the allowed fields (never spread a caller object).
      if (!record || typeof record !== "object" || !isValidHotelId((record as NormalizedHotel).id)) {
        return;
      }
      const r = record as NormalizedHotel;
      if (!trusted.has(r.id) && trusted.size >= MAX_TRUSTED_HOTELS) {
        // Bounded — evict the oldest entry (insertion order).
        const oldest = trusted.keys().next().value as string | undefined;
        if (oldest !== undefined) trusted.delete(oldest);
      }
      trusted.set(r.id, {
        id: r.id,
        name: r.name,
        city: r.city,
        starRating: r.starRating,
        avgRating: r.avgRating,
        minPrice: r.minPrice,
      });
      // A trusted hotel is by definition also allowlisted.
      allowlist.add(r.id);
    },
    getTrustedHotel(id) {
      if (typeof id !== "string") return null;
      const r = trusted.get(id);
      return r ? { ...r } : null;
    },
    beginTurn() {
      // Supersede any previous in-flight turn.
      abortCurrent();
      issuedTurnId += 1;
      const myTurn = issuedTurnId;
      activeTurnId = myTurn;
      const controller = new AbortController();
      currentController = controller;
      return {
        turnId: myTurn,
        signal: controller.signal,
        // Stale once this turn is no longer the active turn (superseded/reset/cancelled).
        isStale: () => myTurn !== activeTurnId,
        cancel: () => {
          try {
            controller.abort();
          } catch {
            /* no-op */
          }
          // REREV-01: cancel immediately invalidates THIS turn (isStale becomes
          // true too, not only signal.aborted) if it is still the active one.
          if (activeTurnId === myTurn) activeTurnId = NO_ACTIVE_TURN;
        },
      };
    },
    reset() {
      allowlist.clear();
      trusted.clear();
      abortCurrent();
      currentController = null;
      // REREV-01: immediately invalidate the active turn (isStale() becomes true
      // at once, even before a new turn begins). issuedTurnId stays MONOTONIC —
      // never reset — so no turn id is ever reused and pre-reset turns stay stale.
      activeTurnId = NO_ACTIVE_TURN;
    },
  };
}
