// ─────────────────────────────────────────────────────────────────────────
// StayBid Travel Buddy — ONE shared session model for typed AND voice turns.
//
//   • ConversationEntry log: one ordered conversation regardless of modality
//     (typed / voice), bounded, in memory only (never persisted, never sent).
//   • Transcript review: a voice transcript is NEVER acted on directly. It is shown
//     for review/edit; critical fields (destination, budget, guests, nights, dates)
//     are extracted with the SAME parser the typed path uses. Low-confidence or
//     ambiguous critical fields must be explicitly confirmed (or changed by the guest)
//     before Send. Nothing is silently corrected: the draft starts as the verbatim
//     transcript, and alternatives only raise a flag.
// Pure: no I/O, no React, no DOM, no network, no storage.
// ─────────────────────────────────────────────────────────────────────────
import { inr, parseUtterance, type BuddyLang } from "./conversation";
import type { SttResult } from "./voice-io";

// ---- conversation log -------------------------------------------------------
export type Modality = "typed" | "voice";

export interface ConversationEntry {
  id: number;
  who: "you" | "buddy" | "note";
  text: string;
  /** set for guest turns only */
  modality?: Modality;
  /** voice turns: where the transcript came from */
  voiceSource?: "simulated" | "browser" | "provider";
  /** buddy turns: "ai" = an answer the ORIGINAL live controller verified; absent/"demo" = scripted */
  source?: "ai" | "demo";
}

export const LOG_MAX = 40;

export function appendEntry(log: readonly ConversationEntry[], entry: Omit<ConversationEntry, "id">, max = LOG_MAX): ConversationEntry[] {
  const text = cleanText(entry.text, 300);
  if (!text) return log.slice();
  const id = log.length ? log[log.length - 1].id + 1 : 1;
  const next = log.concat([{ ...entry, text, id }]);
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Display text: strip control / bidi-override characters and clamp. */
export function cleanText(s: unknown, max = 300): string {
  return String(s == null ? "" : s)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// ---- critical fields ----------------------------------------------------------
export type CriticalKey = "city" | "place" | "maxPrice" | "guests" | "nights" | "dates";

export interface CriticalValues {
  city: string | null;
  place: string | null;
  maxPrice: number | null;
  guests: number | null;
  nights: number | null;
  dates: string | null;
}

/** Extract critical fields with the SAME parser the typed path uses (no second grammar). */
export function criticalFields(text: string, cities: readonly string[], lang: BuddyLang = "hinglish"): CriticalValues {
  const p = parseUtterance(text, cities, lang);
  return { city: p.city, place: p.place, maxPrice: p.maxPrice, guests: p.guests, nights: p.nights, dates: p.dates };
}

export const LOW_CONFIDENCE = 0.8;

export interface ReviewField {
  key: CriticalKey;
  /** value that will be SENT (parsed from the current draft) */
  value: string;
  /** what the engine heard for this field (null if absent in the transcript) */
  heard: string | null;
  /** needs explicit confirmation (low confidence or alternatives disagree) */
  flagged: boolean;
  /** the guest changed this field in the draft (their own words — no confirmation needed) */
  edited: boolean;
  confirmed: boolean;
}

export interface ReviewState {
  fields: ReviewField[];
  /** flagged fields still awaiting confirmation */
  pending: CriticalKey[];
  canSend: boolean;
  lowConfidence: boolean;
}

const KEYS: CriticalKey[] = ["city", "place", "maxPrice", "guests", "nights", "dates"];

export function formatCritical(key: CriticalKey, v: CriticalValues[CriticalKey]): string | null {
  if (v == null) return null;
  if (key === "maxPrice") return inr(v as number);
  if (key === "city" || key === "place") return String(v).replace(/\b([a-z])/g, (m) => m.toUpperCase());
  return String(v);
}

export function criticalLabel(key: CriticalKey, lang: BuddyLang): string {
  const en = lang === "en";
  switch (key) {
    case "city": return en ? "Destination" : "Jagah";
    case "place": return en ? "Place (not in list)" : "Jagah (list mein nahi)";
    case "maxPrice": return en ? "Budget / night" : "Budget / raat";
    case "guests": return en ? "Guests" : "Log";
    case "nights": return en ? "Nights" : "Raatein";
    default: return en ? "Dates" : "Dates";
  }
}

/**
 * Review a voice transcript against the guest's current draft.
 *   • heard  = critical fields in the raw transcript;
 *   • alt    = critical fields in each alternative (a disagreement flags that field);
 *   • draft  = critical fields in what would actually be sent.
 * A flagged field is resolved only by explicit confirmation or by the guest editing it.
 */
export function reviewTranscript(
  result: SttResult,
  draft: string,
  confirmed: readonly CriticalKey[],
  cities: readonly string[],
  lang: BuddyLang = "hinglish",
): ReviewState {
  const heard = criticalFields(result.transcript, cities, lang);
  const now = criticalFields(draft, cities, lang);
  const alts = (result.alternatives || []).map((a) => criticalFields(a, cities, lang));
  const lowConfidence = !(result.confidence >= LOW_CONFIDENCE);
  const fields: ReviewField[] = [];
  for (const key of KEYS) {
    const sendV = formatCritical(key, now[key]);
    const heardV = formatCritical(key, heard[key]);
    if (sendV == null && heardV == null) continue;
    const disagree = alts.some((a) => formatCritical(key, a[key]) !== heardV);
    const flagged = heardV != null && (lowConfidence || disagree);
    const edited = sendV !== heardV;
    const ok = confirmed.includes(key);
    if (sendV == null) continue; // the guest removed it: nothing of it will be sent
    fields.push({ key, value: sendV, heard: heardV, flagged, edited, confirmed: ok });
  }
  const pending = fields.filter((f) => f.flagged && !f.edited && !f.confirmed).map((f) => f.key);
  return { fields, pending, canSend: draft.trim().length > 0 && pending.length === 0, lowConfidence };
}
