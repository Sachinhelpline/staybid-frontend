// v347 — Admin control for the Circle Model-2 B2B dual commission.
//
//   GET  /api/admin/b2b-fee   → { config: { buyerFeePct, sellerFeePct } }
//   POST /api/admin/b2b-fee   { buyerFeePct, sellerFeePct }  (0–100 each)
//
// Upserts the `b2b_fee_config` singleton and invalidates the resolver cache so
// the next listing freezes the new %. Only NEW listings re-price; live listings
// keep their frozen % (tamper-safe). Auth: adminFromReq (Bearer / x-admin-token).

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H } from "@/lib/sb";
import { adminFromReq, logAdminAction } from "@/lib/admin/audit";
import {
  resolveB2bFeeConfig,
  invalidateB2bFeeConfigCache,
  B2B_FEE_CONFIG_ID,
} from "@/lib/b2b/fee-config-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clampPct = (v: any): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
};
const clampMoney = (v: any): number | null => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 10_000_000 ? n : null;
};
const clampMarkup = (v: any): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? n : null;
};

export async function GET(req: NextRequest) {
  if (!adminFromReq(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const config = await resolveB2bFeeConfig();
  return NextResponse.json({ config });
}

export async function POST(req: NextRequest) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const buyerFeePct = clampPct(body?.buyerFeePct);
  const sellerFeePct = clampPct(body?.sellerFeePct);
  if (buyerFeePct === null || sellerFeePct === null) {
    return NextResponse.json({ error: "buyerFeePct & sellerFeePct must each be 0–100." }, { status: 400 });
  }
  // city access price + regulated markup optional — only update when provided.
  const cityAccessPrice = body?.cityAccessPrice === undefined ? undefined : clampMoney(body?.cityAccessPrice);
  if (cityAccessPrice === null) {
    return NextResponse.json({ error: "cityAccessPrice must be ≥ 0." }, { status: 400 });
  }
  const regulatedMarkupPct = body?.regulatedMarkupPct === undefined ? undefined : clampMarkup(body?.regulatedMarkupPct);
  if (regulatedMarkupPct === null) {
    return NextResponse.json({ error: "regulatedMarkupPct must be 0–1000." }, { status: 400 });
  }

  try {
    const r = await fetch(`${SB_URL}/rest/v1/b2b_fee_config?on_conflict=id`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        id: B2B_FEE_CONFIG_ID,
        buyer_fee_pct: buyerFeePct,
        seller_fee_pct: sellerFeePct,
        ...(cityAccessPrice === undefined ? {} : { city_access_price: cityAccessPrice }),
        ...(regulatedMarkupPct === undefined ? {} : { regulated_markup_pct: regulatedMarkupPct }),
        updated_at: new Date().toISOString(),
      }),
    });
    if (!r.ok) {
      const e = await r.text();
      return NextResponse.json({ error: "Save failed", detail: e.slice(0, 160) }, { status: 500 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Save failed" }, { status: 500 });
  }

  invalidateB2bFeeConfigCache();
  try {
    logAdminAction({
      admin,
      action: "b2b_fee.set",
      targetType: "config",
      targetId: B2B_FEE_CONFIG_ID,
      details: { buyerFeePct, sellerFeePct, cityAccessPrice, regulatedMarkupPct },
    });
  } catch { /* best-effort */ }

  const config = await resolveB2bFeeConfig();
  return NextResponse.json({ ok: true, config });
}
