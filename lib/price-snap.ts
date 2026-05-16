// ─────────────────────────────────────────────────────────────────────────
// lib/price-snap.ts — single source of truth for "every price is a multiple
// of ₹100" (v129).
//
// The customer-side bid slider, the partner-side counter slider, the AI
// quick-pick chips, flash-deal price chips, and every CTA price suffix all
// pull from these helpers so a rounding drift in one place can't introduce
// a ₹50/₹25/₹1 spread on another. Lowest indivisible billing unit on the
// platform is ₹100; this file enforces that universally.
// ─────────────────────────────────────────────────────────────────────────

/** Lowest indivisible billing unit on the platform. */
export const PRICE_STEP = 100;

/** Default minimum nightly rate floor used by sliders. */
export const PRICE_MIN = 100;

/** Round any number to the nearest ₹100. NaN / Infinity → 0. */
export function snap100(n: number | string | null | undefined): number {
  const v = typeof n === "string" ? Number(n) : Number(n ?? 0);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v / PRICE_STEP) * PRICE_STEP;
}

/** Round DOWN to the nearest ₹100. Useful for slider lower bounds. */
export function floor100(n: number | string | null | undefined): number {
  const v = typeof n === "string" ? Number(n) : Number(n ?? 0);
  if (!Number.isFinite(v)) return 0;
  return Math.floor(v / PRICE_STEP) * PRICE_STEP;
}

/** Round UP to the nearest ₹100. Useful for slider upper bounds. */
export function ceil100(n: number | string | null | undefined): number {
  const v = typeof n === "string" ? Number(n) : Number(n ?? 0);
  if (!Number.isFinite(v)) return 0;
  return Math.ceil(v / PRICE_STEP) * PRICE_STEP;
}

/** Snap then clamp into [min, max] — sliders, presets, manual input. */
export function snapClamp100(
  n: number | string | null | undefined,
  min: number,
  max: number,
): number {
  const snapped = snap100(n);
  const lo = snap100(min);
  const hi = snap100(max);
  return Math.max(lo, Math.min(hi, snapped));
}

/** "₹3,400" — Indian-locale string from a snapped value (input is auto-snapped). */
export function fmtSnapped(n: number | string | null | undefined): string {
  return `₹${snap100(n).toLocaleString("en-IN")}`;
}
