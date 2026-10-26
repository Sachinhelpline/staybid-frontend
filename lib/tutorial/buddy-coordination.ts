// ─────────────────────────────────────────────────────────────────────────
// Tutorial ↔ Travel Buddy coordination (R2 — first-visit tour obstruction).
//
// The driver.js page tours draw a full-viewport overlay that intercepts every tap. Two
// coordinated rules replace the old QA-only opt-out (`sb_tutorial_disabled`):
//   1. while the guest is ENGAGED with Travel Buddy (an active Buddy session), page tours and the
//      first-visit welcome story do not AUTO-fire (deferred, never marked seen; an explicit help
//      replay still can);
//   2. while a tour (or the first-visit welcome story) IS running, Travel Buddy steps aside (no panels under the overlay) and comes
//      back the moment the tour ends — the tour itself is never deleted or hidden.
// Tiny, framework-free module state (one client runtime): no storage, no network; one read-only
// overlay presence check (tourOverlayPresent) so a stale tour flag can never hide Buddy forever.
// ─────────────────────────────────────────────────────────────────────────
type Listener = (activeTour: string | null) => void;

let buddyEngaged = false;
let activeTour: string | null = null;
const listeners = new Set<Listener>();

export function setBuddyEngaged(engaged: boolean): void { buddyEngaged = engaged === true; }
export function isBuddyEngaged(): boolean { return buddyEngaged; }

export function setTourActive(key: string | null): void {
  const next = typeof key === "string" && key ? key : null;
  if (next === activeTour) return;
  activeTour = next;
  listeners.forEach((l) => { try { l(activeTour); } catch { /* a listener never breaks the tour */ } });
}
/** End ONLY the named tour/overlay (a stale end can never clear a newer one). */
export function endTour(key: string): void { if (activeTour === key) setTourActive(null); }
export function getActiveTour(): string | null { return activeTour; }

/** Is a tour / welcome-story overlay actually on screen? (A cheap presence check — no content is read.) */
export function tourOverlayPresent(): boolean {
  if (typeof document === "undefined") return false;
  try { return !!document.querySelector(".driver-popover, .driver-overlay, .sb-welcome-overlay"); } catch { return false; }
}

export function subscribeTour(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
