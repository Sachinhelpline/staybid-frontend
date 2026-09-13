// POST / DELETE /api/partner/room-units/assign
// Assign / transfer / release PHYSICAL room units (numbered rooms) for a bid, or
// pin a unit onto a walk-in/OTA room_block.
//
// STAY-LIFECYCLE-OPS-01 — HARDENED + ATOMIC. The previous handler trusted a
// DECODE-ONLY JWT, never checked the partner's hotel, and blindly upserted
// whatever unitId the client sent. Now:
//   • AUTHORITY: the partner token is CRYPTOGRAPHICALLY verified and the partner
//     must hold an ACTIVE protected verified_partner_hotel_scope binding for the
//     bid's/block's EXACT hotel (same authority as the hardened check-in /
//     check-out routes). No decode-only path remains.
//   • ATOMICITY: the mutation is ONE database transaction — the plpgsql RPC
//     stay_assign_units (lock → re-validate → supersede → insert → legacy slot-1
//     mirror → bids.assignedUnitId). A refusal is a RAISE → everything rolls
//     back and the previous assignment state is untouched. The route performs
//     the same integrity checks first only to return precise 409 codes cheaply;
//     the RPC is the authority and re-checks everything under per-unit advisory
//     locks (one serialization strategy shared with unit-pinned room_blocks).
//   • LIFECYCLE / HISTORY: ordinary assign only BEFORE check-in (ACCEPTED /
//     CONFIRMED); an in-house stay changes room only via an EXPLICIT
//     action:"transfer" with a reason (audited); a CHECKED_OUT stay is frozen
//     (409 stay_completed); PENDING / COUNTER / terminal hold no reservation.
//     Old lines are superseded / released, never deleted.
//   • Pre-migration (RPC not applied) every WRITE fails closed 503 — no
//     non-atomic fallback write exists. Client ids are INPUT ONLY.
import { NextRequest, NextResponse } from "next/server";
import { sbSelect } from "@/lib/onboard/supabase-admin";
import { resolveVerifiedPartnerScope } from "@/lib/auth/verified-partner-authority";
import { createPartnerAuthorityDeps } from "@/lib/auth/verified-partner-authority-factory";
import { reservationDateISO } from "@/lib/stay/stay-dates";
import {
  assignmentStoreConfigured,
  assignmentLifecycleGate,
  dedupeIds,
  readUnits,
  findUnitConflicts,
  validateAssignmentSet,
  callStayRpc,
  type StayRpcResult,
} from "@/lib/stay/unit-assignments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const partnerAuthority = createPartnerAuthorityDeps();
const up = (s: unknown) => String(s ?? "").trim().toUpperCase();

/** Map an RPC outcome to the HTTP response (refusal codes → 409/400/404; missing RPC → 503). */
function rpcResponse(r: StayRpcResult, extra: Record<string, unknown> = {}) {
  if (r.status === "ok") return NextResponse.json({ ...(r.body || {}), ...extra });
  if (r.status === "missing") return NextResponse.json({ error: "unit_assignment_rpc_unavailable" }, { status: 503 });
  if (r.status === "refused") {
    const status =
      r.code === "transfer_reason_required" ? 400 :
      r.code === "bid_not_found" || r.code === "block_not_found" ? 404 : 409;
    return NextResponse.json({ error: r.code, unitId: r.detail, ...extra }, { status });
  }
  return NextResponse.json({ error: "unit_assignment_unavailable", reason: r.reason }, { status: 503 });
}

