// ═══════════════════════════════════════════════════════════════════════════
// STAY-LIFECYCLE-OPS-01 — physical room-unit assignment authority (server-only
// store + PURE validators).
// ═══════════════════════════════════════════════════════════════════════════
// A booking of N rooms in a room category that has configured PHYSICAL units
// (hotel_room_units, status='active') must have exactly N DISTINCT valid units
// assigned before a NEW check-in may be minted. "Valid" = the unit exists, belongs
// to the bid's EXACT hotel AND EXACT room category, is active, and is not
// conflictingly assigned to another live stay overlapping this stay's range.
//
// STORAGE (migration 2026-09-13-v753 — NOT applied by the PR that introduces it):
//   • public.bid_unit_assignment_lines — one row per (bid, unit) with history
//     (status active | superseded | released), so a multi-room booking is
//     represented faithfully and a room transfer/correction is auditable, never a
//     destructive overwrite. RLS deny-by-default (service_role only).
//   • public.bid_unit_assignments (LEGACY, PK bidId) — kept as the SLOT-1 MIRROR
//     for every existing single-unit reader (availability calendar, customer
//     "allocated room"), so those reads keep working unchanged. Locked to
//     service_role by the same migration (server reads already elevate).
//   • bids.assignedUnitId — mirrored to the slot-1 unit (the operator-isolation
//     read model + attribution key on it).
//
// WRITES ARE ATOMIC AND DB-SIDE ONLY: every assignment mutation goes through ONE
// plpgsql RPC (stay_assign_units / stay_release_units / stay_assign_block_unit /
// stay_release_block_unit, migration 2026-09-13-v753) that locks, re-validates,
// supersedes, inserts, mirrors the legacy slot-1 row and updates
// bids.assignedUnitId in a SINGLE transaction; any refusal is a RAISE (SQLSTATE
// P0001, message = error code) so the previous assignment state is left exactly
// as it was. There is NO multi-step JavaScript write path. Pre-migration (RPC
// missing → PostgREST 404 PGRST202) every write fails closed 503; READS fall back
// to the legacy row + bids.assignedUnitId. A read ERROR (anything other than
// "table missing") always fails closed — never conflated with "nothing assigned".
// Zero network when the service-role key is unconfigured.
//
// Client-supplied identifiers (bidId, unitIds) are INPUT ONLY — every fact used
// for authorization/integrity is re-read server-side from the DB.
import { SB_URL, SB_KEY } from "@/lib/sb-server";

export const ASSIGNMENT_LINES_TABLE = "bid_unit_assignment_lines";
export const LEGACY_ASSIGNMENT_TABLE = "bid_unit_assignments";

/** Bid statuses whose unit assignment physically OCCUPIES the unit (conflicts). */
export const OCCUPYING_BID_STATUSES = ["ACCEPTED", "CONFIRMED", "CHECKED_IN"] as const;

function serviceRoleKey(): string | null {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return typeof k === "string" && k.length > 0 ? k : null;
}
export function assignmentStoreConfigured(): boolean {
  return serviceRoleKey() !== null;
}
function svcHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: SB_KEY, Authorization: `Bearer ${serviceRoleKey() || ""}`, ...extra };
}

export type UnitRow = {
  id: string;
  hotelId: string;
  roomId: string;
  roomNumber: string;
  status: string;
  floor?: string | null;
};

export type AssignmentLine = {
  id: string;
  bid_id: string;
  hotel_id: string;
  room_id: string;
  unit_id: string;
  unit_number: string;
  slot: number;
  status: string; // active | superseded | released
  assigned_by: string | null;
  assigned_at: string;
  released_at?: string | null;
  released_by?: string | null;
  reason?: string | null;
  /** Denormalised stay range [stay_from, stay_to) — lets the DB EXCLUDE overlapping active lines per unit. */
  stay_from?: string | null;
  stay_to?: string | null;
};

const ORDINARY_ASSIGN_STATES = ["ACCEPTED", "CONFIRMED"];
export type LifecycleGate =
  | { ok: true; mode: "assign" | "transfer" }
  | { ok: false; status: number; error: string };

