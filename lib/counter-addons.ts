// ─────────────────────────────────────────────────────────────────────────
// lib/counter-addons.ts — structured catalog of complimentary amenities a
// hotel partner can bundle with a counter-offer (v129).
//
// Why this file exists: pre-v129, the partner's counter modal had a free-text
// "Message to Guest" textarea. Hotels used it to bundle perks ("Free
// breakfast", "Late checkout") but ALSO regularly slipped contact info
// ("WhatsApp me at 9810xxxxxx") through it — an anti-bypass surface we
// already had to scrub on the customer side.
//
// v129 replaces the textarea with a fixed icon-checkbox catalog. The
// partner can ONLY pick from the catalog below. The selection is serialized
// into the message field via `serializeAddons()` so the existing backend
// (Railway / Supabase fallback PATCH on `bids.hotelMessage`) keeps working
// without a schema change, and the customer side parses the same string
// back into chip pills via `parseAddons()`.
//
// The sentinel `[StayBid-Addons] …` prefix is what distinguishes a v129
// structured payload from a legacy free-text counter message. Legacy
// messages keep rendering as-is (the sanitizer scrubs phone/email anyway).
// ─────────────────────────────────────────────────────────────────────────

export type CounterAddon = {
  id: string;
  icon: string;
  label: string;
  /** One-line guest-facing description. */
  desc: string;
};

/** Curated set — same icons / labels used on the customer review pill. */
export const COUNTER_ADDONS: CounterAddon[] = [
  { id: "breakfast",      icon: "🍳", label: "Complimentary breakfast",  desc: "Buffet or à la carte for all guests" },
  { id: "dinner",         icon: "🍽️", label: "Complimentary dinner",     desc: "House menu, one evening included" },
  { id: "welcome_drink",  icon: "🍷", label: "Welcome drink",            desc: "Mocktail or wine on arrival" },
  { id: "early_checkin",  icon: "🌅", label: "Early check-in",           desc: "Before 12 PM if available" },
  { id: "late_checkout",  icon: "🌇", label: "Late check-out",           desc: "Up to 2 PM" },
  { id: "airport_pickup", icon: "🚗", label: "Airport pickup",           desc: "One-way transfer included" },
  { id: "room_upgrade",   icon: "⬆️", label: "Room upgrade",             desc: "Next-tier room if available" },
  { id: "spa_voucher",    icon: "💆", label: "Spa voucher",              desc: "30-min wellness session" },
  { id: "kids_free",      icon: "🧒", label: "Kids stay free",           desc: "Under 12, with existing bedding" },
  { id: "minibar",        icon: "🥤", label: "Mini-bar credit",          desc: "₹500 in-room minibar credit" },
  { id: "parking",        icon: "🅿️", label: "Free parking",             desc: "Valet or self-park included" },
  { id: "honeymoon",      icon: "💑", label: "Honeymoon set-up",         desc: "Bed decoration + sweet treat" },
];

const SENTINEL = "[StayBid-Addons]";

/** Build the message body the backend stores on `bids.hotelMessage`. */
export function serializeAddons(selectedIds: string[]): string {
  const ids = (selectedIds || []).filter((s, i, a) => s && a.indexOf(s) === i);
  if (!ids.length) return "";
  // Whitelist against the known catalog so a corrupted client can't smuggle
  // arbitrary strings through the message field.
  const known = ids.filter((id) => COUNTER_ADDONS.some((a) => a.id === id));
  if (!known.length) return "";
  return `${SENTINEL} ${known.join(",")}`;
}

/** Pull a structured addon list out of the stored message, if present. */
export function parseAddons(message: string | null | undefined): CounterAddon[] {
  if (!message || typeof message !== "string") return [];
  const ix = message.indexOf(SENTINEL);
  if (ix < 0) return [];
  const tail = message.slice(ix + SENTINEL.length).trim();
  if (!tail) return [];
  // Take only the first whitespace-delimited token block so any trailing
  // text the backend appends (e.g. " | paid:...") can't leak into the chip
  // labels.
  const ids = tail.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  return ids
    .map((id) => COUNTER_ADDONS.find((a) => a.id === id))
    .filter((a): a is CounterAddon => !!a);
}

/** True if any structured addons are encoded in the message. */
export function hasAddons(message: string | null | undefined): boolean {
  return parseAddons(message).length > 0;
}
