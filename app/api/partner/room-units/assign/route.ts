// POST / DELETE /api/partner/room-units/assign
// Assign / transfer / release PHYSICAL room units (numbered rooms) for a bid, or
// pin a unit onto a walk-in/OTA room_block.
//
// STAY-LIFECYCLE-OPS-01 — HARDENED. The previous handler trusted a DECODE-ONLY
// JWT (any forged token authenticated), never checked the partner's hotel, and
// blindly upserted whatever unitId the client sent (any hotel, any category,
// inactive, double-booked, or onto a completed stay). Now:
//   • AUTHORITY: the partner token is CRYPTOGRAPHICALLY verified and the partner
//     must hold an ACTIVE protected verified_partner_hotel_scope binding for the
//     bid's/block's EXACT hotel (the same authority as the hardened check-in /
//     check-out routes). No decode-only path remains.
//   • INTEGRITY (all re-read server-side; client ids are INPUT ONLY): bid→hotel,
//     unit→hotel, unit→room category, unit active, no overlapping live occupation
//     of the unit for the stay range, distinct units, cardinality ≤ numRooms.
//   • LIFECYCLE: an ordinary `assign` is allowed only BEFORE check-in (ACCEPTED /
//     CONFIRMED). A checked-in stay may change room only via an EXPLICIT
//     `action:"transfer"` with a reason (audited). A CHECKED_OUT (completed) stay
//     can NEVER be reassigned through this endpoint — its history is frozen.
//     PENDING / COUNTER / terminal bids hold no reservation to assign.
//   • HISTORY: assignments live in bid_unit_assignment_lines (one row per
//     bid+unit with active | superseded | released status) — a change supersedes
//     the old line and inserts a new one; nothing is destructively overwritten.
//     The legacy PK=bidId row + bids.assignedUnitId are mirrored to slot 1 so all
//     existing single-unit readers keep working. Pre-migration (lines table
//     missing) a SINGLE unit still works via the legacy mirror; a multi-unit
//     request fails closed (cannot be represented).
import { NextRequest, NextResponse } from "next/server";
import { sbSelect, SB } from "@/lib/onboard/supabase-admin";
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
  readAssignmentState,
  insertAssignmentLines,
  closeAssignmentLines,
  mirrorPrimaryAssignment,
  assignmentLineId,
  type AssignmentLine,
  type UnitRow,
} from "@/lib/stay/unit-assignments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const partnerAuthority = createPartnerAuthorityDeps();

const up = (s: unknown) => String(s ?? "").trim().toUpperCase();

