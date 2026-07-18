import { NextResponse } from "next/server";
import { SB_URL, SB_H } from "@/lib/sb";
import { sbCacheInvalidate } from "@/lib/sb-cache";
import { provisionBundle } from "@/lib/circle/provision";
import { genId } from "@/lib/sb-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// v344 — M5: best-effort grant of the circle_model1 marker service to a
// provisioned host hotel for the revenue-share INVESTOR (enrollment marker;
// mirrors grantModel3/4Service). Real access is ownership-based (the stamped
// owned units). Must never break verify — the payment is already recorded.
async function grantModel1Service(hotelId: string, grantedBy: string): Promise<void> {
  if (!hotelId) return;
  try {
    await fetch(`${SB_URL}/rest/v1/hotel_services?on_conflict=hotel_id,service_key`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        id: genId("svc"),
        hotel_id: hotelId,
        service_key: "circle_model1",
        status: "active",
        access_type: "free",
        granted_by: grantedBy,
        note: "Circle Model-1 revenue-share investor",
        updated_at: new Date().toISOString(),
      }),
    });
  } catch { /* best-effort */ }
}

// POST /api/circle/verify
// Body: { bundleId, razorpay_order_id, razorpay_payment_id, razorpay_signature }
//
// Anti-tamper chain (same as host portfolio verify): HMAC via the shared
// /api/razorpay/verify, then the bundle row is flipped to 'active' matched by
// BOTH id + razorpay_order_id + status='pending_payment'. Only THIS route
// flips a bundle active — never the admin panel (see v284 gotcha).
// On success it also bumps locked_units on each room type + converts the
// user's circle_locks for the bundled properties.
export async function POST(req: Request) {
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  const bundleId = String(body?.bundleId || "").trim();
  const rzpOrderId = String(body?.razorpay_order_id || "").trim();
  const paymentId = String(body?.razorpay_payment_id || "").trim();
  const signature = String(body?.razorpay_signature || "").trim();

  if (!bundleId || !rzpOrderId || !paymentId || !signature) {
    return NextResponse.json({ ok: false, error: "Missing fields" }, { status: 400 });
  }

  const origin = new URL(req.url).origin;
  let verified = false;
  try {
    const vr = await fetch(`${origin}/api/razorpay/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        razorpay_order_id: rzpOrderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: signature,
      }),
    });
    const vj = await vr.json().catch(() => ({}));
    verified = !!vj?.verified;
  } catch {
    return NextResponse.json({ ok: false, error: "Verification unreachable" }, { status: 502 });
  }
  if (!verified) {
    return NextResponse.json({ ok: false, error: "Payment signature mismatch" }, { status: 400 });
  }

  // A 10% Visit-Access Hold lands as 'hold_paid' (balance due after the visit +
  // signed agreement); full/EMI payments go straight to 'active'.
  let payOption = "full";
  try {
    const gr = await fetch(
      `${SB_URL}/rest/v1/circle_bundles?id=eq.${bundleId}&razorpay_order_id=eq.${rzpOrderId}&select=pay_option`,
      { headers: SB_H },
    );
    const [row] = gr.ok ? await gr.json() : [];
    if (row?.pay_option) payOption = String(row.pay_option);
  } catch { /* default full */ }
  const targetStatus = payOption === "hold" ? "hold_paid" : "active";

  let bundle: any = null;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/circle_bundles?id=eq.${bundleId}&razorpay_order_id=eq.${rzpOrderId}&status=eq.pending_payment`,
      {
        method: "PATCH",
        headers: { ...SB_H, Prefer: "return=representation" },
        body: JSON.stringify({
          status: targetStatus,
          razorpay_payment_id: paymentId,
          updated_at: new Date().toISOString(),
        }),
      },
    );
    const rows = r.ok ? await r.json() : [];
    if (!rows.length) {
      return NextResponse.json({ ok: true, alreadyProcessed: true });
    }
    bundle = rows[0];
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }

  // Post-activation side effects — best-effort, never fail the response
  // (the payment IS verified + recorded; inventory drift is admin-fixable).
  const items: any[] = Array.isArray(bundle?.items) ? bundle.items : [];
  for (const it of items) {
    try {
      const rr = await fetch(
        `${SB_URL}/rest/v1/circle_room_types?id=eq.${encodeURIComponent(String(it.roomTypeId))}&select=id,locked_units`,
        { headers: SB_H },
      );
      const [rt] = rr.ok ? await rr.json() : [];
      if (rt) {
        await fetch(`${SB_URL}/rest/v1/circle_room_types?id=eq.${rt.id}`, {
          method: "PATCH",
          headers: SB_H,
          body: JSON.stringify({
            locked_units: (Number(rt.locked_units) || 0) + (Number(it.rooms) || 0),
          }),
        });
      }
    } catch { /* best-effort */ }
  }

  if (bundle?.user_id && items.length) {
    try {
      const propIds: string[] = [];
      items.forEach((it) => {
        const pid = String(it.propertyId || "");
        if (pid && !propIds.includes(pid)) propIds.push(pid);
      });
      if (propIds.length) {
        await fetch(
          `${SB_URL}/rest/v1/circle_locks?user_id=eq.${encodeURIComponent(bundle.user_id)}&property_id=in.(${propIds.map((i) => `"${i}"`).join(",")})&status=eq.locked`,
          { method: "PATCH", headers: SB_H, body: JSON.stringify({ status: "converted" }) },
        );
      }
    } catch { /* best-effort */ }
  }

  // Phase 2 — provision real bookable inventory (hotel + rooms + owned units)
  // ONLY on full activation. A 10% Visit-Access Hold ('hold_paid') still owes
  // the balance + a signed agreement, so inventory is not created yet.
  // Best-effort: never fail the verified-payment response.
  let provision: any = null;
  if (targetStatus === "active") {
    try {
      provision = await provisionBundle(bundle);
    } catch { /* best-effort */ }
    // v344 — M5: enroll the investor into the circle_model1 marker service on
    // each provisioned hotel (idempotent upsert; never blocks the response).
    try {
      const hotels: string[] = Array.isArray(provision?.hotels) ? provision.hotels : [];
      const grantedBy = String(bundle?.user_id || "");
      for (const hid of hotels) await grantModel1Service(String(hid), grantedBy);
    } catch { /* best-effort */ }
  }

  // Availability changed — drop the cached catalog so the feed reflects it.
  try { sbCacheInvalidate("circle:"); } catch { /* best-effort */ }

  return NextResponse.json({ ok: true, bundle, provision });
}
