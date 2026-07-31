// Admin hotel commission rules CRUD.
//
// GET    → list all hotels + their active rule (or global default) merged
// POST   → create override (deactivates any existing for the same hotel)
// PATCH  → update override by id
// DELETE → soft-deactivate (active=false)
//
// Multi-level rule shape:
//   - flat:   { platform_pct: 7.5 }
//   - slabs:  { slabs: [{ minBookings: 1, maxBookings: 50, pct: 5 }, ...] }
//   At least one of platform_pct or slabs must be set.

import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/admin/verify";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";

export const dynamic = "force-dynamic";


const DEFAULT_PLATFORM_PCT = 5;

async function getGlobalDefault(): Promise<{ platform_pct: number; slabs: any[] | null }> {
  const rows = await fetch(
    `${SB_URL}/rest/v1/commission_rules?scope=eq.global&active=eq.true&select=slabs&limit=1`,
    { headers: SB_READ },
  ).then((r) => (r.ok ? r.json() : []));
  const slabs = Array.isArray(rows) && rows[0]?.slabs ? rows[0].slabs : null;
  // The original commission_rules table is creator-centric (slab.pct = creator
  // earn %). For platform commission, we look for a slab[0].platformPct field
  // if admins have set one; otherwise default to 5%.
  const firstPlatformPct =
    Array.isArray(slabs) && slabs[0]?.platformPct != null ? Number(slabs[0].platformPct) : DEFAULT_PLATFORM_PCT;
  return { platform_pct: firstPlatformPct, slabs };
}

export async function GET(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [hotels, rules, globalDef] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/hotels?select=id,name,city,ownerId&order=name.asc&limit=500`, { headers: SB_READ })
      .then((r) => (r.ok ? r.json() : [])),
    fetch(`${SB_URL}/rest/v1/hotel_commission_rules?select=*&active=eq.true&limit=500`, { headers: SB_READ })
      .then((r) => (r.ok ? r.json() : [])),
    getGlobalDefault(),
  ]);

  const rulesByHotel: Record<string, any> = {};
  for (const r of rules as any[]) if (r.hotel_id) rulesByHotel[r.hotel_id] = r;

  const merged = (hotels as any[]).map((h: any) => {
    const rule = rulesByHotel[h.id];
    if (rule) {
      return { hotel: h, rule, source: "hotel-override" };
    }
    return {
      hotel: h,
      rule: { platform_pct: globalDef.platform_pct, slabs: null, notes: "Platform default" },
      source: "platform-default",
    };
  });

  return NextResponse.json({ hotels: merged, globalDefault: globalDef });
}

export async function POST(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const adminId = admin.id;

  const hotelId: string | undefined = body?.hotel_id || body?.hotelId;
  const platformPct = body?.platform_pct != null ? Number(body.platform_pct) : null;
  const slabs: any[] | null = Array.isArray(body?.slabs) ? body.slabs : null;
  if (!hotelId) return NextResponse.json({ error: "hotel_id required" }, { status: 400 });
  if (platformPct == null && !slabs) {
    return NextResponse.json({ error: "platform_pct or slabs required" }, { status: 400 });
  }
  if (platformPct != null && (platformPct < 0 || platformPct > 50)) {
    return NextResponse.json({ error: "platform_pct must be between 0 and 50" }, { status: 400 });
  }
  if (slabs) {
    for (const s of slabs) {
      if (s.minBookings == null || s.maxBookings == null || s.pct == null) {
        return NextResponse.json({ error: "Each slab needs minBookings, maxBookings, pct" }, { status: 400 });
      }
      if (s.maxBookings < s.minBookings) {
        return NextResponse.json({ error: "Slab max < min" }, { status: 400 });
      }
      if (s.pct < 0 || s.pct > 50) {
        return NextResponse.json({ error: "Slab pct must be between 0 and 50" }, { status: 400 });
      }
    }
  }

  // Deactivate any existing active rule for this hotel first (unique partial index would reject duplicates)
  await fetch(
    `${SB_URL}/rest/v1/hotel_commission_rules?hotel_id=eq.${encodeURIComponent(hotelId)}&active=eq.true`,
    {
      method: "PATCH",
      headers: SB_H,
      body: JSON.stringify({ active: false, updated_at: new Date().toISOString() }),
    },
  ).catch(() => {});

  const ins = await fetch(`${SB_URL}/rest/v1/hotel_commission_rules`, {
    method: "POST",
    headers: { ...SB_H, Prefer: "return=representation" },
    body: JSON.stringify({
      hotel_id: hotelId,
      platform_pct: platformPct,
      slabs,
      notes: body?.notes || null,
      active: true,
      updated_by: adminId,
    }),
  });
  if (!ins.ok) {
    const txt = await ins.text().catch(() => "");
    return NextResponse.json({ error: "Failed to save rule", details: txt }, { status: 500 });
  }
  const arr = await ins.json().catch(() => null);
  return NextResponse.json({ ok: true, rule: Array.isArray(arr) ? arr[0] : arr });
}

export async function DELETE(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const upd = await fetch(`${SB_URL}/rest/v1/hotel_commission_rules?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: SB_H,
    body: JSON.stringify({ active: false, updated_at: new Date().toISOString() }),
  });
  if (!upd.ok) return NextResponse.json({ error: "Failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
