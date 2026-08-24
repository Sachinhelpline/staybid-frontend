// v99 — Admin RLS management API.
//
// Wraps four SECURITY DEFINER Postgres functions that the v99 migration
// installed. The wrapper exists so the admin sb_admin_token can gate
// access (the RPCs themselves use a shared secret, not the admin JWT —
// see the migration for why).
//
// GET  /api/admin/rls                        — list every public table with
//                                              rls_enabled + policy_count + policies
// POST /api/admin/rls  {action:"toggle",   table, enable}
//                      {action:"add_policy", table}
//                      {action:"drop_policy", table, policy}
import { NextResponse } from "next/server";
import { requireVerifiedAdmin, auditIdentity } from "@/lib/admin/verify";
import { hasServiceRole } from "@/lib/sb";
import { adminRlsRpc as rpc } from "@/lib/admin/admin-rls-service-role";
import { logAdminAction } from "@/lib/admin/audit";

// Same string lives inside the four SECURITY DEFINER functions in the
// v99 migration. Rotate both at once if/when needed.
const RLS_SECRET = process.env.SB_RLS_SECRET || "STAYBID_RLS_SECRET_v99_change_me";

// All six Admin-RLS RPCs route through the single fail-closed service-role
// sender (`lib/admin/admin-rls-service-role.ts`). It uses the service-role
// key as the ONLY Authorization identity and fails closed — with ZERO
// outbound request — when that key is missing/empty/whitespace. There is no
// service-role-to-anon fallback here (the generic shared-header path with its
// anon key fallback is deliberately not used).

export async function GET(req: Request) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const r = await rpc("admin_list_rls", { secret: RLS_SECRET });
  if (!r.ok) {
    return NextResponse.json({ error: r.json?.message || "RPC failed", detail: r.json }, { status: r.status });
  }
  if (r.json?.error) {
    return NextResponse.json({ error: r.json.error }, { status: 403 });
  }
  // v100 — augment response with server-side service-role status so the
  // UI can enable/disable the "Lock down" action button.
  return NextResponse.json({ ...r.json, serviceRole: hasServiceRole() });
}

export async function POST(req: Request) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const action = body.action as string;

  if (action === "toggle") {
    const tbl = String(body.table || "").trim();
    const enable = Boolean(body.enable);
    if (!tbl) return NextResponse.json({ error: "table required" }, { status: 400 });
    const r = await rpc("admin_set_rls", { secret: RLS_SECRET, tbl, enable });
    if (r.json?.error) return NextResponse.json({ error: r.json.error }, { status: 403 });
    logAdminAction({
      admin: auditIdentity(admin),
      action: `rls.${enable ? "enable" : "disable"}`,
      targetType: "table",
      targetId: tbl,
      details: { result: r.json },
    });
    return NextResponse.json(r.json);
  }

  if (action === "add_policy") {
    const tbl = String(body.table || "").trim();
    if (!tbl) return NextResponse.json({ error: "table required" }, { status: 400 });
    const r = await rpc("admin_add_permissive_policy", { secret: RLS_SECRET, tbl });
    if (r.json?.error) return NextResponse.json({ error: r.json.error }, { status: 403 });
    logAdminAction({
      admin: auditIdentity(admin),
      action: "rls.add_permissive_policy",
      targetType: "table",
      targetId: tbl,
      details: { result: r.json },
    });
    return NextResponse.json(r.json);
  }

  if (action === "lockdown") {
    // v100 — drops all permissive policies in one shot, leaving the
    // table accessible only via service_role (which bypasses RLS).
    // Guarded server-side: refuses to run unless SUPABASE_SERVICE_ROLE_KEY
    // is set, otherwise the table becomes uneditable from API routes too.
    const tbl = String(body.table || "").trim();
    if (!tbl) return NextResponse.json({ error: "table required" }, { status: 400 });
    if (!hasServiceRole()) {
      return NextResponse.json({
        error: "Service-role key not configured. Set SUPABASE_SERVICE_ROLE_KEY env var on Vercel before locking down.",
      }, { status: 412 });
    }
    const r = await rpc("admin_lockdown_table", { secret: RLS_SECRET, tbl });
    if (r.json?.error) return NextResponse.json({ error: r.json.error }, { status: 403 });
    logAdminAction({
      admin: auditIdentity(admin),
      action: "rls.lockdown",
      targetType: "table",
      targetId: tbl,
      details: { result: r.json },
    });
    return NextResponse.json(r.json);
  }

  if (action === "apply_template") {
    // v103 — apply a pre-baked restrictive policy template
    const tbl = String(body.table || "").trim();
    const template = String(body.template || "").trim();
    const col = body.col ? String(body.col).trim() : null;
    if (!tbl || !template) return NextResponse.json({ error: "table + template required" }, { status: 400 });
    if (template === "service_role_only" && !hasServiceRole()) {
      return NextResponse.json({
        error: "Service-role key not configured. Set SUPABASE_SERVICE_ROLE_KEY env var on Vercel before applying service_role_only.",
      }, { status: 412 });
    }
    const r = await rpc("admin_apply_policy_template", { secret: RLS_SECRET, tbl, templ: template, col });
    if (r.json?.error) return NextResponse.json({ error: r.json.error }, { status: 403 });
    logAdminAction({
      admin: auditIdentity(admin),
      action: `rls.template.${template}`,
      targetType: "table",
      targetId: tbl,
      details: { col, result: r.json },
    });
    return NextResponse.json(r.json);
  }

  if (action === "drop_policy") {
    const tbl = String(body.table || "").trim();
    const policy = String(body.policy || "").trim();
    if (!tbl || !policy) return NextResponse.json({ error: "table + policy required" }, { status: 400 });
    const r = await rpc("admin_drop_policy", { secret: RLS_SECRET, tbl, policy });
    if (r.json?.error) return NextResponse.json({ error: r.json.error }, { status: 403 });
    logAdminAction({
      admin: auditIdentity(admin),
      action: "rls.drop_policy",
      targetType: "table",
      targetId: tbl,
      details: { policy, result: r.json },
    });
    return NextResponse.json(r.json);
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
