import { NextResponse } from "next/server";
import { SB_URL, SB_H } from "@/lib/sb";
import { adminFromReq, logAdminAction } from "@/lib/admin/audit";
import { sbCacheInvalidate } from "@/lib/sb-cache";
import { mergeRevenueConfig } from "@/lib/circle/engine";
import {
  resolveRevenueConfig,
  invalidateRevenueConfigCache,
  CIRCLE_REVENUE_CONFIG_ID,
} from "@/lib/circle/revenue-config-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/admin/circle — StayCircle admin oversight + catalog CRUD.
//
// GET    → everything the /admin/circle page needs in one round-trip:
//          properties (+room types), locks, bundles, payouts, KPIs.
//          Users joined via manual side-load (NO PostgREST FK embed — no FK
//          exists in this schema; see /api/admin/creators precedent).
// POST   → { entity: "property" | "room_type" | "payout", data }
// PATCH  → { entity, id, data }   (partial update; property/room_type only,
//          plus bundle status cancel/complete — NEVER 'active', that flip is
//          owned by /api/circle/verify's payment chain)
// DELETE → ?entity=property|room_type&id=
//
// Every mutation audit-logged via logAdminAction (v98 infra).

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

const PROPERTY_FIELDS = new Set([
  "title", "city", "state", "location_label", "tagline", "description",
  "images", "video_url", "rooms_label", "view_label", "monthly_rate",
  "roi_min_pct", "roi_max_pct", "occupancy_label", "badges", "hotel_id",
  "operation_model", "status", "sort_order",
  // v311 — hospitality richness (matches the host onboarding form)
  "property_type", "star_rating", "amenities",
]);
const ROOM_TYPE_FIELDS = new Set([
  "property_id", "name", "monthly_rate", "total_units", "locked_units",
  "active", "sort_order",
]);
const PAYOUT_FIELDS = new Set(["bundle_id", "user_id", "month_label", "amount", "note", "status"]);

function pickFields(data: any, allowed: Set<string>): Record<string, any> {
  const out: Record<string, any> = {};
  if (!data || typeof data !== "object") return out;
  Object.keys(data).forEach((k) => {
    if (allowed.has(k)) out[k] = data[k];
  });
  return out;
}

async function attachUsers(rows: any[], key: string): Promise<any[]> {
  const ids: string[] = [];
  rows.forEach((r) => {
    const id = String(r?.[key] || "");
    if (id && !ids.includes(id)) ids.push(id);
  });
  if (!ids.length) return rows;
  try {
    const ur = await fetch(
      `${SB_URL}/rest/v1/users?id=in.(${ids.map((i) => `"${i}"`).join(",")})&select=id,name,phone,email`,
      { headers: SB_H },
    );
    const users = ur.ok ? await ur.json() : [];
    const byId = Object.fromEntries(users.map((u: any) => [String(u.id), u]));
    return rows.map((r) => ({ ...r, user: byId[String(r?.[key])] || null }));
  } catch {
    return rows;
  }
}

