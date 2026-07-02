// v283 Gap 3 — Admin CRUD for workforce_workers (catalog + onboarding review).
// Approve / reject / suspend applications, edit, add, remove.
//
//   GET    → all workers (incl. pending/rejected — the admin view).
//   POST   → create.
//   PATCH  body { id, patch:{...} }  → update (whitelisted; incl. status).
//   DELETE ?id=<id>                  → hard delete.
//
// Auth: x-admin-token / x-admin-id (adminFromReq). Mutations audit-logged.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";
import { adminFromReq, logAdminAction } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";
const REST = `${SB_URL}/rest/v1`;

const str = (v: any, n = 1000) => (v == null ? null : String(v).slice(0, n));
const num = (v: any) => { if (v === "" || v == null) return null; const x = Number(v); return Number.isFinite(x) && x >= 0 ? x : null; };
const int = (v: any) => { const n = num(v); return n == null ? null : Math.round(n); };
const bool = (v: any) => v === true || v === "true" || v === 1 || v === "1";
const arr = (v: any) => (Array.isArray(v) ? v.slice(0, 12).map((s) => String(s).slice(0, 30)) : []);
const STATUSES = new Set(["pending", "approved", "rejected", "suspended"]);

function workerFields(body: any, partial = false) {
  const all: Record<string, any> = {
    name: str(body.name, 120),
    phone: body.phone == null ? null : String(body.phone).replace(/[^\d+]/g, "").slice(0, 20),
    email: str(body.email, 160),
    skill: str(body.skill, 40) || "other",
    city: str(body.city, 80),
    locality: str(body.locality, 120),
    rate: num(body.rate),
    rate_unit: ["job", "hour", "day", "month"].includes(String(body.rate_unit)) ? String(body.rate_unit) : "job",
    rating: num(body.rating),
    jobs_done: int(body.jobs_done) ?? 0,
    verified: bool(body.verified),
    background_checked: bool(body.background_checked),
    available: bool(body.available),
    avatar_url: str(body.avatar_url, 600),
    bio: str(body.bio, 1000),
    languages: arr(body.languages),
    active: bool(body.active),
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
    const r = await fetch(`${REST}/workforce_workers?select=*&order=created_at.desc&limit=500`, { headers: SB_READ, cache: "no-store" });
    const workers = r.ok ? await r.json() : [];
    return NextResponse.json({ workers });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to load workers" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch {}
  const row = workerFields(body);
  if (!row.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!row.status) row.status = "approved"; // admin-created workers are live by default
  try {
    const r = await fetch(`${REST}/workforce_workers`, {
      method: "POST", headers: { ...SB_H, Prefer: "return=representation" }, body: JSON.stringify(row),
    });
    if (!r.ok) { const t = await r.text(); return NextResponse.json({ error: "Create failed", detail: t.slice(0, 200) }, { status: 502 }); }
    const created = (await r.json())?.[0] || null;
    logAdminAction({ admin, action: "host_worker_create", targetType: "workforce_worker", targetId: created?.id || row.name } as any);
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
  const patch = workerFields(patchSrc, true);
  delete (patch as any).id;
  if (!Object.keys(patch).length) return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  patch.updated_at = new Date().toISOString();
  try {
    const r = await fetch(`${REST}/workforce_workers?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH", headers: { ...SB_H, Prefer: "return=representation" }, body: JSON.stringify(patch),
    });
    if (!r.ok) { const t = await r.text(); return NextResponse.json({ error: "Update failed", detail: t.slice(0, 200) }, { status: 502 }); }
    const row = (await r.json())?.[0] || null;
    logAdminAction({ admin, action: "host_worker_update", targetType: "workforce_worker", targetId: id } as any);
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
    const r = await fetch(`${REST}/workforce_workers?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: SB_H });
    if (!r.ok) { const t = await r.text(); return NextResponse.json({ error: "Delete failed", detail: t.slice(0, 200) }, { status: 502 }); }
    logAdminAction({ admin, action: "host_worker_delete", targetType: "workforce_worker", targetId: id } as any);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Delete failed" }, { status: 500 });
  }
}