/**
 * PURE lifecycle gate for an assignment request on a bid:
 *   CHECKED_OUT → frozen (409 stay_completed) — a completed stay is never reassigned;
 *   CHECKED_IN  → only an EXPLICIT `action:"transfer"` WITH a reason (audited);
 *   ACCEPTED / CONFIRMED → ordinary assign (a `transfer` here is refused);
 *   PENDING / COUNTER / terminal → no reservation to assign (409 bid_not_reservable).
 */
export function assignmentLifecycleGate(bidStatus: unknown, action: unknown, reason: unknown): LifecycleGate {
  const st = String(bidStatus ?? "").trim().toUpperCase();
  const act = String(action ?? "assign").toLowerCase();
  if (st === "CHECKED_OUT") return { ok: false, status: 409, error: "stay_completed" };
  if (st === "CHECKED_IN") {
    if (act !== "transfer") return { ok: false, status: 409, error: "transfer_confirmation_required" };
    if (!String(reason ?? "").trim()) return { ok: false, status: 400, error: "transfer_reason_required" };
    return { ok: true, mode: "transfer" };
  }
  if (!ORDINARY_ASSIGN_STATES.includes(st)) return { ok: false, status: 409, error: "bid_not_reservable" };
  if (act === "transfer") return { ok: false, status: 409, error: "transfer_only_while_checked_in" };
  return { ok: true, mode: "assign" };
}

export type BidLike = {
  id: string;
  hotelId?: string | null;
  roomId?: string | null;
  numRooms?: number | null;
  assignedUnitId?: string | null;
};

/** The number of physical units a booking requires (bids.numRooms, min 1). */
export function requiredUnitCount(bid: { numRooms?: number | null } | null | undefined): number {
  const n = Number(bid?.numRooms);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** Checkout-EXCLUSIVE overlap of two [from, to) ISO-date ranges. */
export function staysOverlap(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  return aFrom < bTo && bFrom < aTo;
}

export function dedupeIds(ids: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(ids)) return out;
  ids.forEach((x) => {
    const s = String(x ?? "").trim();
    if (s && !out.includes(s)) out.push(s);
  });
  return out;
}

export type AssignmentError =
  | "no_units"
  | "duplicate_unit"
  | "too_many_units"
  | "unit_not_found"
  | "unit_wrong_hotel"
  | "unit_wrong_category"
  | "unit_inactive"
  | "unit_conflict";

export type ValidateResult =
  | { ok: true; units: UnitRow[]; required: number }
  | { ok: false; error: AssignmentError; unitId?: string; required: number; detail?: unknown };

/**
 * PURE integrity validation of a requested assignment SET against server-read
 * facts. Enforces: non-empty, distinct, ≤ required cardinality, every unit
 * exists / exact hotel / exact room category / active / conflict-free.
 */
export function validateAssignmentSet(input: {
  bid: BidLike;
  unitIds: unknown;
  units: UnitRow[];
  conflicts?: Record<string, unknown[]>;
}): ValidateResult {
  const required = requiredUnitCount(input.bid);
  const raw = Array.isArray(input.unitIds) ? input.unitIds.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
  if (raw.length === 0) return { ok: false, error: "no_units", required };
  const ids = dedupeIds(raw);
  if (ids.length !== raw.length) return { ok: false, error: "duplicate_unit", required };
  if (ids.length > required) return { ok: false, error: "too_many_units", required, detail: { requested: ids.length } };
  const byId = new Map<string, UnitRow>();
  (input.units || []).forEach((u) => { if (u && u.id) byId.set(String(u.id), u); });
  const out: UnitRow[] = [];
  for (const id of ids) {
    const u = byId.get(id);
    if (!u) return { ok: false, error: "unit_not_found", unitId: id, required };
    if (String(u.hotelId) !== String(input.bid.hotelId ?? "")) return { ok: false, error: "unit_wrong_hotel", unitId: id, required };
    if (String(u.roomId) !== String(input.bid.roomId ?? "")) return { ok: false, error: "unit_wrong_category", unitId: id, required };
    if (String(u.status ?? "").toLowerCase() !== "active") return { ok: false, error: "unit_inactive", unitId: id, required };
    const c = input.conflicts?.[id];
    if (Array.isArray(c) && c.length > 0) return { ok: false, error: "unit_conflict", unitId: id, required, detail: c };
    out.push(u);
  }
  return { ok: true, units: out, required };
}