async function svcPatch(path: string, body: unknown): Promise<boolean> {
  try {
    const r = await fetch(`${SB.url}/rest/v1/${path}`, {
      method: "PATCH",
      headers: { apikey: SB.key, Authorization: `Bearer ${SB.key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(body),
    });
    return r.ok;
  } catch {
    return false;
  }
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

      // Stay range (server-read) — required for the overlap check.
      let request: any = null;
      if (bid.requestId) {
        try {
          request = (await sbSelect<any>(
            "bid_requests",
            `id=eq.${encodeURIComponent(String(bid.requestId))}&select=id,checkIn,checkOut&limit=1`
          ))[0] || null;
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

      const current = await readAssignmentState(String(bid.id), bid);
      if (current.status === "error") return NextResponse.json({ error: "unit_assignment_unavailable" }, { status: 503 });
      const wanted = v.units.map((u) => String(u.id));
      const toClose = current.unitIds.filter((id) => !wanted.includes(id));
      const toAdd = v.units.filter((u) => !current.unitIds.includes(String(u.id)));
      const nowIso = new Date().toISOString();

      if (current.mode === "legacy") {
        // Pre-migration: only a SINGLE unit can be represented (legacy PK=bidId).
        if (wanted.length > 1) {
          return NextResponse.json({ error: "unit_assignment_lines_unavailable", required: v.required }, { status: 503 });
        }
      } else {
        const closed = await closeAssignmentLines({
          bidId: String(bid.id), unitIds: toClose, status: "superseded", by: scope.subject,
          reason: gate.mode === "transfer" ? `transfer: ${String(body.reason).trim().slice(0, 300)}` : "reassigned before check-in",
          at: nowIso,
        });
        if (closed === "error") return NextResponse.json({ error: "unit_assignment_write_failed" }, { status: 503 });
        // Keep existing slots; hand new lines the smallest free slot numbers.
        const usedSlots = new Set(current.lines.filter((l) => wanted.includes(String(l.unit_id))).map((l) => Number(l.slot)));
        let nextSlot = 1;
        const rows: AssignmentLine[] = toAdd.map((u) => {
          while (usedSlots.has(nextSlot)) nextSlot += 1;
          usedSlots.add(nextSlot);
          return {
            id: assignmentLineId(String(bid.id), String(u.id)),
            bid_id: String(bid.id), hotel_id: String(bid.hotelId), room_id: String(bid.roomId),
            unit_id: String(u.id), unit_number: String(u.roomNumber), slot: nextSlot, status: "active",
            assigned_by: scope.subject, assigned_at: nowIso,
            reason: gate.mode === "transfer" ? `transfer: ${String(body.reason).trim().slice(0, 300)}` : null,
            // Stay range on the line → the DB EXCLUDE constraint makes unit-night
            // clashes impossible even under concurrent writes.
            stay_from: from, stay_to: to,
          };
        });
        const ins = await insertAssignmentLines(rows);
        if (ins === "error") return NextResponse.json({ error: "unit_assignment_write_failed" }, { status: 503 });
        if (ins === "conflict") {
          // Lost a race: the DB exclusion constraint refused an overlapping unit-night.
          return NextResponse.json({ error: "unit_conflict", required: v.required, detail: "db_exclusion" }, { status: 409 });
        }
        if (ins === "missing" && wanted.length > 1) {
          return NextResponse.json({ error: "unit_assignment_lines_unavailable", required: v.required }, { status: 503 });
        }
      }

      // Mirror slot 1 (first requested unit) into the legacy readers.
      const primary: UnitRow = v.units[0];
      const mirrored = await mirrorPrimaryAssignment({ bidId: String(bid.id), unit: primary, by: scope.subject });
      if (!mirrored) return NextResponse.json({ error: "unit_assignment_mirror_failed" }, { status: 503 });

      return NextResponse.json({
        ok: true,
        action: gate.mode,
        mode: current.mode,
        required: v.required,
        assigned: v.units.map((u, i) => ({ unitId: u.id, unitNumber: u.roomNumber, slot: i + 1 })),
        superseded: toClose,
      });
    }

    // ── walk-in / OTA block path ──────────────────────────────────────────────
    const block = (await sbSelect<any>("room_blocks", `id=eq.${encodeURIComponent(blockId)}&limit=1`))[0];
    if (!block) return NextResponse.json({ error: "Block not found" }, { status: 404 });
    if (!block.hotelId || !scope.hotelIds.includes(String(block.hotelId))) {
      return NextResponse.json({ error: "Forbidden — not authorized for this hotel" }, { status: 403 });
    }
    if (rawUnitIds.length !== 1) return NextResponse.json({ error: rawUnitIds.length > 1 ? "too_many_units" : "no_units", required: 1 }, { status: 409 });
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
      unitIds, units, conflicts,
    });
    if (!v.ok) return NextResponse.json({ error: v.error, unitId: v.unitId, required: 1, detail: v.detail }, { status: 409 });
    const u = v.units[0];
    const ok = await svcPatch(`room_blocks?id=eq.${encodeURIComponent(String(block.id))}`, { assignedUnitId: u.id, assignedUnitNumber: u.roomNumber });
    if (!ok) return NextResponse.json({ error: "block_assign_failed" }, { status: 503 });
    return NextResponse.json({ ok: true, unit: u });
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
      const current = await readAssignmentState(String(bid.id), bid);
      if (current.status === "error") return NextResponse.json({ error: "unit_assignment_unavailable" }, { status: 503 });
      if (current.mode === "lines") {
        const closed = await closeAssignmentLines({
          bidId: String(bid.id), unitIds: current.unitIds, status: "released", by: scope.subject, reason: "unassigned",
        });
        if (closed === "error") return NextResponse.json({ error: "unit_assignment_write_failed" }, { status: 503 });
      }
      const mirrored = await mirrorPrimaryAssignment({ bidId: String(bid.id), unit: null, by: scope.subject });
      if (!mirrored) return NextResponse.json({ error: "unit_assignment_mirror_failed" }, { status: 503 });
      return NextResponse.json({ ok: true, released: current.unitIds });
    }

    const block = (await sbSelect<any>("room_blocks", `id=eq.${encodeURIComponent(blockId)}&limit=1`))[0];
    if (!block) return NextResponse.json({ error: "Block not found" }, { status: 404 });
    if (!block.hotelId || !scope.hotelIds.includes(String(block.hotelId))) {
      return NextResponse.json({ error: "Forbidden — not authorized for this hotel" }, { status: 403 });
    }
    const ok = await svcPatch(`room_blocks?id=eq.${encodeURIComponent(String(block.id))}`, { assignedUnitId: null, assignedUnitNumber: null });
    if (!ok) return NextResponse.json({ error: "block_unassign_failed" }, { status: 503 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
