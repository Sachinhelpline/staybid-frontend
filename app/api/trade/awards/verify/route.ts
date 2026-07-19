// v361 — Model 3: verify the WINNER balance payment. HMAC once, then a 4-key
// idempotent flip (award id + agent + status=awarded + razorpay_order_id) →
// voucher_issued, stamp the payment + a deterministic voucher code. On the
// FIRST successful flip only, write the owner's settlement (owed) — idempotent
// via uniq_settlement_kind_ref. A 0-row flip = already processed (no re-charge).
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, genId } from "@/lib/sb-server";
import { requireApprovedAgent } from "@/lib/trade/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const voucherCode = (awardId: string) => `AUC-${awardId.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase()}`;

export async function POST(req: NextRequest) {
  const gate = await requireApprovedAgent(req);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const agentUserId = gate.auth.user.id;

  let body: any = {};
  try { body = await req.json(); } catch {}
  const awardId = String(body.awardId || "").trim();
  const orderId = String(body.razorpay_order_id || "").trim();
  const paymentId = String(body.razorpay_payment_id || "").trim();
  const signature = String(body.razorpay_signature || "").trim();
  if (!awardId || !orderId || !paymentId || !signature) return NextResponse.json({ ok: false, error: "Missing fields." }, { status: 400 });

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
  if (!verified) return NextResponse.json({ ok: false, error: "Signature mismatch." }, { status: 400 });

  const code = voucherCode(awardId);
  // 4-key idempotent flip.
  const r = await fetch(
    `${SB_URL}/rest/v1/auction_awards?id=eq.${encodeURIComponent(awardId)}&agent_user_id=eq.${encodeURIComponent(agentUserId)}&status=eq.awarded&razorpay_order_id=eq.${encodeURIComponent(orderId)}`,
    { method: "PATCH", headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify({ status: "voucher_issued", razorpay_payment_id: paymentId, voucher_code: code, updated_at: new Date().toISOString(),
        // amount_paid stamped from the frozen amount_due below via representation read
      }) },
  );
  if (!r.ok) { const t = await r.text(); return NextResponse.json({ ok: false, error: "Confirm failed.", detail: t }, { status: 500 }); }
  const rows = await r.json().catch(() => []);
  const award = Array.isArray(rows) ? rows[0] : null;
  if (!award) return NextResponse.json({ ok: true, alreadyProcessed: true });

  // Stamp amount_paid = amount_due (best-effort; the flip already committed the voucher).
  await fetch(`${SB_URL}/rest/v1/auction_awards?id=eq.${encodeURIComponent(awardId)}`, {
    method: "PATCH", headers: { ...SB_H, Prefer: "return=minimal" },
    body: JSON.stringify({ amount_paid: Number(award.amount_due) || 0 }),
  }).catch(() => {});

  // Owner settlement (owed) — idempotent via uniq_settlement_kind_ref.
  try {
    await fetch(`${SB_URL}/rest/v1/settlement_ledger`, {
      method: "POST", headers: { ...SB_H, Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({
        id: genId("setl"), kind: "auction_award", ref_id: String(award.id), payee_user_id: String(award.owner_user_id),
        gross_amount: Number(award.base_total) || 0, platform_fee: Number(award.platform_fee) || 0,
        net_amount: Number(award.seller_net) || 0, payout_status: "owed", created_at: new Date().toISOString(),
      }),
    });
  } catch { /* best-effort — never block a verified payment */ }

  return NextResponse.json({ ok: true, voucher: code, award: { id: award.id, rooms: award.rooms_awarded } });
}
