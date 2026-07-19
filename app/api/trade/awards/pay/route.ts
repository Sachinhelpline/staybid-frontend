// v361 — Model 3: WINNER pays the balance on a won award. Balance = winning bid
// + buyer premium − EMD already applied (all frozen at clearing; client never
// sets ₹). Creates ONE Razorpay order for award.amount_due and stamps it onto
// the award. The sibling verify issues the voucher + owner settlement.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";
import { requireApprovedAgent } from "@/lib/trade/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLIC_KEY_ID = "rzp_live_SfFAsbYjbHfztd";

export async function POST(req: NextRequest) {
  const gate = await requireApprovedAgent(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const agentUserId = gate.auth.user.id;

  let body: any = {};
  try { body = await req.json(); } catch {}
  const awardId = String(body.awardId || "").trim();
  if (!awardId) return NextResponse.json({ error: "awardId required." }, { status: 400 });

  const r = await fetch(`${SB_URL}/rest/v1/auction_awards?id=eq.${encodeURIComponent(awardId)}&select=*&limit=1`, { headers: SB_READ, cache: "no-store" });
  const [award] = r.ok ? await r.json().catch(() => []) : [];
  if (!award) return NextResponse.json({ error: "Award not found." }, { status: 404 });
  if (award.agent_user_id !== agentUserId) return NextResponse.json({ error: "Not your award." }, { status: 403 });
  if (award.status !== "awarded") return NextResponse.json({ error: `Award is ${award.status}.` }, { status: 409 });
  if (award.pay_window_close_at && new Date(award.pay_window_close_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: "Pay window closed." }, { status: 409 });
  }
  const amountDue = Math.round(Number(award.amount_due) || 0);
  if (amountDue < 1) return NextResponse.json({ error: "Nothing due." }, { status: 400 });

  const origin = new URL(req.url).origin;
  let rzp: any = null;
  try {
    const orderRes = await fetch(`${origin}/api/razorpay/order`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amountDue, receipt: `awd_${awardId}`.slice(0, 40), notes: { kind: "auction_award_balance", awardId } }),
    });
    rzp = await orderRes.json().catch(() => ({}));
    if (!orderRes.ok || !rzp?.id) return NextResponse.json({ error: rzp?.error || "Could not start payment." }, { status: 502 });
  } catch { return NextResponse.json({ error: "Payment gateway unreachable." }, { status: 502 }); }

  // Stamp the order onto the award (so verify can 4-key match).
  await fetch(`${SB_URL}/rest/v1/auction_awards?id=eq.${encodeURIComponent(awardId)}&status=eq.awarded`, {
    method: "PATCH", headers: { ...SB_H, Prefer: "return=minimal" },
    body: JSON.stringify({ razorpay_order_id: rzp.id, updated_at: new Date().toISOString() }),
  }).catch(() => {});

  return NextResponse.json({ ok: true, orderId: rzp.id, amountPaise: amountDue * 100, amountRupees: amountDue, keyId: PUBLIC_KEY_ID, prefill: { name: gate.auth.agent!.agency_name, email: gate.auth.agent!.email } });
}
