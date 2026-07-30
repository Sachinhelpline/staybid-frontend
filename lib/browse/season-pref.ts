// ─────────────────────────────────────────────────────────────────────────────
// SEASON PREFERENCE (v583.1, client-only) — "I'm not planning for THIS month."
//
// By default every surface sells the CURRENT month's program (the deck's
// calendar). This store lets the traveller flip that preference from the
// Finder's season ribbon — "show me Winter Leisure" in July — and EVERY
// season-aware ranking (hero, rails, reels, Finder answers, /discover
// cold-start) follows, because they all read effectiveMonth() instead of the
// wall clock. Fail-open: no/stale pref → the real current month.
//
// Emits "sb:season-pref" on change so mounted surfaces re-rank live.
// ─────────────────────────────────────────────────────────────────────────────

import {
  programForMonth, programById, representativeMonth, type SeasonProgram,
} from "@/lib/browse/season-programs";

const KEY = "sb_season_pref";
const TTL_MS = 60 * 24 * 60 * 60 * 1000;

export function readSeasonPrefId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!raw?.id || !Number.isFinite(raw.ts)) return null;
    if (Date.now() - raw.ts > TTL_MS) return null;
    return programById(raw.id) ? raw.id : null;
  } catch { return null; }
}

/** Set (or clear with null = back to Auto/this month) the preference. */
export function setSeasonPref(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id && programById(id)) localStorage.setItem(KEY, JSON.stringify({ id, ts: Date.now() }));
    else localStorage.removeItem(KEY);
    window.dispatchEvent(new Event("sb:season-pref"));
  } catch {}
}

/** The program every surface should SELL right now (pref ?? current month). */
export function effectiveProgram(): SeasonProgram {
  const pref = programById(readSeasonPrefId());
  return pref || programForMonth(new Date().getUTCMonth());
}

/** The month every season-aware RANKING should use (pref ?? wall clock). */
export function effectiveMonth(): number {
  const pref = programById(readSeasonPrefId());
  return pref ? representativeMonth(pref) : new Date().getUTCMonth();
}
