// v170 — iCal export token (partner panel, Phase 3).
//
// The StayBid → OTA calendar feed is a public URL (Booking.com / Airbnb
// servers fetch it). A deterministic per-room token keeps the URL
// unguessable without needing a DB lookup on every fetch.
import crypto from "crypto";

const ICAL_SECRET = "staybid-ical-feed-v1";

export function icalToken(roomId: string): string {
  return crypto.createHash("sha256").update(`${roomId}:${ICAL_SECRET}`).digest("hex").slice(0, 24);
}

export function icalUrl(origin: string, roomId: string): string {
  return `${origin}/api/partner/ical/${encodeURIComponent(roomId)}?k=${icalToken(roomId)}`;
}
