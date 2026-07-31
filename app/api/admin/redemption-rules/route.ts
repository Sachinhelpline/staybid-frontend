// Admin redemption rules CRUD — same pattern as /api/admin/commission-rules.
// GET   → list all rules (active + inactive)
// POST  → create a new rule
// PATCH → update an existing rule by id
// DELETE → soft-delete by flipping active=false (preserves audit trail)

import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/admin/verify";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";

export const dynamic = "force-dynamic";


export async function GET(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const r = await fetch(
    `${SB_URL}/rest/v1/redemption_rules?select=*&order=display_order.asc,points_cost.asc`,
    { headers: SB_READ },
  ).then((x) => x.json()).catch(() => []);
  return NextResponse.json({ rules: Array.isArray(r) ? r : [] });
}

export async function POST(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const adminId = admin.id;

  const required = ["slug", "title", "kind", "points_cost"];
  for (const k of required) {
    if (body[k] === undefined || body[k] === null || body[k] === "") {
      return NextResponse.json({ error: `Missing field: ${k}` }, { status: 400 });
    }
  }
  if (!["coupon", "voucher", "amenity", "wallet_credit"].includes(body.kind)) {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  }
  if (!["silver", "gold", "platinum"].includes(body.min_tier || "silver")) {
    return NextResponse.json({ error: "Invalid min_tier" }, { status: 400 });
  }

  const payload: any = {
    slug: String(body.slug).toLowerCase().replace(/[^a-z0-9_]/g, "_"),
    title: String(body.title),
    description: body.description || "",
    kind: body.kind,
    points_cost: Math.max(1, parseInt(body.points_cost, 10) || 1),
    value_inr: Number(body.value_inr || 0),
    min_tier: body.min_tier || "silver",
    max_per_user_per_month: Math.max(1, parseInt(body.max_per_user_per_month, 10) || 5),
    validity_days: Math.max(1, parseInt(body.validity_days, 10) || 90),
    icon: body.icon || "🎁",
    terms: body.terms || "",
    display_order: parseInt(body.display_order, 10) || 100,
    active: body.active !== false,
    updated_by: adminId,
  };

  const ins = await fetch(`${SB_URL}/rest/v1/redemption_rules`, {
    method: "POST",
    headers: { ...SB_H, Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  if (!ins.ok) {
    const txt = await ins.text().catch(() => "");
    return NextResponse.json({ error: "Failed to create rule", details: txt }, { status: 500 });
  }
  const arr = await ins.json().catch(() => null);
  return NextResponse.json({ ok: true, rule: Array.isArray(arr) ? arr[0] : arr });
}

export async function PATCH(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const adminId = admin.id;
  const id: string | undefined = body?.id;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const allowed = [
    "title", "description", "kind", "points_cost", "value_inr", "min_tier",
    "max_per_user_per_month", "validity_days", "icon", "terms", "display_order", "active",
  ];
  const patch: any = { updated_by: adminId, updated_at: new Date().toISOString() };
  for (const k of allowed) if (body[k] !== undefined) patch[k] = body[k];

  const upd = await fetch(`${SB_URL}/rest/v1/redemption_rules?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...SB_H, Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!upd.ok) {
    const txt = await upd.text().catch(() => "");
    return NextResponse.json({ error: "Failed to update rule", details: txt }, { status: 500 });
  }
  const arr = await upd.json().catch(() => null);
  return NextResponse.json({ ok: true, rule: Array.isArray(arr) ? arr[0] : arr });
}

export async function DELETE(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const upd = await fetch(`${SB_URL}/rest/v1/redemption_rules?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: SB_H,
    body: JSON.stringify({ active: false, updated_at: new Date().toISOString() }),
  });
  if (!upd.ok) return NextResponse.json({ error: "Failed to deactivate" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
