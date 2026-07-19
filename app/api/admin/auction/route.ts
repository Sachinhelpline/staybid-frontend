// v361 — Model 3: admin oversight data + refund action.
//   GET  → { agents, lots, awards, refundsOwed } for the /admin/auction panel.
//   POST { action:'refund_bid', bidId } → mark a lost bid's EMD refund paid.
// (Agent approve = /api/admin/trade-agents · config = /api/admin/auction-config ·
//  force-clear = /api/admin/auction/clear · owner payouts = existing finance.)
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";
import { adminFromReq, logAdminAction } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Admin auth required." }, { status: 401 });

  const get = async (path: string) => {
    try { const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_READ, cache: "no-store" }); return r.ok ? await r.json().catch(() => []) : []; }
    catch { return []; }
  };
  const [agents, lots, awards, refundsOwed] = await Promise.all([
    get("trade_agents?select=*&order=created_at.desc&limit=300"),
    get("auction_lots?select=*&order=created_at.desc&limit=300"),
    get("auction_awards?select=*&order=created_at.desc&limit=300"),
    get("auction_bids?status=eq.lost&metadata->>emd_refund=eq.owed&select=id,agent_user_id,agent_id,lot_id,segment_label,deposit_amount,metadata&limit=300"),
  ]);
  return NextResponse.json({ agents, lots, awards, refundsOwed });
}

export async function POST(req: NextRequest) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Admin auth required." }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const action = String(body.action || "").trim();

  if (action === "refund_bid") {
    const bidId = String(body.bidId || "").trim();
    if (!bidId) return NextResponse.json({ error: "bidId required." }, { status: 400 });
    // Load to merge metadata (mark emd_refund paid).
    const lr = await fetch(`${SB_URL}/rest/v1/auction_bids?id=eq.${encodeURIComponent(bidId)}&select=metadata,status&limit=1`, { headers: SB_READ, cache: "no-store" });
    const [row] = lr.ok ? await lr.json().catch(() => []) : [];
    if (!row) return NextResponse.json({ error: "Bid not found." }, { status: 404 });
    const r = await fetch(`${SB_URL}/rest/v1/auction_bids?id=eq.${encodeURIComponent(bidId)}&status=eq.lost`, {
      method: "PATCH", headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify({ status: "refunded", updated_at: new Date().toISOString(), metadata: { ...(row.metadata || {}), emd_refund: "paid" } }),
    });
    if (!r.ok) { const t = await r.text(); return NextResponse.json({ error: "Refund mark failed.", detail: t }, { status: 500 }); }
    logAdminAction({ admin, action: "auction.refund_bid", targetType: "auction_bid", targetId: bidId, details: {} });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
