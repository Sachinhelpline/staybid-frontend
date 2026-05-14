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

/* ──────────────────────────────────────────────────────────────────────
   v122.3 — Global auto-next delegate
   ──────────────────────────────────────────────────────────────────────
   Instead of wiring scrollToAutoNext into every onClick handler across
   the codebase (a long-tail, error-prone effort), we install ONE
   document-level delegate that watches for clicks on elements carrying
   either of these attributes:

     data-autonext-target="<key>"        — when clicked, scroll
                                            [data-autonext="<key>"] into
                                            view. Fires on every device.
     data-autonext-target-blur="<key>"   — fires on `blur` instead of
                                            click. Use on text inputs
                                            (Enter key + tap-away).
     data-autonext-target-enter="<key>"  — fires on Enter keydown. Use
                                            on text inputs that should
                                            advance on Enter.

   Bonus: data-autonext-self="<key>" on a CONTAINER causes any click
   inside it (e.g. tapping a radio chip) to auto-scroll the next
   section into view. Useful for chip-group selectors where you don't
   want to add the attribute to every chip individually.

   Once installAutoNextDelegate() runs at app boot, every component in
   the codebase opts in via attributes alone — no JS wiring needed per
   page. Same UX everywhere.

   Safety:
   • Idempotent — installs once per window even if called multiple times.
   • Passive listeners — never blocks page interactivity.
   • Capture: false — runs after React's synthetic-event tree so any
     state-driven re-render commits to the DOM before we measure.
   • Respects prefers-reduced-motion (via scrollElementIntoView).
   ────────────────────────────────────────────────────────────────────── */

/** Install the global delegate. Call once at app boot from a client
 *  component mounted in the root layout. Subsequent calls are no-ops. */
export function installAutoNextDelegate() {
  if (typeof window === "undefined") return;
  const W = window as any;
  if (W.__sbAutoNextDelegateInstalled) return;
  W.__sbAutoNextDelegateInstalled = true;

  /** Resolve the next-key from an event target by walking up the DOM
   *  to find any of the trigger attributes. */
  function resolveKey(target: EventTarget | null, attrs: string[]): string | null {
    if (!target || !(target instanceof Element)) return null;
    for (const attr of attrs) {
      const trigger = target.closest(`[${attr}]`);
      if (trigger) {
        const v = trigger.getAttribute(attr);
        if (v) return v;
      }
    }
    return null;
  }

  // ── Click delegate ────────────────────────────────────────────────
  document.addEventListener(
    "click",
    (ev) => {
      const key = resolveKey(ev.target, ["data-autonext-target", "data-autonext-self"]);
      if (!key) return;
      scrollToAutoNext(key);
    },
    { passive: true, capture: false },
  );

  // ── Blur delegate (use the focusout bubble, since blur doesn't bubble) ─
  document.addEventListener(
    "focusout",
    (ev) => {
      const key = resolveKey(ev.target, ["data-autonext-target-blur"]);
      if (!key) return;
      scrollToAutoNext(key);
    },
    { passive: true, capture: false },
  );

  // ── Enter-key delegate on inputs / textareas ──────────────────────
  document.addEventListener(
    "keydown",
    (ev) => {
      if (ev.key !== "Enter") return;
      const key = resolveKey(ev.target, ["data-autonext-target-enter"]);
      if (!key) return;
      // Don't prevent default (let forms submit, textareas insert newlines
      // unless the consumer added their own preventDefault).
      scrollToAutoNext(key);
    },
    { passive: true, capture: false },
  );
}

/** Smart filled-input watcher — useful for PIN / OTP inputs that should
 *  auto-advance once they reach a target length. Attach via attribute:
 *
 *    <input data-autonext-target-filled="<key>" data-autonext-min="6" />
 *
 *  The delegate listens for `input` events and fires when the input's
 *  value length reaches `data-autonext-min` (default 6). */
export function installAutoNextFilledWatcher() {
  if (typeof window === "undefined") return;
  const W = window as any;
  if (W.__sbAutoNextFilledInstalled) return;
  W.__sbAutoNextFilledInstalled = true;

  document.addEventListener(
    "input",
    (ev) => {
      const t = ev.target as HTMLInputElement | null;
      if (!t || !(t instanceof Element)) return;
      const attr = t.getAttribute?.("data-autonext-target-filled");
      if (!attr) return;
      const min = Number(t.getAttribute("data-autonext-min") || "6");
      const val = "value" in t ? String((t as any).value || "") : "";
      if (val.length >= min) scrollToAutoNext(attr);
    },
    { passive: true, capture: false },
  );
}
