// v381 — Model 3 LIVE: an agent withdraws their OWN live bid so an old bid never
// blocks a new one. Cancellable while the agent hasn't PAID: status active
// (pending), countered, or accepted-unpaid. An accepted bid also has an award
// (minted on accept) that is un-paid — we cancel that too. A PAID/voucher/won bid
// is a completed purchase (not cancellable); lost/expired/cancelled are terminal.
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";
import { requireApprovedAgent } from "@/lib/trade/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CANCELLABLE = ["active", "countered", "accepted"];

export async function POST(req: NextRequest) {
  const gate = await requireApprovedAgent(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const agentUserId = gate.auth.user.id;

  let body: any = {};
  try { body = await req.json(); } catch {}
  const bidId = String(body.bidId || "").trim();
  if (!bidId) return NextResponse.json({ error: "bidId required." }, { status: 400 });

  // Ownership check (so the error is friendly; the guarded PATCH is the real gate).
  const r = await fetch(`${SB_URL}/rest/v1/auction_bids?id=eq.${encodeURIComponent(bidId)}&select=id,agent_user_id,status&limit=1`, { headers: SB_READ, cache: "no-store" });
  const [bid] = r.ok ? await r.json().catch(() => []) : [];
  if (!bid) return NextResponse.json({ error: "Bid not found." }, { status: 404 });
  if (bid.agent_user_id !== agentUserId) return NextResponse.json({ error: "Not your bid." }, { status: 403 });
  if (!CANCELLABLE.includes(bid.status)) {
    return NextResponse.json({ error: `This bid can't be withdrawn (it's ${bid.status}).` }, { status: 409 });
  }

  // Guarded flip: only your own bid, only while still un-paid (idempotent).
  const pr = await fetch(
    `${SB_URL}/rest/v1/auction_bids?id=eq.${encodeURIComponent(bidId)}&agent_user_id=eq.${encodeURIComponent(agentUserId)}&status=in.(active,countered,accepted)`,
    { method: "PATCH", headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify({ status: "cancelled", updated_at: new Date().toISOString() }) },
  );
  const rows = pr.ok ? await pr.json().catch(() => []) : [];
  if (!Array.isArray(rows) || !rows.length) return NextResponse.json({ ok: true, alreadyResolved: true });

  // If an accept minted an award for this bid, cancel that too (only while
  // un-paid: status='awarded'). A paid/voucher_issued award is never touched.
  try {
    await fetch(
      `${SB_URL}/rest/v1/auction_awards?bid_id=eq.${encodeURIComponent(bidId)}&agent_user_id=eq.${encodeURIComponent(agentUserId)}&status=eq.awarded`,
      { method: "PATCH", headers: { ...SB_H, Prefer: "return=minimal" },
        body: JSON.stringify({ status: "cancelled", updated_at: new Date().toISOString() }) },
    );
  } catch { /* best-effort — the bid is already withdrawn */ }

  return NextResponse.json({ ok: true, status: "cancelled" });
}
