// v464 — RazorpayX payout-status webhook (Circle money-out reconciliation).
//
// A RazorpayX payout is ASYNC: createPayout returning success only means the
// payout was ACCEPTED (queued/processing), not that money landed. It can later
// settle as `processed` OR be `reversed`/`failed` (invalid account, low balance
// after queue, etc). Without this, an admin-triggered payout optimistically
// marks its settlement rows `paid`, and a later reversal would leave them `paid`
// with no money moved.
//
// This endpoint verifies the RazorpayX webhook signature and reconciles the
// exact settlement_ledger rows that carry the payout's id in `payout_ref`:
//   • payout.processed             → ensure `paid` (idempotent; no-op if already)
//   • payout.reversed / .failed    → claw back to `owed` so it can be retried
//
// INERT until configured: set RAZORPAYX_WEBHOOK_SECRET on Vercel AND register
// this URL (https://www.staybids.in/api/webhooks/razorpayx) for payout.* events
// in the RazorpayX dashboard. No secret ⇒ every call is a safe no-op.

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { SB_URL, SB_KEY } from "@/lib/sb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex"); const bb = Buffer.from(b, "hex");
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  } catch { return false; }
}

export async function POST(req: NextRequest) {
  const secret = process.env.RAZORPAYX_WEBHOOK_SECRET || "";
  // Read the RAW body FIRST — signature is computed over the exact bytes.
  const raw = await req.text();

  // No secret ⇒ inert. Return 200 so RazorpayX doesn't retry-storm a
  // not-yet-provisioned endpoint; do nothing.
  if (!secret) return NextResponse.json({ ok: true, ignored: "not_configured" });

  const sig = req.headers.get("x-razorpay-signature") || "";
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  if (!sig || !timingSafeEqualHex(sig, expected)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let evt: any = {};
  try { evt = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const event = String(evt?.event || "");
  const payoutId = String(evt?.payload?.payout?.entity?.id || "");
  if (!payoutId) return NextResponse.json({ ok: true, ignored: "no_payout_id" });

  // Only reconcile guest_booking rows carrying THIS payout's ref.
  const encRef = encodeURIComponent(payoutId);
  const patch = async (where: string, body: object) => {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/settlement_ledger?kind=eq.guest_booking&payout_ref=eq.${encRef}&${where}`, {
        method: "PATCH", headers: { ...SB_H, Prefer: "return=representation" },
        body: JSON.stringify({ ...body, updated_at: new Date().toISOString() }),
      });
      if (!r.ok) return 0;
      const rows = await r.json().catch(() => []);
      return Array.isArray(rows) ? rows.length : 0;
    } catch { return 0; }
  };

  if (event === "payout.processed") {
    // Money delivered — ensure paid (no-op if the admin action already flipped it).
    const n = await patch("payout_status=eq.paying", { payout_status: "paid", paid_at: new Date().toISOString() });
    return NextResponse.json({ ok: true, event, payoutId, reconciled: n });
  }
  if (event === "payout.reversed" || event === "payout.failed") {
    // Money did NOT land (or came back) — claw the rows back to owed for retry.
    const n = await patch("payout_status=in.(paid,paying)", { payout_status: "owed", paid_at: null });
    return NextResponse.json({ ok: true, event, payoutId, clawedBack: n });
  }

  return NextResponse.json({ ok: true, ignored: event || "unhandled" });
}
