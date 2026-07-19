// v361 — Model 3: sealed-bid VERIFY. HMAC-verifies the single EMD payment, then
// flips EVERY pending bid on that order (owned by this agent) to `active` via a
// 4-key idempotent PATCH (razorpay_order_id + agent_user_id + status=pending +
// stamp payment id). A 0-row flip = already processed → never re-charge. The
// deposit is now held; the clearing cron (Phase 3) decides win/lose.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H } from "@/lib/sb";
import { requireApprovedAgent } from "@/lib/trade/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const gate = await requireApprovedAgent(req);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const agentUserId = gate.auth.user.id;

  let body: any = {};
  try { body = await req.json(); } catch {}
  const orderId = String(body.razorpay_order_id || "").trim();
  const paymentId = String(body.razorpay_payment_id || "").trim();
  const signature = String(body.razorpay_signature || "").trim();
  if (!orderId || !paymentId || !signature) return NextResponse.json({ ok: false, error: "Missing payment fields." }, { status: 400 });

  // HMAC verify once.
  const origin = new URL(req.url).origin;
  let verified = false;
  try {
    const vr = await fetch(`${origin}/api/razorpay/verify`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature }),
    });
    verified = !!(await vr.json().catch(() => ({})))?.verified;
  } catch { return NextResponse.json({ ok: false, error: "Verification unreachable." }, { status: 502 }); }
  if (!verified) return NextResponse.json({ ok: false, error: "Payment signature mismatch." }, { status: 400 });

  // 4-key idempotent activate. return=representation → count how many flipped.
  const r = await fetch(
    `${SB_URL}/rest/v1/auction_bids?razorpay_order_id=eq.${encodeURIComponent(orderId)}` +
      `&agent_user_id=eq.${encodeURIComponent(agentUserId)}&status=eq.pending_payment`,
    { method: "PATCH", headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify({ status: "active", razorpay_payment_id: paymentId, updated_at: new Date().toISOString() }) },
  );
  if (!r.ok) { const t = await r.text(); return NextResponse.json({ ok: false, error: "Activation failed.", detail: t }, { status: 500 }); }
  const flipped = await r.json().catch(() => []);
  const count = Array.isArray(flipped) ? flipped.length : 0;

  return NextResponse.json({ ok: true, activated: count, alreadyProcessed: count === 0 });
}
