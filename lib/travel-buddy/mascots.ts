// ─────────────────────────────────────────────────────────────────────────
// StayBid Travel Buddy — tiny draggable mascot: registry, local preference and
// placement geometry (mechanics proof 01).
//
//   • SIX named choices (default Mountain Bear). Each entry points at a clearly
//     marked TEMPORARY placeholder (public/travel-buddy/placeholders/*.svg) and
//     carries `final: null` until Owner-approved transparent plush sprites exist.
//     Final sprites drop in at public/travel-buddy/mascots/<id>.webp (+ @2x) by
//     filling `final` — no component change needed. NEVER point `final` at a
//     poster crop, emoji or reference board.
//   • FINAL ASSETS BOUND (2026-10-13): all six `final` entries point at the Owner-supplied
//     original transparent WebP sprites (96 px 1x / 192 px 2x); identities from the handoff's
//     06_SIX_ASSET_IDENTITIES.json. `bytes`/`sha256` describe the 1x file.
//   • Local preference = ONLY {buddyId, nx, ny, hidden, captions}. Never speech,
//     transcripts, captions text, itinerary, identity or credentials. One key,
//     every read/write wrapped (private mode / blocked storage → defaults).
//   • Geometry is pure (no DOM): the component passes the viewport and the
//     surface's reserved bottom band (bottom dock / sticky booking CTA).
// ─────────────────────────────────────────────────────────────────────────

export type MascotId = "mountain-bear" | "cozy-cottage" | "sleepy-cloud" | "travel-backpack" | "mountain-cabin" | "cozy-mug";

export interface MascotAsset { src: string; src2x: string; width: number; height: number; bytes: number; sha256: string }
export interface MascotEntry {
  id: MascotId;
  name: string;
  /** Temporary, clearly-marked mechanics placeholder (NOT final art). */
  placeholder: string;
  /** Owner-approved transparent plush sprite; null until it exists and passes the asset gate. */
  final: MascotAsset | null;
}

export const DEFAULT_MASCOT: MascotId = "mountain-bear";

export const MASCOTS: readonly MascotEntry[] = Object.freeze([
  { id: "mountain-bear", name: "Mountain Bear", placeholder: "/travel-buddy/placeholders/mountain-bear.svg",
    final: { src: "/travel-buddy/mascots/mountain-bear.webp", src2x: "/travel-buddy/mascots/mountain-bear@2x.webp", width: 96, height: 96, bytes: 4786, sha256: "dc5e3f4345c9db0ad8547be7a8dac71fa4805ac53c8ac5d0a5eaf54ac327951c" } },
  { id: "cozy-cottage", name: "Cozy Cottage", placeholder: "/travel-buddy/placeholders/cozy-cottage.svg",
    final: { src: "/travel-buddy/mascots/cozy-cottage.webp", src2x: "/travel-buddy/mascots/cozy-cottage@2x.webp", width: 96, height: 96, bytes: 4800, sha256: "f38c4d672e4d81374570370e060e32a4bffef7fab9b93cc33618d58882e0480d" } },
  { id: "sleepy-cloud", name: "Sleepy Cloud", placeholder: "/travel-buddy/placeholders/sleepy-cloud.svg",
    final: { src: "/travel-buddy/mascots/sleepy-cloud.webp", src2x: "/travel-buddy/mascots/sleepy-cloud@2x.webp", width: 96, height: 96, bytes: 5082, sha256: "62001dfcc71312093a587909fad6a3128617fa59e306c5ea280a3da9bbf0c0fa" } },
  { id: "travel-backpack", name: "Travel Backpack", placeholder: "/travel-buddy/placeholders/travel-backpack.svg",
    final: { src: "/travel-buddy/mascots/travel-backpack.webp", src2x: "/travel-buddy/mascots/travel-backpack@2x.webp", width: 96, height: 96, bytes: 5022, sha256: "12355fca2256a30d7dcaefccba847a9caccb7a64f6f83d1b4c1c4f40d7897a4c" } },
  { id: "mountain-cabin", name: "Mountain Cabin", placeholder: "/travel-buddy/placeholders/mountain-cabin.svg",
    final: { src: "/travel-buddy/mascots/mountain-cabin.webp", src2x: "/travel-buddy/mascots/mountain-cabin@2x.webp", width: 96, height: 96, bytes: 5436, sha256: "dbe7c0b5082850f50e4b42345d94077d73b3f563384bb95311e4c3f5f87fea27" } },
  { id: "cozy-mug", name: "Cozy Mug", placeholder: "/travel-buddy/placeholders/cozy-mug.svg",
    final: { src: "/travel-buddy/mascots/cozy-mug.webp", src2x: "/travel-buddy/mascots/cozy-mug@2x.webp", width: 96, height: 96, bytes: 4592, sha256: "75bb51057858dadb18004fa034086cb0b1e28c086fa00b871e9d92ba212e51e9" } },
] as MascotEntry[]);

