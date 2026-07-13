// v328 — Circle Phase C2: Model 3 pre-buy PURCHASE verify + inventory HOLD.
//
// POST /api/circle/inventory/[id]/verify
//   Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
//   HMAC-verifies the payment (via the shared /api/razorpay/verify), then flips
//   the block to `owned` (matched on id + razorpay_order_id + status =
//   pending_payment + ownership — anti-tamper, idempotent) and writes an
//   idempotent `room_blocks` HOLD (source='inventory', assignedUnitId) so the
//   pre-bought nights can't be double-booked by a customer bid/book or another
//   block. The hold id is deterministic (`invhold_<blockId>`) → re-verify never
//   duplicates it, and C4 expiry/refund can find + release it.
//
// Auth: partner Bearer JWT → cross-pool owner ids.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, decodeJwt } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function auth(req: NextRequest): { userId?: string; phone?: string; email?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub, phone: p?.phone, email: p?.email };
}

// Write (or refresh) the room-nights HOLD so availability subtracts them.
// Deterministic id → idempotent on re-verify. Best-effort: a hold hiccup must
// NOT fail a succeeded payment (returns false; ops/C4 can reconcile).
async function writeHold(block: any): Promise<boolean> {
  try {
    // Best-effort roomNumber for the human-readable assignedUnitNumber.
    let unitNumber: string | null = null;
    try {
      const ur = await fetch(
        `${SB_URL}/rest/v1/hotel_room_units?id=eq.${encodeURIComponent(String(block.unit_id))}&select=roomNumber`,
        { headers: SB_H },
      );
      const u = (await ur.json().catch(() => []))?.[0];
      unitNumber = u?.roomNumber || null;
    } catch { /* optional */ }

    const holdId = `invhold_${block.id}`;
    const res = await fetch(`${SB_URL}/rest/v1/room_blocks?on_conflict=id`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        id: holdId,
        hotelId: String(block.hotel_id),
        roomId: String(block.room_id),
        fromDate: String(block.date_from),
        toDate: String(block.date_to),
        source: "inventory",
        assignedUnitId: String(block.unit_id),
        assignedUnitNumber: unitNumber,
        note: "StayBid Circle pre-buy hold",
        createdBy: String(block.investor_user_id),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const blockId = String(id || "").trim();
  if (!blockId) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const rzpOrderId = String(body?.razorpay_order_id || "").trim();
  const paymentId = String(body?.razorpay_payment_id || "").trim();
  const signature = String(body?.razorpay_signature || "").trim();
  if (!rzpOrderId || !paymentId || !signature) {
    return NextResponse.json({ ok: false, error: "Missing payment fields" }, { status: 400 });
  }

  const { userId, phone, email } = auth(req);
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const ownerIds = await resolveOwnerIdsCrossPool(userId, phone, email);
  if (!ownerIds.length) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const idsCsv = ownerIds.map((x) => encodeURIComponent(x)).join(",");

  // HMAC verify the payment.
  const origin = new URL(req.url).origin;
  let verified = false;
  try {
    const vr = await fetch(`${origin}/api/razorpay/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ razorpay_order_id: rzpOrderId, razorpay_payment_id: paymentId, razorpay_signature: signature }),
    });
    verified = !!(await vr.json().catch(() => ({})))?.verified;
  } catch {
    return NextResponse.json({ ok: false, error: "Verification unreachable" }, { status: 502 });
  }
  if (!verified) return NextResponse.json({ ok: false, error: "Payment signature mismatch" }, { status: 400 });

  // Flip to owned — matched on id + order + pending_payment + ownership.
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(blockId)}` +
        `&razorpay_order_id=eq.${encodeURIComponent(rzpOrderId)}` +
        `&status=eq.pending_payment&investor_user_id=in.(${idsCsv})`,
      {
        method: "PATCH",
        headers: { ...SB_H, Prefer: "return=representation" },
        body: JSON.stringify({
          status: "owned",
          razorpay_payment_id: paymentId,
          purchased_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      },
    );
    const rows = r.ok ? await r.json().catch(() => []) : [];

    if (!Array.isArray(rows) || !rows.length) {
      // Already processed (or someone else's order) — ensure the hold exists
      // if the block is legitimately owned by this caller, then report idempotent.
      try {
        const gr = await fetch(
          `${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(blockId)}` +
            `&razorpay_order_id=eq.${encodeURIComponent(rzpOrderId)}` +
            `&status=eq.owned&investor_user_id=in.(${idsCsv})&select=*`,
          { headers: SB_H },
        );
        const owned = (gr.ok ? await gr.json().catch(() => []) : [])?.[0];
        if (owned) await writeHold(owned);
      } catch { /* best-effort */ }
      return NextResponse.json({ ok: true, alreadyProcessed: true });
    }

    const block = rows[0];
    const held = await writeHold(block);
    return NextResponse.json({ ok: true, block, held });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }
}
