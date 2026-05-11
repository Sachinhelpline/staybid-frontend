// Admin Hold-payment config — GET defaults + per-hotel overrides; PATCH
// to update either the global defaults row (hotel_id="_global_defaults")
// or any specific hotel row.
//
// Schema (hotel_hold_config):
//   hotel_id              TEXT PK   "_global_defaults" or real hotel id
//   hold_enabled          BOOL
//   pay_at_hotel_enabled  BOOL
//   tier_overrides        JSONB     [{upTo, amount}, ...]
//   acceptance_window_min INT       15 by default

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";

const GLOBAL = "_global_defaults";

async function sbGet(path: string) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_READ });
  if (!r.ok) return [];
  return r.json();
}

// GET ?hotelId=... → single row (or null)
// GET (no params)  → all rows joined with hotels.name (for the admin list page)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const hotelId = searchParams.get("hotelId");

  try {
    if (hotelId) {
      // Single-hotel config (booking flow reads this)
      const rows = (await sbGet(`hotel_hold_config?hotel_id=eq.${encodeURIComponent(hotelId)}`)) as any[];
      const globalRows = (await sbGet(`hotel_hold_config?hotel_id=eq.${GLOBAL}`)) as any[];
      const config = rows[0] || null;
      const defaults = globalRows[0] || null;
      // Resolved config = override falling back to defaults field-by-field
      const resolved = {
        hold_enabled:          config?.hold_enabled          ?? defaults?.hold_enabled          ?? true,
        pay_at_hotel_enabled:  config?.pay_at_hotel_enabled  ?? defaults?.pay_at_hotel_enabled  ?? true,
        tier_overrides:        config?.tier_overrides        ?? defaults?.tier_overrides        ?? null,
        acceptance_window_min: config?.acceptance_window_min ?? defaults?.acceptance_window_min ?? 15,
      };
      return NextResponse.json({ config, defaults, resolved });
    }

    // List view — all config rows + matching hotel names
    const configs = (await sbGet(`hotel_hold_config?order=updated_at.desc&limit=500`)) as any[];
    const ids = configs
      .filter((c: any) => c.hotel_id !== GLOBAL)
      .map((c: any) => c.hotel_id);
    let hotels: any[] = [];
    if (ids.length) {
      const inList = ids.map((i) => `"${i}"`).join(",");
      hotels = (await sbGet(`hotels?id=in.(${encodeURIComponent(inList)})&select=id,name,city,starRating`)) as any[];
    }
    const byId: Record<string, any> = {};
    for (const h of hotels) byId[h.id] = h;
    const enriched = configs.map((c: any) => ({
      ...c,
      hotel: c.hotel_id === GLOBAL ? null : byId[c.hotel_id] || null,
    }));
    return NextResponse.json({ configs: enriched });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST {hotelId, hold_enabled?, pay_at_hotel_enabled?, tier_overrides?, acceptance_window_min?}
// Upserts the row. Pass hotelId="_global_defaults" to edit platform defaults.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { hotelId, ...patch } = body || {};
    if (!hotelId || typeof hotelId !== "string") {
      return NextResponse.json({ error: "hotelId required" }, { status: 400 });
    }
    // Validate tier_overrides if present
    if (patch.tier_overrides !== undefined && patch.tier_overrides !== null) {
      if (!Array.isArray(patch.tier_overrides) || !patch.tier_overrides.every((t: any) =>
        typeof t?.upTo === "number" && typeof t?.amount === "number" && t.amount >= 0
      )) {
        return NextResponse.json({ error: "tier_overrides must be [{upTo, amount}, ...]" }, { status: 400 });
      }
    }

    const row = {
      hotel_id: hotelId,
      ...patch,
      updated_at: new Date().toISOString(),
    };

    // Upsert
    const r = await fetch(`${SB_URL}/rest/v1/hotel_hold_config`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(row),
    });
    const data = await r.json();
    if (!r.ok) return NextResponse.json({ error: data?.message || "Save failed", detail: data }, { status: 500 });
    return NextResponse.json({ ok: true, row: data?.[0] || data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE ?hotelId=... — removes the override row (config falls back to global)
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hotelId = searchParams.get("hotelId");
    if (!hotelId) return NextResponse.json({ error: "hotelId required" }, { status: 400 });
    if (hotelId === GLOBAL) return NextResponse.json({ error: "Cannot delete the global defaults row" }, { status: 400 });
    const r = await fetch(`${SB_URL}/rest/v1/hotel_hold_config?hotel_id=eq.${encodeURIComponent(hotelId)}`, {
      method: "DELETE",
      headers: SB_H,
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      return NextResponse.json({ error: d?.message || "Delete failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
