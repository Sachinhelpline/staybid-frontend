// Partner front-desk reservations / blocks (room_blocks: walk_in | manual | group).
// Inserting a block immediately blocks the room dates across the whole system
// (customer hotel page, availability API, calendar).
//
// STAY-LIFECYCLE-OPS-01 — HARDENED. This surface used a DECODE-ONLY JWT (any
// forged token authenticated) and accepted a client-supplied assignedUnitId /
// assignedUnitNumber verbatim, so a block could pin ANY unit (other hotel, other
// category, inactive, already occupied) and bypass the hardened assignment
// endpoint. Now:
//   • AUTHORITY (GET/POST/PATCH/DELETE): the partner token is CRYPTOGRAPHICALLY
//     verified and the partner must hold an ACTIVE protected
//     verified_partner_hotel_scope binding for the EXACT hotel of the block.
//   • UNIT PINS are validated server-side before the write (exact hotel, exact
//     category, active, no overlapping live occupation — lines + other blocks),
//     the unit NUMBER is derived from the unit row (never the client), and the
//     DB guard trigger on room_blocks (migration 2026-09-13-v753) re-validates +
//     serializes every unit pin under the shared per-unit advisory lock — the
//     same strategy the bid-assignment RPC uses, so line-vs-block and
//     block-vs-block claims can never both win.
import { NextRequest, NextResponse } from "next/server";
import { sbInsert, sbSelect, SB_URL, SB_H, SB_H_REPRESENT } from "@/lib/sb-server";
import { resolveVerifiedPartnerScope } from "@/lib/auth/verified-partner-authority";
import { createPartnerAuthorityDeps } from "@/lib/auth/verified-partner-authority-factory";
import { reservationDateISO } from "@/lib/stay/stay-dates";
import {
  assignmentStoreConfigured,
  assignmentAuthorityReady,
  readUnits,
  findUnitConflicts,
  validateAssignmentSet,
  type UnitRow,
} from "@/lib/stay/unit-assignments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const partnerAuthority = createPartnerAuthorityDeps();

/**
 * Validate a requested unit pin for a block (exact hotel + category + active +
 * no overlapping live occupation). Returns the unit row or a refusal.
 */
async function validateBlockUnit(input: {
  unitId: string; hotelId: string; roomId: string; from: string; to: string; excludeBlockId: string;
}): Promise<{ ok: true; unit: UnitRow } | { ok: false; status: number; error: string; unitId?: string }> {
  if (!assignmentStoreConfigured()) return { ok: false, status: 503, error: "unit_assignment_unconfigured" };
  const units = await readUnits([input.unitId]);
  if (units === null) return { ok: false, status: 503, error: "unit_inventory_unavailable" };
  const conflictsRaw = await findUnitConflicts({ unitIds: [input.unitId], excludeBidId: "", from: input.from, to: input.to });
  if (conflictsRaw === null) return { ok: false, status: 503, error: "unit_conflict_check_unavailable" };
  const conflicts: Record<string, unknown[]> = {};
  Object.keys(conflictsRaw).forEach((k) => {
    conflicts[k] = conflictsRaw[k].filter((c) => !(c.kind === "block" && c.refId === input.excludeBlockId));
  });
  const v = validateAssignmentSet({
    bid: { id: input.excludeBlockId || "new", hotelId: input.hotelId, roomId: input.roomId, numRooms: 1 },
    unitIds: [input.unitId], units, conflicts,
  });
  if (!v.ok) return { ok: false, status: 409, error: v.error, unitId: v.unitId };
  return { ok: true, unit: v.units[0] };
}

// GET /api/partner/walk-in?hotelId=...  — list front-desk reservations
export async function GET(req: NextRequest) {
  const scope = await resolveVerifiedPartnerScope(req, partnerAuthority);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const hotelId = (new URL(req.url).searchParams.get("hotelId") || "").trim();
  if (!hotelId || !scope.hotelIds.includes(hotelId)) {
    return NextResponse.json({ error: "hotelId required / not yours" }, { status: 403 });
  }
  try {
    const rows = await sbSelect(`room_blocks?hotelId=eq.${encodeURIComponent(hotelId)}&select=*&order=fromDate.desc`);
    return NextResponse.json({ reservations: Array.isArray(rows) ? rows : [] });
  } catch (e: any) {
    return NextResponse.json({ reservations: [], warning: e?.message });
  }
}

