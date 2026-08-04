// v361 — Model 3: verify the WINNER balance payment. HMAC once, then a 4-key
// idempotent flip (award id + agent + status=awarded + razorpay_order_id) →
// voucher_issued, stamp the payment + a deterministic voucher code. On the
// FIRST successful flip only, write the owner's settlement (owed) — idempotent
// via uniq_settlement_kind_ref. A 0-row flip = already processed (no re-charge).
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, genId } from "@/lib/sb-server";
import { requireApprovedAgent } from "@/lib/trade/auth";
import { roomHasActiveUnits } from "@/lib/inventory/assign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const voucherCode = (awardId: string) => `AUC-${awardId.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase()}`;

// v729 — Cross-channel oversell CORE FIX (Phase 2): a category-level allotment
// hold for a CLASSIC (unit-less) hotel. A room WITH physical units is reserved
// by the agent's OPTIONAL enable-selling unit hold; a classic room (category +
// `rooms.quantity`, no `hotel_room_units`) can't assign a unit, so the won
// allotment would stay guest/OTA-bookable = PERMANENT oversell. We write one
// category-hold `room_blocks` row per awarded room per contiguous run (NO
// assignedUnitId, deterministic id) covering the allotment nights. The
// availability engine already counts every block as one unit against
// `rooms.quantity` (`unitsFreeForRange`), so free capacity drops by the held
// rooms with NO engine change. Idempotent (deterministic ids + merge-duplicates
// upsert); best-effort only — a hold hiccup must NEVER block a verified payment.
const addDays = (s: string, n: number) =>
  new Date(new Date(s + "T00:00:00Z").getTime() + n * 86_400_000).toISOString().slice(0, 10);

// Contiguous [from, to) runs from a set of ISO nights (weekend segments are
// non-contiguous, so an award can span several runs).
function groupRuns(dates: string[]): { from: string; to: string; nights: number }[] {
  const sorted = Array.from(
    new Set(dates.filter((d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))),
  ).sort();
  const runs: { from: string; to: string; nights: number }[] = [];
  let i = 0;
  while (i < sorted.length) {
    const from = sorted[i];
    let n = 1;
    while (i + n < sorted.length && sorted[i + n] === addDays(from, n)) n++;
    runs.push({ from, to: addDays(from, n), nights: n });
    i += n;
  }
  return runs;
}

async function writeClassicAllotmentHolds(award: any, agentPrimary: string): Promise<void> {
  const hotelId = String(award?.hotel_id || "");
  const roomId = String(award?.room_id || "");
  const rooms = Math.max(0, Math.round(Number(award?.rooms_awarded) || 0));
  const nights: string[] = Array.isArray(award?.night_dates) ? award.night_dates.map(String) : [];
  if (!hotelId || !roomId || rooms < 1 || !nights.length) return;

  // ONLY classic (no physical units). A room WITH units keeps the existing
  // enable-selling unit hold — writing category holds there would double-block
  // real guests. Unknown (lookup error) → skip (never over-block guests).
  const hasUnits = await roomHasActiveUnits(hotelId, roomId);
  if (hasUnits !== false) return;

  const runs = groupRuns(nights);
  for (const run of runs) {
    for (let slot = 0; slot < rooms; slot++) {
      await fetch(`${SB_URL}/rest/v1/room_blocks?on_conflict=id`, {
        method: "POST",
        headers: { ...SB_H, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          id: `allot_${String(award.id)}_${run.from}_${slot}`,
          hotelId,
          roomId,
          fromDate: run.from,
          toDate: run.to,
          source: "allotment",
          note: "StayBid Model-3 auction allotment hold (classic category)",
          createdBy: agentPrimary,
        }),
      }).catch(() => {});
    }
  }
}

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

  // v729 — CLASSIC (unit-less) hotel oversell fix: reserve the won allotment
  // with category-level room_blocks holds so it stops being guest/OTA-bookable.
  // Best-effort — must NEVER throw/block the already-verified payment.
  try {
    await writeClassicAllotmentHolds(award, agentUserId);
  } catch { /* best-effort — never block a verified payment */ }

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
