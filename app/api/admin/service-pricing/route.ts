// v177 — Admin: service subscription pricing (Phase 2).
//
//   GET   → all service prices + bundles
//   POST  { action }
//     price          { serviceKey, monthly, quarterly, yearly }  → upsert
//     bundle         { id?, name, serviceKeys[], monthly, quarterly, yearly }
//     delete_bundle  { id }
//
// Auth: x-admin-token / x-admin-id (adminFromReq).
//
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_H_REPRESENT, genId } from "@/lib/sb-server";
import { adminFromReq, logAdminAction } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";

const num = (v: any) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export async function GET(req: NextRequest) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const pRes = await fetch(`${SB_URL}/rest/v1/service_pricing?select=*`, { headers: SB_H });
    if (!pRes.ok) return NextResponse.json({ pricing: [], bundles: [], provisioned: false });
    const pricing = await pRes.json().catch(() => []);
    const bundles = await fetch(`${SB_URL}/rest/v1/service_bundles?select=*&order=updated_at.desc`, { headers: SB_H })
      .then((r) => r.json()).catch(() => []);
    return NextResponse.json({
      pricing: Array.isArray(pricing) ? pricing : [],
      bundles: Array.isArray(bundles) ? bundles : [],
      provisioned: true,
    });
  } catch {
    return NextResponse.json({ pricing: [], bundles: [], provisioned: false });
  }
}

export async function POST(req: NextRequest) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch {}
  const action = String(body.action || "");

  try {
    if (action === "price") {
      if (!body.serviceKey) return NextResponse.json({ error: "serviceKey required" }, { status: 400 });
      const row = {
        service_key: body.serviceKey,
        monthly: num(body.monthly), quarterly: num(body.quarterly), yearly: num(body.yearly),
        active: true, updated_at: new Date().toISOString(),
      };
      const r = await fetch(`${SB_URL}/rest/v1/service_pricing?on_conflict=service_key`, {
        method: "POST",
        headers: { ...SB_H_REPRESENT, Prefer: "return=representation,resolution=merge-duplicates" },
        body: JSON.stringify(row),
      });
      const txt = await r.text();
      if (!r.ok) {
        if (r.status === 404 || /does not exist/i.test(txt))
          return NextResponse.json({ error: "Pricing tables not provisioned yet. Apply migrations/2026-05-21-service-pricing.sql." }, { status: 412 });
        throw new Error(txt);
      }
      logAdminAction({ admin, action: "service_price_set", targetType: "service", targetId: body.serviceKey } as any);
      return NextResponse.json({ ok: true });
    }

    if (action === "bundle") {
      if (!String(body.name || "").trim()) return NextResponse.json({ error: "Bundle name required" }, { status: 400 });
      const keys = Array.isArray(body.serviceKeys) ? body.serviceKeys.filter((k: any) => typeof k === "string") : [];
      if (!keys.length) return NextResponse.json({ error: "Pick at least one service" }, { status: 400 });
      const row = {
        id: body.id || genId("bndl"),
        name: String(body.name).trim(),
        service_keys: keys,
        monthly: num(body.monthly), quarterly: num(body.quarterly), yearly: num(body.yearly),
        active: true, updated_at: new Date().toISOString(),
      };
      const r = await fetch(`${SB_URL}/rest/v1/service_bundles?on_conflict=id`, {
        method: "POST",
        headers: { ...SB_H_REPRESENT, Prefer: "return=representation,resolution=merge-duplicates" },
        body: JSON.stringify(row),
      });
      if (!r.ok) {
        const txt = await r.text();
        if (r.status === 404 || /does not exist/i.test(txt))
          return NextResponse.json({ error: "Pricing tables not provisioned yet." }, { status: 412 });
        throw new Error(txt);
      }
      logAdminAction({ admin, action: "service_bundle_set", targetType: "bundle", targetId: row.id } as any);
      return NextResponse.json({ ok: true, id: row.id });
    }

    if (action === "delete_bundle") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      await fetch(`${SB_URL}/rest/v1/service_bundles?id=eq.${encodeURIComponent(body.id)}`, { method: "DELETE", headers: SB_H });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Action failed" }, { status: 500 });
  }
}