export async function POST(req: NextRequest) {
  try {
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }
    const bidId = typeof body?.bidId === "string" ? body.bidId.trim() : "";
    const blockId = typeof body?.blockId === "string" ? body.blockId.trim() : "";
    // The RAW requested list is what gets VALIDATED (a client sending the same
    // unit twice is a malformed request → 409 duplicate_unit, never silently
    // collapsed); the deduped list only drives the server-side fact reads.
    const rawUnitIds: string[] = (Array.isArray(body?.unitIds) ? body.unitIds : body?.unitId ? [body.unitId] : [])
      .map((x: unknown) => String(x ?? "").trim()).filter(Boolean);
    const unitIds = dedupeIds(rawUnitIds);
    if (!unitIds.length || (!bidId && !blockId)) {
      return NextResponse.json({ error: "unitIds + (bidId|blockId) required" }, { status: 400 });
    }
    if (!assignmentStoreConfigured()) {
      return NextResponse.json({ error: "unit_assignment_unconfigured" }, { status: 503 });
    }

    // Cryptographic partner authority (decode-only / forged tokens rejected).
    const scope = await resolveVerifiedPartnerScope(req, partnerAuthority);
    if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // ── bid path ──────────────────────────────────────────────────────────────
    if (bidId) {
      const bid = (await sbSelect<any>("bids", `id=eq.${encodeURIComponent(bidId)}&limit=1`))[0];
      if (!bid) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
      if (!bid.hotelId || !scope.hotelIds.includes(String(bid.hotelId))) {
        return NextResponse.json({ error: "Forbidden — not authorized for this hotel" }, { status: 403 });
      }
      const gate = assignmentLifecycleGate(bid.status, body?.action, body?.reason);
      if (!gate.ok) return NextResponse.json({ error: gate.error, status: up(bid.status) }, { status: gate.status });

      // Fast-path integrity checks (precise 409s). The RPC is the authority.
      let request: any = null;
      if (bid.requestId) {
        try {
          request = (await sbSelect<any>("bid_requests", `id=eq.${encodeURIComponent(String(bid.requestId))}&select=id,checkIn,checkOut&limit=1`))[0] || null;
        } catch {
          return NextResponse.json({ error: "stay_dates_unavailable" }, { status: 503 });
        }
      }
      const from = reservationDateISO(request?.checkIn);
      const to = reservationDateISO(request?.checkOut);
      if (!from || !to) return NextResponse.json({ error: "stay_dates_unavailable" }, { status: 409 });
      const units = await readUnits(unitIds);
      if (units === null) return NextResponse.json({ error: "unit_inventory_unavailable" }, { status: 503 });
      const conflicts = await findUnitConflicts({ unitIds, excludeBidId: String(bid.id), from, to });
      if (conflicts === null) return NextResponse.json({ error: "unit_conflict_check_unavailable" }, { status: 503 });
      const v = validateAssignmentSet({ bid, unitIds: rawUnitIds, units, conflicts });
      if (!v.ok) {
        return NextResponse.json({ error: v.error, unitId: v.unitId, required: v.required, detail: v.detail }, { status: 409 });
      }

      // ONE atomic transaction (lock → validate → supersede → insert → mirror → bids).
      const r = await callStayRpc("stay_assign_units", {
        p_bid_id: String(bid.id),
        p_unit_ids: rawUnitIds,
        p_partner_subject: scope.subject,
        p_mode: gate.mode,
        p_reason: gate.mode === "transfer" ? String(body.reason).trim().slice(0, 300) : null,
      });
      return rpcResponse(r, { mode: "atomic" });
    }

    // ── walk-in / OTA block path ──────────────────────────────────────────────
    const block = (await sbSelect<any>("room_blocks", `id=eq.${encodeURIComponent(blockId)}&limit=1`))[0];
    if (!block) return NextResponse.json({ error: "Block not found" }, { status: 404 });
    if (!block.hotelId || !scope.hotelIds.includes(String(block.hotelId))) {
      return NextResponse.json({ error: "Forbidden — not authorized for this hotel" }, { status: 403 });
    }
    if (rawUnitIds.length !== 1) {
      return NextResponse.json({ error: rawUnitIds.length > 1 ? "too_many_units" : "no_units", required: 1 }, { status: 409 });
    }
    const units = await readUnits(unitIds);
    if (units === null) return NextResponse.json({ error: "unit_inventory_unavailable" }, { status: 503 });
    const from = reservationDateISO(block.fromDate), to = reservationDateISO(block.toDate);
    if (!from || !to) return NextResponse.json({ error: "stay_dates_unavailable" }, { status: 409 });
    const conflictsRaw = await findUnitConflicts({ unitIds, excludeBidId: "", from, to });
    if (conflictsRaw === null) return NextResponse.json({ error: "unit_conflict_check_unavailable" }, { status: 503 });
    const conflicts: Record<string, unknown[]> = {};
    Object.keys(conflictsRaw).forEach((k) => {
      conflicts[k] = conflictsRaw[k].filter((c) => !(c.kind === "block" && c.refId === String(block.id)));
    });
    const v = validateAssignmentSet({
      bid: { id: String(block.id), hotelId: block.hotelId, roomId: block.roomId, numRooms: 1 },
      unitIds: rawUnitIds, units, conflicts,
    });
    if (!v.ok) return NextResponse.json({ error: v.error, unitId: v.unitId, required: 1, detail: v.detail }, { status: 409 });
    // Atomic: the BEFORE UPDATE guard trigger validates + serializes + derives the number.
    const r = await callStayRpc("stay_assign_block_unit", {
      p_block_id: String(block.id), p_unit_id: unitIds[0], p_partner_subject: scope.subject,
    });
    return rpcResponse(r, { mode: "atomic" });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const bidId = (url.searchParams.get("bidId") || "").trim();
    const blockId = (url.searchParams.get("blockId") || "").trim();
    if (!bidId && !blockId) return NextResponse.json({ error: "bidId|blockId required" }, { status: 400 });
    if (!assignmentStoreConfigured()) {
      return NextResponse.json({ error: "unit_assignment_unconfigured" }, { status: 503 });
    }
    const scope = await resolveVerifiedPartnerScope(req, partnerAuthority);
    if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (bidId) {
      const bid = (await sbSelect<any>("bids", `id=eq.${encodeURIComponent(bidId)}&limit=1`))[0];
      if (!bid) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
      if (!bid.hotelId || !scope.hotelIds.includes(String(bid.hotelId))) {
        return NextResponse.json({ error: "Forbidden — not authorized for this hotel" }, { status: 403 });
      }
      const st = up(bid.status);
      // A completed stay's room history is frozen; an in-house guest is moved via
      // an explicit transfer, never by silently unassigning their room.
      if (st === "CHECKED_OUT") return NextResponse.json({ error: "stay_completed" }, { status: 409 });
      if (st === "CHECKED_IN") return NextResponse.json({ error: "unassign_not_allowed_in_house" }, { status: 409 });
      const r = await callStayRpc("stay_release_units", {
        p_bid_id: String(bid.id), p_partner_subject: scope.subject, p_reason: "unassigned",
      });
      return rpcResponse(r);
    }

    const block = (await sbSelect<any>("room_blocks", `id=eq.${encodeURIComponent(blockId)}&limit=1`))[0];
    if (!block) return NextResponse.json({ error: "Block not found" }, { status: 404 });
    if (!block.hotelId || !scope.hotelIds.includes(String(block.hotelId))) {
      return NextResponse.json({ error: "Forbidden — not authorized for this hotel" }, { status: 403 });
    }
    const r = await callStayRpc("stay_release_block_unit", { p_block_id: String(block.id), p_partner_subject: scope.subject });
    return rpcResponse(r);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
