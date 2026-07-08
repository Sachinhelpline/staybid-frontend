// v282 — Gap 1: Admin CRUD for the Smart Property Discovery catalog
// (discovery_properties). Complements the v281 review queue (/api/admin/host
// PATCH status) — this route adds create / edit / delete of listings directly.
//
//   GET    /api/admin/host/listings          → all rows (admin editor view).
//   POST   body { ...fields }                → create (source=admin, status=available).
//   PATCH  body { id, patch:{...} }          → update (whitelisted fields).
//   DELETE ?id=<id>                          → hard delete.
//
// Auth: x-admin-token / x-admin-id (adminFromReq). Every mutation audit-logged.
// NOTE: discovery_properties has NO updated_at column — never stamp one.
//
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";
import { adminFromReq, logAdminAction } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";

const REST = `${SB_URL}/rest/v1`;

const str = (v: any) => (v == null ? null : String(v).slice(0, 4000));
const num = (v: any) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const flt = (v: any) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const bool = (v: any) => v === true || v === "true" || v === 1 || v === "1";
const arr = (v: any) => (Array.isArray(v) ? v.slice(0, 40) : []);
const cleanArr = (v: any, cap = 40) =>
  Array.isArray(v) ? v.map((x) => String(x).slice(0, 120)).filter(Boolean).slice(0, cap) : [];
const clampInt = (v: any, lo: number, hi: number, dflt: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const numPos = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const STATUSES = new Set(["pending_review", "available", "shortlisted", "rented", "rejected", "inactive"]);

// v307 — per-category hospitality room builder, mirroring the customer
// submission route (app/api/host/list-property). Shape read by the
// admin review UI + the Phase 4 approval→provision step.
function normalizeRooms(input: any) {
  const roomsIn = Array.isArray(input) ? input.slice(0, 12) : [];
  return roomsIn
    .map((r: any) => ({
      category: String(r?.category || "").trim().slice(0, 40) || "standard",
      name: String(r?.name || "").trim().slice(0, 80) || "Room",
      count: clampInt(r?.count, 1, 500, 1),
      price: numPos(r?.price),
      capacity: clampInt(r?.capacity, 1, 30, 2),
      amenities: cleanArr(r?.amenities, 40),
      images: cleanArr(r?.images, 6),
    }))
    .filter((r: any) => r.category);
}

// v307 — hospitality detail bag: meal plans / add-ons / policies /
// description / star rating all live in the `details` jsonb column.
function normalizeDetails(d: any) {
  if (!d || typeof d !== "object") return null;
  const out: Record<string, any> = {};
  const keepStr = (k: string, cap = 200) => {
    const s = String(d[k] ?? "").trim().slice(0, cap);
    if (s) out[k] = s;
  };
  keepStr("description", 1000);
  keepStr("checkIn", 10);
  keepStr("checkOut", 10);
  keepStr("houseRules", 800);
  keepStr("landmarks", 400);
  const sr = Number(d?.starRating);
  if (Number.isFinite(sr) && sr >= 1 && sr <= 5) out.starRating = Math.round(sr);
  const mp = cleanArr(d?.mealPlans, 12);
  if (mp.length) out.mealPlans = mp;
  const ad = cleanArr(d?.addonServices, 24);
  if (ad.length) out.addonServices = ad;
  return Object.keys(out).length ? out : null;
}

function listingFields(body: any, partial = false) {
  const all: Record<string, any> = {
    title: str(body.title),
    city: str(body.city),
    locality: str(body.locality),
    state: str(body.state),
    property_type: str(body.property_type),
    // Legacy residential columns kept for backward compat (nullable).
    bhk: str(body.bhk),
    area_sqft: num(body.area_sqft),
    furnishing: str(body.furnishing),
    rent_monthly: num(body.rent_monthly),
    deposit: num(body.deposit),
    score: num(body.score),
    images: arr(body.images),
    amenities: arr(body.amenities), // property-level amenities
    // v307 — hospitality additions
    rooms: normalizeRooms(body.rooms),
    details: normalizeDetails(body.details),
    formatted_address: str(body.formatted_address),
    lat: flt(body.lat),
    lng: flt(body.lng),
    featured: bool(body.featured),
    status: STATUSES.has(String(body.status)) ? String(body.status) : undefined,
  };
  if (all.status === undefined) delete all.status;
  if (!partial) return all;
  const out: Record<string, any> = {};
  for (const k of Object.keys(all)) if (k in body) out[k] = all[k];
  return out;
}

export async function GET(req: NextRequest) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const r = await fetch(`${REST}/discovery_properties?select=*&order=created_at.desc&limit=500`, {
      headers: SB_READ, cache: "no-store",
    });
    const rows = r.ok ? await r.json() : [];
    return NextResponse.json({ listings: rows });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to load listings" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const row = listingFields(body);
  if (!row.title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  // Admin-created listings are StayBid-curated (not owner submissions). The
  // source CHECK allows owner|broker|agent|platform — use 'platform' for
  // admin/curated. Default to a live status unless the admin picked one.
  row.source = "platform";
  if (!row.status) row.status = "available";

  try {
    const r = await fetch(`${REST}/discovery_properties`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: "Create failed", detail: t.slice(0, 200) }, { status: 502 });
    }
    const created = (await r.json())?.[0] || null;
    logAdminAction({ admin, action: "host_listing_create", targetType: "discovery_property", targetId: created?.id || row.title } as any);
    return NextResponse.json({ ok: true, row: created });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Create failed" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const id = String(body.id || "");
  const patchSrc = body.patch && typeof body.patch === "object" ? body.patch : body;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const patch = listingFields(patchSrc, true);
  delete (patch as any).id;
  if (!Object.keys(patch).length) return NextResponse.json({ error: "no fields to update" }, { status: 400 });

  try {
    const r = await fetch(`${REST}/discovery_properties?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: "Update failed", detail: t.slice(0, 200) }, { status: 502 });
    }
    const row = (await r.json())?.[0] || null;
    logAdminAction({ admin, action: "host_listing_update", targetType: "discovery_property", targetId: id } as any);
    return NextResponse.json({ ok: true, row });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = String(url.searchParams.get("id") || "");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    const r = await fetch(`${REST}/discovery_properties?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: SB_H });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: "Delete failed", detail: t.slice(0, 200) }, { status: 502 });
    }
    logAdminAction({ admin, action: "host_listing_delete", targetType: "discovery_property", targetId: id } as any);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Delete failed" }, { status: 500 });
  }
}
