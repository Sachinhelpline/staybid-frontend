// ─────────────────────────────────────────────────────────────────────────────
// WHATSAPP CONCIERGE (v583) — the deck's "WhatsApp-led trust" behaviour:
// 56% of the core market prefers assisted booking. One shared helper so every
// surface talks to the SAME concierge line already used by the /bid group
// concierge + Circle support (wa.me/918881555188).
// ─────────────────────────────────────────────────────────────────────────────

export const CONCIERGE_PHONE = "918881555188";

/** Prefilled concierge chat link. Pure string builder — safe everywhere. */
export function conciergeWaLink(message: string): string {
  return `https://wa.me/${CONCIERGE_PHONE}?text=${encodeURIComponent(message)}`;
}
