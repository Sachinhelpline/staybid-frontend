// ============================================================================
// v361 — Model 3 auction: monthly-lot date/window/floor helpers (server-only).
//
// A "lot" auctions a room-category for a whole upcoming CALENDAR MONTH. The
// auction window opens on `windowOpenDay` of the PREVIOUS month and closes when
// the month begins. The min bid floor per room-night = the Spine bidFloor
// (owner never sells below cost); we sample a few nights and take the MAX
// (conservative) so no night in the month is ever sold below its floor.
// ============================================================================
import { resolveSpinePrices } from "@/lib/pricing/read-spine";
import { ceil100 } from "@/lib/price-snap";
import { SB_URL, SB_READ } from "@/lib/sb";
import type { AuctionConfig } from "@/lib/trade/config";

export type MonthRange = { monthKey: string; monthStart: string; monthEnd: string; nights: number };

const pad2 = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => d.toISOString().slice(0, 10);

// "YYYY-MM" → inclusive month_start, EXCLUSIVE month_end, night count.
export function monthKeyToRange(monthKey: string): MonthRange | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(monthKey || "").trim());
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const start = new Date(Date.UTC(y, mo - 1, 1));
  const end = new Date(Date.UTC(y, mo, 1)); // first of next month (exclusive)
  const nights = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return { monthKey: `${y}-${pad2(mo)}`, monthStart: iso(start), monthEnd: iso(end), nights };
}

export type AuctionWindow = {
  windowOpenAt: string;   // ISO
  windowCloseAt: string;  // ISO (= month start; auction closes when the month begins)
  phase: "scheduled" | "open" | "past"; // relative to `now`
};

// Compute the auction window for a target month given the admin window-open day.
export function computeAuctionWindow(range: MonthRange, cfg: AuctionConfig, now: Date = new Date()): AuctionWindow {
  const [y, mo] = range.monthKey.split("-").map(Number);
  // Open on `windowOpenDay` of the PREVIOUS month (Date rolls Jan → prev-year Dec).
  const openAt = new Date(Date.UTC(y, mo - 2, Math.min(Math.max(cfg.windowOpenDay, 1), 28), 0, 0, 0));
  const closeAt = new Date(range.monthStart + "T00:00:00Z"); // month begins → auction closes
  let phase: AuctionWindow["phase"];
  if (now.getTime() >= closeAt.getTime()) phase = "past";
  else if (now.getTime() >= openAt.getTime()) phase = "open";
  else phase = "scheduled";
  return { windowOpenAt: openAt.toISOString(), windowCloseAt: closeAt.toISOString(), phase };
}

// The next `count` upcoming months still auctionable (window not yet closed).
export function upcomingAuctionMonths(cfg: AuctionConfig, now: Date = new Date(), count = 3): Array<MonthRange & AuctionWindow> {
  const out: Array<MonthRange & AuctionWindow> = [];
  const y = now.getUTCFullYear(); const mo = now.getUTCMonth(); // 0-based current month
  // Scan from the current month forward; include any whose close is still in the future.
  for (let i = 0; out.length < count && i < 6; i++) {
    const target = new Date(Date.UTC(y, mo + i, 1));
    const key = `${target.getUTCFullYear()}-${pad2(target.getUTCMonth() + 1)}`;
    const range = monthKeyToRange(key)!;
    const win = computeAuctionWindow(range, cfg, now);
    if (win.phase !== "past") out.push({ ...range, ...win });
  }
  return out;
}

// Min bid floor per room-night for a month = MAX Spine bidFloor across sampled
// nights (conservative: owner never sells any night below cost), snapped up to
// ₹100. Falls back to the room's floorPrice, then a hard ₹500 minimum.
// Base min-bid floor per room-night = the room's NORMAL floor price (the owner's
// stated minimum). This is the PROPERTY-OWNER floor. For CIRCLE-OWNER inventory
// (host_circle) the publish route multiplies this by circle_floor_multiplier
// (default 1.20 = cost + 20%) via effectiveFloor(), so a Circle owner covers
// their purchase cost + a margin.
//
// NOTE: the SAME-DAY flash-deal floor (rooms.flashFloorPrice) is intentionally
// NOT used — it's for last-minute liquidation, not a month-ahead bulk auction,
// and is usually unset. The Spine bidFloor is only a fallback when floorPrice
// is missing.
export async function computeMinBidFloorPerNight(roomId: string, range: MonthRange): Promise<number> {
  let base = 0;
  // 1) the room's own normal floor price (primary).
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/rooms?id=eq.${encodeURIComponent(roomId)}&select=floorPrice&limit=1`,
      { headers: SB_READ, cache: "no-store" },
    );
    if (r.ok) { const [row] = await r.json(); base = Number(row?.floorPrice) || 0; }
  } catch { /* ignore */ }
  // 2) fallback: Spine bidFloor (mid-month sample) if floorPrice is missing.
  if (base <= 0) {
    const [y, mo] = range.monthKey.split("-").map(Number);
    try {
      const prices = await resolveSpinePrices([roomId], `${y}-${pad2(mo)}-15`);
      base = Number(prices[roomId]?.bidFloor) || 0;
    } catch { /* ignore */ }
  }
  return Math.max(ceil100(base || 500), 500);
}

// Is this a Circle-operated (host_circle) property? Those are the only ones that
// can appear in BOTH Model 2 and Model 3 → the overlap the guardrails protect.
export async function isCircleOperatedHotel(hotelId: string): Promise<boolean> {
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/hotels?id=eq.${encodeURIComponent(hotelId)}&select=owner_type&limit=1`,
      { headers: SB_READ, cache: "no-store" },
    );
    if (r.ok) { const [row] = await r.json(); return String(row?.owner_type || "") === "host_circle"; }
  } catch { /* ignore */ }
  return false;
}