export type CheckInAssignmentResult =
  | { ok: true; required: number; assigned: number; skipped: boolean }
  | { ok: false; error: "units_not_assigned" | "assigned_unit_invalid"; required: number; assigned: number; unitId?: string };

/**
 * PURE check-in gate. When the category has NO configured active physical units
 * (quantity/virtual inventory) the requirement is skipped. Otherwise EXACTLY the
 * required number of DISTINCT, currently-valid units must be assigned.
 */
export function evaluateCheckInAssignment(input: {
  bid: BidLike;
  configuredActiveUnits: number;
  assignedUnitIds: string[];
  units: UnitRow[];
}): CheckInAssignmentResult {
  const required = requiredUnitCount(input.bid);
  const ids = dedupeIds(input.assignedUnitIds);
  if (!(input.configuredActiveUnits > 0)) return { ok: true, required, assigned: ids.length, skipped: true };
  const v = validateAssignmentSet({ bid: input.bid, unitIds: ids, units: input.units });
  if (!v.ok) {
    if (v.error === "no_units" || v.error === "too_many_units") {
      return { ok: false, error: "units_not_assigned", required, assigned: ids.length };
    }
    return { ok: false, error: "assigned_unit_invalid", required, assigned: ids.length, unitId: v.unitId };
  }
  if (ids.length !== required) return { ok: false, error: "units_not_assigned", required, assigned: ids.length };
  return { ok: true, required, assigned: ids.length, skipped: false };
}

// ── Store (service-role) ─────────────────────────────────────────────────────
/** True when a PostgREST response means "this table does not exist (yet)". */
function tableMissing(status: number, body: unknown): boolean {
  if (status !== 404) return false;
  const b = (body || {}) as { code?: string; message?: string };
  const code = String(b.code || "");
  const msg = String(b.message || "");
  return code === "PGRST205" || code === "42P01" || /schema cache|does not exist|relation/i.test(msg);
}

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const r = await fetch(url, { headers: svcHeaders(), cache: "no-store" });
  const body = await r.json().catch(() => null);
  return { status: r.status, body };
}

export type AssignmentState =
  | { status: "ok"; mode: "lines" | "legacy"; unitIds: string[]; lines: AssignmentLine[] }
  | { status: "error"; reason: string };

/**
 * Read the ACTIVE physical assignments for ONE bid (tri-state). Lines table
 * first; falls back to the legacy slot-1 row ONLY when the lines table is
 * missing (pre-migration). Any other failure → error (fail closed).
 */
export async function readAssignmentState(bidId: string, bid?: BidLike | null): Promise<AssignmentState> {
  if (!serviceRoleKey()) return { status: "error", reason: "service_role_unconfigured" };
  if (!bidId) return { status: "error", reason: "missing_bid_id" };
  const enc = encodeURIComponent(bidId);
  try {
    const r = await getJson(
      `${SB_URL}/rest/v1/${ASSIGNMENT_LINES_TABLE}?bid_id=eq.${enc}&status=eq.active&select=*&order=slot.asc`
    );
    if (r.status >= 200 && r.status < 300 && Array.isArray(r.body)) {
      const lines = r.body as AssignmentLine[];
      let unitIds = dedupeIds(lines.map((l) => l.unit_id));
      // A booking stamped ONLY on bids.assignedUnitId (Circle / unit-level booking
      // flows write that column directly) must still count as assigned — the
      // unit's validity is re-checked by the caller exactly like a line.
      if (!unitIds.length && bid?.assignedUnitId) unitIds = dedupeIds([bid.assignedUnitId]);
      return { status: "ok", mode: "lines", unitIds, lines };
    }
    if (!tableMissing(r.status, r.body)) return { status: "error", reason: `lines_read_failed_${r.status}` };
    // Legacy fallback (pre-migration): the single PK=bidId row (+ bids.assignedUnitId).
    const l = await getJson(`${SB_URL}/rest/v1/${LEGACY_ASSIGNMENT_TABLE}?bidId=eq.${enc}&select=bidId,unitId,unitNumber`);
    if (!(l.status >= 200 && l.status < 300) || !Array.isArray(l.body)) {
      return { status: "error", reason: `legacy_read_failed_${l.status}` };
    }
    const ids = dedupeIds([...(l.body as any[]).map((x) => x.unitId), bid?.assignedUnitId]);
    return { status: "ok", mode: "legacy", unitIds: ids, lines: [] };
  } catch (e: any) {
    return { status: "error", reason: e?.message || "read_error" };
  }
}

