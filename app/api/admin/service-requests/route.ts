// v176 — Admin: service access requests + entitlements (Phase 1).
//
//   GET   → pending/decided requests + current granted entitlements
//   POST  { action }
//     approve { id, days }  → grant the request's service (days=0 → permanent
//                             free; days>0 → free trial that long)
//     reject  { id }        → mark the request rejected
//     grant   { hotelId, serviceKey, days }  → directly grant a service
//     revoke  { hotelId, serviceKey }        → remove a granted service
//
// Auth: x-admin-token / x-admin-id (adminFromReq). Mutations audit-logged.
//
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_H_REPRESENT, sbSelect, genId } from "@/lib/sb-server";
import { adminFromReq, logAdminAction } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";

const PLAN_DAYS: Record<string, number> = { monthly: 30, quarterly: 90, yearly: 365 };

async function grantService(
  hotelId: string, serviceKey: string,
  opts: { days?: number; plan?: string }, adminId: string,
) {
  const plan = opts.plan && PLAN_DAYS[opts.plan] ? opts.plan : null;
  const days = plan ? PLAN_DAYS[plan] : Math.max(0, Number(opts.days) || 0);
  const expires = days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null;
  const accessType = plan ? "paid" : days > 0 ? "trial" : "free";
  const existing = await sbSelect(
    `hotel_services?hotel_id=eq.${encodeURIComponent(hotelId)}&service_key=eq.${encodeURIComponent(serviceKey)}&select=id`
  ).catch(() => []);
  const row = {
    id: existing?.[0]?.id || genId("hsvc"),
    hotel_id: hotelId, service_key: serviceKey,
    status: "active",
    access_type: accessType,
    plan,
    expires_at: expires,
    granted_by: adminId,
    updated_at: new Date().toISOString(),
  };
  const r = await fetch(`${SB_URL}/rest/v1/hotel_services?on_conflict=hotel_id,service_key`, {
    method: "POST",
    headers: { ...SB_H_REPRESENT, Prefer: "return=representation,resolution=merge-duplicates" },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error((await r.text()) || "grant failed");
}

export async function GET(req: NextRequest) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const reqRes = await fetch(`${SB_URL}/rest/v1/service_requests?select=*&order=created_at.desc&limit=300`, { headers: SB_H });
    if (!reqRes.ok) return NextResponse.json({ requests: [], entitlements: [], provisioned: false });
    const requests = await reqRes.json().catch(() => []);
    const ent = await fetch(`${SB_URL}/rest/v1/hotel_services?select=*&order=updated_at.desc&limit=400`, { headers: SB_H })
      .then((r) => r.json()).catch(() => []);
    return NextResponse.json({
      requests: Array.isArray(requests) ? requests : [],
      entitlements: Array.isArray(ent) ? ent : [],
      provisioned: true,
    });
  } catch {
    return NextResponse.json({ requests: [], entitlements: [], provisioned: false });
  }
}

export async function POST(req: NextRequest) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch {}
  const action = String(body.action || "");

  try {
    if (action === "approve") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      const rows = await sbSelect(`service_requests?id=eq.${encodeURIComponent(body.id)}&select=*`);
      const sr = rows?.[0];
      if (!sr) return NextResponse.json({ error: "Request not found" }, { status: 404 });
      await grantService(sr.hotel_id, sr.service_key, { days: body.days, plan: body.plan }, admin.id || "admin");
      await fetch(`${SB_URL}/rest/v1/service_requests?id=eq.${encodeURIComponent(body.id)}`, {
        method: "PATCH", headers: SB_H,
        body: JSON.stringify({ status: "approved", decided_by: admin.id || "admin", decided_at: new Date().toISOString() }),
      });
      logAdminAction({ admin, action: "service_request_approve", targetType: "service", targetId: `${sr.hotel_id}:${sr.service_key}` } as any);
      return NextResponse.json({ ok: true });
    }

    if (action === "reject") {
      if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
      await fetch(`${SB_URL}/rest/v1/service_requests?id=eq.${encodeURIComponent(body.id)}`, {
        method: "PATCH", headers: SB_H,
        body: JSON.stringify({ status: "rejected", decided_by: admin.id || "admin", decided_at: new Date().toISOString() }),
      });
      logAdminAction({ admin, action: "service_request_reject", targetType: "service", targetId: body.id } as any);
      return NextResponse.json({ ok: true });
    }

    if (action === "grant") {
      if (!body.hotelId || !body.serviceKey)
        return NextResponse.json({ error: "hotelId, serviceKey required" }, { status: 400 });
      await grantService(body.hotelId, body.serviceKey, { days: body.days, plan: body.plan }, admin.id || "admin");
      logAdminAction({ admin, action: "service_grant", targetType: "service", targetId: `${body.hotelId}:${body.serviceKey}` } as any);
      return NextResponse.json({ ok: true });
    }

    if (action === "revoke") {
      if (!body.hotelId || !body.serviceKey)
        return NextResponse.json({ error: "hotelId, serviceKey required" }, { status: 400 });
      await fetch(`${SB_URL}/rest/v1/hotel_services?hotel_id=eq.${encodeURIComponent(body.hotelId)}&service_key=eq.${encodeURIComponent(body.serviceKey)}`, {
        method: "DELETE", headers: SB_H,
      });
      logAdminAction({ admin, action: "service_revoke", targetType: "service", targetId: `${body.hotelId}:${body.serviceKey}` } as any);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Action failed" }, { status: 500 });
  }
}
