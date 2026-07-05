import { NextResponse } from "next/server";
import { SB_URL, SB_H } from "@/lib/sb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/host/portfolio/verify
// Body: { configId, razorpay_order_id, razorpay_payment_id, razorpay_signature }
// Verifies the HMAC then flips the config to 'active'. Matched by BOTH id +
// razorpay_order_id so a tampered configId can't activate someone else's config.
export async function POST(req: Request) {
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  const configId = String(body?.configId || "").trim();
  const rzpOrderId = String(body?.razorpay_order_id || "").trim();
  const paymentId = String(body?.razorpay_payment_id || "").trim();
  const signature = String(body?.razorpay_signature || "").trim();

  if (!configId || !rzpOrderId || !paymentId || !signature) {
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

  // v285 — a 10% Visit-Access Hold lands in 'hold_paid' (balance due after the
  // visit + agreement); full/emi land in 'active'. Read the stored pay_option so
  // the label is server-authoritative (no CHECK on status → no constraint alter).
  let targetStatus = "active";
  try {
    const gr = await fetch(
      `${SB_URL}/rest/v1/host_portfolio_configs?id=eq.${configId}&razorpay_order_id=eq.${rzpOrderId}&select=pay_option`,
      { headers: SB_H },
    );
    if (gr.ok) {
      const rows = await gr.json().catch(() => []);
      if (rows?.[0]?.pay_option === "hold") targetStatus = "hold_paid";
    }
  } catch { /* default 'active' */ }

  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/host_portfolio_configs?id=eq.${configId}&razorpay_order_id=eq.${rzpOrderId}&status=eq.pending_payment`,
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
    return NextResponse.json({ ok: true, config: rows[0] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }
}