// PATCH /api/partner/walk-in  — edit an existing reservation (room_blocks row)
export async function PATCH(req: NextRequest) {
  const scope = await resolveVerifiedPartnerScope(req, partnerAuthority);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const existing = (await sbSelect(`room_blocks?id=eq.${encodeURIComponent(body.id)}&select=*`))[0];
  if (!existing) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
  if (!existing.hotelId || !scope.hotelIds.includes(String(existing.hotelId))) {
    return NextResponse.json({ error: "Not your reservation" }, { status: 403 });
  }

  const patch: any = {};
  for (const k of ["fromDate", "toDate", "guestName", "guestPhone", "guestEmail", "note", "roomId", "assignedUnitId"]) {
    if (body[k] !== undefined) patch[k] = body[k] === "" ? null : body[k];
  }
  if (body.amount !== undefined) patch.amount = body.amount === "" || body.amount == null ? null : Number(body.amount);
  const nextFrom = String(patch.fromDate ?? existing.fromDate ?? "");
  const nextTo = String(patch.toDate ?? existing.toDate ?? "");
  if (nextFrom && nextTo && nextTo <= nextFrom) {
    return NextResponse.json({ error: "Check-out must be after check-in" }, { status: 400 });
  }
  // A unit pin (new, changed, or kept while the dates/category change) is validated
  // server-side; the unit NUMBER is always derived from the unit row.
  const effectiveUnit = patch.assignedUnitId !== undefined ? patch.assignedUnitId : existing.assignedUnitId;
  if (effectiveUnit && (patch.assignedUnitId !== undefined || patch.fromDate !== undefined || patch.toDate !== undefined || patch.roomId !== undefined)) {
    // STAY-LIFECYCLE-OPS-01 M8 — changing a PINNED block's unit/dates/category is an
    // occupancy write guarded by the room_blocks trigger; fail closed 503 pre-migration.
    if (!(await assignmentAuthorityReady())) {
      return NextResponse.json({ error: "unit_assignment_authority_unavailable" }, { status: 503 });
    }
    const from = reservationDateISO(nextFrom), to = reservationDateISO(nextTo);
    if (!from || !to) return NextResponse.json({ error: "stay_dates_unavailable" }, { status: 409 });
    const v = await validateBlockUnit({
      unitId: String(effectiveUnit), hotelId: String(existing.hotelId), roomId: String(patch.roomId ?? existing.roomId),
      from, to, excludeBlockId: String(existing.id),
    });
    if (!v.ok) return NextResponse.json({ error: v.error, unitId: v.unitId }, { status: v.status });
    patch.assignedUnitId = v.unit.id;
    patch.assignedUnitNumber = v.unit.roomNumber;
  } else if (patch.assignedUnitId === null) {
    patch.assignedUnitNumber = null;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  try {
    const r = await fetch(`${SB_URL}/rest/v1/room_blocks?id=eq.${encodeURIComponent(body.id)}`, {
      method: "PATCH", headers: SB_H_REPRESENT, body: JSON.stringify(patch),
    });
    if (!r.ok) {
      // The DB guard trigger refused the unit pin (lost a race / integrity) → 409.
      const t = await r.text();
      if (/unit_conflict|unit_wrong_hotel|unit_wrong_category|unit_inactive|unit_not_found/.test(t)) {
        const code = (/unit_conflict|unit_wrong_hotel|unit_wrong_category|unit_inactive|unit_not_found/.exec(t) || ["unit_conflict"])[0];
        return NextResponse.json({ error: code }, { status: 409 });
      }
      throw new Error(t);
    }
    const j = await r.json().catch(() => []);
    return NextResponse.json({ ok: true, reservation: Array.isArray(j) ? j[0] : j });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const scope = await resolveVerifiedPartnerScope(req, partnerAuthority);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}

  const {
    hotelId, roomId, fromDate, toDate,
    guestName, guestPhone, guestEmail, amount, note,
    assignedUnitId,
    // v113 — bulk block-dates flow can send these. Default `source` to
    // `walk_in` so every existing caller stays correct without changes.
    source: rawSource,
    roomIds,     // optional bulk array
  } = body;

  const source = (() => {
    const allowed = new Set(["walk_in", "manual", "group"]);
    return allowed.has(String(rawSource)) ? String(rawSource) : "walk_in";
  })();

  const targets: string[] = Array.isArray(roomIds) && roomIds.length
    ? roomIds.filter((r: any) => typeof r === "string" && r)
    : (roomId ? [roomId] : []);

  if (!hotelId || !targets.length || !fromDate || !toDate) {
    return NextResponse.json({ error: "hotelId, roomId (or roomIds[]), fromDate, toDate required" }, { status: 400 });
  }
  if (!scope.hotelIds.includes(String(hotelId))) {
    return NextResponse.json({ error: "Forbidden — not authorized for this hotel" }, { status: 403 });
  }
  if (toDate <= fromDate) {
    return NextResponse.json({ error: "toDate must be after fromDate" }, { status: 400 });
  }
  const unitPin = typeof assignedUnitId === "string" && assignedUnitId.trim() ? assignedUnitId.trim() : null;
  if (unitPin && targets.length !== 1) {
    return NextResponse.json({ error: "assignedUnitId requires a single roomId" }, { status: 400 });
  }
  let pinnedUnit: UnitRow | null = null;
  if (unitPin) {
    // STAY-LIFECYCLE-OPS-01 M8 — a pinned block is an OCCUPANCY write that depends
    // on the room_blocks guard trigger. CODE-FIRST cutover: fail closed 503 BEFORE
    // any write until the migration (the guard) is applied. An UNPINNED block below
    // is a category hold (guard-irrelevant) and is never gated.
    if (!(await assignmentAuthorityReady())) {
      return NextResponse.json({ error: "unit_assignment_authority_unavailable" }, { status: 503 });
    }
    const from = reservationDateISO(fromDate), to = reservationDateISO(toDate);
    if (!from || !to) return NextResponse.json({ error: "stay_dates_unavailable" }, { status: 409 });
    const v = await validateBlockUnit({ unitId: unitPin, hotelId: String(hotelId), roomId: String(targets[0]), from, to, excludeBlockId: "" });
    if (!v.ok) return NextResponse.json({ error: v.error, unitId: v.unitId }, { status: v.status });
    pinnedUnit = v.unit;
  }

  const defaultGuestName =
    source === "walk_in" ? "Walk-in guest" :
    source === "group"   ? (guestName || "Group booking") :
                           (guestName || "Blocked");

  try {
    const inserted: any[] = [];
    for (const rid of targets) {
      const row = await sbInsert("room_blocks", {
        hotelId, roomId: rid,
        fromDate, toDate,
        source,
        guestName: source === "walk_in" ? (guestName || defaultGuestName) : defaultGuestName,
        guestPhone: guestPhone || null,
        guestEmail: guestEmail || null,
        amount: amount != null ? Number(amount) : null,
        note: note || null,
        createdBy: scope.subject,
        assignedUnitId: pinnedUnit ? pinnedUnit.id : null,
        assignedUnitNumber: pinnedUnit ? pinnedUnit.roomNumber : null, // server-derived, never the client's
      });
      inserted.push(row);
    }
    return NextResponse.json({ ok: true, block: inserted[0] || null, blocks: inserted, count: inserted.length });
  } catch (e: any) {
    const msg = String(e?.message || "");
    const m = /unit_conflict|unit_wrong_hotel|unit_wrong_category|unit_inactive|unit_not_found/.exec(msg);
    if (m) return NextResponse.json({ error: m[0] }, { status: 409 }); // DB guard trigger refused the pin
    return NextResponse.json({ error: msg || "Failed to create walk-in / block" }, { status: 500 });
  }
}

// Cancel a walk-in (or any block)
export async function DELETE(req: NextRequest) {
  const scope = await resolveVerifiedPartnerScope(req, partnerAuthority);
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = (url.searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const existing = (await sbSelect(`room_blocks?id=eq.${encodeURIComponent(id)}&select=id,hotelId`))[0];
  if (!existing) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
  if (!existing.hotelId || !scope.hotelIds.includes(String(existing.hotelId))) {
    return NextResponse.json({ error: "Not your reservation" }, { status: 403 });
  }
  try {
    const r = await fetch(`${SB_URL}/rest/v1/room_blocks?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: SB_H });
    if (!r.ok) throw new Error(await r.text());
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to cancel" }, { status: 500 });
  }
}
