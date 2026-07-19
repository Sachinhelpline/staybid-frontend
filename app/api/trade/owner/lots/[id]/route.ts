// v361 — Model 3 owner supply: cancel/withdraw a lot the owner manages.
// PATCH { action: 'cancel' }. Only draft/open lots with NO active bids can be
// cancelled (once agents have live bids on it, cancellation is an admin/refund
// concern handled later). Partner-scoped.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";
import { partnerHotelScope } from "@/lib/partner/hotel-scope";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const scope = await partnerHotelScope(req);
  if (!scope) return NextResponse.json({ error: "Partner auth required." }, { status: 401 });
  const { id } = await ctx.params;

  let body: any = {};
  try { body = await req.json(); } catch {}
  const action = String(body.action || "").trim().toLowerCase();
  if (action !== "cancel") return NextResponse.json({ error: "Unsupported action." }, { status: 400 });

  // Load the lot + verify it belongs to a hotel the caller manages.
  const lr = await fetch(
    `${SB_URL}/rest/v1/auction_lots?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
    { headers: SB_READ, cache: "no-store" },
  );
  const [lot] = lr.ok ? await lr.json().catch(() => []) : [];
  if (!lot) return NextResponse.json({ error: "Lot not found." }, { status: 404 });
  if (!scope.hotelIds.includes(lot.hotel_id)) return NextResponse.json({ error: "Not your lot." }, { status: 403 });
  if (!["draft", "open"].includes(lot.status)) {
    return NextResponse.json({ error: `Cannot cancel a ${lot.status} lot.` }, { status: 400 });
  }

  // Block cancel if any active/won bids exist (refund path is not in scope here).
  const br = await fetch(
    `${SB_URL}/rest/v1/auction_bids?lot_id=eq.${encodeURIComponent(id)}&status=in.(active,won,partial)&select=id&limit=1`,
    { headers: SB_READ, cache: "no-store" },
  );
  const bids = br.ok ? await br.json().catch(() => []) : [];
  if (Array.isArray(bids) && bids.length) {
    return NextResponse.json({ error: "This lot already has live bids — cancellation needs admin review." }, { status: 409 });
  }

  const r = await fetch(
    `${SB_URL}/rest/v1/auction_lots?id=eq.${encodeURIComponent(id)}&status=in.(draft,open)`,
    { method: "PATCH", headers: { ...SB_H, Prefer: "return=representation" }, body: JSON.stringify({ status: "cancelled", updated_at: new Date().toISOString() }) },
  );
  if (!r.ok) { const t = await r.text(); return NextResponse.json({ error: "Cancel failed.", detail: t }, { status: 500 }); }
  const [updated] = await r.json().catch(() => []);
  return NextResponse.json({ ok: true, lot: updated });
}
