// ═══════════════════════════════════════════════════════════════════
// Real-time availability helpers — server only.
// Merges: ACCEPTED bids + room_blocks (walk_in / ota_ical / manual).
// Used by /api/availability, /api/partner/calendar, and partner UI.
// ═══════════════════════════════════════════════════════════════════
import { SB_URL, SB_H } from "./sb-server";

/** One-day inclusive date iterator. fromISO..toISO as "YYYY-MM-DD" */
export function enumerateDates(fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  const from = new Date(fromISO + "T00:00:00Z");
  const to   = new Date(toISO   + "T00:00:00Z");
  for (let d = new Date(from); d < to; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function toISODate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toISOString().slice(0, 10);
}

/** Check if two [a1, a2) and [b1, b2) half-open date ranges overlap. */
export function rangesOverlap(a1: string, a2: string, b1: string, b2: string): boolean {
  return a1 < b2 && b1 < a2;
}

type Occupation = {
  fromDate: string;      // YYYY-MM-DD (inclusive)
  toDate:   string;      // YYYY-MM-DD (exclusive — checkout)
  source:   "bid" | "walk_in" | "ota_ical" | "manual" | "group";
  roomId:   string;
  hotelId:  string;
  guestName?: string;
  amount?:  number;
  note?:    string;
  provider?: string;
  refId?:   string;      // bid id or block id
  assignedUnitId?: string;
  assignedUnitNumber?: string;
  // v247 — how many physical units this occupation consumes. A multi-room
  // bid/booking (bids.numRooms = N) blocks N units, not 1. room_blocks /
  // walk-ins / OTA holds are always a single unit. Defaults to 1 everywhere
  // it is read so legacy single-room data is unaffected.
  numRooms?: number;
};

/** Parse a bid's checkIn/checkOut from related bid_request or fallback msg. */
function extractBidRange(b: any): { checkIn?: string; checkOut?: string } {
  const req = b.request || b.bidRequest;
  const ci  = req?.checkIn || b.checkIn;
  const co  = req?.checkOut || b.checkOut;
  if (ci && co) {
    return { checkIn: toISODate(ci), checkOut: toISODate(co) };
  }
  // Fallback: try to parse from message "dates: 2026-04-24..2026-04-26"
  const m = typeof b.message === "string" ? b.message.match(/(\d{4}-\d{2}-\d{2}).*?(\d{4}-\d{2}-\d{2})/) : null;
  if (m) return { checkIn: m[1], checkOut: m[2] };
  return {};
}

/**
 * Pull all occupations for the given hotel within [from, to).
 * Returns merged list: ACCEPTED bids + all room_blocks.
 * Safe: if either query fails, returns whatever succeeded.
 */
export async function getOccupations(params: {
  hotelId: string;
  roomId?: string;
  from:    string;   // inclusive
  to:      string;   // exclusive
}): Promise<Occupation[]> {
  const { hotelId, roomId, from, to } = params;
  const out: Occupation[] = [];

  // ─── 1. Accepted bids (they are always blocks while not rejected/expired) ───
  try {
    const roomFilter = roomId ? `&roomId=eq.${roomId}` : "";
    // Include ACCEPTED + COUNTER (tentative block); RELEASE when REJECTED.
    // v247 — also pull CONFIRMED / CHECKED_IN (a paid stay is the hardest
    // block of all) and the per-bid numRooms so a multi-room bid consumes
    // the right number of units below.
    const bidsUrl =
      `${SB_URL}/rest/v1/bids?hotelId=eq.${hotelId}${roomFilter}` +
      `&status=in.(ACCEPTED,COUNTER,PENDING,CONFIRMED,CHECKED_IN)&select=id,roomId,hotelId,status,amount,message,customerId,requestId,%22numRooms%22`;
    const r = await fetch(bidsUrl, { headers: SB_H });
    const bids = await r.json();
    if (Array.isArray(bids)) {
      // Fetch associated bid_requests in bulk (checkIn/checkOut live there)
      const requestIds = Array.from(new Set(bids.map((b: any) => b.requestId).filter(Boolean)));
      let reqMap: Record<string, any> = {};
      if (requestIds.length) {
        const rr = await fetch(
          `${SB_URL}/rest/v1/bid_requests?id=in.(${requestIds.join(",")})&select=id,checkIn,checkOut`,
          { headers: SB_H }
        );
        const reqs = await rr.json();
        if (Array.isArray(reqs)) reqs.forEach((x: any) => { reqMap[x.id] = x; });
      }

      // Fetch unit assignments for these bids
      const bidIds = bids.map((b: any) => b.id).filter(Boolean);
      let unitMap: Record<string, { unitId: string; unitNumber: string }> = {};
      if (bidIds.length) {
        try {
          const ur = await fetch(
            `${SB_URL}/rest/v1/bid_unit_assignments?bidId=in.(${bidIds.join(",")})&select=bidId,unitId,unitNumber`,
            { headers: SB_H }
          );
          const us = await ur.json();
          if (Array.isArray(us)) us.forEach((x: any) => { unitMap[x.bidId] = { unitId: x.unitId, unitNumber: x.unitNumber }; });
        } catch {}
      }

      for (const b of bids) {
        const req = reqMap[b.requestId] || {};
        const ci = req.checkIn ? toISODate(req.checkIn) : undefined;
        const co = req.checkOut ? toISODate(req.checkOut) : undefined;
        if (!ci || !co) continue;
        if (!rangesOverlap(ci, co, from, to)) continue;
        // HARD blocks: ACCEPTED + CONFIRMED + CHECKED_IN (a held/paid stay).
        // COUNTER stays a soft block (shown to the partner, counted as held
        // while the counter is pending). PENDING is NOT a block — per the
        // v247 decision the reverse auction keeps inventory free until a bid
        // is accepted, so multiple PENDING bids can compete on the same room.
        if (b.status === "ACCEPTED" || b.status === "COUNTER" || b.status === "CONFIRMED" || b.status === "CHECKED_IN") {
          const u = unitMap[b.id];
          out.push({
            fromDate: ci, toDate: co,
            source: "bid", roomId: b.roomId, hotelId: b.hotelId,
            amount: Number(b.amount) || 0,
            note: b.status === "COUNTER" ? "Counter pending"
                : b.status === "CHECKED_IN" ? "Checked in"
                : b.status === "CONFIRMED" ? "Booked"
                : "Bid booked",
            refId: b.id,
            assignedUnitId: u?.unitId,
            assignedUnitNumber: u?.unitNumber,
            numRooms: Math.max(1, Number(b.numRooms) || 1),
          });
        }
      }
    }
  } catch { /* ignore */ }

  // ─── 2. Room blocks (walk-ins + OTA + manual) ───
  try {
    const roomFilter = roomId ? `&roomId=eq.${roomId}` : "";
    const url = `${SB_URL}/rest/v1/room_blocks?hotelId=eq.${hotelId}${roomFilter}` +
                `&toDate=gt.${from}&fromDate=lt.${to}&select=*`;
    const r = await fetch(url, { headers: SB_H });
    const blocks = await r.json();
    if (Array.isArray(blocks)) {
      for (const b of blocks) {
        out.push({
          fromDate: toISODate(b.fromDate),
          toDate:   toISODate(b.toDate),
          source:   (b.source as any) || "manual",
          roomId:   b.roomId,
          hotelId:  b.hotelId,
          guestName: b.guestName,
          amount:   b.amount != null ? Number(b.amount) : undefined,
          note:     b.note,
          provider: b.provider,
          refId:    b.id,
          assignedUnitId: b.assignedUnitId,
          assignedUnitNumber: b.assignedUnitNumber,
          numRooms: 1, // a manual/walk-in/OTA block is always one unit
        });
      }
    }
  } catch { /* ignore */ }

  return out;
}

/**
 * Expand occupations into a Set of occupied ISO dates for a given room.
 * Hard blocks: bid+ACCEPTED, walk_in, ota_ical, manual.
 * Soft: COUNTER (included so customer sees amber warning).
 */
export function occupationsToDateSet(occs: Occupation[], roomId?: string): Set<string> {
  const s = new Set<string>();
  for (const o of occs) {
    if (roomId && o.roomId !== roomId) continue;
    enumerateDates(o.fromDate, o.toDate).forEach(d => s.add(d));
  }
  return s;
}

/**
 * v247 — Date-aware unit availability for a single room category over a range.
 *
 * Returns the number of units that are FREE on the TIGHTEST (most-occupied)
 * day in [from, to). This is the figure an oversell guard compares the
 * requested numRooms against.
 *
 * Capacity basis (per Sachin's confirmed rule): strict per-unit from
 * `hotel_room_units` (status=active) when that room has units configured;
 * otherwise fall back to `rooms.quantity` as virtual units so the 31/32 hotels
 * that have not populated hotel_room_units yet still get correct availability
 * (and are never wrongly blocked). If neither is known, returns null = "no
 * capacity signal" → the caller should fail OPEN (allow), never block.
 *
 * Occupied = the max, across every night in the range, of the summed
 * `numRooms` of all HARD occupations (accepted/confirmed/checked-in bids +
 * room_blocks) covering that night. Multi-room bids consume their full
 * numRooms; manual blocks consume 1.
 */
export async function unitsFreeForRange(params: {
  hotelId: string;
  roomId:  string;
  from:    string;   // YYYY-MM-DD inclusive (check-in)
  to:      string;   // YYYY-MM-DD exclusive (check-out)
}): Promise<{ capacity: number; occupied: number; free: number } | null> {
  const { hotelId, roomId, from, to } = params;
  if (!hotelId || !roomId || !from || !to || from >= to) return null;

  // 1) Capacity — active units first, else rooms.quantity virtual units.
  let capacity = 0;
  try {
    const ur = await fetch(
      `${SB_URL}/rest/v1/hotel_room_units?hotelId=eq.${hotelId}&roomId=eq.${roomId}&status=eq.active&select=id`,
      { headers: SB_H }
    );
    const units = await ur.json();
    if (Array.isArray(units)) capacity = units.length;
  } catch { /* fall through to quantity */ }
  if (capacity === 0) {
    try {
      const rr = await fetch(
        `${SB_URL}/rest/v1/rooms?id=eq.${roomId}&select=quantity`,
        { headers: SB_H }
      );
      const rows = await rr.json();
      const q = Array.isArray(rows) && rows[0] ? rows[0].quantity : null;
      if (q != null) capacity = Math.max(0, Number(q) || 0);
      else return null; // no capacity signal at all → caller fails open
    } catch { return null; }
  }
  if (capacity <= 0) return null;

  // 2) Per-night occupied = Σ numRooms of overlapping hard occupations.
  const occs = await getOccupations({ hotelId, roomId, from, to });
  let peakOccupied = 0;
  for (const night of enumerateDates(from, to)) {
    let dayOcc = 0;
    for (const o of occs) {
      if (o.roomId !== roomId) continue;
      // occupation covers [fromDate, toDate); night is occupied if it lies inside
      if (o.fromDate <= night && night < o.toDate) dayOcc += Math.max(1, o.numRooms || 1);
    }
    if (dayOcc > peakOccupied) peakOccupied = dayOcc;
  }

  return { capacity, occupied: peakOccupied, free: Math.max(0, capacity - peakOccupied) };
}

/**
 * v326 — Channel Manager Phase B: per-unit double-booking detector.
 *
 * Is the ONE physical unit `unitId` sold to more than one source on any night
 * in [from, to)? This is the real StayBid-Circle risk: an investor lists their
 * single room on Airbnb + Booking.com + StayBid, and two of them sell the same
 * night. It only counts occupations explicitly ASSIGNED to this unit
 * (assignedUnitId) — an OTA feed with ota_feeds."unitId" set now stamps its
 * imported room_blocks with assignedUnitId, and an accepted bid carries its
 * bid_unit_assignment. Unassigned category-level demand is handled separately
 * by unitsFreeForRange (v318) — not here.
 *
 * Returns false (never a false alarm) on any gap. Never throws to the caller
 * beyond a rejected fetch which the caller should .catch(() => false).
 */
export async function unitDoubleBooked(params: {
  hotelId: string;
  unitId:  string;
  from:    string;   // YYYY-MM-DD inclusive
  to:      string;   // YYYY-MM-DD exclusive
}): Promise<boolean> {
  const { hotelId, unitId, from, to } = params;
  if (!hotelId || !unitId || !from || !to || from >= to) return false;
  const occs = await getOccupations({ hotelId, from, to });
  const mine = occs.filter((o) => o.assignedUnitId && String(o.assignedUnitId) === String(unitId));
  for (const night of enumerateDates(from, to)) {
    let c = 0;
    for (const o of mine) {
      if (o.fromDate <= night && night < o.toDate) c += Math.max(1, o.numRooms || 1);
    }
    if (c > 1) return true;
  }
  return false;
}

/** ═══ Minimal iCal parser (handles Booking.com/Airbnb/GoIbibo format) ═══ */
export function parseICal(text: string): Array<{ uid?: string; start?: string; end?: string; summary?: string }> {
  if (!text || typeof text !== "string") return [];
  const events: Array<any> = [];
  // Normalize line folding (RFC 5545)
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);

  let cur: any = null;
  for (const raw of lines) {
    if (raw === "BEGIN:VEVENT") cur = {};
    else if (raw === "END:VEVENT") { if (cur) events.push(cur); cur = null; }
    else if (cur) {
      const idx = raw.indexOf(":");
      if (idx < 0) continue;
      const key = raw.slice(0, idx).split(";")[0].toUpperCase();
      const val = raw.slice(idx + 1).trim();
      if (key === "UID")          cur.uid = val;
      else if (key === "DTSTART") cur.start = icalDate(val);
      else if (key === "DTEND")   cur.end = icalDate(val);
      else if (key === "SUMMARY") cur.summary = val;
    }
  }
  return events;
}

function icalDate(s: string): string | undefined {
  // Accepts "20260424", "20260424T000000Z", "2026-04-24"
  const m = s.match(/(\d{4})[-]?(\d{2})[-]?(\d{2})/);
  if (!m) return undefined;
  return `${m[1]}-${m[2]}-${m[3]}`;
}
