// ── Shared anti-bypass text sanitizer ────────────────────────────────
// Originally lived inline in components/discover/InstagramHotelFeed.tsx
// (v25 anti-bypass guard). Extracted to a shared lib so the reel comments,
// the booking-message chat, and captions all use ONE rule set.
//
// Why: public reel surfaces (and pre-booking chat) must not become a private
// off-platform channel. Any way to exchange contact — phone (any format),
// email, WhatsApp/Telegram, social handles, a bare @handle, a StayBid/SB id,
// or a long digit/alphanumeric id — is masked to "•••••" and flags the text as
// `blocked` so the caller can warn the user + trigger admin review.
// (Trip-coordination messages — "Can we get an early check-in?" — pass clean.)

type LabeledPattern = { label: string; re: RegExp };

// Each pattern carries a label so a blocked comment can be reported to admin
// with the reasons it tripped. `re` MUST be global (/g) — replace() uses it.
export const CONTACT_PATTERNS_LABELED: LabeledPattern[] = [
  // Phone — international + Indian formats (8-16 digits with separators)
  { label: "phone", re: /\+?\d[\d\s\-().]{7,16}\d/g },
  // Long UNSEPARATED digit run (7+) — a phone/ID typed without spaces. Prices
  // (≤5 digits) + years (4) are spared; 7+ in a row is effectively always a
  // number/ID being shared.
  { label: "digit-run", re: /\d{7,}/g },
  // Obfuscated digits — 7+ single digits split by spaces / dashes / dots
  // ("9 8 7 6 5 4 3", "98765-43210").
  { label: "spaced-digits", re: /(?:\d[\s\-.]){6,}\d/g },
  // Email
  { label: "email", re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi },
  // URLs
  { label: "url", re: /(https?:\/\/|www\.)\S+/gi },
  // Bare domains (.com, .in, etc.)
  { label: "domain", re: /\b[a-z0-9-]+\.(com|in|co\.in|net|org|io|me|app|xyz|live|shop)(\/\S*)?\b/gi },
  // WhatsApp / Telegram / Signal / Skype / Zoom
  { label: "messenger", re: /\b(whats[\s.]?app|wa\.?me|telegram|t\.?me|signal|skype|google\s*meet|zoom\s*meeting)\b/gi },
  // "DM me", "call me", "ping me", "drop your number"
  { label: "solicit", re: /\b(d\.?m\.?\s*(me|@)?|inbox\s*me|message\s*me|call\s*me|ping\s*me|reach\s*out\s*to\s*me|drop\s*(your\s*)?(number|contact|whatsapp))\b/gi },
  // Social handles with a platform keyword ("insta: x", "snap - y")
  { label: "social", re: /\b(insta(gram)?|fb|facebook|snap(chat)?|twitter|x\.com|telegram)\s*[:\-@]?\s*@?\w[\w.]{1,}/gi },
  // A BARE @handle anywhere ("@travel_with_me") — 2+ chars.
  { label: "handle", re: /(^|[\s(:,])@[a-z0-9._]{2,32}/gi },
  // StayBid / SB id or username being shared ("staybid id: x", "sb username y").
  // Requires the id/username/handle keyword so plain brand mentions
  // ("Booked through StayBid") are NOT masked.
  { label: "staybid-id", re: /\b(stay\s?bid|sb)\s*(id|user\s?name|handle|profile|account)\s*(is|:|-|#|=)?\s*[a-z0-9._@-]+/gi },
  // Generic "my id / username / handle : <token>" contact-share intent.
  { label: "id-share", re: /\b(my\s+)?(id|user\s?name|handle)\s*(is|:|-|#|=)\s*[a-z0-9._@-]{2,}/gi },
  // "Off-platform", "book direct", "outside the app"
  { label: "off-platform", re: /\b(off[-\s]?platform|outside\s*(the\s*)?(app|platform)|book\s*direct(ly)?|side\s*deal)\b/gi },
];

// Back-compat: the plain regex list some callers may still import.
export const CONTACT_PATTERNS: RegExp[] = CONTACT_PATTERNS_LABELED.map((p) => p.re);

/**
 * Mask every contact pattern to "•••••".
 * @returns clean (masked) text, `blocked` (true if anything matched), and the
 *   `reasons` (labels that tripped) for admin reporting.
 */
export function sanitizeText(text: string): { clean: string; blocked: boolean; reasons: string[] } {
  let clean = text || "";
  const reasons: string[] = [];
  for (const { label, re } of CONTACT_PATTERNS_LABELED) {
    // Fresh lastIndex each use (global regex is stateful).
    re.lastIndex = 0;
    if (re.test(clean)) {
      reasons.push(label);
      re.lastIndex = 0;
      // Keep any leading boundary char captured by some patterns (\1-style
      // groups) — replace the whole match but preserve a leading space/paren
      // when the pattern began with one.
      clean = clean.replace(re, (m) => {
        const lead = /^[\s(:,]/.test(m) ? m[0] : "";
        return lead + "•••••";
      });
    }
  }
  return { clean, blocked: reasons.length > 0, reasons };
}
