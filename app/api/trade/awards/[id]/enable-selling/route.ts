// v365 — Model 3 Phase A: a WINNER opts to sell their won allotment on the
// StayBid owner dashboard + OTA. This grants OPERATOR SCOPE over the won units
// for exactly the allotment nights, reusing the proven M1/M4 precedent:
//   assignFreeUnit → mint a date-bounded inventory_blocks row (investor = agent)
//   → stampUnitOwner (guarded) → writeHold (protect the nights).
// After this, resolveOperatedHotelIds / partnerUnitScope light up the agent's
// "My Rooms" tab + the per-unit OTA feeds route. Idempotent (deterministic block
// ids). No money moves. The agent can also just use their own channel (no call).
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";
import { genId } from "@/lib/sb-server";
import { requireApprovedAgent } from "@/lib/trade/auth";
import { assignFreeUnit } from "@/lib/inventory/assign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const addDays = (s: string, n: number) => new Date(new Date(s + "T00:00:00Z").getTime() + n * 86_400_000).toISOString().slice(0, 10);
// Contiguous runs [from, to) from a set of ISO nights (weekend segments are non-contiguous).
function groupRuns(dates: string[]): { from: string; to: string; nights: number }[] {
  const sorted = Array.from(new Set(dates)).sort();
  const runs: { from: string; to: string; nights: number }[] = [];
  let i = 0;
  while (i < sorted.length) {
    const from = sorted[i]; let n = 1;
    while (i + n < sorted.length && sorted[i + n] === addDays(from, n)) n++;
    runs.push({ from, to: addDays(from, n), nights: n });
    i += n;
  }
  return runs;
}

async function stampUnitOwner(unitId: string, agentPrimary: string, agentIds: string[]) {
  if (!unitId) return;
  try {
    const csv = agentIds.map((x) => encodeURIComponent(x)).join(",");
    await fetch(`${SB_URL}/rest/v1/hotel_room_units?id=eq.${encodeURIComponent(unitId)}&or=(owner_user_id.is.null,owner_user_id.in.(${csv}))`, {
      method: "PATCH", headers: { ...SB_H, Prefer: "return=minimal" }, body: JSON.stringify({ owner_user_id: agentPrimary }),
    });
  } catch { /* best-effort */ }
}
async function writeHold(block: any, agentPrimary: string) {
  try {
    await fetch(`${SB_URL}/rest/v1/room_blocks?on_conflict=id`, {
      method: "POST", headers: { ...SB_H, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        id: `invhold_${block.id}`, hotelId: String(block.hotel_id), roomId: String(block.room_id),
        fromDate: String(block.date_from), toDate: String(block.date_to), source: "inventory",
        assignedUnitId: String(block.unit_id), note: "StayBid Model-3 auction allotment hold", createdBy: agentPrimary,
      }),
    });
  } catch { /* best-effort */ }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireApprovedAgent(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const agentUserId = gate.auth.user.id;
  const agentIds = [agentUserId];
  const { id: awardId } = await ctx.params;

  const r = await fetch(`${SB_URL}/rest/v1/auction_awards?id=eq.${encodeURIComponent(awardId)}&select=*&limit=1`, { headers: SB_READ, cache: "no-store" });
  const [award] = r.ok ? await r.json().catch(() => []) : [];
  if (!award) return NextResponse.json({ error: "Award not found." }, { status: 404 });
  if (award.agent_user_id !== agentUserId) return NextResponse.json({ error: "Not your award." }, { status: 403 });
  if (award.status !== "voucher_issued") return NextResponse.json({ error: "Pay the balance first to unlock selling." }, { status: 409 });

  const nights: string[] = Array.isArray(award.night_dates) ? award.night_dates : [];
  const runs = groupRuns(nights);
  const roomsAwarded = Number(award.rooms_awarded) || 0;
  const perNight = Number(award.per_room_per_night) || 0;
  if (!runs.length || roomsAwarded < 1) return NextResponse.json({ error: "Nothing to enable." }, { status: 400 });

  const grantedUnits = new Set<string>();
  const blockIds: string[] = [];
  // For each contiguous run, assign up to roomsAwarded distinct free units; mint a
  // date-bounded block per (run, slot) BEFORE the next assign so units don't collide.
  for (const run of runs) {
    for (let slot = 0; slot < roomsAwarded; slot++) {
      const unit = await assignFreeUnit({ hotelId: String(award.hotel_id), roomId: String(award.room_id), from: run.from, to: run.to, buyerIds: agentIds });
      if (!unit) break; // not enough free units for this run — stop this run
      const blockId = `aucblk_${awardId}_${run.from}_${slot}`;
      const block = {
        id: blockId, investor_user_id: agentUserId, hotel_id: String(award.hotel_id), unit_id: unit.unitId,
        room_id: String(award.room_id), date_from: run.from, date_to: run.to, nights: run.nights,
        buy_price_per_night: perNight, buy_total: perNight * run.nights, resale_price_per_night: 0,
        platform_fee_pct: 0, status: "owned",
        metadata: { source: "auction_award", awardId, roomNumber: unit.roomNumber },
        updated_at: new Date().toISOString(),
      };
      await fetch(`${SB_URL}/rest/v1/inventory_blocks?on_conflict=id`, {
        method: "POST", headers: { ...SB_H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(block),
      }).catch(() => {});
      await stampUnitOwner(unit.unitId, agentUserId, agentIds);
      await writeHold(block, agentUserId);
      grantedUnits.add(unit.unitId);
      blockIds.push(blockId);
    }
  }

  // Mark the award so the UI knows selling is enabled (idempotent).
  await fetch(`${SB_URL}/rest/v1/auction_awards?id=eq.${encodeURIComponent(awardId)}`, {
    method: "PATCH", headers: { ...SB_H, Prefer: "return=minimal" },
    body: JSON.stringify({ metadata: { ...(award.metadata || {}), selling_enabled: grantedUnits.size > 0, granted_units: grantedUnits.size }, updated_at: new Date().toISOString() }),
  }).catch(() => {});

  return NextResponse.json({
    ok: true, granted: grantedUnits.size, blocks: blockIds.length,
    message: grantedUnits.size > 0
      ? "StayBid selling enabled — manage & list your rooms + OTA feeds in the partner dashboard."
      : "This property has no self-manageable units right now — use your own channel, or contact ops.",
  });
}
