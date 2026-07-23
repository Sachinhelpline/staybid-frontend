"use client";
import { useEffect, useState } from "react";
// ─────────────────────────────────────────────────────────────────────────────
// Per-post public comments store (client, localStorage-backed).
//
// Why this exists:
//   The reel card used to show a RANDOM comment count (pseudoStat 38–920) while
//   the drawer rendered a fixed 6 sample comments — so "542 comments" opened to
//   6. That reads as fake. This store makes the count ALWAYS equal what the
//   drawer renders:
//     • a DETERMINISTIC seed list per post id (stable across renders/devices,
//       varied length so the feed still looks populated), plus
//     • the user's OWN comments, persisted per post in localStorage.
//   count(id) === getComments(id).length, always.
//
// Every stored/seeded comment is run through the shared anti-bypass sanitizer,
// so no contact info can ever surface here (defense-in-depth with the drawer).
// ─────────────────────────────────────────────────────────────────────────────
import { sanitizeText } from "@/lib/sanitize-text";

export type SbComment = {
  user: string;
  text: string;
  time: string;
  likes: number;
  ts?: number;
  _you?: boolean;
};

const LS_KEY = "sb_comments_v1";
export const COMMENTS_CHANGED_EVENT = "sb:comments-change";

// Realistic on-brand seed pool. A deterministic slice per post id is shown, so
// every post has a stable, believable thread (not a random number).
const POOL: SbComment[] = [
  { user: "priya_m", text: "Looks like a dream 😍 saving for our anniversary trip", time: "2h", likes: 14 },
  { user: "rohan.k", text: "Booked through StayBid, saved a ton vs MakeMyTrip — same suite", time: "5h", likes: 32 },
  { user: "wanderlust.in", text: "That sunrise shot 🌄🔥", time: "8h", likes: 9 },
  { user: "aisha_s", text: "Service was unreal. Manager remembered our names from check-in.", time: "1d", likes: 21 },
  { user: "vikrambhola", text: "Pool is even better in person.", time: "1d", likes: 6 },
  { user: "meeradc", text: "Quiet, clean, mountains right outside the bathroom window. Magical.", time: "2d", likes: 18 },
  { user: "nomad.neha", text: "How's the network there? Planning to work-from-hills for a week.", time: "3h", likes: 4 },
  { user: "arjun_travels", text: "Went last month — breakfast spread is 🔥", time: "12h", likes: 11 },
  { user: "the.wander.diaries", text: "Adding this to the monsoon list right now.", time: "6h", likes: 8 },
  { user: "kabir_s", text: "Rooms are spacious, exactly like the photos. No surprises.", time: "1d", likes: 15 },
  { user: "sana.explores", text: "Is it couple-friendly? Looks so peaceful 🥺", time: "9h", likes: 7 },
  { user: "dev.on.trip", text: "Won my bid ₹1,900 under the listed price. Buttery smooth.", time: "1d", likes: 27 },
  { user: "riya_kap", text: "Sunset from the balcony >>> everything.", time: "4h", likes: 5 },
  { user: "himalayan.hobo", text: "Staff helped us plan a whole day trek. Legends.", time: "2d", likes: 13 },
  { user: "tanya.m", text: "Booked for December already, can't wait ❄️", time: "7h", likes: 6 },
  { user: "the_foodie_yatri", text: "Local thali at the in-house cafe is unreal value.", time: "1d", likes: 10 },
  { user: "aakash.roams", text: "Parking situation is chill, went by car.", time: "15h", likes: 3 },
  { user: "meghna_v", text: "That view though 🏔️ pinch me", time: "5h", likes: 9 },
  { user: "solo.suhana", text: "Felt super safe as a solo traveller here.", time: "1d", likes: 19 },
  { user: "rahul.frames", text: "Golden hour here is a photographer's dream.", time: "10h", likes: 12 },
  { user: "the.chai.nomad", text: "Morning chai + this view = reset complete ☕", time: "3h", likes: 8 },
  { user: "ishan_g", text: "Checked in via StayBid, got a free upgrade. Wild.", time: "1d", likes: 22 },
  { user: "pooja.travels", text: "Kids loved the garden area. Very family friendly.", time: "2d", likes: 6 },
  { user: "trek.with.t", text: "Base for so many treks around. Perfect location.", time: "8h", likes: 7 },
  { user: "naina.roams", text: "Bookmarking for our next long weekend 🙌", time: "6h", likes: 4 },
  { user: "vivek.on.road", text: "Value for money is honestly unmatched right now.", time: "1d", likes: 14 },
  { user: "the.hill.station", text: "Bonfire in the evening was such a vibe.", time: "13h", likes: 9 },
  { user: "anushka_s", text: "Rooms were spotless. Housekeeping on point.", time: "2d", likes: 11 },
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < (s || "x").length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// A stable, varied-length thread for a post id (6..24 comments), rotated so
// different posts lead with different comments. Deterministic → SSR-safe, and
// identical on every device.
export function seedFor(id: string): SbComment[] {
  const h = hash(id);
  const count = 6 + (h % 19); // 6..24
  const start = h % POOL.length;
  const out: SbComment[] = [];
  for (let i = 0; i < count; i++) {
    const base = POOL[(start + i) % POOL.length];
    out.push({ ...base, text: sanitizeText(base.text).clean });
  }
  return out;
}

function readAll(): Record<string, SbComment[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, SbComment[]>) : {};
  } catch {
    return {};
  }
}
function writeAll(m: Record<string, SbComment[]>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(m));
  } catch {}
}

