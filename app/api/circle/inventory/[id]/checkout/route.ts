// v328 — Circle Phase C2: Model 3 pre-buy PURCHASE (checkout).
//
// POST /api/circle/inventory/[id]/checkout
//   Owner-verified. RE-QUOTES the Pricing Spine at pay time (price may have
//   moved since the draft) and FREEZES the buy on the row, re-runs the overlap
//   guard (excluding self), then creates a Razorpay order for the fresh
//   buy_total (client NEVER sets the amount) and flips the block to
//   `pending_payment`. Verify (→ `owned` + inventory hold) is the sibling route.
//
// Auth: partner Bearer JWT → cross-pool owner ids. Tamper-safe: amount is the
// server-recomputed Spine buy, the PATCH is guarded on ownership + status.

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_H_REPRESENT, decodeJwt } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { quoteInventoryBlock } from "@/lib/inventory/quote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public LIVE key id (safe in client code) — same source as the host checkout.
const PUBLIC_KEY_ID = "rzp_live_SfFAsbYjbHfztd";

function auth(req: NextRequest): { userId?: string; phone?: string; email?: string } {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  return { userId: p?.id || p?.user_id || p?.sub, phone: p?.phone, email: p?.email };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const blockId = String(id || "").trim();
  if (!blockId) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { userId, phone, email } = auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ownerIds = await resolveOwnerIdsCrossPool(userId, phone, email);
  if (!ownerIds.length) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const owns = (v: any) => ownerIds.map(String).includes(String(v));

  // Load the block; must be un-purchased (draft|quoted) and owned by the caller.
  let block: any = null;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(blockId)}&select=*`,
      { headers: SB_H },
    );
    const rows = r.ok ? await r.json().catch(() => []) : [];
    block = Array.isArray(rows) ? rows[0] : null;
  } catch { /* handled below */ }

  if (!block || !owns(block.investor_user_id)) {
    return NextResponse.json({ error: "Forbidden — not your block" }, { status: 403 });
  }
  if (!["draft", "quoted"].includes(String(block.status))) {
    return NextResponse.json(
      { error: `This block is already ${String(block.status).replace(/_/g, " ")}.` },
      { status: 409 },
    );
  }

  // Overlap re-guard at pay time — a DIFFERENT non-terminal block may have
  // grabbed these nights on the same unit since the draft was saved.
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/inventory_blocks?unit_id=eq.${encodeURIComponent(String(block.unit_id))}` +
        `&id=neq.${encodeURIComponent(blockId)}` +
        `&status=not.in.(expired,cancelled,refunded)` +
        `&date_from=lt.${block.date_to}&date_to=gt.${block.date_from}&select=id&limit=1`,
      { headers: SB_H },
    );
    const clash = r.ok ? await r.json().catch(() => []) : [];
    if (Array.isArray(clash) && clash.length) {
      return NextResponse.json(
        { error: "These nights were just taken by another block on this room." },
        { status: 409 },
      );
    }
  } catch { /* non-fatal — the DB is the final integrity gate */ }

  // Re-quote the Spine NOW → freeze the wholesale buy at pay time.
  const quote = await quoteInventoryBlock({
    roomId: String(block.room_id),
    from: String(block.date_from),
    to: String(block.date_to),
  });
  if (!quote || quote.buyTotal <= 0) {
    return NextResponse.json({ error: "Couldn't price this range right now — try again." }, { status: 422 });
  }

  // Create the Razorpay order via the shared self-healing route (amount rupees).
  const origin = new URL(req.url).origin;
  let rzp: any = null;
  try {
    const orderRes = await fetch(`${origin}/api/razorpay/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: quote.buyTotal,
        receipt: `cinv_${blockId}`.slice(0, 40),
        notes: { kind: "circle_inventory", blockId, unitId: String(block.unit_id) },
      }),
    });
    rzp = await orderRes.json().catch(() => ({}));
    if (!orderRes.ok || !rzp?.id) {
      return NextResponse.json(
        { error: rzp?.error || "Could not start payment.", detail: rzp?.code || null },
        { status: 502 },
      );
    }
  } catch {
    return NextResponse.json({ error: "Payment gateway unreachable." }, { status: 502 });
  }

  // Freeze the fresh buy + order id; flip to pending_payment.
  // PATCH guarded on ownership + status so a race can't double-charge.
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/inventory_blocks?id=eq.${encodeURIComponent(blockId)}` +
        `&status=in.(draft,quoted)&investor_user_id=in.(${ownerIds.map((x) => encodeURIComponent(x)).join(",")})`,
      {
        method: "PATCH",
        headers: SB_H_REPRESENT,
        body: JSON.stringify({
          status: "pending_payment",
          buy_price_per_night: quote.avgBuyPerNight,
          buy_total: quote.buyTotal,
          platform_fee_pct: quote.feePct,
          razorpay_order_id: rzp.id,
          metadata: {
            ...(block.metadata && typeof block.metadata === "object" ? block.metadata : {}),
            repricedAt: new Date().toISOString(),
            suggestedResaleTotal: quote.suggestedResaleTotal,
          },
          updated_at: new Date().toISOString(),
        }),
      },
    );
    const rows = res.ok ? await res.json().catch(() => []) : [];
    if (!Array.isArray(rows) || !rows.length) {
      return NextResponse.json({ error: "Block changed — refresh and try again." }, { status: 409 });
    }
    return NextResponse.json({
      ok: true,
      keyId: PUBLIC_KEY_ID,
      order: { id: rzp.id, amount: rzp.amount, currency: rzp.currency || "INR" },
      buyTotal: quote.buyTotal,
      block: rows[0],
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Checkout failed" }, { status: 500 });
  }
}
