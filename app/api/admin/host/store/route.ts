// v282 — Gap 1: Admin CRUD for the StayBid Store catalog (products + categories).
//
//   GET    /api/admin/host/store  → { categories, products } (ALL rows incl.
//          inactive — this is the admin editor view, not the public catalog).
//   POST   body { entity:"product"|"category", ...fields } → create.
//   PATCH  body { entity, id, patch:{...} }               → update (whitelisted).
//   DELETE ?entity=product|category&id=<id>               → hard delete.
//
// Auth: requireVerifiedAdmin (signed admin JWT + server-side role lookup). Every mutation audit-logged.
// The customer-facing catalog (/api/host/store) only ever reads active+in_stock
// rows, so "remove" can be a soft PATCH active=false OR a hard DELETE here.
//
import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin, auditIdentity } from "@/lib/admin/verify";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";
import { logAdminAction } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";

const REST = `${SB_URL}/rest/v1`;

// ── field coercion helpers ────────────────────────────────────────────────
const str = (v: any) => (v == null ? null : String(v).slice(0, 2000));
const num = (v: any) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const int = (v: any) => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};
const bool = (v: any) => v === true || v === "true" || v === 1 || v === "1";
const arr = (v: any) => (Array.isArray(v) ? v.slice(0, 40) : []);
const obj = (v: any) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

// Whitelist + coerce a product payload. `partial` keeps only provided keys (for PATCH).
function productFields(body: any, partial = false) {
  const all: Record<string, any> = {
    category_id: str(body.category_id),
    name: str(body.name),
    brand: str(body.brand),
    description: str(body.description),
    specs: obj(body.specs),
    images: arr(body.images),
    buy_price: num(body.buy_price),
    rent_monthly: num(body.rent_monthly),
    emi_available: bool(body.emi_available),
    emi_min_months: int(body.emi_min_months),
    rating: num(body.rating),
    reviews_count: int(body.reviews_count) ?? 0,
    in_stock: bool(body.in_stock),
    featured: bool(body.featured),
    badges: arr(body.badges),
    active: bool(body.active),
  };
  if (!partial) return all;
  const out: Record<string, any> = {};
  for (const k of Object.keys(all)) if (k in body) out[k] = all[k];
  return out;
}

function categoryFields(body: any, partial = false) {
  const all: Record<string, any> = {
    name: str(body.name),
    slug: str(body.slug),
    icon: str(body.icon),
    kind: str(body.kind) || "furniture",
    sort_order: int(body.sort_order) ?? 0,
    active: bool(body.active),
  };
  if (!partial) return all;
  const out: Record<string, any> = {};
  for (const k of Object.keys(all)) if (k in body) out[k] = all[k];
  return out;
}

const TABLE: Record<string, string> = { product: "store_products", category: "store_categories" };

export async function GET(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const [catRes, prodRes] = await Promise.all([
      fetch(`${REST}/store_categories?select=*&order=sort_order.asc`, { headers: SB_READ, cache: "no-store" }),
      fetch(`${REST}/store_products?select=*&order=created_at.desc&limit=500`, { headers: SB_READ, cache: "no-store" }),
    ]);
    const categories = catRes.ok ? await catRes.json() : [];
    const products = prodRes.ok ? await prodRes.json() : [];
    return NextResponse.json({ categories, products });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to load store catalog" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const entity = String(body.entity || "product");
  const table = TABLE[entity];
  if (!table) return NextResponse.json({ error: "entity must be product|category" }, { status: 400 });

  const row = entity === "product" ? productFields(body) : categoryFields(body);
  if (!row.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  try {
    const r = await fetch(`${REST}/${table}`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: "Create failed", detail: t.slice(0, 200) }, { status: 502 });
    }
    const created = (await r.json())?.[0] || null;
    logAdminAction({ admin, action: "host_store_create", targetType: entity, targetId: created?.id || row.name } as any);
    return NextResponse.json({ ok: true, row: created });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Create failed" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const entity = String(body.entity || "product");
  const table = TABLE[entity];
  const id = String(body.id || "");
  const patchSrc = body.patch && typeof body.patch === "object" ? body.patch : body;
  if (!table) return NextResponse.json({ error: "entity must be product|category" }, { status: 400 });
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const patch = entity === "product" ? productFields(patchSrc, true) : categoryFields(patchSrc, true);
  delete (patch as any).id;
  if (!Object.keys(patch).length) return NextResponse.json({ error: "no fields to update" }, { status: 400 });

  try {
    const r = await fetch(`${REST}/${table}?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: "Update failed", detail: t.slice(0, 200) }, { status: 502 });
    }
    const row = (await r.json())?.[0] || null;
    logAdminAction({ admin, action: "host_store_update", targetType: entity, targetId: id } as any);
    return NextResponse.json({ ok: true, row });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const entity = String(url.searchParams.get("entity") || "product");
  const table = TABLE[entity];
  const id = String(url.searchParams.get("id") || "");
  if (!table) return NextResponse.json({ error: "entity must be product|category" }, { status: 400 });
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    const r = await fetch(`${REST}/${table}?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: SB_H });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: "Delete failed", detail: t.slice(0, 200) }, { status: 502 });
    }
    logAdminAction({ admin, action: "host_store_delete", targetType: entity, targetId: id } as any);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Delete failed" }, { status: 500 });
  }
}