/** Count configured ACTIVE physical units in a room category. null = read failed. */
export async function countActiveUnitsInCategory(hotelId: string, roomId: string): Promise<number | null> {
  if (!serviceRoleKey()) return null;
  try {
    const r = await getJson(
      `${SB_URL}/rest/v1/hotel_room_units?hotelId=eq.${encodeURIComponent(hotelId)}&roomId=eq.${encodeURIComponent(roomId)}&status=eq.active&select=id`
    );
    if (!(r.status >= 200 && r.status < 300) || !Array.isArray(r.body)) return null;
    return r.body.length;
  } catch {
    return null;
  }
}

/** Load unit rows by id (server-read facts). null = read failed. */
export async function readUnits(unitIds: string[]): Promise<UnitRow[] | null> {
  if (!serviceRoleKey()) return null;
  const ids = dedupeIds(unitIds);
  if (!ids.length) return [];
  try {
    const r = await getJson(
      `${SB_URL}/rest/v1/hotel_room_units?id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,hotelId,roomId,roomNumber,status,floor`
    );
    if (!(r.status >= 200 && r.status < 300) || !Array.isArray(r.body)) return null;
    return r.body as UnitRow[];
  } catch {
    return null;
  }
}

export type UnitConflict = { kind: "bid" | "block"; refId: string; from: string; to: string };

/**
 * Find OTHER live occupations of these units that overlap [from, to): active
 * assignment lines (or legacy rows) of other occupying bids, and walk-in /
 * OTA / manual room_blocks. null = a read failed (caller must fail closed).
 */
export async function findUnitConflicts(input: {
  unitIds: string[];
  excludeBidId: string;
  from: string;
  to: string;
}): Promise<Record<string, UnitConflict[]> | null> {
  if (!serviceRoleKey()) return null;
  const ids = dedupeIds(input.unitIds);
  const out: Record<string, UnitConflict[]> = {};
  ids.forEach((id) => { out[id] = []; });
  if (!ids.length) return out;
  const inList = ids.map(encodeURIComponent).join(",");
  try {
    // 1. other bids holding these units (lines table, legacy fallback when missing)
    let holders: Array<{ bidId: string; unitId: string }> = [];
    const r = await getJson(
      `${SB_URL}/rest/v1/${ASSIGNMENT_LINES_TABLE}?unit_id=in.(${inList})&status=eq.active&select=bid_id,unit_id`
    );
    if (r.status >= 200 && r.status < 300 && Array.isArray(r.body)) {
      holders = (r.body as any[]).map((x) => ({ bidId: String(x.bid_id), unitId: String(x.unit_id) }));
    } else if (tableMissing(r.status, r.body)) {
      const l = await getJson(`${SB_URL}/rest/v1/${LEGACY_ASSIGNMENT_TABLE}?unitId=in.(${inList})&select=bidId,unitId`);
      if (!(l.status >= 200 && l.status < 300) || !Array.isArray(l.body)) return null;
      holders = (l.body as any[]).map((x) => ({ bidId: String(x.bidId), unitId: String(x.unitId) }));
    } else {
      return null;
    }
    holders = holders.filter((h) => h.bidId && h.bidId !== input.excludeBidId);
    if (holders.length) {
      const bidIds = dedupeIds(holders.map((h) => h.bidId));
      const b = await getJson(
        `${SB_URL}/rest/v1/bids?id=in.(${bidIds.map(encodeURIComponent).join(",")})&select=id,status,requestId`
      );
      if (!(b.status >= 200 && b.status < 300) || !Array.isArray(b.body)) return null;
      const occupying = (b.body as any[]).filter((x) =>
        (OCCUPYING_BID_STATUSES as readonly string[]).includes(String(x.status ?? "").toUpperCase())
      );
      const reqIds = dedupeIds(occupying.map((x) => x.requestId));
      let reqMap: Record<string, { checkIn?: string; checkOut?: string }> = {};
      if (reqIds.length) {
        const q = await getJson(
          `${SB_URL}/rest/v1/bid_requests?id=in.(${reqIds.map(encodeURIComponent).join(",")})&select=id,checkIn,checkOut`
        );
        if (!(q.status >= 200 && q.status < 300) || !Array.isArray(q.body)) return null;
        (q.body as any[]).forEach((x) => { reqMap[String(x.id)] = x; });
      }
      for (const h of holders) {
        const ob = occupying.find((x) => String(x.id) === h.bidId);
        if (!ob) continue; // non-occupying (checked out / terminal) — no conflict
        const rq = reqMap[String(ob.requestId)] || {};
        const f = String(rq.checkIn || "").slice(0, 10), t = String(rq.checkOut || "").slice(0, 10);
        // Unknown dates on the OTHER stay → treat as conflicting (fail closed).
        if (!f || !t || staysOverlap(input.from, input.to, f, t)) {
          if (out[h.unitId]) out[h.unitId].push({ kind: "bid", refId: h.bidId, from: f, to: t });
        }
      }
    }
    // 2. walk-in / OTA / manual blocks pinned to these units
    const rb = await getJson(
      `${SB_URL}/rest/v1/room_blocks?assignedUnitId=in.(${inList})&toDate=gt.${input.from}&fromDate=lt.${input.to}&select=id,assignedUnitId,fromDate,toDate`
    );
    if (!(rb.status >= 200 && rb.status < 300) || !Array.isArray(rb.body)) return null;
    (rb.body as any[]).forEach((x) => {
      const u = String(x.assignedUnitId);
      if (out[u]) out[u].push({ kind: "block", refId: String(x.id), from: String(x.fromDate).slice(0, 10), to: String(x.toDate).slice(0, 10) });
    });
    return out;
  } catch {
    return null;
  }
}

