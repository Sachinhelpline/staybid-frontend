"use client";
import { useEffect } from "react";

// Kiosk fill-scale. The hub + touchscreen-booking pages were built at a fixed
// ~1000px design width, so on a 43"–55" large-format kiosk (FHD/4K) they showed
// a small centred column with tiny text. This scales the whole page up via
// `zoom` on <html> so the fixed-px design FILLS a big display in either
// orientation — scaled by the SHORTER viewport side (like the display board's
// vmin), so nothing is forced to overflow. Never shrinks below 1 (normal
// phones/tablets keep their own responsive design untouched). Chromium-only
// `zoom` is fine — kiosks run Chromium; `zoom` (unlike transform:scale) keeps
// layout + scrolling correct and leaves `100vw`/`100dvh` filling the screen.
export function useKioskFill(base = 1000, max = 3) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = document.documentElement;
    const prev = el.style.zoom;
    const apply = () => {
      const s = Math.max(1, Math.min(max, Math.min(window.innerWidth, window.innerHeight) / base));
      el.style.zoom = String(Math.round(s * 100) / 100);
    };
    apply();
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      el.style.zoom = prev;
    };
  }, [base, max]);
}
