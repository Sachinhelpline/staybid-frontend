// v280 — Admin → Host Wizard Pricing config API.
//
//   GET  /api/admin/host/pricing  → { ok, config, defaults }
//        config   = live resolved config (admin overrides merged over defaults)
//        defaults = bundled DEFAULT_WIZARD_CONFIG (so the UI can "reset")
//
//   POST /api/admin/host/pricing  body { config }
//        Re-merges the posted config over defaults (mergeWizardConfig clamps
//        every number + keeps the fixed key set), upserts the singleton row,
//        invalidates the resolver cache. Audit-logged.
//
// Auth: x-admin-token / x-admin-id (adminFromReq). No client ever charges from
// this — the wizard + /checkout re-resolve through resolveWizardConfig().
//
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H } from "@/lib/sb";
import { adminFromReq, logAdminAction } from "@/lib/admin/audit";
import { DEFAULT_WIZARD_CONFIG, mergeWizardConfig } from "@/lib/host/wizard-rules";
import { resolveWizardConfig, invalidateWizardConfigCache, WIZARD_CONFIG_ID } from "@/lib/host/wizard-config-store";

export const dynamic = "force-dynamic";

const REST = `${SB_URL}/rest/v1`;

export async function GET(req: NextRequest) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const config = await resolveWizardConfig();
    return NextResponse.json({ ok: true, config, defaults: DEFAULT_WIZARD_CONFIG });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to load config" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const incoming = body?.config && typeof body.config === "object" ? body.config : null;
  if (!incoming) return NextResponse.json({ error: "config required" }, { status: 400 });

  // Re-merge over defaults → clamps every number + locks the key set. This is
  // what actually gets stored, so a bad payload can never persist garbage.
  const clean = mergeWizardConfig(incoming);

  try {
    const r = await fetch(`${REST}/host_wizard_config?on_conflict=id`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        id: WIZARD_CONFIG_ID,
        config: clean,
        updated_at: new Date().toISOString(),
        updated_by: (admin as any)?.id || (admin as any)?.name || "admin",
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: "Save failed", detail: t.slice(0, 200) }, { status: 502 });
    }
    invalidateWizardConfigCache();
    logAdminAction({ admin, action: "host_wizard_pricing_update", targetType: "host_wizard_config", targetId: WIZARD_CONFIG_ID } as any);
    return NextResponse.json({ ok: true, config: clean });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Save failed" }, { status: 500 });
  }
}
