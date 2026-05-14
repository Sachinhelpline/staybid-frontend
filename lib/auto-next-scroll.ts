"use client";
/* ──────────────────────────────────────────────────────────────────────
   auto-next-scroll — universal smooth-scroll-to-next-element helper
   for wizard / form / multi-section UIs across customer + admin +
   partner panels.

   User pain: after picking a destination in a 4-step wizard, the next
   field (dates) lives below the fold and the user has to scroll
   manually to find it. Repeat for every field × every step → friction.

   This helper exposes a single API:
       scrollToAutoNext("dates")
   …which finds the element marked `data-autonext="dates"` anywhere on
   the page and smooth-scrolls it to centre of viewport. If the element
   is already centred (within tolerance), it no-ops. Respects
   prefers-reduced-motion. Cross-browser safe.

   Pattern for any wizard:
   1. Wrap each section in <div data-autonext="<key>">…</div>
   2. In the section's selection handler, call:
          scrollToAutoNext("<next-key>")
   3. Done. The next field smoothly slides into view on every device.
   ────────────────────────────────────────────────────────────────────── */

/** Tolerance in px: if the target is already this close to viewport
 *  centre AND fully within the viewport, we don't bother scrolling. */
const ALREADY_CENTRED_PX = 80;

/** Default delay (ms) before scrolling, gives React a frame to render
 *  the next section / update the selected state styling. */
const DEFAULT_DELAY_MS = 80;

/** Internal: scroll a DOM element into view, smoothly, respecting
 *  reduced-motion + already-visible state. */
function scrollElementIntoView(el: Element | null | undefined, opts?: ScrollIntoViewOptions) {
  if (!el) return;
  if (typeof window === "undefined") return;
  try {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    // Skip if already fully visible AND roughly centred.
    if (r.top >= 0 && r.bottom <= vh) {
      const elCenter = r.top + r.height / 2;
      const vhCenter = vh / 2;
      if (Math.abs(elCenter - vhCenter) < ALREADY_CENTRED_PX) return;
    }
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: opts?.block ?? "center",
      inline: opts?.inline ?? "nearest",
    });
  } catch {
    // Best-effort — never throw. Older browsers without
    // ScrollIntoViewOptions support fall through gracefully (the call
    // succeeds with default behaviour).
  }
}

/**
 * Scroll the element with `data-autonext="<key>"` smoothly into view.
 * Safe to call from any selection handler — no-ops on the server or
 * if the target isn't mounted yet.
 */
export function scrollToAutoNext(key: string, opts?: { delayMs?: number; block?: ScrollLogicalPosition }) {
  if (typeof window === "undefined") return;
  const delay = opts?.delayMs ?? DEFAULT_DELAY_MS;
  // Defer by one rAF so any state-driven re-render commits to the DOM
  // before we measure. Then add the small delay so the user sees their
  // tap settle before the page starts moving.
  requestAnimationFrame(() => {
    setTimeout(() => {
      const el = document.querySelector(`[data-autonext="${cssEscape(key)}"]`);
      scrollElementIntoView(el, { block: opts?.block });
    }, delay);
  });
}

/** Convenience: scroll an element by CSS selector. Use when the next
 *  target doesn't have a `data-autonext` attribute (e.g. a button by ID). */
export function scrollToSelector(selector: string, opts?: { delayMs?: number; block?: ScrollLogicalPosition }) {
  if (typeof window === "undefined") return;
  const delay = opts?.delayMs ?? DEFAULT_DELAY_MS;
  requestAnimationFrame(() => {
    setTimeout(() => {
      const el = document.querySelector(selector);
      scrollElementIntoView(el, { block: opts?.block });
    }, delay);
  });
}

/** Convenience: wrap an existing handler so it auto-scrolls afterwards.
 *  Returns a new function. */
export function withAutoNext<T extends (...args: any[]) => any>(
  handler: T,
  nextKey: string,
  opts?: { delayMs?: number },
): T {
  return ((...args: Parameters<T>) => {
    const result = handler(...args);
    scrollToAutoNext(nextKey, opts);
    return result;
  }) as T;
}

/** Tiny CSS.escape polyfill — supports the modest set of characters
 *  used in our data-autonext keys (letters, digits, dashes, underscores).
 *  Avoids pulling in a polyfill dependency. */
function cssEscape(s: string): string {
  if (typeof (window as any)?.CSS?.escape === "function") return (window as any).CSS.escape(s);
  return s.replace(/[^a-zA-Z0-9_-]/g, (c) => "\\" + c);
}
