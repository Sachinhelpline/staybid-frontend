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
export async function computeMinBidFloorPerNight(roomId: string, range: MonthRange): Promise<number> {
  const [y, mo] = range.monthKey.split("-").map(Number);
  // Sample the 1st, 15th and 25th (bounded to the month's nights).
  const sampleDays = [1, 15, 25].filter((d) => d <= range.nights);
  let maxFloor = 0;
  for (const d of sampleDays) {
    const day = `${y}-${pad2(mo)}-${pad2(d)}`;
    try {
      const prices = await resolveSpinePrices([roomId], day);
      const bf = Number(prices[roomId]?.bidFloor) || 0;
      if (bf > maxFloor) maxFloor = bf;
    } catch { /* ignore this sample */ }
  }
  if (maxFloor <= 0) {
    // Spine gave nothing — fall back to the room's own floorPrice.
    try {
      const r = await fetch(
        `${SB_URL}/rest/v1/rooms?id=eq.${encodeURIComponent(roomId)}&select=floorPrice&limit=1`,
        { headers: SB_READ, cache: "no-store" },
      );
      if (r.ok) { const [row] = await r.json(); maxFloor = Number(row?.floorPrice) || 0; }
    } catch { /* ignore */ }
  }
  return Math.max(ceil100(maxFloor || 500), 500);
}
