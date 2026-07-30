// ─────────────────────────────────────────────────────────────────────────────
// AUDIENCE SEGMENT INFERENCE (v581, client-only) — who is this traveller?
//
// The decks target audiences (couples / families / groups / solo / pilgrims)
// but we never ASK anyone their demographic. We infer it from what they
// already tell us by using the product:
//   • the party they build on /bid or a booking sheet (children ⇒ family,
//     2 adults & 1 room ⇒ couple, 4+ adults ⇒ group, 1 adult ⇒ solo)
//   • the trip-type chip they tap on the Stage (pilgrimage ⇒ pilgrim, …)
//
// Stored in localStorage (sb_segment) with the SOURCE + timestamp; an
// explicit chip tap outranks an old party inference, a fresh party inference
// outranks an older one. Fail-open: no signal → null, callers fall back to
// their defaults. Wiped by the logout allow-list like every taste signal.
// ─────────────────────────────────────────────────────────────────────────────

import type { SegmentId, TripFormatId } from "@/lib/browse/trip-formats";

const KEY = "sb_segment";
const TTL_MS = 90 * 24 * 60 * 60 * 1000; // a season's worth of memory

interface StoredSegment { seg: SegmentId; source: "party" | "chip"; ts: number; }

export function readSegment(): SegmentId | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null") as StoredSegment | null;
    if (!raw?.seg || !Number.isFinite(raw.ts)) return null;
    if (Date.now() - raw.ts > TTL_MS) return null;
    return raw.seg;
  } catch { return null; }
}

function write(seg: SegmentId, source: "party" | "chip") {
  try {
    const prev = JSON.parse(localStorage.getItem(KEY) || "null") as StoredSegment | null;
    // an explicit chip choice is never overwritten by a party inference
    // unless the party signal is NEWER than 7 days after that choice
    if (prev?.source === "chip" && source === "party" && Date.now() - prev.ts < 7 * 24 * 60 * 60 * 1000) return;
    localStorage.setItem(KEY, JSON.stringify({ seg, source, ts: Date.now() } satisfies StoredSegment));
    window.dispatchEvent(new Event("sb:segment-change"));
  } catch {}
}

/** Pure party → segment rule (deck party-size bands). */
export function segmentFromParty(adults: number, children: number, rooms: number): SegmentId {
  const a = Math.max(0, Number(adults) || 0);
  const c = Math.max(0, Number(children) || 0);
  const r = Math.max(1, Number(rooms) || 1);
  if (c > 0) return "family";
  if (a >= 4 || r >= 3) return "group";
  if (a <= 1) return "solo";
  return "couple"; // 2–3 adults, 1–2 rooms
}

/** Call from any surface where the user builds a party (bid form, booking). */
export function recordParty(adults: number, children: number, rooms: number) {
  if (typeof window === "undefined") return;
  write(segmentFromParty(adults, children, rooms), "party");
}

/** v582 — the Trip Finder's first tap IS the segment, said explicitly. */
export function recordSegmentChoice(seg: SegmentId) {
  if (typeof window === "undefined") return;
  write(seg, "chip");
}

/** Call when the user explicitly taps a trip-type chip. */
export function recordFormatChoice(format: TripFormatId) {
  if (typeof window === "undefined") return;
  const seg: SegmentId =
    format === "family" ? "family"
    : format === "pilgrimage" ? "pilgrim"
    : format === "adventure" ? "group"
    : format === "workation" ? "solo"
    : "couple"; // weekend + premium read as couple-led
  write(seg, "chip");
}
