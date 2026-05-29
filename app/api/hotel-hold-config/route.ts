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
      // v241.23 — default bumped 15 → 30 to match the codebase-wide
      // ACCEPTED_UNPAID_WINDOW_MIN (lib/bid-expiry). Existing hotel
      // rows with explicit acceptance_window_min still win (admin
      // override). New hotels + hotels without an explicit override
      // now inherit 30 from this fallback.
      // v241.25 — Clamp to MINIMUM 30. The previous default of 15 was
      // stored on many existing hotel rows BEFORE this bump. Treating
      // those rows as legacy and clamping to 30 retroactively gives
      // every hotel the new floor without an admin backfill pass.
      // Admins can still EXPLICITLY override to anything ≥ 30 (e.g.
      // 60-min window for luxury hotels). Values < 30 are silently
      // upgraded — by design, since 15 was the platform default not a
      // hotel-specific choice.
      acceptance_window_min: Math.max(30, Number(config?.acceptance_window_min ?? defaults?.acceptance_window_min ?? 30)),
    };
    return new NextResponse(JSON.stringify({ resolved }), {
      headers: {
        "Content-Type": "application/json",
        // Cache for 2 minutes — tier changes are rare
        // v241.25 — max-age tightened 120 → 30 so the v241.23/.25 default
        // bump propagates within ~30 sec instead of 2 min. swr lets
        // stale-but-acceptable values keep serving while a fresh fetch
        // runs in the background.
        "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