// Apply the Circle-operated floor multiplier (protects Model-2 fixed pricing).
// Classic hotels → raw floor unchanged. (Legacy helper; the owner-type floor now
// uses circleOwnerFloor for Circle owners and floorPrice for property owners.)
export function effectiveFloor(rawFloor: number, isCircle: boolean, circleMultiplier: number): number {
  if (!isCircle || circleMultiplier <= 1) return rawFloor;
  return ceil100(rawFloor * circleMultiplier);
}

// Property-owner WHOLESALE floor = the room's retail floorPrice minus a bulk
// discount (default 20%). A bulk, advance, guaranteed purchase is worth a real
// discount below the single-night retail floor, so the agent buys wholesale and
// resells at the live market ADR with genuine margin. ₹100-snapped, min ₹100.
// discountPct is clamped 0–40 by the config resolver; a 0 discount ⇒ retail floor.
export function wholesaleFloor(retailFloorPerNight: number, discountPct: number): number {
  const retail = Math.max(0, Math.round(Number(retailFloorPerNight) || 0));
  const pct = Number.isFinite(Number(discountPct)) && Number(discountPct) >= 0 && Number(discountPct) <= 40 ? Number(discountPct) : 20;
  return Math.max(ceil100(retail * (1 - pct / 100)), 100);
}

// Circle-OWNER floor = their PURCHASE price per night × the multiplier (1.20 =
// cover cost + 20% profit). purchasePerNight = their monthly acquisition rate ÷
// 30 (e.g. ₹30,000/mo → ₹1,000/night → ₹1,200 floor). ₹100-snapped, min ₹100.
export function circleOwnerFloor(purchasePerNight: number, circleMultiplier: number): number {
  const p = Math.max(0, Math.round(Number(purchasePerNight) || 0));
  const mult = Number(circleMultiplier) >= 1 ? Number(circleMultiplier) : 1.2;
  return Math.max(ceil100(p * mult), 100);
}

// INFO (not a blocker): is this room also LISTED on Model 2 over the target
// month? Model 2 and Model 3 can run CONCURRENTLY on the same property — the
// shared physical layer (assignFreeUnit + inventory_blocks + room_blocks holds)
// makes a double-booking impossible, so we only surface this as a note, never
// block. Read-only; touches no Model-2 code.
export async function hasActiveModel2Listing(roomId: string, monthStart: string, monthEnd: string): Promise<boolean> {
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/b2b_listings?room_id=eq.${encodeURIComponent(roomId)}&status=eq.listed` +
        `&date_from=lt.${encodeURIComponent(monthEnd)}&date_to=gt.${encodeURIComponent(monthStart)}&select=id&limit=1`,
      { headers: SB_READ, cache: "no-store" },
    );
    if (r.ok) { const rows = await r.json().catch(() => []); return Array.isArray(rows) && rows.length > 0; }
  } catch { /* fail open */ }
  return false;
}

// Physical-capacity guard: how many active physical units this room has. The
// auction must not promise more rooms than exist (over-sell). 0 = classic
// category room with no per-unit rows (availability self-regulates at booking).
export async function activeUnitCount(hotelId: string, roomId: string): Promise<number> {
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/hotel_room_units?hotelId=eq.${encodeURIComponent(hotelId)}&roomId=eq.${encodeURIComponent(roomId)}&status=eq.active&select=id`,
      { headers: SB_READ, cache: "no-store" },
    );
    if (r.ok) { const rows = await r.json().catch(() => []); return Array.isArray(rows) ? rows.length : 0; }
  } catch { /* ignore */ }
  return 0;
}
