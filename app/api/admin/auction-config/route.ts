// v361 — Model 3: admin read/write of the auction_config singleton
// (buyer premium %, seller fee %, EMD deposit %, window-open day, pay-window hrs).
// Mirrors /api/admin/b2b-fee. Clamped server-side; cache invalidated on write.
import { NextResponse } from "next/server";
import { SB_URL, SB_H } from "@/lib/sb";
import { adminFromReq, logAdminAction } from "@/lib/admin/audit";
import { resolveAuctionConfig, invalidateAuctionConfigCache, AUCTION_CONFIG_ID } from "@/lib/trade/config";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Admin auth required." }, { status: 401 });
  const cfg = await resolveAuctionConfig();
  return NextResponse.json({ config: cfg });
}

const clampPct = (v: any, fb: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fb;
};
const clampInt = (v: any, fb: number, lo: number, hi: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= lo && n <= hi ? n : fb;
};
const clampMult = (v: any, fb: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 20 ? n : fb;
};

export async function POST(req: Request) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Admin auth required." }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const cur = await resolveAuctionConfig();

  const patch: any = { updated_at: new Date().toISOString() };
  if (body.buyerPremiumPct !== undefined) patch.buyer_premium_pct = clampPct(body.buyerPremiumPct, cur.buyerPremiumPct);
  if (body.sellerFeePct !== undefined)    patch.seller_fee_pct    = clampPct(body.sellerFeePct, cur.sellerFeePct);
  if (body.depositPct !== undefined)      patch.deposit_pct       = clampPct(body.depositPct, cur.depositPct);
  if (body.windowOpenDay !== undefined)   patch.window_open_day   = clampInt(body.windowOpenDay, cur.windowOpenDay, 1, 28);
  if (body.payWindowHours !== undefined)  patch.pay_window_hours  = clampInt(body.payWindowHours, cur.payWindowHours, 1, 336);
  if (body.circleFloorMultiplier !== undefined) patch.circle_floor_multiplier = clampMult(body.circleFloorMultiplier, cur.circleFloorMultiplier);
  // LIVE-mode knobs (always-open bulk auction).
  if (body.livePayWindowHours !== undefined) patch.live_pay_window_hours = clampInt(body.livePayWindowHours, cur.livePayWindowHours, 1, 336);
  if (body.liveHybridAcceptRatio !== undefined) patch.live_hybrid_accept_ratio = clampMult(body.liveHybridAcceptRatio, cur.liveHybridAcceptRatio);
  if (body.liveDefaultAutopilot !== undefined) {
    patch.live_default_autopilot = ["auto", "hybrid", "manual"].includes(body.liveDefaultAutopilot) ? body.liveDefaultAutopilot : cur.liveDefaultAutopilot;
  }

  const r = await fetch(
    `${SB_URL}/rest/v1/auction_config?id=eq.${AUCTION_CONFIG_ID}`,
    { method: "PATCH", headers: { ...SB_H, Prefer: "return=representation" }, body: JSON.stringify(patch) },
  );
  if (!r.ok) {
    const t = await r.text();
    return NextResponse.json({ error: "Update failed.", detail: t }, { status: 500 });
  }
  invalidateAuctionConfigCache();
  logAdminAction({ admin, action: "auction_config.update", targetType: "auction_config", targetId: AUCTION_CONFIG_ID, details: patch });
  const cfg = await resolveAuctionConfig();
  return NextResponse.json({ ok: true, config: cfg });
}
