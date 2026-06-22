import { NextResponse } from "next/server";
import { SB_URL, SB_H } from "@/lib/sb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/host/store/verify
// Body: { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature }
// Verifies the HMAC via the shared self-healing verify route, then flips the
// store_orders row to 'paid'. The order is matched by BOTH id + razorpay_order_id
// so a tampered orderId can't mark someone else's order paid.
export async function POST(req: Request) {
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  const orderId = String(body?.orderId || "").trim();
  const rzpOrderId = String(body?.razorpay_order_id || "").trim();
  const paymentId = String(body?.razorpay_payment_id || "").trim();
  const signature = String(body?.razorpay_signature || "").trim();

  if (!orderId || !rzpOrderId || !paymentId || !signature) {
    return NextResponse.json({ ok: false, error: "Missing fields" }, { status: 400 });
  }

  // 1) Verify the signature (reuses the self-healing key logic).
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

  // 2) Flip the order to 'paid' — match id AND razorpay_order_id, only from pending.
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/store_orders?id=eq.${orderId}&razorpay_order_id=eq.${rzpOrderId}&status=eq.pending`,
      {
        method: "PATCH",
        headers: { ...SB_H, Prefer: "return=representation" },
        body: JSON.stringify({
          status: "paid",
          razorpay_payment_id: paymentId,
          updated_at: new Date().toISOString(),
        }),
      },
    );
    const rows = r.ok ? await r.json() : [];
    if (!rows.length) {
      // Either already paid, or no match — verified payment still succeeded.
      return NextResponse.json({ ok: true, alreadyProcessed: true });
    }
    return NextResponse.json({ ok: true, order: rows[0] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }
}