export function mascotById(id: string | null | undefined): MascotEntry {
  return MASCOTS.find((m) => m.id === id) || MASCOTS[0];
}

/** True only when every one of the six choices has an approved final sprite. */
export function allFinalAssetsPresent(list: readonly MascotEntry[] = MASCOTS): boolean {
  return list.length === 6 && list.every((m) => m.final !== null);
}

// ---- local preference ------------------------------------------------------
export const PREFS_KEY = "sb_travel_buddy_prefs_v1";

export interface BuddyPrefs {
  buddyId: MascotId;
  /** Normalised position inside the CURRENT safe box (0..1 each); null = default spot. */
  nx: number | null;
  ny: number | null;
  hidden: boolean;
  captions: boolean;
}

export const DEFAULT_PREFS: BuddyPrefs = Object.freeze({ buddyId: DEFAULT_MASCOT, nx: null, ny: null, hidden: false, captions: true }) as BuddyPrefs;

const unit = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null);

/** Validate untrusted stored JSON into the whitelisted shape (unknown fields dropped). */
export function sanitizePrefs(raw: unknown): BuddyPrefs {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PREFS };
  const r = raw as Record<string, unknown>;
  const id = typeof r.buddyId === "string" && MASCOTS.some((m) => m.id === r.buddyId) ? (r.buddyId as MascotId) : DEFAULT_MASCOT;
  const nx = unit(r.nx);
  const ny = unit(r.ny);
  return {
    buddyId: id,
    nx: nx !== null && ny !== null ? nx : null,
    ny: nx !== null && ny !== null ? ny : null,
    hidden: r.hidden === true,
    captions: r.captions !== false,
  };
}

export function readPrefs(): BuddyPrefs {
  try {
    if (typeof window === "undefined") return { ...DEFAULT_PREFS };
    const s = window.localStorage.getItem(PREFS_KEY);
    return sanitizePrefs(s ? JSON.parse(s) : null);
  } catch { return { ...DEFAULT_PREFS }; }
}

export function writePrefs(p: BuddyPrefs): void {
  const clean = sanitizePrefs(p); // re-whitelist: nothing else can ever be persisted
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ buddyId: clean.buddyId, nx: clean.nx, ny: clean.ny, hidden: clean.hidden, captions: clean.captions }));
  } catch { /* private mode / blocked storage: preference simply not remembered */ }
}

// ---- placement geometry ----------------------------------------------------
export const MASCOT_HIT = 52;      // touch target (CSS px) — ≥ 44
export const MASCOT_VISUAL = 48;   // rendered sprite (CSS px) — inside 42–52
export const EDGE_MARGIN = 8;
export const DRAG_THRESHOLD = 8;   // px of movement before a press becomes a drag (tap ≠ drag)

export interface Insets { top: number; right: number; bottom: number; left: number }
export interface SafeBox { minX: number; maxX: number; minY: number; maxY: number }

/**
 * The rectangle the mascot's top-left corner may occupy. `reservedBottom` is the
 * surface's protected band (mobile bottom dock, or dock + sticky booking CTA on
 * hotel detail) — the mascot can never sit on it.
 */
export function safeBox(vw: number, vh: number, insets: Insets, reservedBottom: number, size = MASCOT_HIT): SafeBox {
  const minX = EDGE_MARGIN + Math.max(0, insets.left);
  const minY = EDGE_MARGIN + Math.max(0, insets.top);
  const maxX = Math.max(minX, vw - size - EDGE_MARGIN - Math.max(0, insets.right));
  const maxY = Math.max(minY, vh - size - EDGE_MARGIN - Math.max(0, insets.bottom) - Math.max(0, reservedBottom));
  return { minX, maxX, minY, maxY };
}

