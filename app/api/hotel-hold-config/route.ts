// Public read of resolved hold config for a hotel — used by Booking
// Review flow so the customer sees the right hold/pay-at-hotel options.
// Caches via Cache-Control header to keep load light on the hotels page.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";

const GLOBAL = "_global_defaults";

async function sbGet(path: string) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_READ });
  if (!r.ok) return [];
  return r.json();
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const hotelId = searchParams.get("hotelId");
  if (!hotelId) return NextResponse.json({ error: "hotelId required" }, { status: 400 });

  try {
    const [rows, globalRows] = await Promise.all([
      sbGet(`hotel_hold_config?hotel_id=eq.${encodeURIComponent(hotelId)}`),
      sbGet(`hotel_hold_config?hotel_id=eq.${GLOBAL}`),
    ]);
    const config = (rows as any[])[0] || null;
    const defaults = (globalRows as any[])[0] || null;
    const resolved = {
      hold_enabled:          config?.hold_enabled          ?? defaults?.hold_enabled          ?? true,
      pay_at_hotel_enabled:  config?.pay_at_hotel_enabled  ?? defaults?.pay_at_hotel_enabled  ?? true,
      tier_overrides:        config?.tier_overrides        ?? defaults?.tier_overrides        ?? null,
      acceptance_window_min: config?.acceptance_window_min ?? defaults?.acceptance_window_min ?? 15,
    };
    return new NextResponse(JSON.stringify({ resolved }), {
      headers: {
        "Content-Type": "application/json",
        // Cache for 2 minutes — tier changes are rare
        "Cache-Control": "public, max-age=120, stale-while-revalidate=600",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
