// STAY-LIFECYCLE-OPS-01 — guest contact classification / normalization (pure).
//
// The legacy identity model stores some accounts with an EMAIL in `users.phone`
// (legacy "phone=email" rows) and Firebase accounts with an `unknown_<uid>`
// placeholder. A partner surface must therefore never render whatever sits in
// the phone column as a telephone number (`tel:` / WhatsApp). Classify by
// SHAPE, never invent or overwrite a value, and route each value to the slot it
// actually is. Unknown/placeholder values are dropped (shown as "not on file").
export type ContactKind = "phone" | "email" | "unknown";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLACEHOLDER = /^(unknown_|fb_|firebase_|google_)/i;

export function classifyContact(v: unknown): { kind: ContactKind; value: string | null } {
  const s = String(v ?? "").trim();
  if (!s) return { kind: "unknown", value: null };
  if (PLACEHOLDER.test(s)) return { kind: "unknown", value: null };
  if (EMAIL.test(s)) return { kind: "email", value: s };
  const digits = s.replace(/[\s\-().]/g, "");
  if (/^\+?\d{8,15}$/.test(digits)) return { kind: "phone", value: s };
  return { kind: "unknown", value: null };
}

/**
 * Normalize a (phone, email) pair into truthful slots: a phone-looking value in
 * the phone slot stays a phone; an EMAIL found in the phone slot moves to the
 * email slot (when that slot is empty) — it is never rendered as a phone.
 * Returns nulls rather than inventing anything.
 */
export function normalizeGuestContact(input: { phone?: unknown; email?: unknown }): {
  phone: string | null;
  email: string | null;
} {
  const p = classifyContact(input.phone);
  const e = classifyContact(input.email);
  let phone: string | null = p.kind === "phone" ? p.value : null;
  let email: string | null = e.kind === "email" ? e.value : null;
  if (!email && p.kind === "email") email = p.value; // legacy phone=email row
  if (!phone && e.kind === "phone") phone = e.value; // symmetric safety
  return { phone, email };
}

/** Digits-only for a WhatsApp deep link; null when the value is not a phone. */
export function whatsappDigits(phone: unknown): string | null {
  const c = classifyContact(phone);
  if (c.kind !== "phone" || !c.value) return null;
  return c.value.replace(/[^0-9]/g, "");
}
