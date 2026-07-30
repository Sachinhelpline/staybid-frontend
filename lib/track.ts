// Lightweight client-side event tracker for the Discovery mode.
//
// Design:
//   • Append events to an in-memory buffer.
//   • Flush every 5s OR when buffer hits 10, whichever first.
//   • Use navigator.sendBeacon on visibilitychange=hidden so analytics never
//     miss the last few events before the user backgrounds the tab.
//   • Mirrors engagement signals into localStorage under `sb_disco_signals`
//     so the /api/discover/feed ranker can use them on the next request
//     without needing a server-side warehouse.
//
// This module is client-only. Safe to import from "use client" components.

type EventType =
  | "app_open" | "hotel_view" | "swipe_next" | "swipe_prev"
  | "swipe_detail" | "dwell" | "click_book" | "click_bid"
  | "booking_success" | "mode_toggle" | "exit_discovery";

type Evt = {
  type: EventType;
  hotelId?: string;
  roomId?: string;
  meta?: Record<string, any>;
  ts?: string;
};

type DiscoSignals = {
  viewedIds: string[];
  likedIds: string[];
  skippedIds: string[];
  /** Hard "Not interested" suppressions — these ids are filtered OUT of the
      feed entirely (a much stronger negative than a fast-swipe skip). Sent to
      /api/discover/feed so the ranker can suppress them too. */
  notInterestedIds: string[];
  cities: string[];
  priceBand?: [number, number];
  preferAmenities: string[];
};

const BUF_KEY = "sb_track_buf_v1";
const SIG_KEY = "sb_disco_signals";
const SESSION_KEY = "sb_session_id";

function sessionId(): string {
  if (typeof window === "undefined") return "server";
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function loadBuf(): any[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(BUF_KEY) || "[]"); } catch { return []; }
}
function saveBuf(arr: any[]) {
  try { localStorage.setItem(BUF_KEY, JSON.stringify(arr.slice(-50))); } catch {}
}

function token(): string | null {
  return typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
}

async function flush(useBeacon = false) {
  if (typeof window === "undefined") return;
  const buf = loadBuf();
  if (buf.length === 0) return;
  const body = JSON.stringify({ events: buf });
  const url = "/api/events/track";
  saveBuf([]);
  try {
    if (useBeacon && "sendBeacon" in navigator) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    } else {
      const tok = token();
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        },
        body,
        keepalive: true,
      });
    }
  } catch {
    // Put them back; try again next flush
    const cur = loadBuf();
    saveBuf([...buf, ...cur]);
  }
}

let flushTimer: any = null;
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 5000);
}

/** Record an event. Updates session signals so ranking uses it next feed. */
export function track(type: EventType, data: Partial<Evt> = {}) {
  if (typeof window === "undefined") return;
  const evt = {
    type,
    sessionId: sessionId(),
    hotelId: data.hotelId,
    roomId: data.roomId,
    meta: data.meta,
    ts: new Date().toISOString(),
  };
  const buf = loadBuf();
  buf.push(evt);
  saveBuf(buf);

  updateSignalsFromEvent(type, data);

  if (buf.length >= 10) flush();
  else scheduleFlush();
}

function loadSignals(): DiscoSignals {
  if (typeof window === "undefined") return { viewedIds: [], likedIds: [], skippedIds: [], notInterestedIds: [], cities: [], preferAmenities: [] };
  try {
    const raw = JSON.parse(localStorage.getItem(SIG_KEY) || "{}");
    return {
      viewedIds:  raw.viewedIds  || [],
      likedIds:   raw.likedIds   || [],
      skippedIds: raw.skippedIds || [],
      notInterestedIds: raw.notInterestedIds || [],
      cities:     raw.cities     || [],
      priceBand:  raw.priceBand,
      preferAmenities: raw.preferAmenities || [],
    };
  } catch { return { viewedIds: [], likedIds: [], skippedIds: [], notInterestedIds: [], cities: [], preferAmenities: [] }; }
}
function saveSignals(s: DiscoSignals) {
  try { localStorage.setItem(SIG_KEY, JSON.stringify(s)); } catch {}
}