export async function GET(req: Request) {
  const admin = adminFromReq(req);
  if (!admin) return unauthorized();

  try {
    const [propsR, rtR, locksR, bundlesR, payoutsR, unitsR] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/circle_properties?select=*&order=sort_order.asc&limit=300`, { headers: SB_H }),
      fetch(`${SB_URL}/rest/v1/circle_room_types?select=*&order=sort_order.asc&limit=1000`, { headers: SB_H }),
      fetch(`${SB_URL}/rest/v1/circle_locks?select=*&order=created_at.desc&limit=300`, { headers: SB_H }),
      fetch(`${SB_URL}/rest/v1/circle_bundles?select=*&order=created_at.desc&limit=300`, { headers: SB_H }),
      fetch(`${SB_URL}/rest/v1/circle_payouts?select=*&order=created_at.desc&limit=300`, { headers: SB_H }),
      // Phase 3d — investor-owned physical units (the customer-facing individual
      // listings). owner_user_id NOT NULL = provisioned to a StayCircle investor.
      fetch(`${SB_URL}/rest/v1/hotel_room_units?owner_user_id=not.is.null&status=eq.active&select=id,hotelId,roomId,roomNumber,owner_user_id,circle_bundle_id,price_override,mrp_override,title,is_listed,view_label&order=hotelId.asc,roomNumber.asc&limit=1000`, { headers: SB_H }),
    ]);
    const properties = propsR.ok ? await propsR.json() : [];
    const roomTypes = rtR.ok ? await rtR.json() : [];
    let locks = locksR.ok ? await locksR.json() : [];
    let bundles = bundlesR.ok ? await bundlesR.json() : [];
    const payouts = payoutsR.ok ? await payoutsR.json() : [];
    let ownedUnits = unitsR.ok ? await unitsR.json() : [];

    locks = await attachUsers(Array.isArray(locks) ? locks : [], "user_id");
    bundles = await attachUsers(Array.isArray(bundles) ? bundles : [], "user_id");
    ownedUnits = await attachUsers(Array.isArray(ownedUnits) ? ownedUnits : [], "owner_user_id");
    // Side-load hotel names for the owned units (no FK embed — manual join).
    try {
      const hIds = Array.from(new Set(ownedUnits.map((u: any) => String(u.hotelId)).filter(Boolean)));
      if (hIds.length) {
        const hr = await fetch(
          `${SB_URL}/rest/v1/hotels?id=in.(${hIds.map((i) => `"${i}"`).join(",")})&select=id,name,city`,
          { headers: SB_H },
        );
        const hotels = hr.ok ? await hr.json() : [];
        const byId = Object.fromEntries((Array.isArray(hotels) ? hotels : []).map((h: any) => [String(h.id), h]));
        ownedUnits = ownedUnits.map((u: any) => ({ ...u, hotel: byId[String(u.hotelId)] || null }));
      }
    } catch { /* best-effort */ }

    const revenueConfig = await resolveRevenueConfig();

    const activeBundles = bundles.filter((b: any) => b.status === "active");
    const kpis = {
      properties: (Array.isArray(properties) ? properties : []).length,
      activeProperties: (Array.isArray(properties) ? properties : []).filter((p: any) => p.status === "active").length,
      locks: locks.filter((l: any) => l.status === "locked").length,
      bundles: bundles.length,
      activeBundles: activeBundles.length,
      monthlyGmv: activeBundles.reduce((s: number, b: any) => s + (Number(b.monthly_total) || 0), 0),
      collected: bundles
        .filter((b: any) => b.status === "active" || b.status === "completed")
        .reduce((s: number, b: any) => s + (Number(b.pay_now) || 0), 0),
      paidOut: (Array.isArray(payouts) ? payouts : [])
        .filter((p: any) => p.status === "paid")
        .reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0),
    };

    return NextResponse.json({ properties, roomTypes, locks, bundles, payouts, ownedUnits, kpis, revenueConfig });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const admin = adminFromReq(req);
  if (!admin) return unauthorized();

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const entity = String(body?.entity || "");

  const table =
    entity === "property" ? "circle_properties" :
    entity === "room_type" ? "circle_room_types" :
    entity === "payout" ? "circle_payouts" : null;
  if (!table) return NextResponse.json({ error: "Unknown entity" }, { status: 400 });

  const fields =
    entity === "property" ? PROPERTY_FIELDS :
    entity === "room_type" ? ROOM_TYPE_FIELDS : PAYOUT_FIELDS;
  const data = pickFields(body?.data, fields);
  if (!Object.keys(data).length) return NextResponse.json({ error: "No fields" }, { status: 400 });

  try {
    const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify(data),
    });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: "Insert failed", detail: t.slice(0, 200) }, { status: 502 });
    }
    const [row] = await r.json();
    logAdminAction({ admin, action: `circle.${entity}.create`, targetType: entity, targetId: row?.id, details: data });
    try { sbCacheInvalidate("circle:"); } catch { /* best-effort */ }
    return NextResponse.json({ ok: true, row });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }
}

export async function PATCH(req: Request) {
  const admin = adminFromReq(req);
  if (!admin) return unauthorized();

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const entity = String(body?.entity || "");

  // Honest revenue levers (v294.13) — singleton config, no per-row id. Merge +
  // clamp the posted numbers (mergeRevenueConfig) then upsert the 'default'
  // row. DISPLAY-ONLY; the checkout charge is untouched.
  if (entity === "revenue_config") {
    const cfg = mergeRevenueConfig(body?.data);
    try {
      const r = await fetch(
        `${SB_URL}/rest/v1/circle_revenue_config?id=eq.${CIRCLE_REVENUE_CONFIG_ID}`,
        {
          method: "PATCH",
          headers: { ...SB_H, Prefer: "return=representation" },
          body: JSON.stringify({ config: cfg, updated_at: new Date().toISOString(), updated_by: admin.id || admin.phone || "admin" }),
        },
      );
      if (!r.ok) {
        const t = await r.text();
        return NextResponse.json({ error: "Save failed", detail: t.slice(0, 200) }, { status: 502 });
      }
      invalidateRevenueConfigCache();
      logAdminAction({ admin, action: "circle.revenue_config.update", targetType: "revenue_config", targetId: CIRCLE_REVENUE_CONFIG_ID, details: cfg });
      return NextResponse.json({ ok: true, revenueConfig: cfg });
    } catch (e: any) {
      return NextResponse.json({ error: String(e?.message || e).slice(0, 160) }, { status: 502 });
    }
  }

  const id = String(body?.id || "").trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  let table: string | null = null;
  let data: Record<string, any> = {};

  if (entity === "property") {
    table = "circle_properties";
    data = pickFields(body?.data, PROPERTY_FIELDS);
    data.updated_at = new Date().toISOString();
  } else if (entity === "room_type") {
    table = "circle_room_types";
    data = pickFields(body?.data, ROOM_TYPE_FIELDS);
  } else if (entity === "payout") {
    table = "circle_payouts";
    data = pickFields(body?.data, PAYOUT_FIELDS);
  } else if (entity === "bundle") {
    // Admin may cancel/complete a bundle — NEVER flip it 'active' (that
    // transition is exclusively owned by the /api/circle/verify HMAC chain).
    table = "circle_bundles";
    const status = String(body?.data?.status || "");
    if (!["cancelled", "completed"].includes(status)) {
      return NextResponse.json({ error: "Bundle status can only be set to cancelled/completed here." }, { status: 400 });
    }
    data = { status, updated_at: new Date().toISOString() };
  } else {
    return NextResponse.json({ error: "Unknown entity" }, { status: 400 });
  }

  if (!Object.keys(data).length) return NextResponse.json({ error: "No fields" }, { status: 400 });

  try {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify(data),
    });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: "Update failed", detail: t.slice(0, 200) }, { status: 502 });
    }
    const [row] = await r.json();
    logAdminAction({ admin, action: `circle.${entity}.update`, targetType: entity, targetId: id, details: data });
    try { sbCacheInvalidate("circle:"); } catch { /* best-effort */ }
    return NextResponse.json({ ok: true, row });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const admin = adminFromReq(req);
  if (!admin) return unauthorized();

  const url = new URL(req.url);
  const entity = String(url.searchParams.get("entity") || "");
  const id = String(url.searchParams.get("id") || "").trim();
  const table =
    entity === "property" ? "circle_properties" :
    entity === "room_type" ? "circle_room_types" : null;
  if (!table || !id) return NextResponse.json({ error: "entity + id required" }, { status: 400 });

  try {
    if (entity === "property") {
      // Also remove the property's room types (no FK cascade in this schema).
      await fetch(`${SB_URL}/rest/v1/circle_room_types?property_id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: SB_H,
      });
    }
    const r = await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: SB_H,
    });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: "Delete failed", detail: t.slice(0, 200) }, { status: 502 });
    }
    logAdminAction({ admin, action: `circle.${entity}.delete`, targetType: entity, targetId: id });
    try { sbCacheInvalidate("circle:"); } catch { /* best-effort */ }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }
}
