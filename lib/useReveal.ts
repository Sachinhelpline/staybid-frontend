"use client";
// ═══════════════════════════════════════════════════════════════════════════
// useReveal — IntersectionObserver-driven scroll-reveal hook (v133)
//
// Why this exists: the existing `.hx-reveal` CSS class animates sections on
// MOUNT (page load) via nth-of-type stagger. That works for above-fold
// sections, but sections far below the fold finish their animation while the
// user is still looking at the hero — by the time the user scrolls down,
// those sections sit there flat with no entrance feel.
//
// This hook flips the trigger to viewport-entry. Pair with `.hx-reveal-io`
// (initial hidden) + the `is-visible` modifier (animates on entry).
//
// Respects `prefers-reduced-motion` — sections render fully visible from the
// start with no animation, no transform.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";

type Opts = {
  /** Fraction of element that must be visible before triggering (default 0.15). */
  threshold?: number;
  /** Only fire once (default true). If false, hides again when scrolled out. */
  once?: boolean;
  /** rootMargin string passed to IO (default "0px 0px -10% 0px" — fires slightly before bottom edge). */
  rootMargin?: string;
};

export function useReveal<T extends HTMLElement = HTMLDivElement>(opts: Opts = {}) {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Reduced motion → reveal immediately, skip observer.
    if (typeof window !== "undefined") {
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (reduced) { setVisible(true); return; }
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true);
            if (opts.once !== false) io.disconnect();
          } else if (opts.once === false) {
            setVisible(false);
          }
        }
      },
      {
        threshold: opts.threshold ?? 0.15,
        rootMargin: opts.rootMargin ?? "0px 0px -10% 0px",
      },
    );

    io.observe(el);
    return () => io.disconnect();
  }, [opts.threshold, opts.once, opts.rootMargin]);

  return { ref, visible };
}
