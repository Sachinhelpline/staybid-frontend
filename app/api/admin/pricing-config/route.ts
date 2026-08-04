// v720 — Admin control for the AI dynamic-pricing engine "digits".
//
//   GET  /api/admin/pricing-config → { config, defaults, eventNames }
//   POST /api/admin/pricing-config { ...knobs }  (each validated/clamped)
//
// Upserts the `pricing_engine_config` singleton and invalidates the resolver
// cache so the next price compute (cron price-spine / read-spine) uses the new
// values. The AI FORMULA is untouched — only the numbers it multiplies change.
// A bad/out-of-range value is rejected (400) so a fat-finger can't zero-out or
// 10× a factor. Auth: requireVerifiedAdmin (Bearer / x-admin-token).

import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/admin/verify";
import { SB_URL, SB_H } from "@/lib/sb";
import { logAdminAction } from "@/lib/admin/audit";
import { PRICING_ENGINE_HARDCODED } from "@/lib/ai-pricing";
import {
  resolveEngineConfig,
  invalidateEngineConfigCache,
  PRICING_ENGINE_DEFAULTS,
  PRICING_ENGINE_CONFIG_ID,
} from "@/lib/pricing/engine-config-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A single multiplier: sane band 0.05–5.
const okMult = (v: any) => Number.isFinite(Number(v)) && Number(v) >= 0.05 && Number(v) <= 5;
// Validate a numeric array of an EXACT length (every element a sane mult).
function okArr(v: any, len: number): number[] | null {
  if (!Array.isArray(v) || v.length !== len) return null;
  const out = v.map((x) => Number(x));
  return out.every(okMult) ? out : null;
}
// Bounded scalar.
function okNum(v: any, lo: number, hi: number): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}

export async function GET(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const config = await resolveEngineConfig();
  return NextResponse.json({
    config,
    defaults: PRICING_ENGINE_DEFAULTS,
    eventNames: PRICING_ENGINE_HARDCODED.eventNames,
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  // Build the update patch. Every field OPTIONAL — only update what was sent.
  // undefined = leave as-is; null (from a failed validation) = reject 400.
  const patch: Record<string, any> = {};
  const errs: string[] = [];

  const setNum = (bodyKey: string, col: string, lo: number, hi: number) => {
    if (body[bodyKey] === undefined) return;
    const v = okNum(body[bodyKey], lo, hi);
    if (v === null) errs.push(`${bodyKey} must be ${lo}–${hi}`);
    else patch[col] = v;
  };
  const setArr = (bodyKey: string, col: string, len: number) => {
    if (body[bodyKey] === undefined) return;
    const v = okArr(body[bodyKey], len);
    if (v === null) errs.push(`${bodyKey} must be ${len} numbers, each 0.05–5`);
    else patch[col] = v;
  };

  setNum("undercutPct", "undercut_pct", 0, 50);
  setNum("flashDiscountPct", "flash_discount_pct", 0, 90);
  setNum("clampMin", "clamp_min", 0.2, 1);
  setNum("clampMax", "clamp_max", 1, 5);
  setNum("microAmplitudePct", "micro_amplitude_pct", 0, 20);
  setNum("monsoonMult", "monsoon_mult", 0.3, 1.5);
  setNum("schoolMult", "school_mult", 0.5, 3);
  setNum("longWeekendMult", "long_weekend_mult", 0.5, 3);
  setNum("longWeekendHolidayMult", "long_weekend_holiday_mult", 0.5, 3);
  setArr("seasonMults", "season_mults", 12);
  setArr("dowMults", "dow_mults", 7);
  setArr("occupancyMults", "occupancy_mults", 5);
  setArr("leadMults", "lead_mults", 6);
  setArr("eventMults", "event_mults", PRICING_ENGINE_HARDCODED.eventMults.length);

  if (body.capLiveAtMrp !== undefined) {
    patch.cap_live_at_mrp = body.capLiveAtMrp === true || body.capLiveAtMrp === "true";
  }
  if (body.cityDemand !== undefined) {
    const cd = body.cityDemand;
    if (!cd || typeof cd !== "object" || Array.isArray(cd)) {
      errs.push("cityDemand must be an object of city→multiplier");
    } else {
      const clean: Record<string, number> = {};
      let bad = false;
      for (const k of Object.keys(cd)) {
        if (!okMult(cd[k])) { bad = true; break; }
        clean[k] = Number(cd[k]);
      }
      if (bad) errs.push("cityDemand values must each be 0.05–5");
      else patch.city_demand = clean;
    }
  }

  // Ordered clamp band guard (use resolved current values to fill the missing side).
  const curMin = patch.clamp_min ?? PRICING_ENGINE_DEFAULTS.clampMin;
  const curMax = patch.clamp_max ?? PRICING_ENGINE_DEFAULTS.clampMax;
  if ((patch.clamp_min !== undefined || patch.clamp_max !== undefined) && curMin >= curMax) {
    errs.push("clampMin must be < clampMax");
  }

  if (errs.length) return NextResponse.json({ error: errs.join("; ") }, { status: 400 });
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  try {
    const r = await fetch(`${SB_URL}/rest/v1/pricing_engine_config?on_conflict=id`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        id: PRICING_ENGINE_CONFIG_ID,
        ...patch,
        updated_at: new Date().toISOString(),
        updated_by: (admin as any)?.id || (admin as any)?.phone || "admin",
      }),
    });
    if (!r.ok) {
      const e = await r.text();
      return NextResponse.json({ error: "Save failed", detail: e.slice(0, 160) }, { status: 500 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Save failed" }, { status: 500 });
  }

  invalidateEngineConfigCache();
  try {
    logAdminAction({
      admin,
      action: "pricing_engine.set",
      targetType: "config",
      targetId: PRICING_ENGINE_CONFIG_ID,
      details: { fields: Object.keys(patch) },
    });
  } catch { /* best-effort */ }

  const config = await resolveEngineConfig();
  return NextResponse.json({ ok: true, config });
}
