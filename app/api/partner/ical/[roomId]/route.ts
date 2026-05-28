// v170 — StayBid → OTA calendar export (partner panel, Phase 3).
//
// Returns a standard iCal (.ics) feed of a room's booked dates. The hotel
// owner pastes this URL into Booking.com / Airbnb / MakeMyTrip extranet,
// which then blocks those dates automatically — genuine 2-way calendar
// sync, fully self-serve, no OTA partnership required.
//
// Public + token-gated (Booking.com's servers fetch it, no JWT). Only
// dates are exposed — no guest PII.
//
import { NextRequest, NextResponse } from "next/server";
import { sbSelect } from "@/lib/sb-server";
import { icalToken } from "@/lib/partner/ical-token";

export const dynamic = "force-dynamic";

function icsDate(d: any): string {
  // date-only value (YYYYMMDD) — what Booking.com / Airbnb expect
  const s = String(d || "").slice(0, 10).replace(/-/g, "");
  return s.length === 8 ? s : "";
}
function esc(s: any) {
  return String(s ?? "").replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
}

export async function GET(req: NextRequest, props: { params: Promise<{ roomId: string }> }) {
  const params = await props.params;
  const roomId = params.roomId;
  const k = new URL(req.url).searchParams.get("k") || "";
  if (!roomId || k !== icalToken(roomId)) {
    return new NextResponse("Invalid feed token", { status: 403 });
  }

  const events: { uid: string; start: string; end: string; summary: string }[] = [];

  // 1) Confirmed bids for this room → dates from bid_requests
  try {
    const bids = await sbSelect(
      `bids?roomId=eq.${encodeURIComponent(roomId)}&status=in.(ACCEPTED,CHECKED_IN,CHECKED_OUT)&select=id,requestId,checkIn,checkOut`
    );
    const reqIds = Array.from(new Set((bids || []).map((b: any) => b.requestId).filter(Boolean)));
    let reqs: any[] = [];
    if (reqIds.length) {
      reqs = await sbSelect(`bid_requests?id=in.(${reqIds.join(",")})&select=id,checkIn,checkOut`).catch(() => []);
    }
    for (const b of bids || []) {
      const rq = reqs.find((x: any) => x.id === b.requestId);
      const ci = icsDate(rq?.checkIn || b.checkIn);
      const co = icsDate(rq?.checkOut || b.checkOut);
      if (ci && co) events.push({ uid: `bid-${b.id}@staybid`, start: ci, end: co, summary: "Booked · StayBid" });
    }
  } catch { /* ignore */ }

  // 2) Walk-in / reservation / manual blocks for this room
  try {
    const blocks = await sbSelect(
      `room_blocks?roomId=eq.${encodeURIComponent(roomId)}&select=id,fromDate,toDate,source`
    );
    for (const bl of blocks || []) {
      const ci = icsDate(bl.fromDate);
      const co = icsDate(bl.toDate);
      if (ci && co) {
        const label = bl.source === "manual" ? "Blocked · StayBid" : "Booked · StayBid";
        events.push({ uid: `blk-${bl.id}@staybid`, start: ci, end: co, summary: label });
      }
    }
  } catch { /* ignore */ }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//StayBid//Channel Manager//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:StayBid Room ${esc(roomId)}`,
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${e.start}`,
      `DTEND;VALUE=DATE:${e.end}`,
      `SUMMARY:${esc(e.summary)}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");

  return new NextResponse(lines.join("\r\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="staybid-${roomId}.ics"`,
      "Cache-Control": "public, max-age=300",
    },
  });
}