/** The user's own persisted comments for a post (newest first). */
export function myComments(id: string): SbComment[] {
  return readAll()[id] || [];
}

/** Full thread = the user's persisted comments first, then the deterministic seed. */
export function getComments(id: string): SbComment[] {
  return [...myComments(id), ...seedFor(id)];
}

/** The count shown on the card — always equals getComments(id).length. */
export function getCommentCount(id: string): number {
  return myComments(id).length + seedFor(id).length;
}

/** Count that is stable on first paint (no localStorage read) — avoids SSR/CSR
 *  hydration mismatch; the mounted hook then upgrades it to the real count. */
export function seedCount(id: string): number {
  return seedFor(id).length;
}

/**
 * Add the user's comment to a post. Returns the sanitized text + whether contact
 * info was blocked (the caller fires the admin flag + toast on `blocked`).
 */
export function addComment(id: string, text: string): { clean: string; blocked: boolean } {
  const { clean, blocked } = sanitizeText(text);
  const trimmed = clean.trim();
  if (!trimmed) return { clean: "", blocked };
  const m = readAll();
  (m[id] ||= []).unshift({ user: "you", text: clean, time: "now", likes: 0, ts: Date.now(), _you: true });
  writeAll(m);
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent(COMMENTS_CHANGED_EVENT, { detail: { id } }));
    } catch {}
  }
  return { clean, blocked };
}

/**
 * Reactive comment count for a post — the number shown on the reel card.
 * Initial value is the SSR-safe deterministic seed count (no localStorage read),
 * then on mount it upgrades to the real count (seed + the user's own comments)
 * and live-updates whenever a comment is added anywhere. This GUARANTEES the
 * card count equals what opens in the drawer.
 */
export function useCommentCount(id: string): number {
  const [n, setN] = useState<number>(() => seedCount(id));
  useEffect(() => {
    const refresh = () => setN(getCommentCount(id));
    refresh();
    const onChange = (e: any) => {
      if (!e?.detail?.id || e.detail.id === id) refresh();
    };
    if (typeof window !== "undefined") {
      window.addEventListener(COMMENTS_CHANGED_EVENT, onChange);
      return () => window.removeEventListener(COMMENTS_CHANGED_EVENT, onChange);
    }
  }, [id]);
  return n;
}