// ── Atomic RPC caller (the ONLY write path) ──────────────────────────────────
export type StayRpcResult =
  | { status: "ok"; body: any }
  | { status: "refused"; code: string; detail: string | null }
  | { status: "missing" }
  | { status: "error"; reason: string };

/** True when PostgREST says the function does not exist (migration not applied). */
function rpcMissing(status: number, body: unknown): boolean {
  if (status !== 404) return false;
  const b = (body || {}) as { code?: string; message?: string };
  return String(b.code || "") === "PGRST202" || /could not find the function|function .* does not exist/i.test(String(b.message || ""));
}

/**
 * Call one of the atomic stay RPCs with the service role. A plpgsql RAISE
 * (P0001) surfaces as PostgREST 400 { code:"P0001", message:<error code>,
 * details:<unit id> } → "refused" (and the DB has rolled back everything).
 */
export async function callStayRpc(fn: string, args: Record<string, unknown>): Promise<StayRpcResult> {
  if (!serviceRoleKey()) return { status: "error", reason: "service_role_unconfigured" };
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: svcHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
      body: JSON.stringify(args),
      cache: "no-store",
    });
    const body = await r.json().catch(() => null);
    if (r.ok) return { status: "ok", body };
    if (rpcMissing(r.status, body)) return { status: "missing" };
    const b = (body || {}) as { code?: string; message?: string; details?: string };
    // A plpgsql RAISE (P0001) — whatever HTTP status PostgREST wraps it in — is a
    // refusal: the transaction has already rolled back.
    if (String(b.code || "") === "P0001") {
      return { status: "refused", code: String(b.message || "refused"), detail: b.details ? String(b.details) : null };
    }
    // The lines EXCLUDE constraint (23P01) refusing an insert also rolls the RPC back.
    if (r.status === 409 || String(b.code || "") === "23P01" || String(b.code || "") === "23505") {
      return { status: "refused", code: "unit_conflict", detail: b.details ? String(b.details) : null };
    }
    return { status: "error", reason: `rpc_${fn}_failed_${r.status}` };
  } catch (e: any) {
    return { status: "error", reason: e?.message || "rpc_error" };
  }
}
