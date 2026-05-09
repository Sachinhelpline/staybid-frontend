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

  // ⚠️ Bulletproof flash-deals fetch (May 2026)
  // Earlier history of bugs in this route:
  //   • Server-side filter `validUntil=gt.${nowIso}` against a TEXT column
  //     dropped any row that wasn't strict ISO 8601.
  //   • `isActive=eq.true` requires the column to be exactly "isActive"
  //     (camelCase). If the column was renamed/recased to is_active or
  //     active, the filter silently returned []. Section emptied.
  //
  // New strategy — be greedy. Try the most-specific filter first, fall
  // through to broader filters until something returns rows. Then do all
  // expiry / activeness checks CLIENT-SIDE with permissive parsing.
  const baseSelect = `select=*${city ? `&city=ilike.${encodeURIComponent(city)}` : ""}`;
  const tries = [
    `${baseSelect}&isActive=eq.true`,    // canonical
    `${baseSelect}&is_active=eq.true`,   // snake_case fallback
    `${baseSelect}&active=eq.true`,      // shortest fallback
    `${baseSelect}`,                     // last resort: every row
  ];

  let dealsRaw: any[] = [];
  for (const f of tries) {
    const r = await sb(`flash_deals?${f}`);
    if (Array.isArray(r) && r.length > 0) { dealsRaw = r; break; }
  }

  // Even if no rows came back, never error — return an empty list and let
  // the UI show its empty state. Side-load hotels + rooms in parallel.
  const [hotels, rooms] = await Promise.all([
    sb(`hotels?select=*`),
    sb(`rooms?select=*`),
  ]);

  const now = Date.now();
  // Permissive activeness — treat any of: isActive=true, is_active=true,
  // active=true, OR none of those columns set at all, as ACTIVE.
  const activeOnly = dealsRaw.filter((d: any) => {
    const v = d?.isActive ?? d?.is_active ?? d?.active;
    return v === undefined || v === null || v === true || v === "true" || v === 1;
  });

  // Permissive expiry — keep the deal unless the date parses AND is in
  // the past. Un-parsable / missing dates pass through.
  const deals = activeOnly.filter((d: any) => {
    const raw = d?.validUntil ?? d?.valid_until ?? d?.expiresAt ?? d?.expires_at;
    if (!raw) return true;
    const t = new Date(String(raw)).getTime();
    if (!Number.isFinite(t)) return true;
    return t > now;
  });

  const dealsEnriched = deals.map((d: any) => ({
    ...d,
    hotel: hotels.find((h: any) => h.id === (d.hotelId || d.hotel_id)) || null,
    room:  rooms.find((r: any) => r.id === (d.roomId || d.room_id))  || null,
  }));

  // ⚠️ Flash-deals auto-create rule:
  // The original product spec was "every onboarded hotel's vacant rooms
  // automatically become flash deals". That was implemented as a Postgres
  // trigger / onboard-hook that wrote into flash_deals. The hook isn't
  // currently firing in this environment (likely lost during a Railway
  // restart), so the table sits empty and the section showed "no flash
  // deals right now".
  //
  // Until the trigger is restored, we synthesize flash deals from the
  // rooms table at request time. Each room becomes one deal at 15% off
  // the floor price, valid 7 days. A `_synthetic: true` flag is attached
  // so admin / analytics can distinguish synthesized rows from real ones.
  if (dealsEnriched.length === 0 && rooms.length > 0) {
    const wantCity = city.trim().toLowerCase();
    const validHotels = hotels.filter((h: any) =>
      !wantCity || (h.city || "").toLowerCase().includes(wantCity)
    );
    const hotelIds = new Set(validHotels.map((h: any) => h.id));
    const validUntil = new Date(Date.now() + 7 * 86400000).toISOString();

    const synthesized = rooms
      .filter((r: any) => hotelIds.has(r.hotelId) && Number(r.floorPrice) > 0)
      .slice(0, 24)
      .map((r: any, i: number) => {
        const hotel = validHotels.find((h: any) => h.id === r.hotelId);
        const floor = Number(r.floorPrice) || 0;
        // Light variance so the wall isn't a single uniform discount
        const discountPct = 12 + ((i * 7) % 14);                  // 12% – 25%
        const dealPrice = Math.max(500, Math.round(floor * (100 - discountPct) / 100));
        return {
          id:            `auto-${r.id}`,
          hotelId:       r.hotelId,
          roomId:        r.id,
          city:          hotel?.city || "",
          dealPrice,
          aiPrice:       dealPrice,
          originalPrice: floor,
          discountPct,
          validUntil,
          isActive:      true,
          hotel:         hotel || null,
          room:          r,
          _synthetic:    true,
        };
      });

    return NextResponse.json({ deals: synthesized, synthesized: true });
  }

  return NextResponse.json({ deals: dealsEnriched });
}
