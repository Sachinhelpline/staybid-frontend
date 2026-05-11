// ── Shared anti-bypass text sanitizer ────────────────────────────────
// Originally lived inline in components/discover/InstagramHotelFeed.tsx
// (v25 anti-bypass guard). Extracted to a shared lib for Phase 7 so the
// booking-message chat can use the same rule set without duplication.
//
// Why: pre-booking communication on public reel surfaces must not turn
// into a private-DM channel that lets users go off-platform. The same
// rule applies to post-booking chat for one specific reason — to
// prevent the hotel/customer from coordinating a refund-then-rebook
// loop that bypasses StayBid's commission. (Trip-coordination
// messages — "Can we get an early check-in?" — pass through cleanly.)

export const CONTACT_PATTERNS: RegExp[] = [
  // Phone — international and Indian formats (8-14 digits with separators)
  /\+?\d[\d\s\-().]{7,16}\d/g,
  // Email
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi,
  // URLs
  /(https?:\/\/|www\.)\S+/gi,
  // Bare domains (.com, .in, etc.)
  /\b[a-z0-9-]+\.(com|in|co\.in|net|org|io|me|app|xyz|live|shop)(\/\S*)?\b/gi,
  // WhatsApp / Telegram / Signal / Skype / Zoom
  /\b(whats[\s.]?app|wa\.?me|telegram|t\.?me|signal|skype|google\s*meet|zoom\s*meeting)\b/gi,
  // "DM me", "call me", "ping me", "drop your number"
  /\b(d\.?m\.?\s*(me|@)?|inbox\s*me|message\s*me|call\s*me|ping\s*me|reach\s*out\s*to\s*me|drop\s*(your\s*)?(number|contact|whatsapp))\b/gi,
  // Social handles
  /\b(insta(gram)?|fb|facebook|snap(chat)?|twitter|x\.com)\s*[:\-@]\s*\S+/gi,
  // "Off-platform", "book direct", "outside the app"
  /\b(off[-\s]?platform|outside\s*(the\s*)?(app|platform)|book\s*direct(ly)?|side\s*deal)\b/gi,
];

export function sanitizeText(text: string): { clean: string; blocked: boolean } {
  let clean = text || "";
  let blocked = false;
  for (const p of CONTACT_PATTERNS) {
    if (p.test(clean)) blocked = true;
    clean = clean.replace(p, "•••••");
  }
  return { clean, blocked };
}
