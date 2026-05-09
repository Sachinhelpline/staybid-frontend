import { NextRequest, NextResponse } from "next/server";

const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

async function sb(path: string) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_H });
    const t = await r.text();
    const j = JSON.parse(t);
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

export async function GET(req: NextRequest) {
  const city = req.nextUrl.searchParams.get("city") || "";

  // ⚠️ Bug fix (May 2026): the previous implementation filtered deals on
  // the SERVER with `validUntil=gt.${nowIso}`. Two problems:
  //   1. `flash_deals.validUntil` is a TEXT column (per CLAUDE.md), and
  //      PostgREST `gt` against TEXT does string comparison — fine for
  //      strict ISO 8601 strings, but anything stored without the "T" or
  //      "Z" delimiter (e.g., "2026-05-04 12:00:00") fails sort and the
  //      whole row drops out.
  //   2. Older deals saved with relative timestamps drop out instantly.
  // Net result: the entire flash-deals section showed empty.
  //
  // New approach — fetch every active deal, filter expiry CLIENT-SIDE
  // with permissive Date parsing. If we can't parse validUntil, we keep
  // the deal (better to show a stale deal than to hide everything).
  let filter = `select=*&isActive=eq.true`;
  if (city) filter += `&city=ilike.${encodeURIComponent(city)}`;

  const [dealsRaw, hotels, rooms] = await Promise.all([
    sb(`flash_deals?${filter}`),
    sb(`hotels?select=*`),
    sb(`rooms?select=*`),
  ]);

  const now = Date.now();
  const deals = dealsRaw.filter((d: any) => {
    if (!d?.validUntil) return true;                  // no expiry recorded → keep
    const t = new Date(String(d.validUntil)).getTime();
    if (!Number.isFinite(t)) return true;             // un-parsable → keep (safer than hiding)
    return t > now;                                   // future → keep
  });

  const dealsEnriched = deals.map((d: any) => ({
    ...d,
    hotel: hotels.find((h: any) => h.id === d.hotelId) || null,
    room:  rooms.find((r: any) => r.id === d.roomId)  || null,
  }));

  return NextResponse.json({ deals: dealsEnriched });
}
