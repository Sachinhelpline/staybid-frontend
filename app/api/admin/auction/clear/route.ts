// v361 — Model 3: admin FORCE-CLEAR a single lot (POST { lotId }). Lets an admin
// run the clearing engine on demand (e.g. testing before the window naturally
// closes, or re-running a stuck lot). Idempotent — reuses clearLotDb.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";
import { adminFromReq, logAdminAction } from "@/lib/admin/audit";
import { clearLotDb } from "@/lib/trade/clear-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Admin auth required." }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const lotId = String(body.lotId || "").trim();
  if (!lotId) return NextResponse.json({ error: "lotId required." }, { status: 400 });

  const r = await fetch(`${SB_URL}/rest/v1/auction_lots?id=eq.${encodeURIComponent(lotId)}&select=*&limit=1`, { headers: SB_READ, cache: "no-store" });
  const [lot] = r.ok ? await r.json().catch(() => []) : [];
  if (!lot) return NextResponse.json({ error: "Lot not found." }, { status: 404 });
  if (lot.status !== "open") return NextResponse.json({ error: `Lot is ${lot.status}, not open.` }, { status: 400 });

  const res = await clearLotDb(lot);
  logAdminAction({ admin, action: "auction.force_clear", targetType: "auction_lot", targetId: lotId, details: res });
  return NextResponse.json(res);
}