/** Public — read current signals (used by /app/discover when requesting feed). */
export function getSignals(): DiscoSignals { return loadSignals(); }

/** Explicit mutators so callers can attach rich context (city, price). */
export function markViewed(hotelId: string, city?: string, minPrice?: number, amenities?: string[]) {
  const s = loadSignals();
  if (!s.viewedIds.includes(hotelId)) s.viewedIds = [hotelId, ...s.viewedIds].slice(0, 200);
  if (city && !s.cities.includes(city)) s.cities = [city, ...s.cities].slice(0, 10);
  if (minPrice) s.priceBand = s.priceBand ? [Math.min(s.priceBand[0], minPrice * 0.7), Math.max(s.priceBand[1], minPrice * 1.4)] : [minPrice * 0.7, minPrice * 1.4];
  (amenities || []).forEach(a => { if (!s.preferAmenities.includes(a)) s.preferAmenities.push(a); });
  s.preferAmenities = s.preferAmenities.slice(0, 20);
  saveSignals(s);
}

export function markLiked(hotelId: string)   { const s = loadSignals(); if (!s.likedIds.includes(hotelId))   s.likedIds   = [hotelId, ...s.likedIds].slice(0, 100);   saveSignals(s); }
export function markSkipped(hotelId: string) { const s = loadSignals(); if (!s.skippedIds.includes(hotelId)) s.skippedIds = [hotelId, ...s.skippedIds].slice(0, 100); saveSignals(s); }

/** "Not interested" — a hard, persistent suppression. The id is filtered out of
 *  the feed immediately AND on every future feed (client filter + server signal).
 *  Also removed from likedIds so a stale positive can't re-surface it. */
export function markNotInterested(id: string) {
  const s = loadSignals();
  if (!id) return;
  if (!s.notInterestedIds.includes(id)) s.notInterestedIds = [id, ...s.notInterestedIds].slice(0, 300);
  s.likedIds = s.likedIds.filter((x) => x !== id);
  saveSignals(s);
  if (typeof window !== "undefined") {
    try { window.dispatchEvent(new CustomEvent("sb:not-interested", { detail: { id } })); } catch {}
  }
}
/** Read the current "Not interested" suppression set (used by the feed filter). */
export function getNotInterested(): string[] { return loadSignals().notInterestedIds; }

// v580 — the reel player's engagement events (like / save / follow / tagged
// book / tagged bid) now feed the SAME preference store, so watching, saving
// and liking a reel personalises every future feed — including the server
// ranker (/api/discover/feed reads these signals on the next request).
// A long watch (dwell ≥ 8s on one reel) is a positive signal, mirrored from
// the "dwell" event the reel page emits on card change.
const LIKE_EVENTS = new Set<string>([
  "click_bid", "click_book", "booking_success",
  "ig_like", "ig_double_tap_like", "ig_follow",
  "ig_tagged_hotel_book", "ig_tagged_hotel_bid",
]);
const LONG_WATCH_MS = 8000;

function updateSignalsFromEvent(type: EventType, data: Partial<Evt>) {
  if (!data.hotelId) return;
  const t = String(type);
  if (t === "hotel_view") markViewed(data.hotelId, data.meta?.city, data.meta?.minPrice, data.meta?.amenities);
  else if (LIKE_EVENTS.has(t)) markLiked(data.hotelId);
  else if (t === "ig_save") { if ((data as any)?.save !== false && data.meta?.save !== false) markLiked(data.hotelId); }
  else if (t === "dwell" && (data.meta?.dwellMs ?? 0) >= LONG_WATCH_MS) markLiked(data.hotelId);
  else if (t === "swipe_next" && (data.meta?.dwellMs ?? 9999) < 1500) markSkipped(data.hotelId);
}

/** Wire global flush handlers (call once from a layout component). */
export function initTracking() {
  if (typeof window === "undefined") return;
  window.addEventListener("visibilitychange", () => { if (document.hidden) flush(true); });
  window.addEventListener("beforeunload", () => flush(true));
}
