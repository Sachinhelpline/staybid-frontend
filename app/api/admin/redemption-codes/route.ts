// GET /api/admin/redemption-codes
// Full audit feed for admins. Supports filters:
//   ?status=active|used|expired|revoked   (default: all)
//   ?kind=coupon|voucher|amenity|wallet_credit
//   ?ruleSlug=...
//   ?userId=...
//   ?from=ISO&to=ISO  (issued_at window)
//   ?limit=100  (max 500)
//
// PATCH /api/admin/redemption-codes
// Body: { id, action: "revoke" | "extend", days? }
//   revoke → status='revoked', revoked_at, revoked_by
//   extend → expires_at += days * 24h (admin can save a customer who let
//            their code expire by a few days)

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";

export const dynamic = "force-dynamic";

function isAdmin(req: NextRequest): boolean {
  const token = req.headers.get("x-admin-token") || "";
  const adminId = req.headers.get("x-admin-id") || "";
  return !!token && !!adminId;
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Admin auth required" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") || "";
  const kind = sp.get("kind") || "";
  const ruleSlug = sp.get("ruleSlug") || "";
  const userId = sp.get("userId") || "";
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const limit = Math.min(500, Math.max(10, parseInt(sp.get("limit") || "100", 10)));

  const filters: string[] = [];
  if (status) filters.push(`status=eq.${encodeURIComponent(status)}`);
  if (kind) filters.push(`kind=eq.${encodeURIComponent(kind)}`);
  if (ruleSlug) filters.push(`rule_slug=eq.${encodeURIComponent(ruleSlug)}`);
  if (userId) filters.push(`user_id=eq.${encodeURIComponent(userId)}`);
  if (from) filters.push(`issued_at=gte.${encodeURIComponent(from)}`);
  if (to) filters.push(`issued_at=lte.${encodeURIComponent(to)}`);

  const codes = await fetch(
    `${SB_URL}/rest/v1/redemption_codes?select=*&order=issued_at.desc&limit=${limit}${filters.length ? "&" + filters.join("&") : ""}`,
    { headers: SB_READ },
  ).then((r) => r.json()).catch(() => []);
  const list: any[] = Array.isArray(codes) ? codes : [];

  // KPIs for the dashboard strip — based on filtered set
  const totalIssued = list.length;
  const activeCount = list.filter((c) => c.status === "active").length;
  const usedCount = list.filter((c) => c.status === "used").length;
  const expiredCount = list.filter((c) => c.status === "expired").length;
  const revokedCount = list.filter((c) => c.status === "revoked").length;
  const totalPointsSpent = list.reduce((s, c) => s + Number(c.points_spent || 0), 0);
  const totalRupeeCost = list.reduce((s, c) => s + Number(c.value_inr || 0), 0);
  const usedRupeeCost = list
    .filter((c) => c.status === "used")
    .reduce((s, c) => s + Number(c.value_inr || 0), 0);

  // Side-load user names + rule titles for table display
  const userIds = Array.from(new Set(list.map((c) => c.user_id).filter(Boolean)));
  const users = userIds.length
    ? await fetch(`${SB_URL}/rest/v1/users?id=in.(${userIds.join(",")})&select=id,name,phone,email`, { headers: SB_READ })
        .then((r) => r.json()).catch(() => [])
    : [];
  const userById = Object.fromEntries((Array.isArray(users) ? users : []).map((u: any) => [u.id, u]));
  for (const c of list) c.user = userById[c.user_id] || null;

  return NextResponse.json({
    codes: list,
    kpis: {
      totalIssued,
      activeCount,
      usedCount,
      expiredCount,
      revokedCount,
      totalPointsSpent,
      totalRupeeCost,
      usedRupeeCost,
    },
  });
}

export async function PATCH(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Admin auth required" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id: string | undefined = body?.id;
  const action: string | undefined = body?.action;
  if (!id || !action) return NextResponse.json({ error: "id + action required" }, { status: 400 });
  const adminId = req.headers.get("x-admin-id") || "system";

  if (action === "revoke") {
    const upd = await fetch(`${SB_URL}/rest/v1/redemption_codes?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify({
        status: "revoked",
        revoked_at: new Date().toISOString(),
        revoked_by: adminId,
      }),
    });
    if (!upd.ok) return NextResponse.json({ error: "Failed to revoke" }, { status: 500 });
    const arr = await upd.json().catch(() => null);
    return NextResponse.json({ ok: true, code: Array.isArray(arr) ? arr[0] : arr });
  }
  if (action === "extend") {
    const days = Math.max(1, Math.min(180, parseInt(body.days, 10) || 30));
    // Read current expires_at + extend
    const rows = await fetch(`${SB_URL}/rest/v1/redemption_codes?id=eq.${encodeURIComponent(id)}&select=*`, { headers: SB_READ })
      .then((r) => r.json()).catch(() => []);
    const c: any = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!c) return NextResponse.json({ error: "Code not found" }, { status: 404 });
    const newExpiry = new Date(Math.max(Date.now(), new Date(c.expires_at).getTime()) + days * 86400_000).toISOString();
    const upd = await fetch(`${SB_URL}/rest/v1/redemption_codes?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify({
        expires_at: newExpiry,
        status: c.status === "expired" ? "active" : c.status,
        notes: `${c.notes || ""}\nExtended +${days}d by admin on ${new Date().toISOString()}`.trim(),
      }),
    });
    if (!upd.ok) return NextResponse.json({ error: "Failed to extend" }, { status: 500 });
    const arr = await upd.json().catch(() => null);
    return NextResponse.json({ ok: true, code: Array.isArray(arr) ? arr[0] : arr });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