export function clampToBox(x: number, y: number, b: SafeBox): { x: number; y: number; clamped: boolean } {
  const cx = Math.min(b.maxX, Math.max(b.minX, Number.isFinite(x) ? x : b.maxX));
  const cy = Math.min(b.maxY, Math.max(b.minY, Number.isFinite(y) ? y : b.maxY));
  return { x: Math.round(cx), y: Math.round(cy), clamped: Math.abs(cx - x) > 0.5 || Math.abs(cy - y) > 0.5 };
}

export function normalize(x: number, y: number, b: SafeBox): { nx: number; ny: number } {
  const w = b.maxX - b.minX, h = b.maxY - b.minY;
  return { nx: w > 0 ? Math.min(1, Math.max(0, (x - b.minX) / w)) : 1, ny: h > 0 ? Math.min(1, Math.max(0, (y - b.minY) / h)) : 1 };
}

/** Normalised → pixels in the current box (default spot: bottom-right of the safe box). */
export function denormalize(nx: number | null, ny: number | null, b: SafeBox): { x: number; y: number } {
  const fx = nx === null || ny === null ? 1 : nx;
  const fy = nx === null || ny === null ? 1 : ny;
  return { x: Math.round(b.minX + fx * (b.maxX - b.minX)), y: Math.round(b.minY + fy * (b.maxY - b.minY)) };
}

// ---- essential-target collision policy (UX finishing F1) --------------------
// Pure geometry. The component feeds it rectangles it measured from the page
// (geometry only — see probeRegion in TravelBuddy.tsx); nothing here touches the
// DOM. Goal: a resting Buddy surface (mascot, its options badge, the edge tab)
// never sits on a native control the guest needs (SEE ALL, search, cards, dock,
// sticky CTA, any button/link), and never under a native layer drawn above it.

export interface Rect { x: number; y: number; w: number; h: number }
/** A page target: its full box, the part visible in the viewport, and whether it is moving
 *  (inside a running CSS animation — e.g. the auto-scrolling home ticker). */
export interface PageTarget { full: Rect; visible: Rect; moving?: boolean }

/** A target whose FULL box is at most this many px² is "small" (links, buttons, chips): ANY overlap obstructs it. */
export const SMALL_TARGET_AREA = 3 * MASCOT_HIT * MASCOT_HIT;
/** A target whose short side is at most this (a bar / ribbon / search field / chip row that the mascot would
 *  cover top-to-bottom, hiding part of its label) is treated like a small target: ANY overlap obstructs it. */
export const THIN_TARGET_SIDE = 64;
/** A large target (a card) is obstructed when its visible centre is covered or ≥ this share of its visible area. */
export const LARGE_TARGET_OVERLAP = 0.2;
/** Candidate spacing when looking for a clear spot (px). */
export const SPOT_STEP = 12;
/** Edge tab: 22 px visual + 22 px invisible hit extension = 44 × 52 hit box. */
export const EDGE_TAB_HIT_W = 44;

export function intersectArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function obstructs(buddy: Rect, t: PageTarget): boolean {
  const v = t.visible;
  if (v.w <= 0 || v.h <= 0) return false;
  const a = intersectArea(buddy, v);
  if (a <= 0) return false;
  if (t.moving || t.full.w * t.full.h <= SMALL_TARGET_AREA || Math.min(t.full.w, t.full.h) <= THIN_TARGET_SIDE) return true; // moving / small / thin: no overlap at all
  const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
  if (cx >= buddy.x && cx <= buddy.x + buddy.w && cy >= buddy.y && cy <= buddy.y + buddy.h) return true;
  return a / (v.w * v.h) >= LARGE_TARGET_OVERLAP;
}

/** True when none of Buddy's rects obstructs a target or touches a native layer drawn above Buddy. */
export function footprintClear(rects: readonly Rect[], targets: readonly PageTarget[], covers: readonly Rect[] = []): boolean {
  return rects.every((r) => !targets.some((t) => obstructs(r, t)) && !covers.some((c) => intersectArea(r, c) > 0));
}

export function mascotRectAt(p: { x: number; y: number }): Rect { return { x: p.x, y: p.y, w: MASCOT_HIT, h: MASCOT_HIT }; }

