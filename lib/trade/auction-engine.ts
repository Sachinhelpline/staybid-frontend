// ============================================================================
// v361 — Model 3 auction: SEGMENT + PRICING engine (pure, shared UI↔server).
//
// An agent bids on a monthly lot for a chosen SEGMENT:
//   • full_month — every night of the month
//   • week       — one calendar-aligned 7-night block (W1: 1–7, W2: 8–14, …)
//   • weekend    — every Friday & Saturday night of the month
//
// The agent bids a price PER ROOM PER NIGHT (≥ the lot floor). We normalize
// everything to per-room-per-night so full-month / week / weekend bids compare
// on the SAME basis at clearing time. EMD deposit = depositPct% of the bid base.
//
// This is the SINGLE source of truth: the bid form, the review page, and the
// checkout route all compute the same numbers (preview == charge).
// ============================================================================

export type SegmentType = "full_month" | "week" | "weekend";

export type MonthRangeLite = { monthKey: string; monthStart: string; monthEnd: string; nights: number };

export type Segment = {
  type: SegmentType;
  weekIndex?: number;     // only for type === 'week'
  label: string;
  dates: string[];        // exact ISO nights this segment covers
  nights: number;
};

const pad2 = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const shortDay = (iso: string) => {
  try { return new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }); }
  catch { return iso; }
};

// All ISO nights of the month [monthStart, monthEnd).
export function monthDates(range: MonthRangeLite): string[] {
  const out: string[] = [];
  const start = new Date(range.monthStart + "T00:00:00Z");
  for (let i = 0; i < range.nights; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    out.push(isoOf(d));
  }
  return out;
}

// Calendar-aligned 7-night weeks: W1 = days 1–7, W2 = 8–14, … last may be short.
export function weekSegments(range: MonthRangeLite): Segment[] {
  const all = monthDates(range);
  const out: Segment[] = [];
  for (let i = 0; i * 7 < all.length; i++) {
    const dates = all.slice(i * 7, i * 7 + 7);
    if (!dates.length) break;
    out.push({
      type: "week", weekIndex: i,
      label: `Week ${i + 1} (${shortDay(dates[0])}–${shortDay(dates[dates.length - 1])})`,
      dates, nights: dates.length,
    });
  }
  return out;
}

// Every Friday & Saturday night of the month (dow 5 = Fri, 6 = Sat).
export function weekendDates(range: MonthRangeLite): string[] {
  return monthDates(range).filter((iso) => {
    const dow = new Date(iso + "T00:00:00Z").getUTCDay();
    return dow === 5 || dow === 6;
  });
}

// Resolve a specific segment's nights (server recomputes this — never trusts a
// client-supplied night list). Returns null for an invalid selection.
export function segmentNights(range: MonthRangeLite, type: SegmentType, weekIndex?: number): Segment | null {
  if (type === "full_month") {
    const dates = monthDates(range);
    return { type, label: "Full month", dates, nights: dates.length };
  }
  if (type === "weekend") {
    const dates = weekendDates(range);
    if (!dates.length) return null;
    return { type, label: "Weekends (Fri–Sat)", dates, nights: dates.length };
  }
  if (type === "week") {
    const weeks = weekSegments(range);
    const w = weeks[Number(weekIndex)];
    return w || null;
  }
  return null;
}

// All selectable segment options for a lot (for the bid form).
export function enumerateSegments(range: MonthRangeLite): Segment[] {
  return [
    segmentNights(range, "full_month")!,
    ...weekSegments(range),
    segmentNights(range, "weekend"),
  ].filter(Boolean) as Segment[];
}

// ── Pricing (per-room-per-night bidding) ────────────────────────────────────
export function bidBaseTotal(perRoomPerNight: number, nights: number, rooms: number): number {
  return Math.round((Number(perRoomPerNight) || 0) * (Number(nights) || 0) * (Number(rooms) || 0));
}
export function emdDeposit(baseTotal: number, depositPct: number): number {
  return Math.round((Number(baseTotal) || 0) * (Number(depositPct) || 0) / 100);
}

// Full cost preview for a single bid line (used by the review page + checkout).
export function bidCostPreview(input: {
  perRoomPerNight: number; nights: number; rooms: number; depositPct: number;
}): { baseTotal: number; deposit: number; perRoomBid: number } {
  const baseTotal = bidBaseTotal(input.perRoomPerNight, input.nights, input.rooms);
  const deposit = emdDeposit(baseTotal, input.depositPct);
  const perRoomBid = Math.round((Number(input.perRoomPerNight) || 0) * (Number(input.nights) || 0));
  return { baseTotal, deposit, perRoomBid };
}
