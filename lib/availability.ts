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
    // Include ACCEPTED + COUNTER (tentative block); RELEASE when REJECTED
    const bidsUrl =
      `${SB_URL}/rest/v1/bids?hotelId=eq.${hotelId}${roomFilter}` +
      `&status=in.(ACCEPTED,COUNTER,PENDING)&select=id,roomId,hotelId,status,amount,message,customerId`;
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

      for (const b of bids) {
        const req = reqMap[b.requestId] || {};
        const ci = req.checkIn ? toISODate(req.checkIn) : undefined;
        const co = req.checkOut ? toISODate(req.checkOut) : undefined;
        if (!ci || !co) continue;
        if (!rangesOverlap(ci, co, from, to)) continue;
        // Only ACCEPTED is a HARD block. COUNTER/PENDING are "soft" — still show for partner, but treat as soft
        if (b.status === "ACCEPTED" || b.status === "COUNTER") {
          out.push({
            fromDate: ci, toDate: co,
            source: "bid", roomId: b.roomId, hotelId: b.hotelId,
            amount: Number(b.amount) || 0,
            note: b.status === "COUNTER" ? "Counter pending" : "Bid booked",
            refId: b.id,
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
