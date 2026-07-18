// v340 — Circle Marketplace Phase M1: Model-3 pre-buy DEMAND-side verify.
//
// POST /api/circle/marketplace/verify
//   Body: { blockId, razorpay_order_id, razorpay_payment_id, razorpay_signature }
//   HMAC-verifies the payment, then:
//     1) flips the block pending_payment → owned (4-key anti-tamper, idempotent),
//     2) STAMPS hotel_room_units.owner_user_id = buyer — guarded
//        or=(owner_user_id.is.null, owner_user_id.in.(<buyerIds>)) so a race can
//        never overwrite a co-investor's ownership (the M1 assignFreeUnit rule),
//     3) writes the deterministic invhold_<blockId> inventory HOLD,
//     4) grants the circle_model3 marker service (best-effort future-proof; the
//        REAL dashboard access is the owner_user_id unit-stamp).
//   Once a buyer owns the unit, later date-range pre-buys reuse the C1/C2 path.
//
// Auth: customer sb_token → cross-pool owner ids.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, genId } from "@/lib/sb-server";
import { userFromReq } from "@/lib/sb";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stamp the assigned physical unit to the buyer — only if still unowned OR
// already the buyer's (idempotent + race-safe). Never takes a co-investor's unit.
async function stampUnitOwner(unitId: string, buyerPrimary: string, buyerIds: string[]): Promise<boolean> {
  try {
    const idsCsv = buyerIds.map((x) => encodeURIComponent(x)).join(",");
    const res = await fetch(
      `${SB_URL}/rest/v1/hotel_room_units?id=eq.${encodeURIComponent(unitId)}` +
        `&or=(owner_user_id.is.null,owner_user_id.in.(${idsCsv}))`,
      {
        method: "PATCH",
        headers: { ...SB_H, Prefer: "return=minimal" },
        body: JSON.stringify({ owner_user_id: buyerPrimary }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

// Write (or refresh) the room-nights HOLD so availability subtracts them.
// Deterministic id → idempotent on re-verify. Best-effort: a hold hiccup must
// NOT fail a succeeded payment.
async function writeHold(block: any): Promise<boolean> {
  try {
    let unitNumber: string | null = block?.metadata?.roomNumber || null;
    if (!unitNumber) {
      try {
        const ur = await fetch(
          `${SB_URL}/rest/v1/hotel_room_units?id=eq.${encodeURIComponent(String(block.unit_id))}&select=roomNumber`,
          { headers: SB_H },
        );
        unitNumber = (await ur.json().catch(() => []))?.[0]?.roomNumber || null;
      } catch { /* optional */ }
    }
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

// Best-effort grant of the circle_model3 marker service to the operated hotel.
// Additive future-proof marker; must never break verify.
async function grantModel3Service(hotelId: string, grantedBy: string): Promise<void> {
  try {
    await fetch(`${SB_URL}/rest/v1/hotel_services?on_conflict=hotel_id,service_key`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        id: genId("svc"),
        hotel_id: hotelId,
        service_key: "circle_model2",
        status: "active",
        access_type: "free",
        granted_by: grantedBy,
        note: "Circle Model-2 inventory investor (pre-buy)",
        updated_at: new Date().toISOString(),
      }),
    });
  } catch { /* best-effort */ }
}

export async function POST(req: NextRequest) {
  const user = userFromReq(req);
  if (!user?.id) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const blockId = String(body?.blockId || "").trim();
  const rzpOrderId = String(body?.razorpay_order_id || "").trim();
  const paymentId = String(body?.razorpay_payment_id || "").trim();
  const signature = String(body?.razorpay_signature || "").trim();
  if (!blockId || !rzpOrderId || !paymentId || !signature) {
    return NextResponse.json({ ok: false, error: "Missing payment fields" }, { status: 400 });
  }

  const buyerIds = await resolveOwnerIdsCrossPool(user.id, user.phone, user.email);
  if (!buyerIds.length) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const buyerPrimary = String(user.id);
  const idsCsv = buyerIds.map((x) => encodeURIComponent(x)).join(",");

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
      // Already processed (or someone else's order). If the block is legitimately
      // owned by this caller, ensure stamp/hold/grant ran, then report idempotent.
      try {
        const gr = await fetch(
          `${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(blockId)}` +
            `&razorpay_order_id=eq.${encodeURIComponent(rzpOrderId)}` +
            `&status=eq.owned&investor_user_id=in.(${idsCsv})&select=*`,
          { headers: SB_H },
        );
        const owned = (gr.ok ? await gr.json().catch(() => []) : [])?.[0];
        if (owned) {
          await stampUnitOwner(String(owned.unit_id), buyerPrimary, buyerIds);
          await writeHold(owned);
          await grantModel3Service(String(owned.hotel_id), buyerPrimary);
        }
      } catch { /* best-effort */ }
      return NextResponse.json({ ok: true, alreadyProcessed: true });
    }

    const block = rows[0];
    const stamped = await stampUnitOwner(String(block.unit_id), buyerPrimary, buyerIds);
    const held = await writeHold(block);
    await grantModel3Service(String(block.hotel_id), buyerPrimary);
    return NextResponse.json({ ok: true, block, stamped, held });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }
}