/** The options badge's 44×44 hit box beside a mascot at p (same placement rule the component renders). */
export function badgeHitRectAt(p: { x: number; y: number }, vw: number): Rect {
  const left = p.x + MASCOT_HIT / 2 > vw / 2;
  const bx = left ? p.x - 34 : p.x + MASCOT_HIT + 8;
  return { x: bx - 9, y: p.y + (MASCOT_HIT - 26) / 2 - 9, w: 44, h: 44 };
}

export function edgeTabHitRect(side: "left" | "right", y: number, vw: number): Rect {
  return { x: side === "right" ? vw - EDGE_TAB_HIT_W : 0, y, w: EDGE_TAB_HIT_W, h: MASCOT_HIT };
}

function ys(from: number, b: SafeBox, step: number): number[] {
  const out: number[] = [from];
  for (let d = step; from - d >= b.minY || from + d <= b.maxY; d += step) {
    if (from - d >= b.minY) out.push(from - d);   // prefer moving UP first (away from the dock / CTA)
    if (from + d <= b.maxY) out.push(from + d);
  }
  if (!out.includes(b.minY)) out.push(b.minY);
  if (!out.includes(b.maxY)) out.push(b.maxY);
  return out;
}

/**
 * Ordered candidate spots for the mascot: the desired spot, then the same column
 * by distance (up first), then that column nudged 12 / 24 px inward (clears a thin
 * native edge layer such as a page scroll rail without switching sides), then the
 * nearer screen edge, then the far edge. Deterministic — the same page geometry
 * always yields the same choice.
 */
export function spotCandidates(desired: { x: number; y: number }, b: SafeBox, step = SPOT_STEP): { x: number; y: number }[] {
  const d = clampToBox(desired.x, desired.y, b);
  const mid = (b.minX + b.maxX) / 2;
  const cols: number[] = [];
  const addCol = (x: number) => {
    for (const k of [0, 1, 2]) {
      const c = Math.round(Math.min(b.maxX, Math.max(b.minX, x + (x > mid ? -k : k) * step)));
      if (!cols.includes(c)) cols.push(c);
    }
  };
  addCol(d.x);
  const nearRight = d.x - b.minX >= b.maxX - d.x;
  for (const c of nearRight ? [b.maxX, b.minX] : [b.minX, b.maxX]) addCol(c);
  const out: { x: number; y: number }[] = [];
  for (const x of cols) for (const y of ys(d.y, b, step)) out.push({ x, y });
  return out;
}

/** Ordered edge-tab candidates: preferred side by distance from y (up first), then the other side. */
export function tabCandidates(y: number, preferLeft: boolean, b: SafeBox, step = SPOT_STEP): { side: "left" | "right"; y: number }[] {
  const c = Math.min(b.maxY, Math.max(b.minY, Math.round(y)));
  const out: { side: "left" | "right"; y: number }[] = [];
  for (const side of (preferLeft ? ["left", "right"] : ["right", "left"]) as ("left" | "right")[]) for (const yy of ys(c, b, step)) out.push({ side, y: yy });
  return out;
}

/** Placement outcome: a clear mascot spot; else a clear parked edge tab; else nothing (fail closed). */
export type Placement =
  | { kind: "mascot"; x: number; y: number }
  | { kind: "parked"; side: "left" | "right"; y: number }
  | { kind: "suppressed" };

/**
 * Pure planner used by the component and unit-tested directly.
 * `isClear(rects)` answers whether a set of Buddy rects is clear on the current page.
 */
export function planPlacement(
  desired: { x: number; y: number }, b: SafeBox, vw: number, withBadge: boolean,
  isClear: (rects: Rect[]) => boolean,
): Placement {
  for (const c of spotCandidates(desired, b)) {
    const rects = withBadge ? [mascotRectAt(c), badgeHitRectAt(c, vw)] : [mascotRectAt(c)];
    if (isClear(rects)) return { kind: "mascot", x: c.x, y: c.y };
  }
  const t = planTab(desired.y, desired.x + MASCOT_HIT / 2 < vw / 2, b, vw, isClear);
  return t ? { kind: "parked", side: t.side, y: t.y } : { kind: "suppressed" };
}

export function planTab(y: number, preferLeft: boolean, b: SafeBox, vw: number, isClear: (rects: Rect[]) => boolean): { side: "left" | "right"; y: number } | null {
  for (const t of tabCandidates(y, preferLeft, b)) if (isClear([edgeTabHitRect(t.side, t.y, vw)])) return t;
  return null;
}
